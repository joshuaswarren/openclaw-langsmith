import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseConfig } from "./config.js";
import { initLogger, log } from "./logger.js";
import { LangSmithClient } from "./client.js";
import { Tracer } from "./tracer.js";
import type { LlmTraceEvent, TokenUsage } from "./types.js";

/** Extract token usage from the LAST assistant message (current turn only, not cumulative) */
function extractUsageFromMessages(messages: unknown): TokenUsage | undefined {
  if (!Array.isArray(messages)) return undefined;

  // Find the last assistant message with usage data (represents current turn)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    if (m.role !== "assistant") continue;

    const usage = m.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    // OpenClaw uses: input, output, cacheRead, cacheWrite, total
    const input = typeof usage.input === "number" ? usage.input : 0;
    const output = typeof usage.output === "number" ? usage.output : 0;
    const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
    const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;

    // Map to LangSmith field names
    return {
      input_tokens: input + cacheRead + cacheWrite, // prompt tokens include cache
      output_tokens: output,
      total_tokens: input + output + cacheRead + cacheWrite,
    };
  }

  return undefined;
}

export default {
  id: "openclaw-langsmith",
  name: "LangSmith Tracing",
  description: "Automatic LangSmith tracing for OpenClaw agent turns, tool calls, and LLM calls.",
  kind: "utility" as const,

  register(api: OpenClawPluginApi) {
    const cfg = parseConfig(api.pluginConfig);
    initLogger(api.logger, cfg.debug);

    if (!cfg.langsmithApiKey) {
      log.warn("no LangSmith API key — tracing disabled");
      return;
    }

    const client = new LangSmithClient(cfg);
    const tracer = new Tracer(client, cfg);

    // Hook: before_agent_start — Start a chain run
    if (cfg.traceAgentTurns) {
      log.info("registering before_agent_start hook");
      api.on("before_agent_start", (event: Record<string, unknown>, ctx: Record<string, unknown>) => {
        const prompt = event.prompt as string | undefined;
        const sessionKey = (ctx?.sessionKey as string) ?? "default";
        if (prompt) {
          tracer.startAgentRun(sessionKey, prompt);
        }
      });
    }

    // Hook: agent_end — Close the chain run
    if (cfg.traceAgentTurns) {
      log.info("registering agent_end hook");
      api.on("agent_end", (event: Record<string, unknown>, ctx: Record<string, unknown>) => {
        const sessionKey = (ctx?.sessionKey as string) ?? "default";
        const durationMs = event.durationMs as number | undefined;

        // Extract token usage from messages array (assistant messages contain usage data)
        const usage = extractUsageFromMessages(event.messages);

        tracer.endAgentRun(sessionKey, event.messages, !!event.success, usage, durationMs);
      });
    }

    // Hook: before_tool_call — Start a tool run
    if (cfg.traceToolCalls) {
      api.on("before_tool_call", (event: Record<string, unknown>, ctx: Record<string, unknown>) => {
        const sessionKey = (ctx?.sessionKey as string) ?? "default";
        const toolName = event.toolName as string;
        const runId = tracer.startToolRun(sessionKey, toolName, event.params);
        // Store the runId on the event so after_tool_call can find it
        if (runId) {
          event._langsmithToolRunId = runId;
        }
      });
    }

    // Hook: after_tool_call — Close the tool run
    if (cfg.traceToolCalls) {
      api.on("after_tool_call", (event: Record<string, unknown>) => {
        const runId = (event._langsmithToolRunId ?? event.toolCallId) as string | undefined;
        if (runId) {
          tracer.endToolRun(runId, event.result, event.error as string | undefined);
        }
      });
    }

    // Subscribe to engram trace callback
    if (cfg.traceEngramLlm) {
      (globalThis as any).__openclawEngramTrace = (event: LlmTraceEvent) => {
        tracer.traceLlmCall(event);
      };
    }

    // Register service with graceful shutdown
    api.registerService({
      id: "openclaw-langsmith",
      start: () => {
        log.info("langsmith tracing active");
      },
      stop: async () => {
        await client.flush();
        client.close();
        // Clean up globalThis
        if ((globalThis as any).__openclawEngramTrace) {
          (globalThis as any).__openclawEngramTrace = undefined;
        }
        log.info("langsmith tracing stopped");
      },
    });
  },
};
