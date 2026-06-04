# Changelog

## [Unreleased]

> 当前开发版本，等待下一批工作累积。

### Added

- **Cloud-Native Readiness Probe (2026-06-04)** — k8s/容器化部署可观测性
  - 新增 `GET /ready` 端点（`hub/src/rest_server.ts` 的 `handleReady`）：仅当 `db / topics / memoryPool / wsServer` 4 个核心组件全部初始化完成时返回 200 + `{status:"ready", components:{...}}`；任一未就绪则返回 503 + `{status:"not-ready", ...}`。区别于 `/health`（仅检查进程是否在跑），`/ready` 是 k8s readiness probe 的正确选择 —— 流量只在 hub 真就绪时才会被路由过来
  - 新增 `hub/test/rest_server.test.ts` 中 4 个单测：`/ready` 200 全就绪 / 503 任一未就绪 / 503 部分未就绪 / handleReady mock 直返
  - 文档同步：`docs/API.md` 新增「就绪检查 `GET /ready`」小节（含 200/503 双响应示例 + 与 `/health` 区别说明）；`hub/README.md` REST API 表加一行

### Docs

- **Repo 拆分计划**（v0.6+ `RS-1: woclaw-hub 仓拆分`）
  - `docs/RS-1-REPO-SPLIT-HUB-PLAN.md`（Step 1）—— 拆分方案设计：审计 hub/ 自包含资源 + 识别需处理项 + 设计 3 步执行 + 风险评估
  - `docs/RS-1-EXECUTION-RUNBOOK.md`（Step 1.5）—— 父端执行 Step 2-4 的 turn-key 指南：`gh repo create` / `gh secret set` / `git filter-repo` 一键命令 + 验收清单 + 回滚方案

### Fixed

- **README npm 徽章漏更 / 过时 (2026-06-04)** — 4 个 README 文件与 npm registry 不一致
  - `docs/README.md` 顶部徽章 `woclaw-hub%400.4.1` → `400.5.0`（Hub 子包已发 v0.5.0 / GitHub Release, 徽章停留在 v0.4.1）
  - `README_zh.md` 顶部徽章：补 `woclaw-hub@0.5.0` / `woclaw-mcp@0.1.2` 版本号 + 补缺失的 `woclaw-codex@0.1.2` 整行
  - `docs/README_zh.md` 顶部徽章：补缺失的 4 行（`woclaw-hub@0.5.0` / `woclaw-mcp@0.1.2` / `woclaw-hooks@0.5.0` / `woclaw-codex@0.1.2`）
  - 4 个 README 现与根 `README.md`（权威 5 徽章）对齐, npmjs.com 页面点击跳转一致
  - **`docs/README.md` 表格漏更**（同一 fix 的延伸）—「npm Packages」表格里 `woclaw-hub` 仍标 `0.4.1`（15:10 轮只动了徽章, 没扫到表格行）。修正为 `0.5.0`，与 hub/package.json 权威版本对齐
  - **`plugin/bin/woclaw.js` CLI banner 漏更**（同一类问题）— 两处硬编码的 `v0.4.0` 字面量（usage banner line 55 + interactive shell banner line 216）未随 `package.json` 从 `0.4.0` 升到 `0.4.3` 同步。修正为 `v0.4.3`，与 `xingp14-woclaw@0.4.3` 权威版本对齐。`dist/bin/` 是 gitignored 的 build 产物, 不入库, 重新 `npm run build` 即同步

## [0.5.0] - 2026-06-02

> 自 0.4.3 (2026-04-05) 起完成的核心工作：All-in-One Memory Platform (Session Store / AI Extraction / Forgetting Scheduler)、Memory Encryption at Rest、Federation-aware Shared Memory、Session Archival、Web UI 增强、CI/CD 完善。
> npm 已发布：`woclaw-hub@0.5.0`（hub 子包），`woclaw-hooks@0.5.0`（hooks 子包）。Hub 子包版本领先 workspace meta-package 是设计：hub 走独立发布周期。

