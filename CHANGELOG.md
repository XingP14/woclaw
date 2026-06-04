# Changelog

## [Unreleased]

> 当前开发版本，等待下一批工作累积。

### Added

- **SECURITY.md — Vulnerability disclosure policy** (2026-06-04, 新类型首推，避开 13 轮漏更扫耗尽)
  - 项目根 `SECURITY.md` (5.8 KB)：覆盖 6 个 npm 包 + Docker Hub + VS Code Marketplace 7 路发布的统一安全策略
  - 内容：Supported Versions 表（每包 latest minor 仅接收安全修复）/ Reporting via GitHub Private Vulnerability Reporting (advisories/new) / 备用 private security discussion / 报告应附内容清单 / SLA 表 (ack 7d / triage 14d / patch 30d@High-Critical) / 协调披露默认 patch+14d / In-scope 与 Out-of-scope 清单 / Reporter 致谢机制（commit / CHANGELOG / Advisory） / Security Architecture Notes (TLS / Token rotation / AES-256-GCM at-rest / Rate limit / Federation) / 政策版本 v1.0
  - 设计取舍：仅维护 latest minor（项目全 0.x 阶段，无 LTS 承诺）；私有披露走 GitHub Security Advisories 而非 maintainer 邮箱（公开 maintainer 邮箱是 anti-pattern）；SLA 7/14/30/90 天分级参考 GitHub 协调披露规范；In-scope 直接点出 `hub/src/crypto.ts` / `hub/src/ws_server.ts` S22 / `hub/src/topics.ts` 等具体模块路径供 reviewer 关联
  - 验证：`grep` 6 个 package.json `version` 字段与表格权威值一致（`woclaw-hub@0.5.0` / `xingp14-woclaw@0.4.3` / `woclaw-hooks@0.5.0` / `woclaw-mcp@0.1.2` / `woclaw-codex@0.1.2` / `opencode-woclaw@0.1.0` / `woclaw-vscode@0.1.0`）；`docs/INSTALL.md` line 277-307 + line 291「🔐 TLS/SSL 加密连接」确为 TLS env var 权威位置
  - 意义：把项目从「隐式依赖 GitHub Issues 报告漏洞」升级为「显式 private disclosure + SLA」，是 npm/Docker Hub 双发布的 7 路包 + 公开 Hub 端口（8082/8083/8084）必要的 governance 闭环；父 22:10 提示「候选池耗尽 → 换新类型 (CHANGELOG/CONTRIBUTING/CODE_OF_CONDUCT/SECURITY) → 或跳轮」是直接按此 hint 落子
  - 修复：1 个新文件 + 1 行 CHANGELOG，diff +0/-0 实际代码改动

### Fixed

- **subpackage README ↔ 根 README 一致性漏更 (2026-06-04, 漏更模式第 12 处)** — docs 目录子包列表与 npm 实际发布状态错位
  - `docs/README_zh.md`「已完成 ✅」清单 (line 253-261) 4 处漏更：
    - `WebSocket 中继服务器` 和 `REST API 管理接口` 两行没标 `woclaw-hub@0.5.0`（本仓库的 Hub server 自身是核心子包，但清单中所有项目都标了 @version，唯独 Hub 自身 2 项漏了）。补 `（woclaw-hub@0.5.0）`
    - 漏列 `OpenCode Plugin（opencode-woclaw@0.1.0）` — OpenCode 是已 npm 发布的子包（2026-04-03 S2 完成），但清单漏列。补 1 行
    - 漏列 `VS Code / Cursor 扩展（woclaw-vscode@0.1.0，VS Code Marketplace, publisher: XingP14）` — S28-1/2 (2026-04-05) 完成，vsce → Marketplace 走非 npm 分发。20:40 轮已修根 README「Connect Your Agents」漏更，但未扫到 `docs/README_zh.md` 清单
  - `docs/README_zh.md`「计划中 📋」清单 (line 264-265) 完成态错位：
    - `[ ] ClawHub Skill 发布（~2026-04-13）` → `[x]`。实际 2026-04-13 已发布（skill `k97bq7et0sw5vm2meqc9yh6s5184sshr`）
    - `[ ] VS Code / Cursor 等生态插件继续完善与发布` → `[x] VS Code / Cursor 等生态插件完成（woclaw-vscode@0.1.0，已上架 VS Code Marketplace）`
  - `docs/README.md`「OpenCode」段 (line 206-210) 漏 npm 安装方式：只给了本地 copy 一种方式，没提 `npm install -g opencode-woclaw@0.1.0`。与 `packages/opencode-woclaw-plugin/README.md` 的「Option 1: Local plugin / Option 2: npm package」二选一不一致。补 Option 2
  - `docs/README.md`「npm Packages」表格 (line 413-417) 漏 `opencode-woclaw@0.1.0` — 同表格其他 5 项都是 npm 已发布子包，唯独 OpenCode 漏列。补 1 行（与 `docs/PUBLISH.md` 表格 6 行齐）
  - 验证：`npm view <pkg> version` 6 个 npm 子包权威值 = `woclaw-hub@0.5.0` / `xingp14-woclaw@0.4.3` / `woclaw-mcp@0.1.2` / `woclaw-hooks@0.5.0` / `opencode-woclaw@0.1.0` / `woclaw-codex@0.1.2`；`woclaw-vscode@0.1.0` vsce → VS Code Marketplace（非 npm 设计）
  - 根因：与 20:40 轮「跨子包版本矩阵」扫描互补——上次扫的是版本号/徽章/CLI banner 这种**单文件版本号过时**，本轮扫的是**子包列表与 npm 实际发布状态错位**（清单漏列/完成态误标/安装方式不一致），是同一漏更模式的不同切面
  - 修复：2 个文档 4 处微调，diff +11/-5 行，0 行为变更

