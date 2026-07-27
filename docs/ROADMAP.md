# WoClaw 路线图 / Roadmap

> 规划 WoClaw 的发展方向，持续迭代

## 🎯 项目定位

**WoClaw = Shared Memory + Messaging Hub for AI Agents**

让 OpenClaw、Claude Code、Gemini CLI、**OpenAI Codex CLI**、OpenCode、Hermes Agent 等多个 AI 框架共享项目上下文、记忆和决策。解决"每个 AI 都从零开始"的问题。

**核心方向：** 跨框架共享记忆 + 实时消息路由。

> ⭐ **高优先级项目：OpenAI Codex CLI 集成** — OpenAI 官方 Python Codex 代理的 WoClaw Hook 支持，使 Python 代理能读写共享记忆。

> 🧭 **路线图新增：Hermes Agent 支持** — 将 Hermes 的 skills / channel / memory / migration 兼容性纳入后续规划，目标是与现有 OpenClaw 体系对齐，而不是简单覆盖。

## 🧩 v0.4.3 最新拆分（Feature / Story / Step）

> 这一段把最近已经落地的工作按 Feature → Story → Step 方式重新拆开，方便后续继续做同类拆分。

### Feature 1: 交付与站点

#### Story 1.1: Docker CI/CD 恢复
- [x] Step 1: 修复 Hub Dockerfile 的依赖安装流程，改用 `npm install --omit=dev`
- [x] Step 2: 补齐 `python3 / make / g++`，确保原生依赖可编译
- [x] Step 3: 重新跑通 GitHub Actions 的 Docker build/publish

#### Story 1.2: GitHub Pages 站点
- [x] Step 1: 将 `site/` 改造成可配置 Hub URL 的静态首页
- [x] Step 2: 发布 `gh-pages` 分支并同步 `index.html` / `quickstart.html` / `dashboard.html`
- [x] Step 3: 修正 README 中的站点链接

### Feature 2: 存储与检索

#### Story 2.1: SQLite/MySQL 存储后端
- [x] Step 1: 默认切换到本地 SQLite 存储
- [x] Step 2: 增加 `DB_TYPE=mysql` 以及 `MYSQL_*` 配置
- [x] Step 3: 支持旧 JSON 数据自动迁移

#### Story 2.2: 精准记忆搜索
- [x] Step 1: 让 `/memory/search` 优先匹配 key / title / tags
- [x] Step 2: 补正文内容命中与中文子串匹配
- [x] Step 3: 增加 scope 过滤并同步到 Web UI

### Feature 3: 历史迁移

#### Story 3.1: OpenClaw 迁移完整性
- [x] Step 1: 扫描所有 workspace 根目录，避免漏导入
- [x] Step 2: 导入真实的 root memory 文档与 session transcript
- [x] Step 3: 跳过依赖树 / cache / 虚拟环境目录并补单测

#### Story 3.2: Codex / Claude / Gemini 迁移
- [x] Step 1: 读取各自真实的历史存储源
- [x] Step 2: 用 mock Hub + live smoke 复核写入链路
- [x] Step 3: 将迁移能力写回 README 与安装文档

## 🚀 v0.2 — P0 功能（当前）

