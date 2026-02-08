import type { PluginConfig, LangSmithRun, LlmTraceEvent, TokenUsage, ModelInfo } from "./types.js";
import type { LangSmithClient } from "./client.js";
import { log } from "./logger.js";

interface ActiveRun {
  runId: string;
  traceId: string; // Root run ID for this trace
  dottedOrder: string; // Ordering key for LangSmith
  parentRunId?: string;
  startTime: string;
  input?: string; // Stored from llm_start for use in llm_end
}

/**
 * Parse model info from event data
 *
 * Priority:
 * 1. If provider is explicitly provided in the event, use it directly
 * 2. If model string contains "/" (e.g., "anthropic/claude-opus-4-5"), parse it
 * 3. Fallback: infer from model name patterns (last resort)
 */
function parseModelInfo(model: string, provider?: string): ModelInfo {
  // If provider is explicitly provided, use it directly
  if (provider) {
    return { provider, model };
  }

  // If model contains provider prefix (e.g., "anthropic/claude-opus-4-5")
  if (model.includes("/")) {
    const [prov, ...rest] = model.split("/");
    return { provider: prov, model: rest.join("/") };
  }

  // Fallback: infer from model name patterns (not ideal, but necessary for some cases)
  let inferredProvider = "unknown";
  if (model.startsWith("claude")) {
    inferredProvider = "anthropic";
  } else if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3")) {
    inferredProvider = "openai";
  } else if (model.startsWith("gemini")) {
    inferredProvider = "google";
  } else if (model.startsWith("glm")) {
    inferredProvider = "zai";
  } else if (model.startsWith("kimi")) {
    inferredProvider = "kimi";
  }

  return { provider: inferredProvider, model };
}