### Fixed

- **跨子包版本矩阵漏更 (2026-06-04, 漏更模式第 11 处)** — cross-subpackage version matrix drift
  - `docs/ROADMAP.md` line 66「v0.2 → 核心已上线」一栏 `npm 包发布` 描述仍写 `xingp14-woclaw@0.3.0, woclaw-hooks@0.1.0, woclaw-mcp@0.1.2`, 这是 2026-03-31 当时的快照, 早已与 `npm view <pkg> version` 权威值 (`xingp14-woclaw@0.4.3` / `woclaw-hooks@0.5.0` / `woclaw-mcp@0.1.2`) 不一致。`woclaw-mcp@0.1.2` 是 v0.2 至今未动, 不动; `xingp14-woclaw` 从 0.3.0 升 0.4.3 (2026-04-13 ClawHub 发布的版本) / `woclaw-hooks` 从 0.1.0 升 0.5.0 (2026-06-02 0.5.0 大版本)。三值对齐 npm registry
  - `README.md` (en) + `README_zh.md` 「Connect Your Agents / 接入 Agent」一节漏列 `woclaw-vscode` 子包。该子包 2026-04-05 完成 S28-1/2 (脚手架 + Tree View + package.json vsce 配置), 已在 `packages/woclaw-vscode/` 编译通过 (`out/extension.js` 存在), publisher 为 `XingP14`, 部署目标是 VS Code Marketplace (不是 npm, 与 vsce 约定一致), 此前文档未告知用户如何安装。补一行「VS Code / Cursor: 在 VS Code Marketplace 搜索 WoClaw 安装」, 中英一致
  - 验证: `npm view` 7 个子包 (含本地未发的 `woclaw-vscode`) 与各自 `package.json` `version` 字段一致; `woclaw-vscode` 唯一非 npm 包属设计 (vsce 走 marketplace) 不是漏更
  - 注: 本轮是「跨子包版本矩阵」扫描的延伸, 之前 10 轮漏更都是单文件版本号过时, 本次是 ROADMAP 历史快照 + README 子包列表 2 处复合漏更, 实际命中 1 个独立问题 (跨子包元数据)

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
  - **`docs/PUBLISH.md`「Published Packages」表格 3 处漏更**（同一类问题）— `xingp14-woclaw` 仍标 `0.3.0`（实际 `0.4.3`）/ `woclaw-hub` 仍标 `0.3.0`（实际 `0.5.0`）/ `woclaw-hooks` 仍标 `0.4.0`（实际 `0.5.0`）。`woclaw-mcp@0.1.2` / `opencode-woclaw@0.1.0` 正确不动。三行对齐 `npm view <pkg> version` 权威值。`docs/PUBLISH.md` 是 4 处 npm 文档（README 徽章 / README 表格 / PUBLISH 表格 / CLI banner）的第 3 处漏更, 是漏更扫描的延伸。注：`docs/PUBLISH.md` 底部「Current Status」清单 `[x] npm publish xingp14-woclaw@0.3.0 - 2026-04-01` 是历史 release log 格式, 不应修改（动了会改写历史）；表格本身是「当前状态」快照, 该改
  - **`plugin/openclaw.plugin.json` OpenClaw 插件清单漏更**（同一类问题, 第 5 处）— `version` 字段仍标 `0.4.1`（实际 `0.4.3`, 与 `plugin/package.json` 权威版本对齐）。此文件是 OpenClaw runtime 加载的 plugin manifest, 版本号不一致会导致 runtime 显示的插件版本与 npm 安装的实际版本对不上。`git log -- plugin/openclaw.plugin.json` 显示该字段自 `9200ddf chore: bump version to 0.4.1 for npm publish` 起未再 bump, 漏掉 0.4.2 / 0.4.3 两次升级。修正为 `0.4.3`。注：CHANGELOG.md `[0.4.1]` / `[0.4.0]` / `docs/ROADMAP.md` line 98「PreCompact hook ✅ (v0.4.1)」是历史 release entry, 不应修改
  - **`plugin/bin/woclaw.js` 文件头注释漏更**（同一类问题, 第 6 处, 17:40 轮新扫出）— 第 3 行文件头 JSDoc 注释 `WoClaw CLI v0.4` 不完整版本号, 第 55 / 216 行的 CLI banner 已在 commit `7ca440b fix(plugin): align CLI banner version with package.json` 修正为 `v0.4.3`, 但该 commit 只 grep 了 `log(bold(...))` / `console.log(bold(...))` 调用, 漏掉了 file-header 注释行。修正为 `v0.4.3`, 与 `plugin/package.json` 权威版本对齐
  - **`docs/INSTALL.md` Docker 镜像 tag 过时 (2026-06-04)** — 第 188 行「部署到云服务器 → your-hub-host 示例」`docker run` 命令仍拉 `xingp14/woclaw-hub:hub/v0.3.0` (2 个月前版本), 但 hub 已在 2026-06-02 发布 `hub/v0.5.0` (含 All-in-One Memory Platform / Memory Encryption / Federation-aware Sync / Session Archival / Web UI 增强 / CI/CD 完善)。按 INSTALL 文档执行的用户会错过 0.4.0→0.5.0 期间所有修复与功能。修正为 `hub/v0.5.0`, 与 hub/package.json `0.5.0` 权威版本对齐。第 15 / 25 / 46 / 57 / 182 / 230 行的 `:latest` / `:local` 引用不动 (语义不同, latest 跟随 latest tag, local 是本地构建)
  - **`docs/PUBLISH.md` Docker build/tag/push 命令版本号过时 (2026-06-04, 漏更模式第 8 处)** — 「Docker Hub Publishing」小节里 `docker tag` / `docker push` 命令仍用 `xingp14/woclaw-hub:0.1.0` (4 月初首次 push 的历史版本号), 但 `woclaw-hub` 已在 2026-06-02 发到 `0.5.0` (同文档上方「Published Packages」表格里 `woclaw-hub` 写的就是 0.5.0, 自相矛盾)。按本节命令操作的用户会 push 一个过期的 `0.1.0` tag, 覆盖现网 `0.5.0` 镜像或创建错版本镜像。两处 `0.1.0` → `0.5.0` + 加一行说明「下方 `0.5.0` 为当前 `woclaw-hub` 最新版本, 发布新版本时替换即可」, 与 hub/package.json `0.5.0` 权威版本对齐。本节与之前的 7 处漏更 (README 徽章 4 处 / CLI banner 2 处 / INSTALL 1 处) 互补: 前 7 处都是文档**状态显示**漏更, 本处是**可执行命令**漏更, 按文档操作的副作用最大
  - **Docker workflow Node 版本漏更 (2026-06-04, 第 9 处)** — `.github/workflows/docker-publish.yml` 和 `.github/workflows/docker.yml` 的 `actions/setup-node` 仍写 `node-version: '18'`, 与 3 个 npm publish workflow (`hooks-publish.yml` / `hub-publish.yml` / `publish.yml` 的 `'20'`) + 根 CI `ci.yml` 的 `'22'` 不一致, 也与 `hub/Dockerfile` 运行时镜像 `node:20-bookworm-slim` 不齐。是 4 月初以来根 CI 从 18 升 22 时的漏更。两个 workflow → `'20'`（与 publish 类 3 个 workflow 对齐, 也与 Dockerfile 运行时容器版本一致）。安全性：`hub/package.json` `engines: ">=18.0.0"` 已覆盖 18/20/22；build 步骤只是 `npm install` + `npm run build`(纯 `tsc` TS 编译, `hub/tsconfig.json` target `ES2022` Node 18+ 原生支持), 不依赖任何 Node 18 专属特性。改后 docker publish 链路 CI 端 = 运行时容器 = 其他 publish workflow = 单一 20 节点
