# Changelog

## [0.4.1] - 2026-04-02

### Added (Codex CLI PreCompact Hook)
- **precompact.py** — Codex context compaction checkpoint hook: saves critical context to WoClaw Hub before Codex compresses its context window
  - Scans `~/.codex/sessions/` for latest session transcript (last 30 lines)
  - Writes checkpoint as `compact:{project_key}:{timestamp}` to Hub memory
  - Registered as Codex `PreCompact` hook via `~/.codex/hooks.json`
  - Updated `install.py` to install/uninstall precompact.py automatically

## [0.4.0] - 2026-04-02

### Added (Codex CLI Integration ⭐)
- **woclaw-codex package** — `packages/codex-woclaw/` with Python hooks for OpenAI Codex CLI
  - `session_start.py` — reads shared context from WoClaw Hub on session start, injects as additionalContext
  - `stop.py` — reads session transcript and writes summary to WoClaw Hub on session end
  - `install.py` — one-command installer: creates `~/.codex/hooks/` + `~/.codex/hooks.json` + enables `codex_hooks` in config
  - `bin/cli.js` — npm entry point (`npx woclaw-codex install`)
  - README with usage docs


All notable changes to WoClaw will be documented in this file.

## [0.3.1] - 2026-04-02

### Fixed (woclaw-hooks)
- REST URL format fixed (removed trailing /api prefix)
- Default Hub address corrected
- JSON injection format fixed in hook scripts

### Documentation
- Added woclaw-hooks npm version badge to README
- Fixed version display in README

## [0.3.0] - 2026-04-01

### Changed (Plugin Refactoring)
- **OpenClaw v2026.3+ compatibility**: Plugin now uses `defineChannelPluginEntry` API
- Plugin entry point refactored: `index.ts` uses `defineChannelPluginEntry` wrapper
- Channel implementation moved to `channel.ts` with proper TypeScript types
- `ws` module proper type declarations via `types/ws.d.ts`
- Plugin types moved to `plugin-types.d.ts` (ambient module declaration)
- Improved TypeScript strictness and type safety

### Technical Details
- Uses `openclaw/plugin-sdk/core` for proper plugin SDK integration
- Separate `types/` directory for ambient type declarations
- Proper ESM module exports for OpenClaw plugin loading

## [0.2.0] - 2026-03-31

### Added (v0.4 - Memory Tags + TTL)
- **Memory Tags**: `memory.write(key, value, tags)` — tag memory entries with labels (`project`, `fact`, `decision`, `config`)
- **Memory TTL**: `memory.write(key, value, tags, ttl)` — set expiry time in seconds (0 = permanent)
- **Auto-Expiry**: `memory.read()` and `memory.getAll()` automatically filter expired entries
- **Tag Queries**: REST `GET /memory/tags/:tag` and `GET /memory?tags=filter`
- **REST POST /memory**: Now accepts `{ key, value, tags, ttl }` for full v0.4 support
- **WebSocket memory_write**: Now accepts optional `tags` and `ttl` parameters
- **Backwards Compatible**: Old DB entries auto-migrate on load (adds empty tags/ttl)
- `cleanupExpired()` for periodic maintenance

### Changed
- `DBMemory` interface: `tags: string[]`, `ttl: number`, `expireAt: number`
- `memory_value` WS response now includes `tags`, `ttl`, `expireAt`
- `memory_update` WS broadcast now includes `tags`, `ttl`, `expireAt`
- `DBMemory` updated in `types.ts`, `db.ts`, `memory.ts`, `ws_server.ts`, `rest_server.ts`

## [0.1.5] - 2026-03-31

### Added
- Channel Plugin architecture for OpenClaw integration
- ESM module support for modern Node.js
- npm package: `xingp14-woclaw`
- GitHub Actions publish workflow
- Hook lifecycle system for memory integration
- MCP bridge support
- Multi-framework support (OpenClaw, Claude Code, Gemini CLI, OpenCode)

### Changed
- Project renamed from ClawLink to WoClaw
- Hub now uses TypeScript throughout
- README updated with comprehensive documentation
- Plugin split into separate `plugin/` directory with its own package

### Fixed
- ESM/CJS module compatibility
- Docker build configuration
- WebSocket reconnection handling

### Deprecated
- CLAWLINK_* environment variables (replaced by CLAW_*)

## [0.1.0] - 2026-03-26

### Added
- Initial WoClaw Hub implementation
- WebSocket-based message relay
- Topic-based pub/sub system
- REST API for hub management
- Basic Docker support
- Token authentication
