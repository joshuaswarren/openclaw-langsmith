# openclaw-langsmith

## PUBLIC REPOSITORY — Privacy Policy

**This repository is PUBLIC on GitHub.** Every commit is visible to the world.

### Rules for ALL agents committing to this repo:

1. **NEVER commit API keys, tokens, or secrets** — even in comments or examples
2. **NEVER commit trace data** — LangSmith traces contain conversation content
3. **NEVER commit session IDs or user identifiers** — these are private
4. **NEVER commit `.env` files** or any file containing credentials
5. **NEVER reference specific users, conversations, or sessions** in code comments or commit messages
6. **Config examples must use placeholders** — `${LANGSMITH_API_KEY}`, not actual keys

### What IS safe to commit:
- Source code (`src/`)
- Package manifests (`package.json`, `tsconfig.json`, `tsup.config.ts`)
- Plugin manifest (`openclaw.plugin.json`)
- Documentation (`README.md`, `docs/`)
- Build configuration
- `.gitignore`
- This `CLAUDE.md` file

### Before every commit, verify:
- `git diff --cached` contains NO personal information
- No hardcoded API keys, URLs with tokens, or credentials
- No references to specific users or their trace data

## Architecture Notes

### File Structure
```
src/
├── index.ts              # Plugin entry point, hook registration
├── config.ts             # Config parsing
├── types.ts              # TypeScript interfaces
├── logger.ts             # Logging wrapper
├── client.ts             # LangSmith API client
└── tracer.ts             # Trace management and batching
```

### Key Patterns

1. **Hooks drive everything** — `before_agent_start`, `agent_end`, `before_tool_call`, `after_tool_call`
2. **Token usage from messages** — extracted from last assistant message
3. **Model detection cascade** — event → context → message metadata → session file
4. **Session cache** — 10s TTL to avoid repeated file reads
5. **Graceful shutdown** — flush pending traces on stop

### Integration Points

- `api.on("before_agent_start")` — start chain run
- `api.on("agent_end")` — end chain run with usage
- `api.on("before_tool_call")` — start tool run
- `api.on("after_tool_call")` — end tool run
- `api.registerService()` — graceful shutdown

### Engram Integration

If both plugins are installed, LangSmith can trace Engram's internal LLM calls:

```typescript
// Engram exposes a trace callback slot on globalThis
(globalThis as any).__openclawEngramTrace = (event) => {
  tracer.traceLlmCall(event);
};
```

Enable with `traceEngramLlm: true`.

### Testing Locally

```bash
# Build
npm run build

# Reload gateway
kill -USR1 $(pgrep openclaw-gateway)

# Trigger an agent run, then check LangSmith dashboard

# View logs
grep "\[langsmith\]" ~/.openclaw/logs/gateway.log
```

### Common Gotchas

1. **Missing API key** — add to launchd plist EnvironmentVariables
2. **Token data missing** — model/provider may not include usage in responses
3. **Model shows undefined** — check all detection sources in order
4. **Session cache stale** — 10s TTL, reduce if accuracy critical
