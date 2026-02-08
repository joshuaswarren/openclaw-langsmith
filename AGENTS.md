# openclaw-langsmith - Agent Guide

## What This Plugin Does (Simple Explanation)

This plugin sends tracing data to LangSmith so you can analyze and debug OpenClaw agent runs.

Think of it like a flight recorder for AI conversations:
- Every agent turn, tool call, and LLM call gets recorded
- You can see token usage, latency, and success/failure
- LangSmith provides dashboards, search, and analysis tools
- Helps debug why agents failed or misbehaved

## Why This Exists

When agents behave unexpectedly, you need visibility into:
1. What prompt did the agent receive?
2. What tools did it call and with what parameters?
3. How many tokens did each step use?
4. What model was used for each call?
5. Where did things go wrong?

Without tracing, you're debugging blind. LangSmith provides:
- **Trace visualization** - See the full call tree
- **Latency analysis** - Find slow steps
- **Token tracking** - Understand costs
- **Error aggregation** - Find common failure patterns

## How It Fits Into OpenClaw

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                         │
│                                                              │
│  ┌────────────────┐    ┌────────────────┐                   │
│  │  Agent Runs    │    │   Tool Calls   │                   │
│  └───────┬────────┘    └───────┬────────┘                   │
│          │                     │                             │
│          └──────────┬──────────┘                             │
│                     │                                        │
│              ┌──────┴───────┐                                │
│              │  LangSmith   │  <-- THIS PLUGIN               │
│              │   Tracer     │                                │
│              └──────┬───────┘                                │
│                     │                                        │
│                     ▼                                        │
│              ┌──────────────┐                                │
│              │ LangSmith    │                                │
│              │   Cloud      │                                │
│              └──────────────┘                                │
└─────────────────────────────────────────────────────────────┘
```

The plugin:
1. **Hooks into agent lifecycle** - Captures start/end of agent turns
2. **Hooks into tool calls** - Captures tool name, params, result
3. **Extracts token usage** - Parses usage data from messages
4. **Sends to LangSmith** - Batches and uploads trace data

## Key Concepts

### 1. Run Types

| Run Type | What It Captures | Hook Used |
|----------|------------------|-----------|
| Chain | Full agent turn (prompt → response) | `before_agent_start`, `agent_end` |
| Tool | Individual tool call | `before_tool_call`, `after_tool_call` |
| LLM | Raw LLM call (via Engram callback) | Custom callback |

### 2. Token Usage Extraction

Token data is extracted from the **last assistant message** in the messages array:

```typescript
// OpenClaw usage format
{
  input: number,      // Prompt tokens
  output: number,     // Completion tokens
  cacheRead: number,  // Cached prompt tokens
  cacheWrite: number  // Tokens written to cache
}

// Mapped to LangSmith format
{
  input_tokens: input + cacheRead + cacheWrite,
  output_tokens: output,
  total_tokens: input + output + cacheRead + cacheWrite
}
```

### 3. Model Detection

The plugin tries multiple sources to find the model used:

1. Event fields (`event.model`, `event.modelUsed`)
2. Context fields (`ctx.model`, `ctx.modelUsed`)
3. Message metadata (`msg.meta.model`)
4. Session file lookup (`sessions.json`)

### 4. Session Key

Traces are grouped by session key (e.g., `agent:generalist:discord:channel:123`). This allows you to see all turns in a conversation together.

## File Structure

```
~/.openclaw/extensions/openclaw-langsmith/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── openclaw.plugin.json
├── CLAUDE.md              # Privacy policy
├── AGENTS.md              # This file
└── src/
    ├── index.ts           # Plugin entry, hook registration
    ├── config.ts          # Config parsing
    ├── types.ts           # TypeScript interfaces
    ├── logger.ts          # Logging wrapper
    ├── client.ts          # LangSmith API client
    └── tracer.ts          # Trace management and batching