### Added

- **All-in-One Memory Platform (v1.1, 2026-04-23~05-30)**
  - Session Store（`hub/src/session_store.ts`）：session 注册 / 更新 / 列表 / 搜索 / flag / feedback / access-count
  - AI 提取引擎（`hub/src/extraction/engine.ts`）：动态加载 provider，支持 batch 模式
  - OpenAI / Anthropic / Ollama 三个 provider（Ollama 完整实现，非 stub）
  - ForgettingScheduler（`hub/src/scheduler.ts`）：按 `importance×0.5 + 时间衰减×0.3 + 访问频率×0.2` 淘汰，支持 dryRun
  - Session / Memory / Extraction Queue / Feedback 表及索引
  - REST 端点：`GET/POST/PUT/DELETE /sessions`、`/sessions/search`、`/sessions/stats`、`/sessions/:id/feedback|flag`、`/memory/prune`、`/memory/prune/status`、`/memory/stats`
- **Memory Encryption at Rest (2026-05-25)**
  - `hub/src/crypto.ts`：AES-256-GCM 认证加密 + PBKDF2 密钥派生，`ENC:v1:` 紧凑序列化
  - `EncryptionProvider` 接口 + `encryptAndSerialize` / `deserializeAndDecrypt` 便捷函数
  - 集成到 `ClawDB`，自动加解密 `memory.value`
  - 10 个 `crypto.test.ts` 单元测试全部通过
- **Federation-aware Shared Memory (2026-05-27)**
  - Hub 之间自动同步高重要性记忆（`syncImportantMemories`）
  - 修复 federation 同步链路上的 `syncImportantMemories` 缺失问题
- **Session Archival (2026-04-25)**
  - ForgettingScheduler 淘汰前归档到 JSONL/ZIP，支持恢复
- **Web UI 增强 (2026-05-25~05-30)**
  - Memory Inspection Panel：浏览 / 搜索 / 导出（Browse All & Export JSON）
  - Session Replay：play / pause / step 控制条
  - Sessions Tab：列表 + 搜索 + 详情回放
  - Importance Heatmap：grid + histogram 双视图
- **GitHub Actions CI/CD 完善 (CI-1 Story, 2026-06-01~06-02)**
  - README / README_zh 顶部加 CI status + Docker Hub image 徽章
  - `.github/workflows/ci.yml` 添加 `npm test` 步骤，job 重命名为 `hub (lint + build + test)`
  - Node.js 18 → 22 升级 + npm cache 提速

### Fixed

- 路由重构：session 路由移入 `else-if` 链，避免通配匹配冲突
- Federation 同步：补齐 `syncImportantMemories` 方法，避免高重要性记忆跨 Hub 同步失败

### Documentation

- ROADMAP 持续同步：v1.1 / v1.1+ / v0.6 完成项全部勾选，progress 表刷新
- `.gitignore` 忽略 `memory/`（workspace 日常日志不入库）
- `vitest` 引入 `coverage-v8` 配置

### Package versions (npm)

- `woclaw-hooks`: 0.4.3 → **0.5.0**（本地已发布）
- `woclaw-mcp`: 0.1.2（无变化）
- `woclaw-codex`: 0.1.2（无变化）
- `xingp14-woclaw` (workspace): 0.4.3（待发布下一版）

---

## [0.4.3] - 2026-04-05

### Added
- SQLite as the default Hub storage backend, with optional MySQL configuration and automatic migration from the legacy JSON store
- GitHub Pages-compatible landing page, dashboard, and inspector under `site/`
- Expanded migration sources for OpenClaw, Claude Code, Gemini CLI, and OpenAI Codex CLI
- Graph Memory CRUD/traversal APIs and memory search scope filtering

### Changed
- Memory search now prioritizes key/title/tags and body-text matches instead of loose recall-only scoring
- README / README_zh / Roadmap updated to reflect the current package versions and deployment flow

### Fixed
- Docker image build/publish workflow
- GitHub Pages deployment and site URLs

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
