# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.1.0] - 2026-02-07

### Added
- Smart tagging for trace filtering — auto-tags traces with source (`cron`, `discord`, `slack`, `telegram`), job names, channel IDs, guild names
- Token usage tracking on LangSmith dashboard columns

### Fixed
- Token counts now display correctly in LangSmith dashboard (changed run_type from `chain` to `llm`)
- Fixed inflated token counts — now only counts tokens from current turn, not cumulative conversation history
- Engram LLM runs now capture input prompts (previously showed "(not captured)")

### Changed
- Agent turns now use `llm` run type instead of `chain` for proper token tracking

## [1.0.0] - 2026-02-07

### Added
- Initial release
- Agent turn tracing (chain runs)
- Tool call tracing (tool runs)
- Engram LLM call tracing via globalThis callback
- Batch queue for efficient API usage
- Configurable per-feature toggles
