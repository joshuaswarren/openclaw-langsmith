# openclaw-langsmith

[![npm version](https://img.shields.io/npm/v/openclaw-langsmith.svg)](https://www.npmjs.com/package/openclaw-langsmith)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

LangSmith tracing plugin for [OpenClaw](https://github.com/openclaw/openclaw). Automatically traces agent turns, tool calls, and LLM invocations to [LangSmith](https://smith.langchain.com/) for observability, debugging, and cost tracking.

## Features

- **Agent turn tracing** — Each agent turn becomes a LangSmith run with prompt, response, and token usage
- **Token tracking** — Prompt tokens, completion tokens, and total tokens displayed in LangSmith dashboard
- **Smart tagging** — Auto-tags traces with source (cron, discord, slack, telegram), job names, channel IDs
- **Tool call tracing** — Tool calls nested under their parent agent run
- **Engram LLM tracing** — Memory extraction/consolidation calls appear as LLM runs with full prompts
- **Batch queue** — Operations batched for efficient API usage (configurable interval and size)
- **Per-feature toggles** — Enable/disable each trace type independently
- **Zero runtime dependencies** — Uses native `fetch` and `crypto.randomUUID()`
- **Error isolation** — Tracing errors never affect gateway operation

## Quick Start

### 1. Get a LangSmith API Key

1. Sign up at [smith.langchain.com](https://smith.langchain.com/)
2. Go to **Settings > API Keys**
3. Create a new API key (starts with `lsv2_pt_...`)

### 2. Install the Plugin

```bash
cd ~/.openclaw/extensions
git clone https://github.com/joshuaswarren/openclaw-langsmith.git
cd openclaw-langsmith
npm install && npm run build
```

### 3. Add API Key to Gateway Environment

The gateway needs the API key in its environment. Choose your platform:

<details>
<summary><strong>macOS (launchd)</strong></summary>

Edit `~/Library/LaunchAgents/ai.openclaw.gateway.plist` and add inside `EnvironmentVariables`:

```xml
<key>LANGSMITH_API_KEY</key>
<string>lsv2_pt_your_key_here</string>
```
</details>

<details>
<summary><strong>Linux (systemd)</strong></summary>

Edit `~/.config/systemd/user/openclaw-gateway.service` and add to the `[Service]` section:

```ini
Environment="LANGSMITH_API_KEY=lsv2_pt_your_key_here"
```

Or create an environment file at `~/.config/openclaw/env`:

```bash
LANGSMITH_API_KEY=lsv2_pt_your_key_here
```

Then reference it in the service file:

```ini
EnvironmentFile=%h/.config/openclaw/env
```
</details>

<details>
<summary><strong>Docker</strong></summary>

Add to your `docker-compose.yml` or pass via `-e`:

```yaml
environment:
  - LANGSMITH_API_KEY=lsv2_pt_your_key_here
```
</details>

### 4. Enable in openclaw.json

```json
{
  "plugins": {
    "allow": ["openclaw-langsmith"],
    "entries": {
      "openclaw-langsmith": {
        "enabled": true,
        "config": {
          "langsmithApiKey": "${LANGSMITH_API_KEY}",
          "projectName": "openclaw"
        }
      }
    }
  }
}
```

### 5. Restart Gateway

**macOS:**
```bash
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

**Linux:**
```bash
systemctl --user restart openclaw-gateway
```

**Docker:**
```bash
docker compose restart openclaw-gateway
```

**Verify** (all platforms):
```bash
tail -f ~/.openclaw/logs/gateway.log | grep langsmith
# Should see: [langsmith] langsmith tracing active
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `langsmithApiKey` | string | `$LANGSMITH_API_KEY` | LangSmith API key |
| `langsmithEndpoint` | string | `https://api.smith.langchain.com` | API endpoint |
| `projectName` | string | `openclaw` | LangSmith project name |
| `traceAgentTurns` | boolean | `true` | Trace agent turns |
| `traceToolCalls` | boolean | `true` | Trace tool calls |
| `traceEngramLlm` | boolean | `true` | Trace engram LLM calls |
| `batchIntervalMs` | number | `1000` | Batch flush interval (ms) |
| `batchMaxSize` | number | `20` | Max operations before flush |
| `debug` | boolean | `false` | Enable debug logging |

## Filtering Traces

Traces are automatically tagged for easy filtering in LangSmith:

| Tag | Description | Example |
|-----|-------------|---------|
| `cron` | Cron job runs | Filter all scheduled jobs |
| `discord` | Discord messages | Filter Discord conversations |
| `slack` | Slack messages | Filter Slack conversations |
| `telegram` | Telegram messages | Filter Telegram conversations |
| `job:<id>` | Specific cron job | `job:96b7720d-02b1-4373-8846-33306c9913fc` |
| `name:<name>` | Cron job name | `name:X Bookmarks → Insights pipeline` |
| `channel:<id>` | Discord channel | `channel:1467253309348909241` |
| `guild:#<name>` | Discord guild | `guild:#proj-deckard` |

## How It Works

### Agent Turns
Hooks into `before_agent_start` and `agent_end`. Creates LangSmith runs with:
- Prompt content
- Response messages
- Token usage (prompt, completion, total)
- Duration
- Auto-generated tags based on session source

### Tool Calls
Hooks into `before_tool_call` and `after_tool_call`. Tool runs are nested under the parent agent run using LangSmith's `trace_id` and `dotted_order` for proper hierarchy.

### Engram LLM Calls
The engram memory plugin emits `LlmTraceEvent` objects via `globalThis.__openclawEngramTrace`. This plugin subscribes and creates LLM runs with:
- Full prompt text
- Model and operation type
- Token usage and duration
- Output (truncated to 2000 chars)

### Error Isolation
- All LangSmith API calls wrapped in try/catch
- Failures log warnings but never affect gateway
- If no API key configured, plugin logs warning and exits cleanly

## Development

```bash
npm install
npm run build    # Build with tsup
npm run dev      # Watch mode
```

## Related Projects

- [OpenClaw](https://github.com/openclaw/openclaw) — The AI agent gateway
- [openclaw-engram](https://github.com/joshuawarren/openclaw-engram) — Local-first memory plugin
- [LangSmith](https://smith.langchain.com/) — LLM observability platform

## License

MIT © Joshua Warren