/** Extract tags from session key and prompt for LangSmith filtering */
function extractTags(sessionKey: string, prompt?: string): string[] {
  const tags: string[] = [];

  // Parse session key: agent:generalist:discord:channel:123 or agent:generalist:cron:abc
  const parts = sessionKey.split(":");
  if (parts.includes("cron")) {
    tags.push("cron");
    const cronIdx = parts.indexOf("cron");
    if (parts[cronIdx + 1]) {
      tags.push(`job:${parts[cronIdx + 1]}`);
    }
  } else if (parts.includes("discord")) {
    tags.push("discord");
    const channelIdx = parts.indexOf("channel");
    if (channelIdx >= 0 && parts[channelIdx + 1]) {
      tags.push(`channel:${parts[channelIdx + 1]}`);
    }
  } else if (parts.includes("telegram")) {
    tags.push("telegram");
  } else if (parts.includes("slack")) {
    tags.push("slack");
  }

  // Extract job name from cron prompt: [cron:id Job Name (schedule)]
  if (prompt && tags.includes("cron")) {
    const cronMatch = prompt.match(/\[cron:[^\s]+\s+([^\(]+)\s*\(/);
    if (cronMatch?.[1]) {
      tags.push(`name:${cronMatch[1].trim()}`);
    }
  }

  // Extract guild/channel name from Discord prompt: [Discord Guild #name ...]
  if (prompt && tags.includes("discord")) {
    const guildMatch = prompt.match(/\[Discord Guild (#[^\s]+)/);
    if (guildMatch?.[1]) {
      tags.push(`guild:${guildMatch[1]}`);
    }
  }

  return tags;
}

/** Create dotted_order timestamp format: YYYYMMDDTHHMMSSssssssZ */
function formatDottedOrderTime(date: Date): string {
  const pad = (n: number, len = 2) => n.toString().padStart(len, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}${pad(date.getUTCMilliseconds(), 3)}000Z`;
}

/** Create dotted_order: for root runs it's timestamp+runId, for child runs it's parent.timestamp+runId */
function makeDottedOrder(runId: string, parentDottedOrder?: string): string {
  const ts = formatDottedOrderTime(new Date());
  const cleanId = runId.replace(/-/g, "");
  if (parentDottedOrder) {
    return `${parentDottedOrder}.${ts}${cleanId}`;
  }
  return `${ts}${cleanId}`;
}

export class Tracer {
  // Active agent runs keyed by sessionKey
  private activeAgentRuns = new Map<string, ActiveRun>();
  // Active tool runs keyed by toolCallId
  private activeToolRuns = new Map<string, ActiveRun>();
  // Track model usage per session (aggregated from llm_end events during a turn)
  private sessionModels = new Map<string, ModelInfo[]>();

  constructor(
    private readonly client: LangSmithClient,
    private readonly config: PluginConfig,
  ) {}

  /** Record an LLM call for a session (called from llm_end hook) */
  recordLlmCall(sessionKey: string, model: string, provider?: string): void {
    const modelInfo = parseModelInfo(model, provider);
    const models = this.sessionModels.get(sessionKey) ?? [];
    models.push(modelInfo);
    this.sessionModels.set(sessionKey, models);
    log.debug(`recorded LLM call for ${sessionKey}: ${modelInfo.provider}/${modelInfo.model}`);
  }

  /** Get the primary model used in a session (most recent or most used) */
  private getSessionModelInfo(sessionKey: string): ModelInfo | undefined {
    const models = this.sessionModels.get(sessionKey);
    if (!models || models.length === 0) return undefined;
    // Return the last (most recent) model used
    return models[models.length - 1];
  }

  /** Get all models used in a session */
  private getAllSessionModels(sessionKey: string): string[] {
    const models = this.sessionModels.get(sessionKey);
    if (!models || models.length === 0) return [];
    // Deduplicate
    const seen = new Set<string>();
    return models
      .map((m) => `${m.provider}/${m.model}`)
      .filter((s) => {
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      });
  }

  startAgentRun(sessionKey: string, prompt: string): void {
    try {
      const runId = crypto.randomUUID();
      const startTime = new Date().toISOString();
      const dottedOrder = makeDottedOrder(runId);
      const tags = extractTags(sessionKey, prompt);

      // Agent run is the root, so trace_id = runId
      this.activeAgentRuns.set(sessionKey, { runId, traceId: runId, dottedOrder, startTime });

      const run: LangSmithRun = {
        id: runId,
        trace_id: runId, // Agent runs are root runs
        dotted_order: dottedOrder,
        name: "agent_turn",
        run_type: "llm", // Using llm type so LangSmith populates token columns
        inputs: { prompt },
        start_time: startTime,
        session_name: this.config.projectName,
        tags: tags.length > 0 ? tags : undefined,
        extra: { metadata: { sessionKey } },
      };

      this.client.createRun(run);
      log.debug(`started agent run ${runId} for session ${sessionKey} tags=${tags.join(",")}`);
    } catch (err) {
      log.warn(`failed to start agent run: ${err}`);
    }
  }

  endAgentRun(sessionKey: string, messages: unknown, success: boolean, usage?: TokenUsage, durationMs?: number): void {
    try {
      const active = this.activeAgentRuns.get(sessionKey);
      if (!active) {
        log.debug(`no active agent run for session ${sessionKey}`);
        return;
      }

      this.activeAgentRuns.delete(sessionKey);

      // Get model info tracked during this turn
      const modelInfo = this.getSessionModelInfo(sessionKey);
      const allModels = this.getAllSessionModels(sessionKey);
      // Clear session models for next turn
      this.sessionModels.delete(sessionKey);

      // Normalize token usage - OpenClaw might use different field names
      const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
      const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens);

      log.debug(`endAgentRun: session=${sessionKey}, tokens=${totalTokens}, model=${modelInfo?.provider}/${modelInfo?.model}`);

      // LangSmith expects usage_metadata in outputs for token tracking
      const usageMetadata = totalTokens > 0 ? {
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        total_tokens: totalTokens,
      } : undefined;

      const patch: Partial<LangSmithRun> = {
        id: active.runId,
        trace_id: active.traceId,
        dotted_order: active.dottedOrder,
        end_time: new Date().toISOString(),
        outputs: {
          messages,
          success,
          // Model info for easy visibility
          ...(modelInfo && { model: modelInfo.model, provider: modelInfo.provider }),
          ...(allModels.length > 1 && { all_models: allModels }),
          // usage_metadata is where LangSmith extracts token counts from
          ...(usageMetadata && { usage_metadata: usageMetadata }),
        },
        // Top-level token fields (may only work for llm run types)
        ...(totalTokens > 0 && {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        }),
        extra: {
          metadata: {
            sessionKey,
            durationMs,
            // Model info for LangSmith metadata panel
            ...(modelInfo && {
              model: modelInfo.model,
              provider: modelInfo.provider,
            }),
            ...(allModels.length > 0 && { models_used: allModels }),
          },
          // Also try putting usage data in extra.usage
          ...(usageMetadata && {
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: totalTokens,
            },
          }),
        },
        // Add tags for model/provider for easy filtering in LangSmith
        tags: [
          ...(modelInfo ? [`provider:${modelInfo.provider}`, `model:${modelInfo.model}`] : []),
        ],
      };

      if (!success) {
        patch.error = "Agent turn failed";
      }

      this.client.updateRun(active.runId, patch);
      log.debug(`ended agent run ${active.runId} (model: ${modelInfo?.provider}/${modelInfo?.model}, tokens: ${totalTokens}, duration: ${durationMs}ms)`);
    } catch (err) {
      log.warn(`failed to end agent run: ${err}`);
    }
  }

  startToolRun(sessionKey: string, toolName: string, params: unknown): string | undefined {
    try {
      const runId = crypto.randomUUID();
      const startTime = new Date().toISOString();

      // Parent is the current agent run for this session
      const parentRun = this.activeAgentRuns.get(sessionKey);
      const parentRunId = parentRun?.runId;
      // Inherit trace_id from parent agent run, or use own ID if orphan
      const traceId = parentRun?.traceId ?? runId;
      // For tool runs, chain to parent's dotted_order if available
      const dottedOrder = makeDottedOrder(runId, parentRun?.dottedOrder);

      this.activeToolRuns.set(runId, { runId, traceId, dottedOrder, parentRunId, startTime });

      const run: LangSmithRun = {
        id: runId,
        trace_id: traceId,
        dotted_order: dottedOrder,
        name: toolName,
        run_type: "tool",
        inputs: { params },
        parent_run_id: parentRunId,
        start_time: startTime,
        session_name: this.config.projectName,
      };

      this.client.createRun(run);
      log.debug(`started tool run ${runId} (${toolName})`);
      return runId;
    } catch (err) {
      log.warn(`failed to start tool run: ${err}`);
      return undefined;
    }
  }

  endToolRun(toolCallId: string, result: unknown, error?: string): void {
    try {
      const active = this.activeToolRuns.get(toolCallId);
      if (!active) {
        log.debug(`no active tool run for ${toolCallId}`);
        return;
      }

      this.activeToolRuns.delete(toolCallId);

      const patch: Partial<LangSmithRun> = {
        id: active.runId,
        trace_id: active.traceId,
        dotted_order: active.dottedOrder,
        end_time: new Date().toISOString(),
        outputs: { result },
      };

      if (error) {
        patch.error = error;
      }

      this.client.updateRun(active.runId, patch);
      log.debug(`ended tool run ${active.runId}`);
    } catch (err) {
      log.warn(`failed to end tool run: ${err}`);
    }
  }

  traceLlmCall(event: LlmTraceEvent): void {
    try {
      if (event.kind === "llm_start") {
        // Store for later pairing — we'll create the full run on llm_end/llm_error
        const dottedOrder = makeDottedOrder(event.traceId);
        this.activeToolRuns.set(`llm:${event.traceId}`, {
          runId: event.traceId,
          traceId: event.traceId, // LLM calls from engram are standalone traces
          dottedOrder,
          startTime: new Date().toISOString(),
          input: event.input, // Store input for use in llm_end
        });
        return;
      }

      // For llm_end and llm_error, create a complete run in one shot
      const startEntry = this.activeToolRuns.get(`llm:${event.traceId}`);
      if (startEntry) {
        this.activeToolRuns.delete(`llm:${event.traceId}`);
      }

      const startTime = startEntry?.startTime ?? new Date().toISOString();
      const endTime = new Date().toISOString();
      // Use stored dotted_order from start, or create new one
      const dottedOrder = startEntry?.dottedOrder ?? makeDottedOrder(event.traceId);
      // Use stored input from llm_start, or fallback to event.input
      const inputText = startEntry?.input ?? event.input ?? "(not captured)";

      // Normalize token usage from engram event
      const promptTokens = event.tokenUsage?.input ?? 0;
      const completionTokens = event.tokenUsage?.output ?? 0;
      const totalTokens = event.tokenUsage?.total ?? (promptTokens + completionTokens);

      // LangSmith expects usage_metadata in outputs for token tracking
      const usageMetadata = totalTokens > 0 ? {
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        total_tokens: totalTokens,
      } : undefined;

      const run: LangSmithRun = {
        id: event.traceId,
        trace_id: event.traceId, // LLM calls from engram are standalone traces
        dotted_order: dottedOrder,
        name: `engram:${event.operation}`,
        run_type: "llm",
        inputs: { prompt: inputText },
        outputs: {
          ...(event.output && { completion: event.output }),
          ...(usageMetadata && { usage_metadata: usageMetadata }),
        },
        start_time: startTime,
        end_time: endTime,
        error: event.error,
        session_name: this.config.projectName,
        // Top-level token fields for llm run types
        ...(totalTokens > 0 && {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        }),
        extra: {
          metadata: {
            model: event.model,
            operation: event.operation,
            durationMs: event.durationMs,
          },
          // Also in extra.usage
          ...(usageMetadata && {
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: totalTokens,
            },
          }),
        },
      };

      this.client.createRun(run);
      log.debug(`traced LLM call ${event.traceId} (${event.operation}, ${event.kind})`);
    } catch (err) {
      log.warn(`failed to trace LLM call: ${err}`);
    }
  }
}
