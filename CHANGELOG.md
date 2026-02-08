# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-02-08

### Added
- Model and provider tracking for all LLM calls
- Model info (provider/model name) now appears in LangSmith trace outputs
- Tags for filtering by `provider:` and `model:` in LangSmith UI
- Metadata includes `models_used` array when multiple models are used in a turn

### Changed
- Provider is now extracted from the model string when available (e.g., `anthropic/claude-opus-4-5`)
- Falls back to event-provided provider info, then pattern inference as last resort

## [1.1.0] - 2026-02-06

### Added
- Token usage tracking in agent runs
- Support for `usage_metadata` in outputs for LangSmith token columns
- Tags extracted from session key (cron, discord, channel, job name)

## [1.0.0] - 2026-02-05

### Added
- Initial release
- Agent turn tracing (before_agent_start, agent_end hooks)
- Tool call tracing (before_tool_call, after_tool_call hooks)
- Engram LLM call tracing (via global callback)
- Batched run submission to LangSmith API
- Configurable project name, batch size, and intervals