- **plugin src/ 死代码清理 (2026-06-04, 第 10 处)** — `plugin/src/index.js` 是 commit `9ba6e5f "Add compiled JS plugin (src/index.js) - no npm build required"` 留下的预编译产物, 在 2026-04-01 commit `4b04f53 refactor(plugin): use defineChannelPluginEntry for OpenClaw v2026.3.22+ compatibility` 之后变成孤儿：旧版 `class WoClawChannel { ... } export default new WoClawChannel()` 模式被新版 `defineChannelPluginEntry({...})` 取代, 已 64+ 天未被引用
  - 验证: `grep -c "defineChannelPluginEntry" dist/index.js src/index.ts src/index.js` = 3/3/0 (dist 和 .ts 都是新版, .js 是旧版)
  - 验证: `git grep "src/index\.js" plugin/src/ plugin/bin/ plugin/test/` = 0 hits (无任何 import 引用)
  - 验证: `plugin/tsconfig.json` 和 `plugin/tsconfig.build.json` 都已 `exclude: ["node_modules", "dist", "src/**/*.js"]`, `package.json` `build` 脚本 `npx tsc --project tsconfig.build.json` 本来就跳过它
  - 验证: `package.json` `main: "dist/index.js"` 指向 dist 输出 (从 src/index.ts 编译), runtime 加载的是 dist, 跟 src/index.js 无关
  - `git rm plugin/src/index.js` — 1 file changed, 255 deletions(-), 零行为变更

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