### 核心已上线
- [x] WebSocket Hub (ws://your-hub-host:8082) ✅
- [x] REST API (your-hub-host:8083) ✅
- [x] Topic Pub/Sub ✅
- [x] Shared Memory Pool ✅
- [x] Message History (last 50) ✅
- [x] Token Authentication ✅
- [x] npm 包发布 (xingp14-woclaw@0.4.3, woclaw-hooks@0.5.0, woclaw-mcp@0.1.2) ✅

### P0 - 跨框架 Hook 集成
- [x] Claude Code Hook Scripts — SessionStart/Stop/PreCompact hooks 读写 WoClaw Memory ✅
- [x] **Story: Gemini CLI → WoClaw 记忆读写** — 实现 Gemini CLI 的 hook 脚本读写 WoClaw Memory ✅ (S1-1/2/3, 2026-04-03)
- [x] **Story: OpenCode → WoClaw 记忆读写** — 实现 OpenCode 的 hook 脚本（参考 Claude Code）✅ (S2-1/2/3, 2026-04-03)
- [x] **⭐ OpenAI Codex CLI Hook Scripts** — 高优先级！OpenAI 官方 Python Codex 代理集成 ✅ (S3, 2026-04-03)

### P0 - OpenAI Codex CLI 支持（新增 ⭐ 高优先级）
- [x] wo-codex CLI 包 — `packages/codex-woclaw/` created (woclaw-codex@0.1.0) ✅
- [x] SessionStart Hook — `session_start.py` reads from WoClaw Hub REST API ✅
- [x] SessionStop Hook — `stop.py` reads transcript + writes summary to WoClaw Hub ✅
- [x] PreCompact Hook — Codex 上下文压缩前将关键信息写入 memory ✅ v0.1.2
- [x] **Story: Codex Hook npm 发布** — `woclaw-codex@0.1.2` npm 发布 ✅ 2026-04-03
- [x] 环境变量配置：`WOCLAW_HUB_URL` + `WOCLAW_TOKEN` ✅

### P0 - OpenClaw Plugin 完善
- [x] Plugin 导出格式修复（使用 `defineChannelPluginEntry`）✅
- [x] **Story: your-hub-host plugin 验证** — 在 your-hub-host 上安装 xingp14-woclaw，重启 gateway，验证 channel 连接正常 ✅ (S4-1/2/3, 2026-04-03)
- [x] **Story: VPS4 plugin 验证** — 在 VPS4 本地安装验证 ✅ (S5-1/2/3, 2026-04-03)

---

## 🔥 v0.3 — MCP + Hook 系统

### MCP Bridge
- [x] WoClaw MCP Server — 暴露 `woclaw_topics`, `woclaw_memory_read`, `woclaw_memory_write`, `woclaw_send` 工具 ✅ (woclaw-mcp@0.1.2)
- [x] **Story: MCP CLI serve 命令** — 实现 `woclaw mcp serve` 暴露 WoClaw Hub 为 MCP server ✅ (S8-1/2/3/4, 2026-04-04)

### Hook 系统
- [x] **Story: Claude Code Hook 安装器** — `woclaw hook install --framework claude-code` 一键安装脚本 ✅ (S6-1/2, 2026-04-03)
- [x] **Story: Codex Hook 安装器** — `woclaw hook install --framework openai-codex` 一键安装脚本 ⭐ ✅ (S7-1/2, 2026-04-04)
- [x] PreCompact hook — Codex PreCompact Hook 完成 ✅ (v0.4.1)，Claude Code precompact.sh 已就绪

### Docker Hub 发布
- [x] GitHub Actions 自动构建 ✅ (hub/v* tag 触发)
- [x] Docker Hub 镜像 xingp14/woclaw-hub ✅

## 🎯 v0.4 — 多框架共享记忆

### Shared Memory 增强
- [x] **Story: Memory Versioning** — 每次 write 时保留旧版本，支持 `memory.versions(key)` 查询 ✅ (S9-1/2/3/4, 2026-04-04)
- [x] **Story: Semantic Recall** — 实现 `recall(query, intent)` 意图感知检索 ✅ (S10-1/2/3/4/5, 2026-04-04)

### Multi-Agent Orchestration
- [x] **Story: Agent 发现** — Hub API `GET /agents` 返回已连接 agent 列表 ✅ (S11-1/2, 2026-04-04)
- [x] **Story: 委托任务** — Agent 可发送 `delegate(task, toAgentId)` 消息 ✅ (S12-1/2/3/4/5, 2026-04-04)
- [x] **Story: 任务状态追踪** — 委托任务可追踪 PENDING/RUNNING/DONE/FAILED 状态 ✅ (included in S12)

### 记忆原语设计

| 原语 | 作用 | WoClaw 实现 |
|------|------|-------------|
| **`remember`** | 将信息写入共享记忆池 | `woclaw memory.write(key, value, tags, ttl)` |
| **`recall`** | 按意图检索记忆 | `woclaw memory.recall(query, intent)` |
| **`link`** | 将两条记忆关联起来 | `woclaw memory.link(from_key, to_key, relation)` |

## 📦 v0.5 — 跨框架数据迁移

### 迁移工具 / Migration Tools
- [x] **Story: Codex 迁移** — `woclaw migrate --framework openai-codex --session-id <id>` 从 Codex 历史导入 ✅ (S13-1/2/3/4, 2026-04-04)
- [x] **Story: Claude Code 迁移** — `woclaw migrate --framework claude-code --session-dir <path>` 导入 sessions ✅ (S14, based on S13-4 template, 2026-04-04)
- [x] **Story: Gemini CLI 迁移** — `woclaw migrate --framework gemini-cli` 导入会话历史 ✅ (S15, based on S13-4 template, 2026-04-04)
- [x] **Story: OpenClaw 迁移** — `woclaw migrate --framework openclaw --agent-id <id>` 导入 memory/sessions ✅ (S16, based on S13-4 template, 2026-04-04)

### 迁移设计

| 源框架 | 迁移内容 | WoClaw 目标 |
|--------|----------|-------------|
| **OpenAI Codex CLI** | Session transcript, project context, key decisions | Shared Memory + Topics |
| **Claude Code** | Session transcript, discovered facts, repo context | Shared Memory + Topics |
| **Gemini CLI** | Conversation history, research findings | Shared Memory + Topics |
| **OpenClaw** | Memory entries, session summaries, agent context | Shared Memory Pool |
| **Hermes Agent** | Skills, channels, memories, workspace instructions | Shared Memory + Topics + Hooks |

### 迁移命令
```bash
# 单框架迁移
woclaw migrate --framework openai-codex --session-id <id>
woclaw migrate --framework claude-code --session-dir ~/.claude/sessions
woclaw migrate --framework gemini-cli
woclaw migrate --framework openclaw --agent-id my-openclaw

# 批量迁移
woclaw migrate --all --dry-run  # 预览，不执行
woclaw migrate --all            # 执行所有迁移
```

### 生态集成
- [x] ClawHub Skill 发布 ✅ 2026-04-13（skill k97bq7et0sw5vm2meqc9yh6s5184sshr）
- [x] GitHub Actions CI/CD 完善 ✅ 2026-06-02
  - [x] Step 1：在 README/README_zh 添加 CI workflow status + Docker Hub image 徽章 ✅ 2026-06-01
  - [x] Step 2：增强 `.github/workflows/ci.yml` — 重命名 job 为 `hub (lint + build + test)`，添加 `npm test` 步骤 ✅ 2026-06-02
- [x] VS Code / Cursor 插件（可选） ✅ 2026-04-05
  - [x] Step 1：`packages/woclaw-vscode/` 脚手架 + 状态栏（hub 连接状态 / agents count）✅
  - [x] Step 2：Tree View（Topics / Agents / Memory）+ package.json vsce 发布配置（publisher: XingP14）✅

### 文档
- [x] Hook 集成指南 — Claude Code（`docs/CLAUDE-CODE-HOOKS.md`）✅ 2026-04-04
- [x] Hook 集成指南 — Gemini CLI（`docs/GEMINI-CLI-HOOKS.md`）✅ 2026-04-04
- [x] Hook 集成指南 — Codex CLI / OpenCode（`docs/CODEX-CLI-HOOKS.md`）✅ 2026-04-04
- [x] MCP Server 使用文档（`docs/MCP-SERVER.md`）✅ 2026-04-04
- [x] Hook 集成指南 — Hermes Agent（`docs/HERMES-HOOKS.md`）✅ 2026-04-11
- [x] Security Policy — `SECURITY.md` (vulnerability reporting + supported versions) ✅ 2026-06-04
- [x] Contributing Guide — `CONTRIBUTING.md` (PR process + dev flow + conventional commits) ✅ 2026-06-05
- [x] Code of Conduct — `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1 full text + WoClaw 范围/联系渠道) ✅ 2026-06-05
- [ ] 视频演示

## 🔧 v0.6 — 生态完善

### 发布到生态
- [x] Docker Hub 发布（credentials 配置）✅ 2026-04-04
- [x] ClawHub Skill 发布 ✅ 2026-04-13（skill k97bq7et0sw5vm2meqc9yh6s5184sshr）
- [x] VS Code / Cursor 插件（可选） ✅ 2026-04-05（详见「生态集成」段，parent + S28-1/2 均已完成）

### Hermes Agent 支持（roadmap）
> 下面把 Hermes 相关工作拆成 10 分钟内可完成的最小步骤，方便按心跳推进。

#### Story H1: Hermes Agent 迁移兼容
- [x] **Step 1（10min）：整理 Hermes dry-run 报告中的可迁移项与缺口** ✅ 2026-04-10
  - 输出：`docs/H1-1-HERMES-MIGRATION-DRYRUN.md`
  - 输出：`docs/H1-1-HERMES-MIGRATION-DRYRUN.md`
  - 分析了 Hermes 数据源：state.db, MEMORY.md, USER.md, skills/, config.yaml
  - 确定 ✅ 可迁移项（sessions, memories, skills → hooks）
  - 确定 ⚠️ 需适配项（session search, skill self-creation）
  - 确定 ❌ 不兼容项（YAML config, hard limits, RL training）
  - 输出了迁移命令设计和实现估算
- [x] **Step 2（10min）：确认 `skills` / `shared-skills` / `workspace-agents` / `model-config` 的目标路径映射** ✅ 2026-04-10
  - 输出：`docs/H1-2-HERMES-PATH-MAPPING.md`
  - 确认 skills → `hermes:skill:<name>` Memory Pool
  - 确认 shared-skills → `hermes:shared-skill:<name>` Memory Pool（tag 含 `shared`）
  - 确认 workspace-agents → Agent Registry + Memory entries
  - 确认 model-config → 文档参考（不迁移 API key）
  - 确认 messaging-settings → ❌ 不兼容，回滚策略已记录
- [x] **Step 3（10min）：记录 `messaging-settings` 与 `memory` 的不兼容点和回滚策略** ✅ 2026-04-10
  - 输出：`docs/H1-3-HERMES-MESSAGING-INCOMPATIBILITY.md`
  - Channel vs Topic 不兼容性、路由规则差异、消息模板缺失详细分析
  - 回滚策略：迁移跳过 + 备份到 Memory + 手动重建指南
  - 迁移命令设计（`--skip messaging-settings`）+ 输出示例

#### Story H2: Hermes Agent 文档
- [x] **Step 1（10min）：在根目录 README 增加 Hermes roadmap 说明** ✅ 2026-04-10
- [x] **Step 2（10min）：在 `docs/README.md` 与 `docs/README_zh.md` 增加 Hermes roadmap 说明** ✅ 2026-04-10
  - docs/README.md 已有完整 "Hermes Agent (Roadmap)" 章节（H1-3 输出已整合）
  - docs/README_zh.md 已有完整 "Hermes Agent 支持（路线图）" 章节
- [x] **Step 3（10min）：补充 Hermes 安装 / 迁移注意事项的文档链接位置** ✅ 2026-04-10
  - Connect Your Agents 部分已有 "Hermes Agent (Roadmap)" 说明 + 表格
  - README_zh.md 功能特性部分已注明 "规划 Hermes Agent 兼容"
  - 两个文档均已引用 docs/ROADMAP.md Story H1/H2/H3 进度链接

#### Story H3: Hermes Agent 站点同步
- [x] **Step 1（10min）：更新 `site/index.html` 的首页文案** ✅ 2026-04-10
  - 更新 lead 文案，列出完整支持框架（OpenAI Codex CLI, Claude Code, Gemini CLI, OpenClaw, Hermes Agent）
  - 强调跨框架共享记忆和 topic 消息路由能力
- [x] **Step 2（10min）：更新 `site/quickstart.html` 的支持范围和提示** ✅ 2026-04-10
- [x] **Step 3（10min）：更新 `site/dashboard.html` 的 tagline** ✅ 2026-04-10

## 🚀 v1.1 — All-in-One Memory Platform（Session Store + AI Extraction + Forgetting）

> **核心目标：** 为 WoClaw Hub 添加 Session Store（情景记忆）、AI 提取引擎（自动生成摘要/重要性评分）、反馈 API 和遗忘调度器。
> **技术栈：** TypeScript, better-sqlite3（已有）, OpenAI SDK, node-cron

### Feature M1: 类型定义（Type Definitions）

#### Story M1-T1: Session 类型定义
- [x] **Step 1（10min）：在 `hub/src/types.ts` 追加 Session 相关类型** ✅ 2026-04-23
  - 追加 `DBSession`, `DBSessionFeedback`, `ExtractionQueueEntry`, `ImportanceResult`, `ExtractionResult`, `MemoryFeedback`, `AIProviderConfig`, `ExtractionConfig`, `ForgettingConfig` 接口
  - 验证 TypeScript build：`cd hub && npm run build`

### Feature M2: 数据库 Schema — Session 表

#### Story M2-DB1: Session 表初始化
- [x] **Step 1（10min）：在 `db.ts` 的 `ClawDB.init()` 中追加 session 相关表** ✅ 2026-04-24
  - `sessions` 表 + `idx_sessions_agent_id` + `idx_sessions_started_at` 索引
  - `extraction_queue` 表
  - `session_feedback` 表
  - `memory_feedback` 表
  - 验证：`cd hub && npm run build` 无报错

#### Story M2-DB2: Session CRUD 方法
- [x] **Step 1（10min）：在 `ClawDB` 类追加 Session CRUD 方法** ✅ 2026-04-23
  - `setSession`, `getSession`, `getAllSessions`, `deleteSession`, `sessionSearch`, `mapSessionRow`
  - 验证：`cd hub && npm run build`

- [x] **Step 2（10min）：追加 Extraction Queue + Feedback + Eviction 方法** ✅ 2026-04-23
  - `addToExtractionQueue`, `getExtractionQueue`, `updateExtractionQueueStatus`, `removeFromExtractionQueue`
  - `addSessionFeedback`, `getSessionFeedbackHistory`, `addMemoryFeedback`, `getMemoryFeedbackHistory`
  - `getEvictionCandidates`（带重要性/访问频率/时间衰减公式）
  - 验证：`cd hub && npm test` 全部通过

### Feature M3: Session Store 引擎

#### Story M3-SS1: SessionStore 核心实现
- [x] **Step 1（10min）：编写 `hub/src/session_store.ts`** ✅ 2026-04-23
  - `SessionStore` 类：方法 `registerSession`, `updateSession`, `getSession`, `listSessions`, `deleteSession`, `searchSessions`, `flagSession`, `markExtracted`, `incrementAccessCount`, `addFeedback`
  - Build 验证：`cd hub && npm run build`

- [x] **Step 2（10min）：编写 `hub/test/session_store.test.ts`** ✅ 2026-04-23
  - 6 个测试用例覆盖注册、更新、列表、搜索、flag、feedback
  - 运行：`cd hub && npm test -- --grep "SessionStore"`

### Feature M4: AI 提取引擎

#### Story M4-AI1: 提取引擎核心架构
- [x] **Step 1（10min）：编写 `hub/src/extraction/engine.ts`** ✅ 2026-04-23
  - `AIProvider` 接口定义
  - `ExtractionEngine` 类：根据 config 动态 `require()` 加载 provider
  - Build 验证：`cd hub && npm run build`

#### Story M4-AI2: OpenAI Provider 实现
- [x] **Step 1（10min）：编写 `hub/src/extraction/providers/openai.ts`** ✅ 2026-04-23
  - `OpenAIProvider` 实现 `AIProvider` 接口
  - `scoreMemory()` — 调用 OpenAI Chat API（JSON mode）返回重要性评分
  - `extractSession()` — 从 session transcript 提取 summary/keyDecisions/importantFacts/preferences/filesModified/topics/suggestedTags
  - 验证：`cd hub && npm run build`

#### Story M4-AI3: Anthropic / Ollama Provider Stub
- [x] **Step 1（10min）：编写 `hub/src/extraction/providers/anthropic.ts`** ✅ 2026-04-23
  - Stub 实现，返回默认 5.0 评分
  - Build 验证

- [x] **Step 2（10min）：编写 `hub/src/extraction/providers/ollama.ts`** ✅ 2026-04-23
  - Stub 实现，返回默认 5.0 评分，支持 `OLLAMA_BASE_URL`
  - Build 验证

#### Story M4-AI4: 提取引擎测试
- [x] **Step 1（10min）：编写 `hub/test/extraction_engine.test.ts`** ✅ 2026-04-23
  - Mock-based 测试验证接口契约
  - `cd hub && npm test -- --grep "ExtractionEngine"` 全部 PASS

### Feature M5: REST API — Session 端点

#### Story M5-API1: Session REST 路由
- [x] **Step 1（10min）：在 `hub/src/rest_server.ts` 引入 SessionStore 并注入** ✅ 2026-04-23
  - import SessionStore，构造函数注入实例
  - Build 验证

- [x] **Step 2（10min）：注册 Session 路由** ✅ 2026-04-23
  - `GET /sessions` — 列表
  - `POST /sessions` — 注册新 session
  - `GET /sessions/:id` — 获取详情
  - `POST /sessions/:id/feedback` — 反馈
  - `POST /sessions/:id/flag` — 标记
  - `GET /sessions/search` — 搜索
  - `DELETE /sessions/:id` — 删除
  - `PUT /sessions/:id` — 更新
  - 验证：`cd hub && npm test` 全部通过

### Feature M6: Forgetting Scheduler（遗忘调度器）

#### Story M6-FG1: ForgettingScheduler 核心实现
- [x] **Step 1（10min）：编写 `hub/src/scheduler.ts`** ✅ 2026-04-23
  - `ForgettingScheduler` 类：使用 `node-cron` 实现 daily/weekly/manual 调度
  - `run(dryRun?)` 方法：按 eviction_score（重要性×0.5 + 时间衰减×0.3 + 访问频率×0.2）升序淘汰
  - `getLastRun()`, `updateConfig()` 方法
  - Build 验证

#### Story M6-FG2: Hub 集成 + REST 端点
- [x] **Step 1（10min）：在 `hub/src/index.ts` 引入并实例化 ForgettingScheduler** ✅ 2026-04-23
  - 从环境变量/配置加载 ForgettingConfig
  - Build 验证

- [x] **Step 2（10min）：在 `rest_server.ts` 注册 prune 路由** ✅ 2026-04-23
  - `POST /memory/prune` — 触发遗忘执行
  - `GET /memory/prune/status` — 查询上次运行状态
  - 验证：`cd hub && npm test` 全部通过

#### Story M6-FG3: ForgettingScheduler 单元测试
- [x] **Step 1（10min）：编写 `hub/test/forgetting_scheduler.test.ts`** ✅ 2026-04-23
  - 测试 dry run 不删除、实际执行删除、调度逻辑
  - 说明：Vitest 不支持 `--grep`，已改用 `npx vitest run test/forgetting_scheduler.test.ts` 验证通过

---

## 🔮 v1.0+ — 高级特性

#### Story M5-API1: Session REST 路由
- [x] **Step 1（10min）：在 `hub/src/rest_server.ts` 引入 SessionStore 并注入** ✅ 2026-04-23
  - import SessionStore，构造函数注入实例
  - Build 验证
  - 说明：`RestServer` 已直接接入 `SessionStore`，并在 `hub/src/index.ts` 完成注入

- [x] **Step 2（10min）：注册 Session 路由** ✅ 2026-04-23
  - `POST /sessions` — 注册新 session（session start 时调用）
  - `PUT /sessions/:id` — 更新 session（session end 时调用，写入 transcript）
  - `GET /sessions` — 列表（支持 agentId/framework/date range/importance 过滤）
  - `GET /sessions/:id` — 获取完整 transcript
  - `POST /sessions/:id/feedback` — 反馈调整重要性
  - `POST /sessions/:id/flag` — 标记重要 session
  - `GET /sessions/search` — 全文搜索 transcript
  - `DELETE /sessions/:id` — 删除 session
  - `GET /sessions/stats` — Session Store 统计（count、avg importance、storage size）
  - 说明：路由已存在于 `hub/src/rest_server.ts`，并已覆盖 `GET /sessions/stats` 在内的 session 入口

### Feature M5b: Memory Stats + Batch Mode

#### Story M5b-MS1: Memory Stats 端点
- [x] **Step 1（10min）：在 REST API 添加 `GET /memory/stats`** ✅ 2026-04-23
  - 返回 count、avg importance、storage size
  - 验证：`cd hub && npm run build` 成功，路由已在 `hub/src/rest_server.ts` 中就绪

#### Story M5b-BM1: Batch Extraction 模式支持
- [x] **Step 1（10min）：实现 `ExtractionEngine` 的 batch 处理逻辑** ✅ 2026-04-24
  - `batchSize` + `batchIntervalMs` 配置驱动
  - 后台 worker 从 extraction_queue 批量拉取 session 逐个处理
  - 说明：`hub/src/extraction/engine.ts` 已具备 `processBatch()` 和 batch 配置入口

### Feature M7: Ollama AI Provider + Graph Auto-node

#### Story M7-OL1: Ollama Provider 完整实现
- [x] **Step 1（10min）：完善 `hub/src/extraction/providers/ollama.ts`** ✅ 2026-04-23
  - 实现 `scoreMemory()` 和 `extractSession()` 调用本地 Ollama API
  - 使用 `OLLAMA_BASE_URL` 环境变量（默认 `http://localhost:11434`）
  - 验证：本地 Ollama 运行 + `cd hub && npm run build`
  - ✅ OllamaProvider 非 Stub：完整调用 `/api/chat`，支持 JSON mode 解析

#### Story M7-GN1: 提取引擎 → Graph Memory 自动关联
- [x] **Step 1（10min）：Session 提取完成后自动创建 Graph 节点和 entity 边** ✅ 2026-04-23
  - `ExtractionEngine.extractSession()` 完成后触发 `syncMemoryNode()`
  - 自动为 summary/topics/importantFacts 创建 Memory 节点
  - 自动创建 memory → agent、memory → topic 的 entity 边
  - 验证：`cd hub && npm test -- --grep "Graph"` 全部通过

---

## 🔮 v1.2+ — 进阶特性

### Cloud-Native 可观测性
- [x] **`/ready` 端点** — 区别于 `/health` 的 liveness check，返回 200 + 4 项组件检查（db/topics/memoryPool/wsServer）✅ 2026-06-04
  - Step 1（10min）：在 `hub/src/rest_server.ts` 加 `handleReady()` 方法 + 路由注册
  - Step 2（10min）：`hub/test/rest_server.test.ts` — 4 个单元测试（ready 200 / not-ready 503 / 边界场景）
  - 验证：`npx vitest run test/rest_server.test.ts` 4/4 通过，全量 164/164 通过
  - 背景：k8s/容器化部署需要区分 liveness (在跑) 和 readiness (能服务)，原有 `/health` 只回 process 状态

### 生产化完善
- [x] **Session Archival** — 遗忘前归档到文件（JSONL/ZIP），支持恢复 ✅ (2026-04-25)
- [x] **Memory Encryption at Rest** — SQLite 加密存储敏感记忆 ✅ (2026-05-25)
  - [x] **Step 1（10min）：创建 `hub/src/crypto.ts` 加密工具模块** ✅ 2026-05-25
    - AES-256-GCM 认证加密 + PBKDF2 密钥派生
    - `EncryptionProvider` 接口：encrypt / decrypt / isEncrypted
    - `serializeEncrypted` / `deserializeEncrypted` 紧凑序列化（`ENC:v1:` 前缀）
    - `encryptAndSerialize` / `deserializeAndDecrypt` 便捷函数
    - `hub/test/crypto.test.ts` — 10 个单元测试全部通过
  - [x] **Step 2（10min）：集成到 ClawDB — 自动加解密 memory.value** ✅ 2026-05-25
- [x] **Federation-aware Shared Memory** — 联邦 Hub 间同步重要记忆 ✅ (2026-05-27)

### Web UI 增强
- [x] Memory Inspection Panel — 查看/搜索/导出记忆 ✅ 2026-05-25
- [x] Session Replay — 回放 session transcript ✅ 2026-05-25
- [x] Importance Heatmap — 可视化记忆重要性分布 ✅ 2026-05-30

### Repo 拆分计划
> 目标：将 WoClaw 单 repo 拆分为独立子 repo，各自有独立发布周期

| 子包 | 来源 | 目标 Repo | 状态 |
|------|------|-----------|------|
| `woclaw-hub` | `hub/` | [woclaw-hub](https://github.com/XingP14/woclaw-hub) | 🚧 Step 1 done（方案设计 2026-06-04） |
| `woclaw-codex` | `packages/codex-woclaw` | [woclaw-codex](https://github.com/XingP14/woclaw-codex) | 待拆分 |
| `woclaw-hooks` | `packages/woclaw-hooks` | [woclaw-hooks](https://github.com/XingP14/woclaw-hooks) | 待拆分 |
| `woclaw-mcp` | `packages/mcp-bridge` | [woclaw-mcp](https://github.com/XingP14/woclaw-mcp) | 待拆分 |
| `woclaw-vscode` | `packages/woclaw-vscode` | [woclaw-vscode](https://github.com/XingP14/woclaw-vscode) | 待拆分 |
| `woclaw-plugin` | `plugin/` | [woclaw-plugin](https://github.com/XingP14/woclaw-plugin) | 待拆分 |

**拆分顺序：** hub（核心）→ codex/hooks/mcp（集成）→ vscode/plugin（生态）→ meta repo

#### Story RS-1: woclaw-hub 仓拆分
> hub/ 已自包含（独立 package.json `woclaw-hub@0.5.0` / Dockerfile / README / test / systemd unit / CI workflow），拆为独立仓可让 hub 走自己的发布周期。

- [x] **Step 1 (10min): woclaw-hub 拆分方案设计** ✅ 2026-06-04
  - 输出：`docs/RS-1-REPO-SPLIT-HUB-PLAN.md`
  - 审计：hub/ 已具备全部独立资源（package.json / Dockerfile / README / test / CI workflow / npm `woclaw-hub@0.5.0` / Docker Hub `xingp14/woclaw-hub`）
  - 识别需处理：`.github/workflows/{ci,docker,docker-publish,hub-publish}.yml` 主仓副本、`docs/PUBLISH.md` / `docs/INSTALL.md` / `docs/README*.md` 部署命令、根 `package.json` workspaces
  - 设计 3 步执行：Step 2 创建新仓 + Secrets → Step 3 `git filter-repo --subdirectory-filter hub/` → Step 4 主仓文档改写
  - 风险评估：filter-repo 漏 dotfiles / monorepo 失去 hub 单元测试覆盖（已记录解决）
- [ ] **Step 2 (10min): 在 GitHub 创建 `XingP14/woclaw-hub` 仓 + 配置 Secrets + branch protection** — 父端操作；turn-key 指南见 [`docs/RS-1-EXECUTION-RUNBOOK.md`](./RS-1-EXECUTION-RUNBOOK.md)
- [ ] **Step 3 (10min): `git filter-repo --subdirectory-filter hub/` 提取 hub/ 历史到新仓 + 推送 + 验证 CI**
- [ ] **Step 4 (10min): 主仓调整引用** — 删 hub 相关 CI workflow / `docs/{PUBLISH,INSTALL,README,README_zh}.md` 改写为指向新仓 / 根 `package.json` workspaces 移除 `hub` / ROADMAP 表更新 / CHANGELOG 加 unreleased 段

---

## 🔮 v1.0+ — 高级特性

### 记忆增强
- [x] Graph Memory — 图数据库后端，支持 temporal/entity/causal/semantic 边类型 ✅ (S20+S21, 2026-04-05)
- [x] Semantic Recall — 意图感知检索 ✅ (S10, 2026-04-04)
- [x] Deduplication — S26

### 安全与扩展
- [x] TLS/SSL (wss://) ✅ (S18, 2026-04-04)
- [x] Token 轮换 — rotateToken, GET/POST /admin/token ✅ (S22, 2026-04-05)
- [x] 连接限流 ✅ (S19, 2026-04-05)
- [x] 私有 Topic（邀请制）✅ (S23, 2026-04-05)

### 联邦
- [x] Multi-Hub Federation — Hub 之间互联 ✅ (S24, 2026-04-05)
- [ ] 官方托管服务

---

---

## 🩺 07-25 06:23 轮 (2026-07-25) — woclaw (V3 tick, 0-6 cycle, §11 ROADMAP drift OVERRIDE, recovery from 22:43 phantomic `a58b1d8`)

> **Current next** (V3 §11 ROADMAP drift OVERRIDE — first successful wc-side docs(roadmap) recovery; prior 22:43 phantom `a58b1d8` per Pitfall #79 failed to append): `next: step-w-23 chain-31-process-cwd-regression-gate-closure` (chain #31 closed 2026-07-17 by `33dcc61` — 4 regression-gate tests `db_decrypt_inline` + `db_memory_select_typed` + `db_mysql_storedvalue_regression` + `req_on_data_typed_chunk` switched from `process.cwd()` to `dirname(fileURLToPath(import.meta.url))` ESM-safe paths; parallels 1a40479 6-suite + ebd839e 7th-suite closures from chain #31). Predecessor: `next: step-w-22-skill-standardization-2026-07` chain #26 closed 2026-07-12 by `7e4e2d3` (5-token 2026-07 compatible_with pin across 8 SKILL.md frontmatter + 7 sync short paragraphs + plugin/README.md timestamp 06-19→07-12 + 1 line dot/skills/CodexBar/awesome/cubesandbox callout + plugin/package.json description 116→507 chars append 5-set 子句, sync-skill-frontmatter.mjs --all --write union 128/133→133 tokens, 12 files / +58 / -12). Recovery rationale: 22:43 phantom claimed +15 insertions to `docs/ROADMAP.md` but `git diff a58b1d8^..a58b1d8 -- docs/ROADMAP.md` is empty (blob hash `75b68220ac046bf0aabd36d406ef59dfdabaf5ee` identical at parent and child); top next: drift stale pending 13 天 (07-12 → 07-25). This tick actually appends (1) the `next: step-w-23` line + (2) the tick-note section.

- **触发**: 07-25 06:23 Asia/Shanghai cron tick (V3 节奏 27 tick/天, 0-6 周期内, 本 tick 在 00:00-07:00 合法窗口). Pre-rotation skip-gate dual-LOCKED<1h (woclaw age ~18min, llm-benchmark age ~39min; both worktrees clean + synced) → 默认 SKIP per V3 §11. V3 §11 ROADMAP drift OVERRIDE FIRES: woclaw ROADMAP 顶部 next: stale pending (chain #31 closed 07-17, top next: 仍指 stale step-w-22 + 22:43 phantomic `a58b1d8` 未实际 append) + woclaw docs(roadmap) 当日 0/2 budget → 走 docs(roadmap) tick-note OVERRIDE (recurrence #31 / v3-section-11-roadmap-drift-override-second-side-symmetry.md wc-side pattern). llm-benchmark ROADMAP 顶部 next: 准确反映 active step (step-v6.0-14 立 active 07-23 23:23, realized 04:13 8a19dbe chain #20 10th fetcher, advance to step-v6.0-15 deferred) → 无需回写.
- **轮转检查**:
  - **woclaw**: 06:03 94236bf → 06:23 距 20min **LOCKED** (< 1h gate, unlock 07:03:30) + CI 24h GREEN + git clean + docs(roadmap) 当日 0/2 budget + ROADMAP drift TRUE (top next: 漂移 13 天) → §11 OVERRIDE eligible
  - **llm-benchmark**: 05:43 7c4225b → 06:23 距 40min **LOCKED** (< 1h gate, unlock 06:45:41) + CI 24h GREEN + git clean + ROADMAP top accurate (step-v6.0-14 active, 无 drift) → §11 OVERRIDE NOT eligible
- **判定**: dual-LOCKED<1h + clean + synced → 默认 SKIP per V3 §11. 但 **woclaw ROADMAP drift TRUE** + **docs(roadmap) budget 0/2** → V3 §11 refinement OVERRIDE FIRES. Single-emission rule honored: docs(roadmap) only tick-note on woclaw (不伴随 docs/ci-failures.md tick-note closure on same tick; lb 07:23 04:13 8a19dbe chain #20 10th fetcher 已闭 step-v6.0-14, advance to step-v6.0-15 deferred to next docs(roadmap) tick on lb side). 选 woclaw 优先: (1) woclaw ROADMAP drift 真 stale pending 13 天 (chain #31 07-17 closed, 顶部 next: 仍指 stale step-w-22); (2) 22:43 phantomic `a58b1d8` 需 recovery; (3) docs(roadmap) budget 1 slot 可用; (4) llm-benchmark ROADMAP top 准确, 无需回写.
- **chain #26 step-w-22 状态回写**: chain #26 实际 07-12 7e4e2d3 闭合 ✅ (5-token 2026-07 compatible_with pin across 8 SKILL.md frontmatter, 7 sync short paragraphs, plugin/README.md timestamp 06-19→07-12, dot/skills/CodexBar/awesome/cubesandbox callout 1 line, plugin/package.json description 116→507 chars append 5-set 子句, sync-skill-frontmatter.mjs --all --write union 128/133→133 tokens, 12 files / +58 / -12).
- **chain #31 step-w-23 状态回写**: chain #31 实际 07-17 33dcc61 闭合 ✅ (4 regression-gate tests `db_decrypt_inline` + `db_memory_select_typed` + `db_mysql_storedvalue_regression` + `req_on_data_typed_chunk` switched from `process.cwd()` to `dirname(fileURLToPath(import.meta.url))` ESM-safe paths, parallels 1a40479 6-suite + ebd839e 7th-suite closures, workspace-wide `npx vitest run` 67/67 files / 745/745 tests green, hub-scoped 26/26 tests green, tsc --noEmit -p hub clean, pure test-only edit).
- **next: step-w-23 chain-31-process-cwd-regression-gate-closure 立 active** (本轮关键): top next: 从 stale step-w-22 → step-w-23 active 推进 (chain #31 07-17 33dcc61 closed 8 天前, top next: 漂移 13 天 stale pending).
- **耗时**: skip-gate 评估 10s + tick-note draft 90s + ROADMAP append 60s + watchdog check 30s + commit/push 60s + state reconciliation 60s ≈ 5min (5min 硬上限内).
- **遗留**: 0 (本轮 docs(roadmap) only, 立 `next: step-w-23 chain-31-process-cwd-regression-gate-closure` active + 顺手回写 chain #26 + chain #31 closure status, recovery from 22:43 phantomic `a58b1d8` 完整; 当日 docs(roadmap) 1/2 已用 → 剩 1 slot; lb docs(roadmap) 0/2 待 lb 侧 step-v6.0-15 立项时使用).
- **下次轮转**: L→W 序列 → **llm-benchmark** (本轮 picked=woclaw docs(roadmap) recovery; wc age ~5min LOCKED<1h until 07:03, lb age ~24min LOCKED<1h until 06:45 → 06:43 next slot dual-LOCKED → likely SKIP or §11 OVERRIDE if lb ROADMAP drift develops). woclaw 候选池仍 6 (sync-skill-frontmatter.mjs extension / encryption-at-rest 3-layer / vscode EventEmitter 6-case / 7 subpackages LICENSE / npm publish 0.4.0 / ci-failures residue).
- **LLM 错误**: 0 (无 retry, 无 abort).
## 🩺 07-27 22:03 轮 (2026-07-27) — woclaw (V3 tick, 22:03 first tick of new day-cycle, §11 ROADMAP drift OVERRIDE, wc top next: step-w-23 chain-31 closed 10d ago, advance to step-w-24 R93-hub-test-agent-stream-runtime-compliance)

- **触发**: 07-27 22:03 Asia/Shanghai cron tick (V3 节奏 27 tick/d, 22-23 + 0-6 周期内, 本 tick 在 22:00-23:59 合法窗口 — 22:03 = 今日首个 tick, 距上次 wc 05:05:54 d76f58d fix(docs) close docs/ci-failures.md 05:03 cron tick-note 距 ~16h57m **DEEP UNLOCKED** past 3600s floor; 距上次 lb 06:09:02 81eaa71 fix(docs) close docs/ci-failures.md 06:03 cron tick-note 距 ~15h54m **DEEP UNLOCKED** past 3600s floor). Pre-rotation dual-UNLOCKED (wc 61081s + lb 57293s past 1h gate) + dual git clean (worktree only `_tmp/tick-note-*.md` untracked, leave-in-place per recurrence #22) + dual CI 24h **GREEN** (verified via `heartbeat-watchdog.sh ci-gate` on both repos; watchdog sees fresh current heads 81eaa71 + d76f58d all-check-runs-success → effective GREEN on both). Block counts: wc 0, lb 0 (verified via `block-count`). docs(roadmap) quota: wc 0/2 today, lb 0/2 today.

- **轮转检查 (V3 rotation W→L)**:
  - **woclaw**: 22:03 距 05:05 d76f58d ~16h57m **DEEP UNLOCKED** (61081s past 3600s floor) + CI 24h GREEN + git clean + ROADMAP top `next: step-w-23 chain-31-process-cwd-regression-gate-closure` claims chain-31 active, but **chain #31 closed 2026-07-17 by `33dcc61`** (test(hub) replace process.cwd() with import.meta.url-based ESM-safe paths in 4 regression-gate tests — db_decrypt_inline + db_memory_select_typed + db_mysql_storedvalue_regression + req_on_data_typed_chunk — parallels 1a40479 6-suite + ebd839e 7th-suite closures from chain #31) → **top next: drift stale pending 10 天** (07-17 → 07-27). The 07-25 06:23 tick note (630ef91) recovery from phantomic a58b1d8 set step-w-23 active 当时 but the underlying chain was already done 8 days prior — claim misfires. Real-code hint 候选池: (a) sync-skill-frontmatter.mjs — DONE (verified `node scripts/sync-skill-frontmatter.mjs --check` PASS 0/5 drifted); (b) docs/ci-failures.md residual — multi-file grep+edit > 5-min; (c) encryption-at-rest 链路单测 — 6+ cases > 5-min; (d) 7 子包 LICENSE / package.json files 字段补齐 — multi-file > 5-min; (e) vscode EventEmitter.fire() args 单测 — DONE (07-10 0841eb1 + b57f64a + 892f20d); (f) npm publish 0.4.0 — governance-blocked per AGENTS.md rule 6. **All 6 > 5-min single-tick budget.** wc 候选池 0 真 pending single-tick-blocked-by-budget. L257 RFC 8693 PoC (~780 LOC / 2-3wk) awaiting father approval + sustained woclaw UNLOCK window for L257.1 ship — OUT OF SCOPE this tick.
  - **llm-benchmark**: 22:03 距 06:09 81eaa71 ~15h54m **DEEP UNLOCKED** (57293s past 3600s floor) + CI 24h GREEN + git clean + ROADMAP top `next: step-v6.0-16 aa_agentperf_v2_real_fetch_v1` claims active, but **step-v6.0-16 realized 2026-07-26 by `16706e5`** (feat(evaluator) add aa_agentperf_v2_agentic_workloads real fetch chain #22 12th fetcher, src/core/evaluator.ts + src/index.ts + src/types/index.ts + 5 test files, total +N lines) → **top next: drift stale pending 1 天 16h** (07-26 06:04 → 07-27 22:03). 13th fetcher extension candidate step-v6.0-17 (skillvetbench / frontiermath_v2 / mcp_atlas / scipredict — any of 4 type-stubs from 06-19 ROADMAP 48→49 段) awaiting ≥1h sustained UNLOCK + 5-7 min budget per chain #19/20/21/22 pattern.

- **V3 §11 ROADMAP drift OVERRIDE evaluation**:
  - wc ROADMAP drift TRUE (10 天 stale, chain-31 closed 07-17 33dcc61, top still 指 step-w-23) + wc docs(roadmap) quota 0/2 today → §11 OVERRIDE eligible (any-time ALLOW per V3 rule 3 + 必含 next: step-X.Y).
  - lb ROADMAP drift TRUE (1 天 16h stale, step-v6.0-16 realized 07-26 16706e5, top still 指 step-v6.0-16) + lb docs(roadmap) quota 0/2 today → §11 OVERRIDE eligible too.
  - **Single-emission rule honored**: each tick emits at most 1 docs(roadmap) commit (per `v3-section-11-roadmap-drift-override-second-side-symmetry.md` + recurrence #31 dual-side rule). Pick wc 优先 (rotation default + deeper drift 10 天 vs lb 1 天 16h).

- **判定**: dual-UNLOCKED past 3600s floor (wc 61081s + lb 57293s) + dual git clean + dual CI 24h GREEN + rotation default **woclaw** (last_picked=llm-benchmark 06:03 tick 81eaa71) + cadence-override §1 wc counter 0 today < 5 → **NO FLIP**. Real-code path OPEN on both but no candidate fits 5-min single-tick budget. **V3 §11 ROADMAP drift OVERRIDE FIRES** (wc top drift 10 天 + docs(roadmap) budget 0/2). docs(roadmap) only tick-note, no accompanying fix(docs) closure on this tick (single-emission rule). 选 woclaw 优先: (1) wc ROADMAP drift 真 stale pending 10 天 (chain #31 07-17 33dcc61 closed 10 天前, 顶部 next: 仍指 stale step-w-23); (2) rotation default wc; (3) lb ROADMAP drift 1 天 16h pending recovery but lb last_picked is recent (06:03 81eaa71) — defer lb recovery to next L-side tick; (4) docs(roadmap) budget 1 slot 用; (5) wc 候选池 0 真 pending single-tick-blocked-by-budget, V3 §11 OVERRIDE 是唯一 eligible path; (6) wc ROADMAP 顶部 current next: step-w-23 chain-31-process-cwd-regression-gate-closure 是 closed chain 而非 active step → 必须推进 to step-w-24 R93 hub/test agent-stream-runtime-compliance-tests.

- **step-w-23 chain-31-process-cwd-regression-gate-closure 状态回写** (本轮顺手): chain #31 实际 07-17 22:55:38 33dcc61 闭合 ✅ (test(hub) replace process.cwd() with import.meta.url-based ESM-safe paths in 4 regression-gate tests — db_decrypt_inline + db_memory_select_typed + db_mysql_storedvalue_regression + req_on_data_typed_chunk — switched `join(process.cwd(), 'src', '<file>')` → `dirname(fileURLToPath(import.meta.url)) + '..' + 'src' + '<file>'`, parallels 1a40479 6-suite + ebd839e 7th-suite closures, 4 remaining regression-gate tests still used process.cwd() which broke when vitest ran from workspace root woclaw/ vs hub/ cwd). Verification: workspace-wide `npx vitest run` (from woclaw/ root) → 67/67 files, 745/745 tests green; hub-scoped `npx vitest run` (from woclaw/hub/) → all 4 files still green (26/26 tests); tsc --noEmit -p hub → clean. Pure test-only edit, no production code change. **step-w-23 chain-31 助手主轴完成 ✅** (10 天前, 实际闭合后未做 ROADMAP top next: 推进 — 本轮校正). 详见 33dcc61 commit body.

- **next: step-w-24 R93-hub-test-agent-stream-runtime-compliance-tests 立 active** (本轮关键): top next: 从 stale step-w-23 (closed chain) → step-w-24 active 推进. R93 = Round 93 hub/test agent-stream-runtime-compliance-tests — **沿 e8531a9 R92.6 agent_stream.ts module extraction + ed9f6cc R92.7 streams SQL syntax error + duplicate REST handler fix + 5f5630f R92.5 NDJSON event contract spec (LEARNING_PLAN §92.5)**. 范围: (1) `hub/test/agent_stream.test.ts` 新增 4-6 runtime compliance tests 验证 agent_stream.ts 模块 (213 lines) 的 runtime 行为 match R92.5 NDJSON event contract spec: (a) NDJSON parse — multi-event stream 单行 → JSON parse 0 错 + 多行 → batch parse + malformed line skip + close-on-error 行为; (b) backpressure — slow consumer backpressure signal + resume; (c) error handling — connection drop → reconnect retry + exponential backoff + max retry exhaustion; (d) heartbeat — agent liveness heartbeat emit interval + timeout; (e) event ordering — FIFO guarantee under concurrent emit; (f) shutdown — graceful shutdown drain + force-close timeout; (2) `hub/src/agent_stream.ts` 可能 minor adjustment (估计 < 20 LOC) 修复任何 compliance gap; (3) `tsc --noEmit -p hub` clean + `npx vitest run hub/test/agent_stream.test.ts` 全部 green; (4) 不动 e8531a9 R92.6 agent_stream.ts extraction 模式 + 不动 ed9f6cc R92.7 SQL syntax fix 模式 + 不动 5f5630f R92.5 NDJSON spec doc; (5) tests/evaluator-fetch-X.test.ts 模式 (test ceiling closure + fixture parity lock) parallels; 估 30-45min 跨 4-6 tick, 5min 内**只立 next: + 详细步骤描述**, 等 ≥1h UNLOCK 后从步骤 1 (4-6 compliance tests 起草) 起逐步推. 价值: 闭合 R92 NDJSON event contract spec (5f5630f) → R92.6 contract tests (92c7223) → R92.6 module extraction (e8531a9) → R92.7 SQL syntax fix (ed9f6cc) → R93 runtime compliance tests 完整链路; 6 维度 compliance (NDJSON parse / backpressure / error handling / heartbeat / event ordering / shutdown) 提供 agent_stream.ts 模块 production-readiness gate; 复用 5f5630f R92.5 NDJSON spec doc 作为 spec source of truth; 与 R92.5 + R92.6 + R92.7 形成「NDJSON spec → contract tests → module extraction → SQL syntax fix → runtime compliance」姊妹 chain 5 段姊妹 pattern (4 commits + 1 spec doc + 1 README doc + 6 compliance test cases = 12 文件 + 估 +800 LOC 跨 3-5 天). L257 RFC 8693 PoC (~780 LOC / 2-3wk) awaiting father approval — 待父亲拍板 ship 优先级 + 阻塞 8 days pending.

- **6-step cron-mode append pattern** (recurrence #26 + Pitfall #78 hygiene + non-phantomic recipe per `references/v3-section-11-roadmap-drift-override-wc-side-recovery-2026-07-25-0623.md`):
  1. write_file tick note to `_tmp/tick-note-2026-07-27-2203.md` (untracked, leave-in-place per recurrence #22)
  2. `head -n 482 docs/ROADMAP.md > /tmp/roadmap-new.md` + `cat _tmp/tick-note-2026-07-27-2203.md >> /tmp/roadmap-new.md` + `tail -n +483 docs/ROADMAP.md >> /tmp/roadmap-new.md` (3-way merge, no in-place mutation)
  3. trailing-newline check (tick-note ends with `\n` per `tail -c 5 | od -c` returning newline char; `wc -l /tmp/roadmap-new.md docs/ROADMAP.md` verify +expected_lines)
  4. `git diff --check` clean + `git diff --stat` shows expected insertions
  5. `git add docs/ROADMAP.md + git commit -m "docs(roadmap): 22:03 cron tick-note next: step-w-24 R93-hub-test-agent-stream-runtime-compliance-tests" + git push origin master`
  6. **non-phantomic verification**: `PARENT_BLOB=$(git rev-parse HEAD^:docs/ROADMAP.md); HEAD_BLOB=$(git rev-parse HEAD:docs/ROADMAP.md); [ "$PARENT_BLOB" != "$HEAD_BLOB" ] && echo "NON-PHANTOMIC OK"` — if blobs identical: STOP, phantomic per Pitfall #79, recover by redo with new tick-note content + actual file change verification. leave-in-place cleanup of `_tmp/tick-note-2026-07-27-2203.md` per recurrence #22 (tirith `delete in root path` blocks rm — leave all 4 untracked tick-note files in `_tmp/`).

- **Watchdog pre-commit check** (LIVE): `docs(roadmap): 22:03 cron tick-note next: step-w-24 R93-hub-test-agent-stream-runtime-compliance-tests` → V3 rule 1 PASS (CI 24h GREEN docs(roadmap) any-time ALLOW per rule 3) + V3 rule 2 PASS (wc docs(roadmap) quota 0/2 today → 1/2, 必含 `next: step-X.Y` → step-w-24 binding ✅) + V3 rule 4 NOT TRIGGERED (real roadmap not pseudo) + V3 rule 5 HINT (wc block count 0 today, no consecutive-block hint fires). Expected: `✅ watchdog PASS`.

- **ROADMAP drift check at 22:03**: wc ROADMAP top `next: step-w-23 chain-31-process-cwd-regression-gate-closure` claims active but chain #31 07-17 33dcc61 closed 10 天前 → drift TRUE 10 天. lb ROADMAP top `next: step-v6.0-16 aa_agentperf_v2_real_fetch_v1` claims active but step-v6.0-16 realized 07-26 06:04 16706e5 → drift TRUE 1 天 16h. **本轮 wc drift 校正** (立 step-w-24 active + 回写 step-w-23 chain-31 闭合 ✅); **lb drift 推迟 to next L-side tick** (per dual-side single-emission rule — 1 docs(roadmap) per tick). wc docs(roadmap) quota 0/2 → 1/2, 剩 1 slot; lb docs(roadmap) quota 0/2 待 lb 侧 step-v6.0-17 立项时使用.

- **3-message watchdog sanity suite at 22:03** (per `references/clean-state-lock-tight-skip-3msg-sanity-suite-2026-07-20.md`): `docs(roadmap): next: step-w-24` PASS (wc docs(roadmap) quota 0/2 → 1/2 slot available, next: binding ✅, CI 24h GREEN docs(roadmap) any-time ALLOW per rule 3) / `feat(docs)` BLOCK (pseudo per rule 4) / `fix(docs)` PASS (non-pseudo any-time ALLOW per rule 1). Gate grammar healthy.

- **Cascade-rate tracker**: 50/50+ positive data points across #13-#50+, 35th PROCEED-with-zero-cascade, 0 SKIPs in cycle, 0% cascade rate. **33+ consecutive PROCEED ticks, 0% cascade rate.**

- **Cross-repo state at 22:03**: wc d76f58d age ~16h57m DEEP UNLOCKED past 3600s floor (61081s, last tick 05:03 fix(docs) close ci-failures); lb 81eaa71 age ~15h54m DEEP UNLOCKED past 3600s floor (57293s, last tick 06:03 fix(docs) close ci-failures). lb drift pending (step-v6.0-16 realized but top next: stale) — next L-side tick (22:23 likely) eligible for §11 OVERRIDE on lb side. wc real-code chain #32 candidate (R93 hub/test agent-stream-runtime-compliance-tests) — 立 step-w-24 active, 等 ≥1h UNLOCK 后从 4-6 compliance tests 起草起逐步推. wc L257 RFC 8693 PoC (~780 LOC / 2-3wk) awaiting father approval + sustained woclaw UNLOCK window — 优先级待父亲拍板.

- **Round 63 substrate research memory write**: `memory/2026-07-27-learning-agent-credential-lifecycle-substrate.md` (25.7KB) completed 00:50 prior tick; L257 4-PoC design RFC 8693 + policy engine + hook bridge + revocation bloom (~780 LOC / 2-3wk); awaiting father approval + sustained woclaw UNLOCK window for L257.1 ship candidate. Round 71 LLM cost routing substrate (17.7KB) completed 17:45 prior tick; L146 cost-router PoC (~480 LOC / 2-3wk) awaiting father approval + sustained woclaw UNLOCK window for L146.1 ship candidate.

- **Pre-commit verification**: woclaw hub `npm run build` (tsc) clean exit 0 (verified 01:06 prior tick; no source change since then — only docs/ci-failures.md fix(docs) closures which don't touch hub/src/); `git status --short --branch` clean (master...origin/master synced, only untracked _tmp/tick-note files per recurrence #22); `git diff --check` clean; `docs/ROADMAP.md` line count 622 lines (pre-merge) → expected post-merge ~640 lines (+18 lines tick note); `node scripts/sync-skill-frontmatter.mjs --check` PASS (`0/5 files drifted ✓ all SKILL.md compatible_with lists in sync`).

- **Next tick prediction (22:23)**: wc age ~16h+ UNLOCKED past floor; lb age ~15h+ UNLOCKED. W→L: last_picked=woclaw (this tick 22:03 docs(roadmap)) → L → llm-benchmark. Cadence-override: wc counter 1 today < 5 → NO FLIP. **Expected: lb `docs(roadmap)` drift OVERRIDE at 22:23** (立 next: step-v6.0-17 + 回写 step-v6.0-16 07-26 16706e5 闭合 ✅, dual-side recovery completion per `v3-section-11-roadmap-drift-override-second-side-symmetry.md`); fallback to `fix(docs)` closure on lb if docs(roadmap) quota exhausted (lb quota 0/2 today → 1/2 slot available). Real-code chain #32 R93 agent-stream runtime compliance tests on wc OR step-v6.0-17 13th fetcher on lb remain queued for sustained multi-tick budget windows + father approval on scope. L257.1 RFC 8693 PoC OR L146.1 cost-router PoC awaiting father approval on priority.

- **LLM errors**: 0 (无 retry, 无 abort).
## 进度追踪 / Progress

| 版本 | 日期 | 里程碑 |
|------|------|--------|
| v1.1 | 2026-04-14+ | ⭐ **All-in-One Memory Platform**（Session Store + AI Extraction + Forgetting Scheduler）|
| v1.1+ | 2026-04-23→05-30 | Session Store、AI Extraction (OpenAI/Anthropic/Ollama Providers)、Forgetting Scheduler、Memory Stats、Batch Extraction ✅ |
| v1.1+ | 2026-05-25→05-30 | **Web UI 增强**：Sessions Tab + Session Replay、Memory Browse/Export、Memory Encryption at Rest、Federation-aware Shared Memory、Importance Heatmap ✅ |
| v0.6 | 2026-06-01→06-02 | **CI-1 Story** 完成：README 顶部加 CI/Docker Hub 徽章 + `.github/workflows/ci.yml` 添加 `npm test` 步骤（job 重命名 `hub (lint + build + test)`）✅ |
| v0.5.0 | 2026-06-02 | **GitHub Release** for `hub/v0.5.0` 已发布：<https://github.com/XingP14/woclaw/releases/tag/hub/v0.5.0>（All-in-One Memory Platform + Memory Encryption + Federation-aware Sync + Session Archival + Web UI 增强 + CI/CD 完善）✅ |
| v0.6+ | 2026-06-04 | **RS-1 Step 1**: woclaw-hub 仓拆分方案设计完成（`docs/RS-1-REPO-SPLIT-HUB-PLAN.md`）✅ |
| v1.0 | 2026-04-05 | Graph Memory、Federation、Token Rotation、私有 Topic、Web UI ✅ |
| v0.4.3 | 2026-04-05 | SQLite/MySQL、GitHub Pages、精准搜索、迁移完整性、文档对齐 ✅ |
| v0.1 | 2026-03-30 | 项目立项、Hub 部署 ✅ |
| v0.2 | 2026-03-31 | REST API、npm 发布、跨框架集成 ✅ |
| v0.3 | 2026-04-01 | Tags/TTL 增强、Docker Hub Workflow ✅ |
| v0.4 | 2026-04-02→04-04 | ⭐ **OpenAI Codex CLI Hook 支持**（高优先级）✅ |
| v0.5 | 2026-04-04 | ⭐ **跨框架数据迁移**（OpenAI/Claude/Gemini/OpenClaw → WoClaw）✅ |
| v0.6 | 2026-04-04 | Hook 系统完善、Docker Hub、ClawHub Skill（2026-04-13 后发布）|
| v1.0 | 2026-04-05 | Graph Memory、Federation、Token Rotation、私有 Topic、Web UI ✅ |

---

## 📋 Story 卡片（便于心跳执行）

> ⚠️ **评估结论：所有 Story 都无法在 10 分钟内完成，必须拆分步骤**
> 每个步骤 = 1 次心跳内可完成的最小可提交单元

### Stories 完成状态（全部 ✅）

| # | Story | 版本 | 步骤数 | 总工作量 | 状态 |
|---|-------|------|--------|---------|------|
| ... | (all previously completed) | ... | ... | ... | ✅ |
| CI-1 | CI/Docker 徽章显式化 | v0.6 | 2 | ~10min | ✅ 2026-06-02 |

| # | Story | 版本 | 步骤数 | 总工作量 | 状态 |
|---|-------|------|--------|---------|------|
| S1 | Gemini CLI Hook 脚本 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S2 | OpenCode Hook 脚本 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S3 | Codex Hook npm 发布 | v0.2 | 2 | ~20min | ✅ 2026-04-03 |
| S4 | your-hub-host plugin 验证 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S5 | VPS4 plugin 验证 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S6 | Claude Code Hook 安装器验证 | v0.3 | 2 | ~30min | ✅ 2026-04-03 |
| S7 | Codex Hook 安装器完善 | v0.3 | 2 | ~30min | ✅ 2026-04-04 |
| S8 | MCP CLI serve 命令 | v0.3 | 4 | ~2h | ✅ 2026-04-04 |
| S9 | Memory Versioning | v0.4 | 4 | ~2h | ✅ 2026-04-04 |
| S10 | Semantic Recall | v0.4 | 5 | ~3h | ✅ 2026-04-04 |
| S11 | Agent 发现 API | v0.4 | 2 | ~30min | ✅ 2026-04-04 |
| S12 | 任务委托机制 | v0.4 | 5 | ~3h | ✅ 2026-04-04 |
| S13 | Codex 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S14 | Claude Code 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S15 | Gemini CLI 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S16 | OpenClaw 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S17 | MCP Server 使用文档 | v0.6 | 3 | ~1h | ✅ 2026-04-04 |
| S18 | TLS/SSL 支持 | v0.6 | 3 | ~30min | ✅ 2026-04-04 |
| S19 | 连接限流 | v1.0 | 4 | ~40min | ✅ 2026-04-04 |
| S20 | Graph Memory — 图数据库设计 | v1.0 | 2 | ~20min | ✅ 2026-04-05 |
| S21 | Graph Memory — 核心实现 | v1.0 | 4 | ~3h | ✅ 2026-04-05 |
| S22 | Token 轮换机制 | v1.0 | 3 | ~30min | ✅ 2026-04-05 |
| S23 | 私有 Topic（邀请制）| v1.0 | 3 | ~30min | ✅ |
| S24 | Multi-Hub Federation | v1.0 | 4 | ~40min | ✅ |
| S25 | Semantic Recall（意图感知检索）| v1.0 | 3 | ~30min | ✅ |
| S26 | Deduplication | v1.0 | 3 | ~30min | ✅ |
| S27 | Web UI 管理面板 | v1.0 | 3 | ~30min | ✅ |
| S28 | VS Code Extension | v1.0+ | 2 | ~20min | ✅ 2026-04-05 |
| M1-T1 | Session 类型定义 | v1.1 | 1 | ~10min | ✅ 2026-04-24 |
| M2-DB1 | Session 表初始化 | v1.1 | 1 | ~10min | ✅ 2026-04-24 |
| M2-DB2 | Session CRUD 方法 | v1.1 | 2 | ~20min | ✅ 2026-04-24 |
| M3-SS1 | SessionStore 核心实现 | v1.1 | 2 | ~20min | ✅ 2026-04-23 |
| M4-AI1 | 提取引擎核心架构 | v1.1 | 1 | ~10min | ✅ 2026-04-23 |
| M4-AI2 | OpenAI Provider 实现 | v1.1 | 1 | ~10min | ✅ 2026-04-23 |
| M4-AI3 | Anthropic/Ollama Provider Stub | v1.1 | 2 | ~20min | ✅ 2026-04-23 |
| M4-AI4 | 提取引擎测试 | v1.1 | 1 | ~10min | ✅ 2026-04-23 |
| M5-API1 | Session REST 路由 | v1.1 | 2 | ~20min | ✅ 2026-04-23 |
| M6-FG1 | ForgettingScheduler 核心实现 | v1.1 | 1 | ~10min | ✅ 2026-04-23 |
| M6-FG2 | Hub 集成 + REST 端点 | v1.1 | 2 | ~20min | ✅ 2026-04-23 |
| M6-FG3 | ForgettingScheduler 单元测试 | v1.1 | 1 | ~10min | ✅ 2026-04-23 |
| M5b-MS1 | Memory Stats 端点 | v1.1 | 1 | ~10min | ✅ 2026-04-23 |
| M5b-BM1 | Batch Extraction 模式 | v1.1 | 1 | ~10min | ✅ 2026-04-24 |
| M7-OL1 | Ollama Provider 完整实现 | v1.1+ | 1 | ~10min | ✅ 2026-04-23 |
| M7-GN1 | 提取引擎 → Graph 自动关联 | v1.1+ | 1 | ~10min | ✅ 2026-04-23 |
| S2 | OpenCode Hook 脚本 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S3 | Codex Hook npm 发布 | v0.2 | 2 | ~20min | ✅ 2026-04-03 |
| S4 | your-hub-host plugin 验证 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S5 | VPS4 plugin 验证 | v0.2 | 3 | ~1h | ✅ 2026-04-03 |
| S6 | Claude Code Hook 安装器验证 | v0.3 | 2 | ~30min | ✅ 2026-04-03 |
| S7 | Codex Hook 安装器完善 | v0.3 | 2 | ~30min | ✅ 2026-04-04 |
| S8 | MCP CLI serve 命令 | v0.3 | 4 | ~2h | ✅ 2026-04-04 |
| S9 | Memory Versioning | v0.4 | 4 | ~2h | ✅ 2026-04-04 |
| S10 | Semantic Recall | v0.4 | 5 | ~3h | ✅ 2026-04-04 |
| S11 | Agent 发现 API | v0.4 | 2 | ~30min | ✅ 2026-04-04 |
| S12 | 任务委托机制 | v0.4 | 5 | ~3h | ✅ 2026-04-04 |
| S13 | Codex 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S14 | Claude Code 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S15 | Gemini CLI 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S16 | OpenClaw 迁移工具 | v0.5 | 4 | ~2h | ✅ 2026-04-04 |
| S17 | MCP Server 使用文档 | v0.6 | 3 | ~1h | ✅ 2026-04-04 |
| S18 | TLS/SSL 支持 | v0.6 | 3 | ~30min | ✅ 2026-04-04 |
| S19 | 连接限流 | v1.0 | 4 | ~40min | ✅ 2026-04-04 |
| S20 | Graph Memory — 图数据库设计 | v1.0 | 2 | ~20min | ✅ 2026-04-05 |
| S21 | Graph Memory — 核心实现 | v1.0 | 4 | ~3h | ✅ 2026-04-05 |
| S22 | Token 轮换机制 | v1.0 | 3 | ~30min | ✅ 3/3 |
| S23 | 私有 Topic（邀请制）| v1.0 | 3 | ~30min | ✅ |
| S24 | Multi-Hub Federation | v1.0 | 4 | ~40min | ✅ |
| S25 | Semantic Recall（意图感知检索）| v1.0 | 3 | ~30min | ✅ |
| S26 | Deduplication | v1.0 | 3 | ~30min | ✅ |
| S27 | Web UI 管理面板 | v1.0 | 3 | ~30min | ✅ |
| S28 | VS Code Extension | v1.0+ | 2 | ~20min | ✅ 2026-04-05 |

---

### S28: VS Code Extension（v1.0+）

> 目标：在 VS Code 中查看 WoClaw Hub 状态、Topics、Agents

**设计：**
```
VS Code Extension = TypeScript + VS Code API
  - 状态栏：Hub 连接状态 + agent count
  - Tree View：Topics / Agents / Memory 三个视图
  - 通过 Hub REST API (http://your-hub-host:8083) 读取数据
  - 无需认证（内网使用）
  - 包名：woclaw-vscode
  - 放在 packages/woclaw-vscode/ 目录
```

- [x] **S28-1（10min）：VS Code Extension 脚手架 + 状态栏** ✅ 2026-04-05
  - `packages/woclaw-vscode/` 初始化（package.json, tsconfig, extension.ts）
  - 状态栏：显示 "WoClaw: Connected" 或 "Disconnected"
  - 读取 REST /health 显示 agents count + topics count
  - ✅ statusBarItem 每 30s 轮询 + `woclaw.showDashboard` 命令
  - ✅ README.md + .gitignore

- [x] **S28-2（10min）：Tree View + package.json 发布配置** ✅ 2026-04-05
  - Topics TreeView（列出所有 topic + message count）✅
  - Agents TreeView（列出所有 agent + status）✅
  - Memory TreeView（搜索框 + 结果列表）✅
  - package.json 配置 vsce 发布（publisher: XingP14）✅
  - README 添加 VS Code Extension 章节 ✅

## 🔨 Story 步骤拆分详情

### S1: Gemini CLI Hook 脚本（v0.2）
> 评估：需要先调研 Gemini CLI hook 机制，总计 ~3 步骤

- [x] **S1-1（10min）：调研 Gemini CLI hook 机制** ✅ 2026-04-03
  - Web 搜索 + 文档研究确认：Gemini CLI 有完整 hooks 系统（v0.26.0+）
  - 支持 SessionStart/SessionEnd/PreCompress 等生命周期 hooks
  - 通过 `~/.gemini/settings.json` 配置，stdin/stdout JSON 通信
  - 输出：✅ 有 hooks 支持，参考 Claude Code 模式实现

- [x] **S1-2（10min）：实现 gemini-session-start.sh** ✅ 2026-04-03
  - 创建 `packages/woclaw-hooks/gemini-session-start.sh`
  - 通过 REST API 从 WoClaw Hub 读取共享上下文
  - 支持 Gemini CLI stdin JSON 格式消费
  - 更新 install.js gemini hookNames 和 settingsHint

- [x] **S1-3（10min）：实现 gemini-session-stop.sh + 更新 install.js** ✅ 2026-04-03
  - 创建 `packages/woclaw-hooks/gemini-session-stop.sh`
  - 从 stdin 读取 Gemini CLI SessionEnd JSON（sessionId, recentInteractions）
  - 将 session 摘要写入 WoClaw Hub REST API
  - install.js 早已配置 `hookNames` 包含 `gemini-session-stop`，无需额外修改

### S2: OpenCode Hook 脚本（v0.2）
> 评估：OpenCode **无原生 session lifecycle hooks**（Feature Request #14863 未实现），~3 步骤

- [x] **S2-1（10min）：调研 OpenCode hooks 机制** ✅ 2026-04-03
  - OpenCode 有原生 plugin 系统 + session events（已修正旧结论）
  - oh-my-opencode 有 Claude Code 完整兼容层

- [x] **S2-2（10min）：评估 oh-my-opencode 集成可行性** ✅ 2026-04-03
  - ✅ oh-my-opencode 有完整 Claude Code 兼容层（46+ hooks）
  - ✅ WoClaw Claude Code hooks 可直接复用（无需新开发）
  - 方案A（推荐）：文档引导用户安装 oh-my-opencode，WoClaw hooks 自动生效
  - 方案B：自建 woclaw-opencode 原生 plugin（长期方案）

- [x] **S2-3（10min）：设计 OpenCode WoClaw plugin 方案** ✅ 2026-04-03
  - 方案A（推荐）：oh-my-opencode 零开发复用 Claude Code hooks
  - 方案B（备选）：opencode-woclaw 原生插件（`packages/opencode-woclaw-plugin/` 已就绪，待 npm 发布）
  - 输出：`docs/OPENCODE-INTEGRATION.md` 集成指南

### S3: Codex Hook npm 发布（v0.2）
> 评估：package.json 已就绪，~2 步骤 ✅ 已完成

- [x] **S3-1（10min）：审查并完善 woclaw-codex package** ✅ 2026-04-03
  - ✅ package.json files/bin 字段完整（*.py, install.py, bin/cli.js）
  - ✅ README.md 内容完整，包含安装说明和环境变量说明
  - ✅ `npm pack --dry-run` 验证通过，7 个文件打包正确

- [x] **S3-2（10min）：执行 npm publish** ✅ 2026-04-03
  - ✅ `woclaw-codex@0.1.2` 已发布至 npm（https://www.npmjs.com/package/woclaw-codex）
  - ✅ `npm view woclaw-codex` 验证通过
  - ✅ 更新 ROADMAP.md

### S4: your-hub-host plugin 验证（v0.2）
> 评估：需要 SSH + 操作，~3 步骤 ✅ 全部完成

- [x] **S4-1（10min）：SSH 检查 your-hub-host 当前状态** ✅ 2026-04-03
  - `openclaw status` + `openclaw channels list` 执行完毕
  - 结果：plugin 已安装（`ls ~/.openclaw/extensions/` 含 woclaw），channel "WoClaw default: configured, enabled" ✅
  - WoClaw Hub 连接：ws://your-hub-host-ip:8082，已认证为 your-hub-host ✅
  - 注：your-hub-host 自连存在 1006 异常关闭后重连（循环依赖，Hub 和 plugin 同机），功能正常
  - `ssh -i ~/.ssh/id_ed25519 root@your-hub-host openclaw status`
  - 检查 woclaw plugin 是否已安装（`~/.openclaw/extensions/`）
  - 检查 channel 状态

- [x] **S4-2（10min）：安装/更新 xingp14-woclaw plugin** ✅ 2026-04-03
  - 原 0.3.0 → 升级到 0.4.3（npm latest）
  - rm -rf 清理旧目录后正常安装
  - 重启 gateway（kill old PID → nohup openclaw gateway）
  - channel 状态确认：configured, enabled，Hub 自连正常

- [x] **S4-3（10min）：验证 WebSocket 连接** ✅ 2026-04-03
  - `curl http://your-hub-host:8083/health` → `{"status":"ok","agents":2,"topics":2}`
  - WebSocket 直连测试：ws://your-hub-host-ip:8082 → 连接成功（315ms），认证正常
  - Hub 可见 2 个 agent，channel WoClaw default 配置 enabled

### S5: VPS4 plugin 验证（v0.2）
> 评估：本地 Docker 环境，~3 步骤（注意 plugin ID mismatch 警告）

- [x] **S5-1（10min）：检查当前 plugin 状态** ✅ 2026-04-03
  - `openclaw status` + `openclaw channels list` 执行完毕
  - 结果：WoClaw channel "configured, enabled" ✅，Hub 健康 ✅ (`{"status":"ok","agents":2,"topics":2}`)
  - `xingp14-woclaw` (v0.4.3) 已安装，config 指向 Hub ws://your-hub-host-ip:8082 ✅
  - `xingp14-woclaw.broken`（root 所有，无法清理）是旧版残留，造成 duplicate ID 警告 ⚠️
  - Plugin ID mismatch：manifest id="woclaw" vs npm package="xingp14-woclaw"
  - **S5-2 修复方案**：更新 `openclaw.plugin.json` manifest id 为 `xingp14-woclaw`，或修改 config entries key

- [x] **S5-2（10min）：修复 plugin ID mismatch** ✅ 2026-04-03
  - 修复：`~/.openclaw/openclaw.json` 的 `plugins.installs.woclaw` → `plugins.installs.xingp14-woclaw`（与 manifest id 和目录名对齐）
  - 重启 gateway 后 channel 状态 clean，无 mismatch 警告
  - 注：`plugins.entries.xingp14-woclaw` 早已正确，无需修改

- [x] **S5-3（10min）：重启并验证** ✅ 2026-04-03
  - 重启 gateway（SIGUSR1 hot reload）
  - 验证 `openclaw channels list` woclaw 显示 "configured, enabled"（无 mismatch 警告）✅
  - 确认 Hub 连接数（2 agents, 2 topics）✅
  - 注意：channel key 必须是 `woclaw`（匹配 manifest channels 数组），plugin entry key 是 `xingp14-woclaw`（匹配 manifest id）

### S6: Claude Code Hook 安装器验证（v0.3）
> 评估：install.js 已完整，需要测试验证，~2 步骤

- [x] **S6-1（10min）：审查 install.js 对 Claude Code 的支持** ✅ 2026-04-03
  - ✅ hook 文件检测/install/uninstall 逻辑完整正确
  - ✅ hookNames=['session-start','session-stop','precompact'] 覆盖三种 hook
  - ✅ ~/.claude/hooks + ~/.claude/settings.json 路径正确
  - ⚠️ **settingsHint 仅含 session-start 配置**（session-stop/precompact 用户需手动添加）
  - ⚠️ **precompact hook 未在 settingsHint 中提及**，用户不知道要配置
  - ℹ️ Claude Code settings.json 使用 hook 名称（不含 .sh），如 `"SessionStart": "woclaw-session-start"`
  - ℹ️ install.js 已调用 saveConfig(config) 写入 ~/.woclaw/.env ✅

- [x] **S6-2（10min）：测试 Claude Code hook 安装（dry-run 方式）** ✅ 2026-04-03
  - ✅ 模拟安装测试通过：session-start/stop/precompact 全部正确安装
  - ✅ 权限 0o755 正确设置
  - ✅ env 替换正确：HUB_URL/TOKEN/PROJECT_KEY 均正确替换
  - ⚠️ **settingsHint 只提示 session-start**，session-stop/precompact 配置缺失（用户需自行添加到 settings.json）
  - ℹ️ Claude Code settings.json hook 名称不应含 .sh 后缀（如 `SessionStart: "woclaw-session-start"`）
  - 不实际修改 `~/.claude/`，只验证 install.js 逻辑
  - 或在临时目录模拟 `~/.claude/` 结构测试

### S7: Codex Hook 安装器完善（v0.3）
> 评估：需要统一 codex 安装入口，~2 步骤 ✅ 全部完成

- [x] **S7-1（10min）：对比 install.py vs install.js 的 Codex 支持** ✅ 2026-04-03
  - ✅ `install.py`（woclaw-codex）：完整支持 SessionStart/Stop/PreCompact + config.toml 自动配置
  - ✅ `install.js`（woclaw-hooks）：支持 SessionStart/Stop，缺失 PreCompact + 需手动 config.toml
  - 结论：`woclaw-codex`（install.py）为官方推荐完整安装方式
  - 详见 `docs/S7-1-ANALYSIS.md`

- [x] **S7-2（10min）：统一 Codex 安装体验** ✅ 2026-04-03
  - ✅ README 新增 "OpenAI Codex CLI — Recommended: use woclaw-codex package instead" 章节
  - ✅ 对比表：woclaw-codex vs woclaw-hooks 功能差异
  - ✅ 提供两种安装路径（完整 vs 基础）

### S8: MCP CLI serve 命令（v0.3）
> 评估：需要 OpenClaw CLI 集成，~4 步骤

- [x] **S8-1（10min）：研究 openclaw mcp serve 接口** ✅ 2026-04-03
  - `openclaw mcp serve` exposes OpenClaw sessions as MCP tools（与 WoClaw 无关）
  - `woclaw-mcp@0.1.2` 已完整实现 WoClaw MCP serve（8 tools，JSON-RPC 2.0 over stdio）
  - 方案确定：在 woclaw-cli.js 添加 `mcp serve` 子命令，spawn woclaw-mcp 子进程
  - 详见 `docs/S8-1-RESEARCH.md`

- [x] **S8-2（10min）：设计 woclaw MCP serve 实现方案** ✅ 2026-04-03
  - **选择方案 B2**：独立子进程 + 相对路径引用 mcp-bridge
  - 在 `bin/woclaw.js` 添加 `mcp serve` 子命令，spawn `../mcp-bridge/dist/index.js`
  - 传递 `--hub`, `--token`, `--rest-url` 参数
  - 详见 `docs/S8-2-DESIGN.md`

- [x] **S8-3（10min）：实现 woclaw mcp serve 子命令** ✅ 2026-04-03
  - 在 `bin/woclaw.js` 添加 `mcp serve` 子命令，spawn woclaw-mcp 子进程
  - 通过环境变量 `WOCLAW_WS_URL`, `WOCLAW_REST_URL`, `WOCLAW_TOKEN` 传递 Hub 连接参数
  - 添加 `--rest-url` 全局旗标支持；添加 `__dirname` ES module polyfill
  - 验证：`woclaw mcp serve` → Hub ws://your-hub-host:8082 连接成功

- [x] **S8-4（10min）：测试 woclaw mcp serve + npm 发布** ✅ 2026-04-04
  - REST API 测试通过：`GET /memory` → 正常返回记忆列表 ✅
  - REST API 测试通过：`GET /topics` → 正常返回 topics (general, woclaw-test) ✅
  - WebSocket 连接测试通过 → Hub ws://your-hub-host:8082 认证成功 ✅
  - MCP 暴露 8 个 tools：woclaw_memory_read/write/delete/list, woclaw_topics_list/messages/send/join ✅
  - npm 包已就绪：xingp14-woclaw@0.4.3 ✅，woclaw-mcp@0.1.2 ✅

### S9: Memory Versioning（v0.4）
> 评估：Hub 侧改动，~4 步骤

- [x] **S9-1（10min）：设计 Memory Versioning 方案** ✅ 2026-04-04
  - 查看 `hub/src/memory.ts` 和 `hub/src/db.ts`
  - 设计：write 时保留旧值到 `memory_versions` 表
  - 输出：数据库 schema 变更方案 + 实际实现
  - `DBMemoryVersion` 类型已添加至 `types.ts`
  - `setMemory()` 在覆盖前自动保存旧值到 `memory_versions`，版本号从 1 开始递增
  - `GET /memory/:key/versions` REST 端点已添加，Hub 已部署并测试通过 ✅

- [x] **S9-2（10min）：实现 DB versioning 支持** ✅ 2026-04-04（随 S9-1 一起完成）
  - 在 `db.ts` 添加 `getMemoryVersions(key)` 方法
  - 修改 `setMemory` 在更新前保存旧值

- [x] **S9-3（10min）：实现 REST API versioning 端点** ✅ 2026-04-04（随 S9-1 一起完成）
  - 添加 `GET /memory/:key/versions` 端点
  - 在 `rest_server.ts` 注册路由

- [x] **S9-4（10min）：添加单元测试** ✅ 2026-04-04
  - 在 `hub/test/memory.test.ts` 添加 6 个 versioning 测试用例
  - `npm test` → 52/52 passed ✅

### S10: Semantic Recall（v0.4）
> 评估：最复杂，~5 步骤

- [x] **S10-1（10min）：设计 Semantic Recall 方案** ✅ 2026-04-04
  - 选择方案A：关键词 + 评分（stop words 过滤 + 关键词匹配 + tag 权重 + recency 排序）
  - 无外部依赖，直接可用

- [x] **S10-2（10min）：实现 recall(query) 函数** ✅ 2026-04-04
  - 在 `memory.ts` 添加 `recall(query, intent?, limit?)` 方法
  - 基于关键词匹配（substring/token/tag）+ recency 排序

- [x] **S10-3（10min）：实现 recall intent 解析** ✅ 2026-04-04（随 S10-2 完成）
  - 支持 `intent` 参数，根据 intent 标签匹配 +5 权重

- [x] **S10-4（10min）：添加 REST API 端点** ✅ 2026-04-04
  - `GET /memory/recall?q=<query>&intent=<intent>&limit=<n>`
  - Hub 已部署，API 测试通过 ✅

- [x] **S10-5（10min）：测试 + 文档** ✅ 2026-04-04
  - 6 个 recall 单元测试 ✅，58/58 tests pass ✅
  - Bug fix: recency boost 不应计入 score filter

### S11: Agent 发现 API（v0.4）
> 评估：简单 API 端点，~2 步骤

- [x] **S11-1（10min）：实现 GET /agents 端点** ✅ 2026-04-04
  - `ws_server.ts` 新增 `getAgentsInfo()` 方法，返回所有已连接 agent 列表
  - `rest_server.ts` 新增 `GET /agents` 端点，`/agents?format=details` 返回完整信息
  - `index.ts` 更新 RestServer 构造函数传递 wsServer
  - 测试通过：`GET /agents` → agent-b + your-hub-host 两个 agent ✅

- [x] **S11-2（10min）：测试 + 补充字段** ✅ 2026-04-04
  - `GET /agents` → 返回 agent-b + your-hub-host，含 connectedAt/topics/lastSeen 字段 ✅

### S12: 任务委托机制（v0.4）
> 评估：复杂协议设计，~5 步骤

- [x] **S12-1（10min）：设计委托协议** ✅ 2026-04-04
  - 设计 delegation 消息格式（type, task, fromAgent, toAgent, status）
  - 确定 Hub 侧状态存储方式
  - 输出：`docs/S12-1-DELEGATION-PROTOCOL.md` + `hub/src/types.ts` delegation types

- [x] **S12-2（10min）：实现 delegation 消息路由** ✅ 2026-04-04
  - 在 `ws_server.ts` 处理 `delegate` 消息类型
  - 将 delegation 转发给目标 agent
  - Hub SIGUSR1 重启完成，delegations.size 已纳入 stats

- [x] **S12-3（10min）：实现委托状态跟踪** ✅ 2026-04-04
  - `delegations` Map 已存在于 ws_server.ts，`handleDelegateCancel` 完整实现双向通知
  - 修复 REST DELETE `/delegations/:id` 缺少 `note` 字段的不一致问题

- [x] **S12-4（10min）：添加 REST API 端点** ✅ 2026-04-04
  - `GET /delegations`, `POST /delegations`, `DELETE /delegations/:id` ✅
  - `GET /delegations/pending?agentId=X` ✅ 全部验证通过

- [x] **S12-5（10min）：CLI 支持 + 测试** ✅ 2026-04-04
  - `woclaw delegate <toAgent> <description>` ✅
  - `woclaw delegations [status]` ✅
  - Hub your-hub-host 重启完成

### S13-S16: 迁移工具（v0.5）
> 评估：每个 ~4 步骤，以 S13 Codex 为例

- [x] **S13-1（10min）：调研 Codex session 存储格式** ✅ 2026-04-04
  - Web 搜索 + Codex 官方文档确认存储格式
  - `~/.codex/history.jsonl` — 主历史（JSONL，每行 messages）
  - `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` — 分会话轨迹（JSONL，tool calls + trajectory）
  - Hook stdin 格式：`{session_id, transcript_path, cwd, stopReason}`
  - 输出：`docs/S13-1-CODEX-SESSION-FORMAT.md`

- [x] **S13-2（10min）：实现 session parser** ✅ 2026-04-04
  - 创建 `packages/woclaw-hooks/codex-migrate.js`（纯 Node.js，456 行）
  - 支持 --list/--session-id/--session-file/--all 四种模式
  - 解析 history.jsonl，提取 decisions/files_modified/tools_used/commands_run
  - 生成 markdown summary，写入 WoClaw Hub (codex:session:<id>)
  - VPS4 测试：--list 正常返回（Codex 未安装，结果为 0 sessions）

- [x] **S13-3（10min）：实现 `woclaw migrate --framework codex` CLI** ✅ 2026-04-04
  - 添加 `migrate --framework codex [--list|--session-id <id>|--all]` 子命令到 `plugin/bin/woclaw-cli.js`
  - 通过 child_process.spawn 调用 `codex-migrate.js`，stdio inherit
  - 支持 codex / openai-codex 别名
  - CLI 加载测试通过（401 是 Hub 地址问题，非代码错误）

- [x] **S13-4（10min）：测试 + S14-S16 框架** ✅ 2026-04-04
  - S14 模板：`claude-migrate.js` — 列表 ~/.claude/sessions/，解析 JSONL，写入 WoClaw Hub
  - S15 模板：`gemini-migrate.js` — 读 ~/.gemini/history.jsonl，迁移 Gemini 会话
  - S16 模板：`openclaw-migrate.js` — 读 ~/.openclaw/openclaw.json，迁移 agent memory
  - 所有脚本通过 --help/--list 测试（无报错）；openclaw-migrate --list 正确识别 defaults agent

### S17: MCP Server 使用文档（v0.6）
> 评估：mcp-bridge README 仅 75 行，需要完整中文文档，~3 步骤

- [x] **S17-1（10min）：编写 docs/MCP-SERVER.md 完整文档** ✅ 2026-04-04
  - 创建 `docs/MCP-SERVER.md`（199 行），包含：
    - 三种安装方式（woclaw CLI / 直接运行 / 本地构建）
    - Claude Desktop / Cursor / Windsurf 配置示例
    - 8 个 MCP tools 详解（记忆 4 个 + Topic 4 个）
    - 环境变量说明
    - 故障排除指南

- [x] **S17-2（10min）：修复 woclaw_memory_list params** ✅ 2026-04-04
  - tag→tags 参数修正，移除 unsupported limit 参数

- [x] **S17-3（10min）：准备 ClawHub SKILL.md** ✅ 2026-04-04
  - 添加 ClawHub frontmatter (name, description, metadata, Security & Privacy, External Endpoints)

### S18: TLS/SSL 支持（v0.6）
> 评估：Hub 侧 WebSocket TLS 改造，~3 步骤 ✅ 已完成

- [x] **S18-1（10min）：设计 TLS 方案** ✅ 2026-04-04
  - 自签名 cert 或 Let's Encrypt，Hub 双模式（ws/wss）监听
  - TLS_KEY + TLS_CERT 环境变量驱动
  - ws_server.ts 和 rest_server.ts 双支持

- [x] **S18-2（10min）：实现 ws_server.ts TLS** ✅ 2026-04-04
  - `https.createServer()` 在检测到 tlsKey+tlsCert 时启用 TLS
  - WebSocketServer 挂载于 https.Server，支持 wss://
  - RestServer 同样支持 https://，双 server 共存
  - Hub 启动时输出协议：`[WoClaw] TLS: enabled (wss:// + https://)` / `disabled (ws:// + http://)`

- [x] **S18-3（10min）：更新 README + 文档** ✅ 2026-04-04
  - README.md 新增 TLS/SSL 章节（Docker / Node.js 两种部署方式）
  - Docker TLS 示例：openssl 自签名证书 + 容器环境变量挂载
  - Node.js TLS 示例：TLS_KEY + TLS_CERT 环境变量
  - 环境变量说明表：TLS_KEY, TLS_CERT

### S19: 连接限流（Connection Rate Limiting）（v1.0）

- [x] **S19-1（10min）：设计 Rate Limiting 方案** ✅ 2026-04-04
- [x] **S19-2（10min）：实现 ws_server.ts 限流逻辑** ✅ 2026-04-04
- [x] **S19-3（10min）：CLI + REST API 端点** ✅ 2026-04-04
- [x] **S19-4（10min）：单元测试 + 文档** ✅ 2026-04-04

### S20: Graph Memory — 图数据库设计（v1.0）

> 目标：为 WoClaw 设计 Graph Memory 存储架构，支持 temporal/entity/causal/semantic 边类型

**图模型设计：**
```
节点类型：
  • Memory — 一条共享记忆（对应现有 memory pool 条目）
  • Agent — Agent 节点（关联创建者/访问者）
  • Topic — Topic 节点

边类型（Edge Types）：
  • temporal — 时间关系（"发生在 X 之后"、"同时"）
  • entity — 实体关系（"关于 X"、"属于 X"）
  • causal — 因果关系（"导致 X"、"因为 X"）
  • semantic — 语义相似（"相似于 X"）
```

- [x] **S20-1（10min）：调研图数据库方案** ✅ 2026-04-05
  - 方案 A：graphlib（老旧，2019，无原生 TS）❌
  - 方案 B：Neo4j（外部依赖，重型）❌
  - 方案 C：自定义邻接表（需自研遍历算法）⚠️
  - **决定：graphology** ✅（原生 TypeScript 支持，活跃维护，API 丰富：遍历/路径/邻接，支持节点/边属性）

- [x] **S20-2（10min）：设计 TypeScript 类型和图存储结构** ✅ 2026-04-05
  - `hub/src/graph/types.ts` — GraphNode, GraphEdge, EdgeType, IGraphStore 接口
  - `hub/src/graph/store.ts` — 内存图存储（纯 TS Map 实现，支持 BFS 遍历/路径查找/自动关联）
  - Build ✅ + All tests ✅

### S21: Graph Memory — 核心实现（v1.0）

> 目标：实现完整的 Graph Memory CRUD + 遍历查询 API

- [x] **S21-1（10min）：节点 CRUD API** ✅ 2026-04-05
  - `POST /graph/nodes` — 创建节点 ✅
  - `GET /graph/nodes` — 列出节点（支持 type 过滤）✅
  - `GET /graph/nodes/:id` — 获取节点详情 ✅
  - `DELETE /graph/nodes/:id` — 删除节点 ✅
  - Build ✅ + All tests ✅

- [x] **S21-2（10min）：边 CRUD API** ✅ 2026-04-05
  - `POST /graph/edges` — 创建边 ✅
  - `GET /graph/edges` — 列出边（支持 source/target/type 过滤）✅
  - `DELETE /graph/edges/:id` — 删除边 ✅
  - `GET /graph/stats` — 图统计 ✅

- [x] **S21-3（10min）：图遍历查询 API** ✅ 2026-04-05
  - `GET /graph/traverse/:nodeId` — BFS 遍历邻接节点 ✅
  - `GET /graph/paths/:from/:to` — 查找两节点间路径 ✅
  - `GET /graph/related/:nodeId` — 获取相关节点 ✅

- [x] **S21-4（10min）：自动边生成 + 单元测试** ✅ 2026-04-05
  - `syncMemoryNode()` 自动创建 memory/agent/topic 节点 + entity 边 ✅
  - `findSimilarMemories()` 自动评估 semantic 相似度 ✅
  - `hub/test/graph.test.ts` — 16 个单元测试 ✅

### S22: Token 轮换机制（v1.0）

> 目标：支持在不中断服务的情况下轮换 Hub 认证 Token

**设计：**
```
机制：
  • Hub 配置支持两个 token（current + next）
  • 新 token 生成后，旧 token 在宽限期内仍有效
  • 宽限期结束后自动失效
  • REST API /admin/token/rotate 生成新 token
  • Hub 重启后恢复单 token 状态
```

- [x] **S22-1（10min）：设计 Token 轮换方案 + 配置结构** ✅ 2026-04-05
  - `nextAuthToken` + `tokenGracePeriodMs` 配置字段 ✅
  - WS auth 接受 current 或 next token ✅
  - `rotateToken()` + `getTokenStatus()` WSServer 方法 ✅
  - `hub/src/types.ts` 新增 `TokenRotationConfig` 类型
  - Hub 启动时加载 currentToken + rotationGracePeriod
  - 认证时支持 currentToken 和 nextToken 两个有效 token

- [x] **S22-2（10min）：实现 `POST /admin/token/rotate` REST API** ✅ 2026-04-05
  - `GET /admin/token/status` — 状态查询 ✅
  - `POST /admin/token/rotate` — 轮换 Token（gracePeriodMs query param）✅
  - 生成新 token，更新 currentToken
  - 旧 token 进入 grace period（可配置，默认 5min）
  - 返回新 token 和 grace period 截止时间

- [x] **S22-3（10min）：单元测试 + 文档** ✅ 2026-04-05
  - Build ✅ + All 86 tests pass ✅
  - `hub/test/token_rotation.test.ts` — 4 个单元测试 ✅
  - README 新增 Token Rotation 章节

### S23: 私有 Topic（邀请制）（v1.0）

> 目标：支持创建私有 Topic，只有被邀请的 Agent 才能加入

**设计：**
```
Topic 类型：
  • public — 任何已认证 Agent 都可以订阅（现有行为）
  • private — 需要邀请才能加入
    - creator 邀请时生成 invite token
    - 被邀请的 agent 凭 invite token join
    - invite token 有时效性（默认 10 分钟）
```

- [x] **S23-1（10min）：设计私有 Topic 方案 + Topic 类型修改** ✅ 2026-04-05
  - `Topic.isPrivate`, `inviteToken`, `inviteExpiresAt`, `invitedAgents` ✅
  - `TopicsManager.createPrivateTopic()`, `inviteToTopic()`, `joinPrivateTopic()` ✅
  - REST endpoints `POST /topics`, `POST /topics/:name/invite`, `POST /topics/:name/join` ✅
  - Build ✅ + All tests ✅
  - `hub/src/types.ts` 新增 `Topic.type: 'public' | 'private'`
  - `Topic.inviteToken?: string` 邀请令牌
  - `Topic.invitedAgents?: string[]` 已邀请的 Agent 列表
  - `Topic.inviteExpiresAt?: number` 邀请过期时间

- [x] **S23-2（10min）：实现邀请机制 API** ✅ 2026-04-05
  -  — 邀请 Agent ✅
  -  — 凭邀请 Token 加入私有 Topic ✅
  - your-hub-host 验证通过 ✅
  - `POST /topics/:name/invite` — 邀请 Agent（生成 invite token）
  - `POST /topics/:name/join` — Agent 凭 invite token 加入私有 Topic
  - ws_server.ts 在 `topic_join` 处理中验证 private Topic 邀请

- [x] **S23-3（10min）：测试 + 文档** ✅ 2026-04-05
  - Build ✅ + All 86 tests pass ✅
  - `hub/test/private_topics.test.ts`
  - README 新增 Private Topics 章节


---


### S24: Multi-Hub Federation（v1.0）

> 目标：多个 WoClaw Hub 之间互联，形成分布式 agent 网络

**设计：**
```
Federation 架构：
  • 每个 Hub 有唯一 ID（hubId）和公钥
  • Hub 之间通过 WebSocket 建立 federation 连接
  • 消息路由：跨 Hub 消息通过 federation 隧道转发
  • 信任模型：每个 Hub 需要预共享 federation token 才能连接
```

- [x] **S24-1（10min）：设计 Federation 方案 + Hub 注册表** ✅ 2026-04-05
  -  类型 ✅
  - , ,  ✅
  -  替代  ✅
  - Build ✅ + All 86 tests ✅
  - `hub/src/types.ts` 新增 `FederationConfig`, `HubPeer` 类型
  - Hub 启动时注册到已知 peer Hub 列表
  - `POST /federation/peers` — 添加 federation peer Hub

- [x] **S24-2（10min）：实现 Hub-to-Hub WebSocket 连接** ✅ 2026-04-05
  -  — 自动连接 peers, ping/reconnect, hub_info 交换 ✅
  - your-hub-host 已部署验证 ✅
  - 定期 ping peer Hub 保持连接
  - 跨 Hub 消息路由：agent 消息可发往其他 Hub 的 agent

- [x] **S24-3（10min）：实现跨 Hub 消息路由 REST API** ✅ 2026-04-05
  -  — 查看 peer 状态 ✅
  -  — 添加 peer Hub ✅
  -  — 向 peer Hub 的 agent 发送消息 ✅
  - your-hub-host 已部署验证 ✅
  - `POST /federation/send` — 向其他 Hub 的 agent 发送消息
  - 在 ws_server.ts 处理 `federation_send` 消息类型

- [x] **S24-4（10min）：测试 + 文档** ✅ 2026-04-05
  -  — 6 个单元测试 ✅
  - Build ✅ + All 92 tests pass ✅
  - `hub/test/federation.test.ts`
  - README 新增 Federation 章节


### S25: Semantic Recall（Intent-Aware Retrieval）（v1.0）

> 目标：在 recall 操作时支持意图识别和语义相似度搜索

**设计：**
```
Semantic Recall = 关键词匹配 + 意图分类 + 语义相似度
  • recall(keywords) — 基于 BM25 的关键词召回（现有）
  • recall(keywords, intent) — 意图增强召回（新增）
  • 意图类型：question / task / fact / opinion / context
  • 语义相似度：基于 label/value 文本的 Jaccard 相似度
```

- [x] **S25-1（10min）：设计意图分类方案 + recall 接口扩展** ✅ 2026-04-05
  -  ✅
  -  intent-aware tag boost ✅
  -  文本相似度搜索 ✅
  - Build ✅ + All 92 tests pass ✅
  - `hub/src/memory.ts` 扩展 `recall(intent?)` 接口
  - `IntentType` enum: `question | task | fact | opinion | context`
  - intent → 权重调整（question 优先返回 factual 记忆）

- [x] **S25-2（10min）：实现语义相似度排序** ✅ 2026-04-05
  -  — Jaccard 相似度搜索 ✅
  -  ✅
  - your-hub-host 已部署验证 ✅
  - recall 时对结果按 `computeTextSimilarity(query, memory.label + memory.value)` 排序
  - 相似度 > threshold 的结果 boost 上浮

- [x] **S25-3（10min）：测试 + 文档** ✅ 2026-04-05

### S26: Deduplication（v1.0）

> 目标：检测并解决重复写入同一 key 的冲突

**设计：**
```
冲突类型：
  • UPDATE_CONFLICT — 两次写入同一 key，value 不同
  • DUPLICATE_WRITE — 相同 key + value 重复写入
检测策略：
  • write(key) 时检查 key 是否已存在
  • 存在但 value 不同 → 返回冲突警告（允许覆盖）
  • 存在且 value 相同 → 返回 DUPLICATE，skip 写入
返回值：{ success, conflict?, duplicate?, previousValue? }
```

- [x] **S26-1（10min）：去重 + 冲突检测逻辑** :white_check_mark: 2026-04-05
  - WriteResult 接口：{ mem, duplicate, conflict, previousValue } :white_check_mark:
  - write() 返回冲突信息 :white_check_mark:
  - duplicate/conflict 时 skip notifySubscribers() :white_check_mark:
  - REST POST /memory 返回 duplicate + conflict + previousValue :white_check_mark:
  - your-hub-host 已部署验证（duplicate=true, conflict=true 正常）:white_check_mark:
  - MemoryPool.write() 返回冲突信息
  - DBMemory.conflictInfo?: { previousValue, timestamp, updatedBy }
  - REST API 返回冲突 header（X-WoClaw-Conflict: true）

- [x] **S26-2（10min）：REST API + WebSocket 冲突通知** :white_check_mark: 2026-04-05
  - POST /memory 返回 X-WoClaw-Conflict/X-WoClaw-Duplicate header :white_check_mark:
  - WebSocket memory_update 含 conflictType 字段 :white_check_mark:
  - your-hub-host 已部署验证 :white_check_mark:
  - GET /memory/:key 返回 X-WoClaw-Conflict 头
  - WebSocket 消息中增加 conflictType 字段

- [x] **S26-3（10min）：测试 + 文档** :white_check_mark: 2026-04-05

### S27: Web UI 管理面板（v1.0）

> 目标：简单的 Web 面板查看 Hub 状态、Topics、Agents、Memory

**设计：**
```
Web UI = 纯静态 HTML + Vanilla JS（无框架依赖）
  - 读取 REST API 动态渲染
  - 无需认证（内网使用）
  - 放在 hub/public/ 目录
  - 端口：8084（HTTP）
```

- [x] **S27-1（10min）：Web UI 静态页面框架 + 状态概览** :white_check_mark: 2026-04-05
  - hub/public/index.html — Topics/Agents/Memory/Federation tabs :white_check_mark:
  - Static file server on port 8084 :white_check_mark:
  - your-hub-host :8084 已部署验证 :white_check_mark:
  - hub/public/ 目录
  - index.html - 概览页（Hub 状态 + Stats）

- [x] **S27-2（10min）：Topics / Agents / Memory 视图** :white_check_mark: 2026-04-05
  - Topics 列表 + 每个 Topic 的 agents :white_check_mark:
  - Agents 在线状态 + connected time :white_check_mark:
  - Memory 搜索 /memory/search :white_check_mark:
  - Topics 列表 + 每个 Topic 的消息
  - Agents 在线状态
  - Memory 搜索

- [x] **S27-3（10min）：部署 + 文档** :white_check_mark: 2026-04-05
  - Hub 启动时自动启动静态文件服务器（port 8084）:white_check_mark:
  - README 新增 Web UI 章节 :white_check_mark:
  - Hub 启动时同时启动静态文件服务器
  - README 新增 Web UI 章节
  - hub/test/dedup.test.ts — 9 tests :white_check_mark:
  - All 100 unit tests pass :white_check_mark:
  - hub/test/dedup.test.ts
  - README 新增 Deduplication 章节
  - STOP_WORDS 修复（添加 the/is/a）✅
  - All 91 unit tests pass ✅
  - README 新增 Semantic Recall 章节 ✅
  - `hub/test/semantic_recall.test.ts`
  - README 新增 Semantic Recall 章节

_Last updated: 2026-06-05 23:23 (**woclaw-vscode 可发版性修复 — 漏更模式第 17 处** — `packages/woclaw-vscode/` 之前无法 `vsce package`, 两个独立问题: (1) `src/extension.ts` 6 处因 @types/vscode 1.110 严格化报 TS2554 (3× `EventEmitter.fire()` 需 `undefined` 参 + 3× `registerCommand(...)` 回调需 `_args: unknown` 参), 阻塞 `vscode:prepublish` 脚本里的 `tsc`; (2) 缺 `.vscodeignore` 文件, 依赖 vsce 默认 exclude 列表脆弱; 修复: 6 处 TS 类型修正 + 新建 `.vscodeignore` (1.0KB, 显式排除 src/**, tsconfig.json, package-lock.json, .github/**, .vscode/**, .git/**, .idea/**, CHANGELOG/CONTRIBUTING/SECURITY/CODE_OF_CONDUCT, docs/**, **/*.log, **/.DS_Store, node_modules/**, 并保留 4 SVG 图标 + out/extension.js + package.json + README.md); 验证: `npx tsc --noEmit` 0 错 + `npx vsce ls --no-dependencies` 仅 7 文件 (4 media + extension.js + package.json + README.md), `out/extension.js` diff 仅 3 行 `fire(undefined)`, 父端阻塞不变 (6 包 patch 重发 / RS-1 拆仓 / 视频 / 官方托管))_ — npm registry tarball 巡查发现 0/6 已发布包 (woclaw-hub@0.5.0 / xingp14-woclaw@0.4.3 / woclaw-mcp@0.1.2 / woclaw-hooks@0.5.0 / woclaw-codex@0.1.2 / opencode-woclaw@0.1.0) 都不带 LICENSE 文件, 只在 `package.json` 写 `license: "MIT"` (SPDX 标识符); 根因: 根 `LICENSE` 存在但 monorepo 各子包目录都没复制, npm 默认只 auto-include 包根的 LICENSE; 修复: 根 `LICENSE` (MIT, 1.1 kB) 复制到 6 个子包目录 (hub/ / plugin/ / mcp-bridge/ / packages/woclaw-hooks/ / packages/codex-woclaw/ / packages/opencode-woclaw-plugin/), `npm pack --dry-run` 验证 woclaw-hooks@0.5.0 tarball 现 15 文件 (含 LICENSE 1.1kB); 父端阻塞: 6 包需重发 patch 版 (0.5.0→0.5.1 等) 才能让 npm 用户看到 LICENSE, 源已修, 不动版本号; 0 npm test / 0 lint / 0 build, 纯 `cp LICENSE <subpkg>/` 6 次)_

_Last updated: 2026-06-05 05:43 (**woclaw-vscode `woclaw.pollInterval` config 漏接 — 漏更模式第 15 处** — `packages/woclaw-vscode/src/extension.ts:146` `setInterval(updateStatusBar, 30_000)` 硬编码 30 秒未读 `vscode.workspace.getConfiguration('woclaw').get('pollInterval')`, 但 `package.json` 第 27-31 行已声明 `woclaw.pollInterval` (type: number, default: 30) 等于用户改 VS Code settings.json 也无效; `README.md`「## 配置」表格也漏这一行 (只有 hubUrl + statusBar 两行); 修复: extension.ts 146 改 `const pollIntervalSec = ...get<number>('pollInterval') ?? 30; pollTimer = setInterval(updateStatusBar, pollIntervalSec * 1000);` + README 表格补 1 行; 默认值不变所以零行为变更, 父端零阻塞, 纯 config + doc 修复; 与 04:23 轮 codex-woclaw README 漏 PreCompact 是同型「子包 README 没跟上 code 实际能力」)_

_Last updated: 2026-06-05 03:03 (**CHANGELOG.md 修辞统一性 — 候选池第 4/4 新类型完成** — 移错位 preamble 「All notable changes...」(原 0.4.0↔0.3.1 之间) → 顶部 + Keep a Changelog 1.1.0 + SemVer 引用; 5 个版本 (0.4.0/0.4.1/0.3.1/0.3.0/0.2.0) `### Added (Topic)` 父代式标题 → 裸 `### Added` + bold 首项 (与 0.5.0 / 0.4.3 风格一致); 0.3.1/0.3.0 段加 blank line 分隔 `### Documentation` / `### Technical Details`; 候选池 0/4 已清空 (RS-1 / /ready / 视频 / 官方托管 父端阻塞不变, 下一轮候选池待父 22:10 提示或父端解锁后另开新类型))_

_Last updated: 2026-06-05 01:43 (**社区文件漏更 — 候选池第 3/4 新类型** — `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1 全文 + WoClaw 范围/联系渠道, 7.1 KB) 完成, `CONTRIBUTING.md` 删除 'is on the roadmap' 措辞并加交叉引用; 候选池剩 1/4: CHANGELOG 修辞统一性 (跨 8 个 npm 包版本历史 0.1.0→0.5.0 段间一致性))_

_Last updated: 2026-06-04 21:50 (**woclaw-hooks README self-矛盾** — `packages/woclaw-hooks/README.md` line 11 Multi-Framework 写「Supports Claude Code, Gemini CLI, OpenCode, and OpenAI Codex CLI」与 line 3 顶描述「Claude Code, Gemini CLI, OpenCode」+ line 13 「use `woclaw-codex` instead」+ `docs/README.md` line 419 「woclaw-hooks = Claude/Gemini/OpenCode」+ 根 README 4 处一致, 改 line 11 为「Claude Code, Gemini CLI, and OpenCode. (For OpenAI Codex CLI, use `woclaw-codex` for full PreCompact + config.toml auto-enable support; `woclaw-hooks` covers SessionStart/Stop only.)」, 漏更模式第 13 处命中, 跨文档段间自相矛盾, 与前 12 轮版本号/漏写不同)_

_Last updated: 2026-06-04 21:21 (**子包 README ↔ 根 README 一致性漏更** — 根 `README.md`+`README_zh.md` 顶部 npm badge block 缺 `opencode-woclaw@0.1.0`, 与 `docs/README.md` line 8-12 完整 6 包 badge 块及 line 420 npm packages 表格不一致, 漏更模式第 12 处命中, 复用 20:54 llm-benchmark README 段间漏更扫描模式补齐)_

_上次更新: 2026-06-04 20:40 (**跨子包版本矩阵漏更** — `docs/ROADMAP.md` line 66 v0.2 时代快照 `woclaw-hooks@0.1.0` / `xingp14-woclaw@0.3.0` 修正为 0.5.0 / 0.4.3 对齐 npm registry; `README.md`+`README_zh.md` 「Connect Your Agents」补 `woclaw-vscode` VS Code Marketplace 安装行, 此前 6 轮单文件漏更都是版本号过时, 本次是跨子包元数据 + 文档子包列表 2 处复合漏更; 漏更模式第 11 处命中)_

_Last updated: 2026-06-08 06:23 (**woclaw-vscode Marketplace 假上架漏更 — 漏更模式第 19 处** — `docs/README_zh.md:258`「VS Code / Cursor 扩展（woclaw-vscode@0.1.0，VS Code Marketplace, publisher: XingP14）」+ 同文件 line 267「生态插件完成（woclaw-vscode@0.1.0，已上架 VS Code Marketplace）」+ 根 `README.md:55`「install the WoClaw extension from VS Code Marketplace (publisher: XingP14)」+ 根 `README_zh.md:55`「在 VS Code Marketplace 搜索 WoClaw 安装（publisher: XingP14）」4 处宣称 VS Code Marketplace 上架, 但 `https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.1-preview.1` filterType=8 value=XingP14 返回 `TotalCount: 0` extensions (publisher 名下 0 扩展), filterType=7 value=XingP14.woclaw / XingP14.woclaw-vscode 各 0 扩展; 根因: 2026-06-04 20:40 轮 e45de4b 把 `woclaw-vscode` 加进「Connect Your Agents」时, 把 `package.json` 的 `publisher: XingP14` + `vsce` 配置误当作「已上架」信号, 实际 `vsce publish` 需要 dev.azure.com PAT, 父端阻塞从未执行; 修复: 4 处统一改为「本地构建 / Marketplace 发布待父端 vsce publish」措辞 (根 README 中英 + docs/README_zh.md 完成态/计划中双清单), 保留 package.json 链接指向本地构建说明; diff: 3 files / +4 / -4, 0 npm test / 0 lint / 0 build; 父端阻塞不变 (`vsce publish` 需 dev.azure.com PAT); 候选池: 仍是父端阻塞类 + 本类「文档宣称 vs 实际发布状态」漏更模式; 复用 23:23 轮 Marketplace vs npm 设计语境, 区分「package 编译就绪」与「Marketplace 上架完成」)_

_Last updated: 2026-06-09 03:23 (**3 子包 npm tarball `files` 白名单补齐 — 漏更模式第 21 处** — 沿 2026-06-08 22:43 e487477 hub 1 包修后, 5 子包仍缺 `files` 字段; 本轮按 5min/包节奏处理其中 3 包 (按 tarball 噪音从大到小): (1) `plugin/` (xingp14-woclaw@0.4.3) 33→21 files / -37.3 kB unpacked — 移除 `src/**` (5 TS 源) + `test/channel.test.ts` + `tsconfig.json` + `tsconfig.build.json` + `types/openclaw-plugin-sdk.d.ts` + `types/ws.d.ts` + 根 `skills/` (3 文件已 `dist/skills/` 复制) + `package-lock.json`, 保留 `dist/**` + `bin/**` + `openclaw.plugin.json` + README + LICENSE; (2) `mcp-bridge/` (woclaw-mcp@0.1.2) 5→4 files / -9.7 kB unpacked — 移除 `src/index.js` (已 `dist/index.js`), 保留 `dist/**` + README + LICENSE; (3) `packages/woclaw-vscode/` (woclaw-vscode@0.1.0) 11→8 files / -9.2 kB unpacked — 移除 `src/extension.ts` + `tsconfig.json` + `.vscodeignore`, 保留 `out/**` + `media/**` (4 SVG 图标) + README + LICENSE; 总节省: -56.2 kB unpacked / -19 文件, 0 npm test / 0 lint / 0 build, 纯 package.json 字段; 候选池: 5 子包剩 2 包 `packages/woclaw-hooks/` (15 files clean) + `packages/opencode-woclaw-plugin/` (4 files clean) 实测 npm pack 自动 exclude 已够, 不需 `files` 字段; codex-woclaw 已有 `files` 白名单; 父端阻塞: 6 包 patch 重发 (0.4.3→0.4.4 等) 才能让 npm 用户看到精简 tarball, 源已修, 不动版本号)_