```

### Key Files Explained

**index.ts** - Plugin entry point:
- Registers hooks for agent and tool lifecycle
- Extracts token usage from messages
- Looks up model info from multiple sources
- Manages session model cache (10s TTL)

**client.ts** - LangSmith API client:
- Handles authentication with LangSmith
- Batches trace data for efficient upload
- Manages connection and graceful shutdown

**tracer.ts** - Trace management:
- Creates and closes trace runs
- Manages parent-child relationships (agent → tool)
- Handles run IDs and timing

## Configuration

In `openclaw.json`:

```json
{
  "plugins": {
    "openclaw-langsmith": {
      "langsmithApiKey": "${LANGSMITH_API_KEY}",
      "traceAgentTurns": true,
      "traceToolCalls": true,
      "traceEngramLlm": false,
      "debug": false
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `langsmithApiKey` | string | required | LangSmith API key |
| `traceAgentTurns` | boolean | `true` | Trace agent start/end |
| `traceToolCalls` | boolean | `true` | Trace individual tool calls |
| `traceEngramLlm` | boolean | `false` | Trace Engram's internal LLM calls |
| `debug` | boolean | `false` | Enable verbose logging |

## Hooks Used

### before_agent_start

Fired before an agent processes a prompt.

```typescript
api.on("before_agent_start", (event, ctx) => {
  const prompt = event.prompt;          // User's prompt
  const sessionKey = ctx.sessionKey;    // Session identifier
  tracer.startAgentRun(sessionKey, prompt);
});
```

### agent_end

Fired after an agent completes its turn.

```typescript
api.on("agent_end", (event, ctx) => {
  const messages = event.messages;      // Full message array
  const success = event.success;        // Whether turn succeeded
  const durationMs = event.durationMs;  // Turn duration

  // Extract usage from last assistant message
  const usage = extractUsageFromMessages(messages);

  tracer.endAgentRun(sessionKey, messages, success, usage, durationMs, model, provider);
});
```

### before_tool_call / after_tool_call

Fired around tool execution.

```typescript
api.on("before_tool_call", (event, ctx) => {
  const toolName = event.toolName;
  const params = event.params;
  const runId = tracer.startToolRun(sessionKey, toolName, params);
  event._langsmithToolRunId = runId;  // Store for after_tool_call
});

api.on("after_tool_call", (event) => {
  const runId = event._langsmithToolRunId;
  tracer.endToolRun(runId, event.result, event.error);
});
```

## Engram Integration

If both plugins are installed, LangSmith can trace Engram's internal LLM calls:

```typescript
// Engram exposes a trace callback slot
(globalThis as any).__openclawEngramTrace = (event: LlmTraceEvent) => {
  tracer.traceLlmCall(event);
};
```

This captures:
- Memory extraction calls to GPT-5.2
- Consolidation calls
- Contradiction detection calls

Enable with `traceEngramLlm: true` in config.

## Common Tasks

### Viewing Traces

1. Go to [smith.langchain.com](https://smith.langchain.com)
2. Select your project
3. Browse runs by time, status, or search

### Debugging a Failed Turn

1. Find the failed run in LangSmith
2. Expand the trace tree
3. Look for red (error) nodes
4. Check the error message and stack trace
5. Look at the input that caused the failure

### Analyzing Token Usage

1. Filter runs by time range
2. Sort by total tokens
3. Identify expensive operations
4. Check if caching is working (`cacheRead` > 0)

### Adding Custom Metadata

Currently not supported directly, but you could:
1. Fork the plugin
2. Add metadata to `tracer.startAgentRun()` calls
3. Include session info, user ID, etc.

## Footguns (Common Mistakes)

### 1. Missing API Key

**Symptom**: "no LangSmith API key — tracing disabled" in logs.

**Fix**: Add `LANGSMITH_API_KEY` to the gateway's launchd plist:
```bash
# Edit ~/Library/LaunchAgents/ai.openclaw.gateway.plist
# Add to EnvironmentVariables dict
```

### 2. No Token Data in Traces

**Symptom**: Traces show 0 tokens.

**Cause**: Token usage is only in the last assistant message. If the message array is empty or has no usage field, extraction fails.

**Fix**: Check that the model/provider includes usage data in responses.

### 3. Model Shows as "undefined"

**Symptom**: LangSmith traces don't show which model was used.

**Cause**: Model info isn't in any of the expected locations.

**Fix**: The plugin checks multiple sources in order:
1. `event.model` / `event.modelUsed`
2. `ctx.model` / `ctx.modelUsed`
3. Message metadata
4. Session file

Ensure at least one source has the data.

### 4. Session Cache Stale

**Symptom**: Wrong model shown for some traces.

**Cause**: Session model cache has a 10s TTL. If the model changes mid-session, old value may be used.

**Fix**: This is a trade-off for performance. Reduce `SESSION_CACHE_TTL_MS` if accuracy is critical.

### 5. Tool Run ID Lost

**Symptom**: Tool traces don't close properly.

**Cause**: The `_langsmithToolRunId` property on the event wasn't preserved between hooks.

**Fix**: Ensure nothing clears event properties between `before_tool_call` and `after_tool_call`.

## Testing Changes

```bash
# Build the plugin
cd ~/.openclaw/extensions/openclaw-langsmith
npm run build

# Reload gateway
kill -USR1 $(pgrep openclaw-gateway)

# Trigger an agent run
# ...

# Check LangSmith dashboard for new traces
# Check logs for errors
grep "\[langsmith\]" ~/.openclaw/logs/gateway.log
```

## Debug Mode

Enable in `openclaw.json`:
```json
{
  "plugins": {
    "openclaw-langsmith": {
      "debug": true
    }
  }
}
```

This logs:
- Hook registration
- Each agent_end event details
- Model and provider detection
- Token extraction results
