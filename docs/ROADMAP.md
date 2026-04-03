# WoClaw 路线图 / Roadmap

> 规划 WoClaw 的发展方向，持续迭代

## 🎯 项目定位

**WoClaw = Shared Memory + Messaging Hub for AI Agents**

让 OpenClaw、Claude Code、Gemini CLI、**OpenAI Codex CLI**、OpenCode 等多个 AI 框架共享项目上下文、记忆和决策。解决"每个 AI 都从零开始"的问题。

**核心方向：** 跨框架共享记忆 + 实时消息路由。

> ⭐ **高优先级项目：OpenAI Codex CLI 集成** — OpenAI 官方 Python Codex 代理的 WoClaw Hook 支持，使 Python 代理能读写共享记忆。

## 🚀 v0.2 — P0 功能（当前）

### 核心已上线
- [x] WebSocket Hub (ws://vm153:8082) ✅
- [x] REST API (vm153:8083) ✅
- [x] Topic Pub/Sub ✅
- [x] Shared Memory Pool ✅
- [x] Message History (last 50) ✅
- [x] Token Authentication ✅
- [x] npm 包发布 (xingp14-woclaw@0.3.0, woclaw-hooks@0.1.0, woclaw-mcp@0.1.2) ✅

### P0 - 跨框架 Hook 集成
- [x] Claude Code Hook Scripts — SessionStart/Stop/PreCompact hooks 读写 WoClaw Memory ✅
- [ ] **Story: Gemini CLI → WoClaw 记忆读写** — 实现 Gemini CLI 的 hook 脚本读写 WoClaw Memory
- [ ] **Story: OpenCode → WoClaw 记忆读写** — 实现 OpenCode 的 hook 脚本（参考 Claude Code）
- [ ] **⭐ OpenAI Codex CLI Hook Scripts — 高优先级！OpenAI 官方 Python Codex 代理集成**

### P0 - OpenAI Codex CLI 支持（新增 ⭐ 高优先级）
- [x] wo-codex CLI 包 — `packages/codex-woclaw/` created (woclaw-codex@0.1.0) ✅
- [x] SessionStart Hook — `session_start.py` reads from WoClaw Hub REST API ✅
- [x] SessionStop Hook — `stop.py` reads transcript + writes summary to WoClaw Hub ✅
- [x] PreCompact Hook — Codex 上下文压缩前将关键信息写入 memory ✅ v0.1.2
- [x] **Story: Codex Hook npm 发布** — `woclaw-codex@0.1.2` npm 发布 ✅ 2026-04-03
- [x] 环境变量配置：`WOCLAW_HUB_URL` + `WOCLAW_TOKEN` ✅

### P0 - OpenClaw Plugin 完善
- [x] Plugin 导出格式修复（使用 `defineChannelPluginEntry`）✅
- [ ] **Story: vm153 plugin 验证** — 在 vm153 上安装 xingp14-woclaw，重启 gateway，验证 channel 连接正常
- [ ] **Story: VPS4 plugin 验证** — 在 VPS4 本地安装验证

---

## 🔥 v0.3 — MCP + Hook 系统

### MCP Bridge
- [x] WoClaw MCP Server — 暴露 `woclaw_topics`, `woclaw_memory_read`, `woclaw_memory_write`, `woclaw_send` 工具 ✅ (woclaw-mcp@0.1.2)
- [ ] **Story: MCP CLI serve 命令** — 实现 `openclaw mcp serve` 暴露 WoClaw Hub 为 MCP server

### Hook 系统
- [ ] **Story: Claude Code Hook 安装器** — `woclaw hook install --framework claude-code` 一键安装脚本
- [ ] **Story: Codex Hook 安装器** — `woclaw hook install --framework openai-codex` 一键安装脚本 ⭐
- [x] PreCompact hook — Codex PreCompact Hook 完成 ✅ (v0.4.1)，Claude Code precompact.sh 已就绪

### Docker Hub 发布
- [x] GitHub Actions 自动构建 ✅ (hub/v* tag 触发)
- [x] Docker Hub 镜像 xingp14/woclaw-hub ✅

## 🎯 v0.4 — 多框架共享记忆

### Shared Memory 增强
- [ ] **Story: Memory Versioning** — 每次 write 时保留旧版本，支持 `memory.versions(key)` 查询
- [ ] **Story: Semantic Recall** — 实现 `recall(query, intent)` 意图感知检索

### Multi-Agent Orchestration
- [ ] **Story: Agent 发现** — Hub API `GET /agents` 返回已连接 agent 列表
- [ ] **Story: 委托任务** — Agent 可发送 `delegate(task, toAgentId)` 消息
- [ ] **Story: 任务状态追踪** — 委托任务可追踪 PENDING/RUNNING/DONE/FAILED 状态

### 记忆原语设计

| 原语 | 作用 | WoClaw 实现 |
|------|------|-------------|
| **`remember`** | 将信息写入共享记忆池 | `woclaw memory.write(key, value, tags, ttl)` |
| **`recall`** | 按意图检索记忆 | `woclaw memory.recall(query, intent)` |
| **`link`** | 将两条记忆关联起来 | `woclaw memory.link(from_key, to_key, relation)` |

## 📦 v0.5 — 跨框架数据迁移

### 迁移工具 / Migration Tools
- [ ] **Story: Codex 迁移** — `woclaw migrate --framework openai-codex --session-id <id>` 从 Codex 历史导入
- [ ] **Story: Claude Code 迁移** — `woclaw migrate --framework claude-code --session-dir <path>` 导入 sessions
- [ ] **Story: Gemini CLI 迁移** — `woclaw migrate --framework gemini-cli` 导入会话历史
- [ ] **Story: OpenClaw 迁移** — `woclaw migrate --framework openclaw --agent-id <id>` 导入 memory/sessions

### 迁移设计

| 源框架 | 迁移内容 | WoClaw 目标 |
|--------|----------|-------------|
| **OpenAI Codex CLI** | Session transcript, project context, key decisions | Shared Memory + Topics |
| **Claude Code** | Session transcript, discovered facts, repo context | Shared Memory + Topics |
| **Gemini CLI** | Conversation history, research findings | Shared Memory + Topics |
| **OpenClaw** | Memory entries, session summaries, agent context | Shared Memory Pool |

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
- [ ] ClawHub Skill 发布
- [ ] GitHub Actions CI/CD 完善
- [ ] VS Code / Cursor 插件（可选）

### 文档
- [ ] Hook 集成指南（针对每个框架）
- [ ] MCP Server 使用文档
- [ ] 视频演示

## 🔧 v0.6 — 生态完善

### 发布到生态
- [ ] Docker Hub 发布（credentials 配置）
- [ ] ClawHub Skill 发布（2026-04-13 后）
- [ ] VS Code / Cursor 插件（可选）

## 🔮 v1.0+ — 高级特性

### 记忆增强
- [ ] Graph Memory — 图数据库后端，支持 temporal/entity/causal/semantic 边类型
- [ ] Semantic Recall — 意图感知检索
- [ ] Deduplication — 自动去重和冲突检测

### 安全与扩展
- [ ] TLS/SSL (wss://)
- [ ] Token 轮换
- [ ] 连接限流
- [ ] 私有 Topic（邀请制）

### 联邦
- [ ] Multi-Hub Federation — Hub 之间互联
- [ ] 官方托管服务

---

## 进度追踪 / Progress

| 版本 | 日期 | 里程碑 |
|------|------|--------|
| v0.1 | 2026-03-30 | 项目立项、Hub 部署 ✅ |
| v0.2 | 2026-03-31 | REST API、npm 发布、跨框架集成 ✅ |
| v0.3 | 2026-04-01 | Tags/TTL 增强、Docker Hub Workflow ✅ |
| v0.4 | 2026-04-02 | ⭐ **OpenAI Codex CLI Hook 支持**（高优先级）|
| v0.5 | 待定 | ⭐ **跨框架数据迁移**（OpenAI/Claude/Gemini/OpenClaw → WoClaw）|
| v0.6 | 待定 | Hook 系统完善、Docker Hub、ClawHub Skill |
| v1.0 | 待定 | Graph Memory、Federation |

---

## 📋 Story 卡片（便于心跳执行）

> ⚠️ **评估结论：所有 Story 都无法在 10 分钟内完成，必须拆分步骤**
> 每个步骤 = 1 次心跳内可完成的最小可提交单元

### 待办 Stories（按优先级）

| # | Story | 版本 | 步骤数 | 总工作量 |
|---|-------|------|--------|---------|
| S1 | Gemini CLI Hook 脚本 | v0.2 | 3 | ~1h |
| S2 | OpenCode Hook 脚本 | v0.2 | 3 | ~1h |
| S3 | Codex Hook npm 发布 | v0.2 | 2 | ~20min | ✅ 完成
| S4 | vm153 plugin 验证 | v0.2 | 3 | ~1h |
| S5 | VPS4 plugin 验证 | v0.2 | 3 | ~1h |
| S6 | Claude Code Hook 安装器验证 | v0.3 | 2 | ~30min |
| S7 | Codex Hook 安装器完善 | v0.3 | 2 | ~30min |
| S8 | MCP CLI serve 命令 | v0.3 | 4 | ~2h |
| S9 | Memory Versioning | v0.4 | 4 | ~2h |
| S10 | Semantic Recall | v0.4 | 5 | ~3h |
| S11 | Agent 发现 API | v0.4 | 2 | ~30min |
| S12 | 任务委托机制 | v0.4 | 5 | ~3h |
| S13 | Codex 迁移工具 | v0.5 | 4 | ~2h |
| S14 | Claude Code 迁移工具 | v0.5 | 4 | ~2h |
| S15 | Gemini CLI 迁移工具 | v0.5 | 4 | ~2h |
| S16 | OpenClaw 迁移工具 | v0.5 | 4 | ~2h |

---

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

### S4: vm153 plugin 验证（v0.2）
> 评估：需要 SSH + 操作，~3 步骤 ✅ 全部完成

- [x] **S4-1（10min）：SSH 检查 vm153 当前状态** ✅ 2026-04-03
  - `openclaw status` + `openclaw channels list` 执行完毕
  - 结果：plugin 已安装（`ls ~/.openclaw/extensions/` 含 woclaw），channel "WoClaw default: configured, enabled" ✅
  - WoClaw Hub 连接：ws://192.168.102.153:8082，已认证为 vm153 ✅
  - 注：vm153 自连存在 1006 异常关闭后重连（循环依赖，Hub 和 plugin 同机），功能正常
  - `ssh -i ~/.ssh/id_ed25519 root@vm153 openclaw status`
  - 检查 woclaw plugin 是否已安装（`~/.openclaw/extensions/`）
  - 检查 channel 状态

- [x] **S4-2（10min）：安装/更新 xingp14-woclaw plugin** ✅ 2026-04-03
  - 原 0.3.0 → 升级到 0.4.3（npm latest）
  - rm -rf 清理旧目录后正常安装
  - 重启 gateway（kill old PID → nohup openclaw gateway）
  - channel 状态确认：configured, enabled，Hub 自连正常

- [x] **S4-3（10min）：验证 WebSocket 连接** ✅ 2026-04-03
  - `curl http://vm153:8083/health` → `{"status":"ok","agents":2,"topics":2}`
  - WebSocket 直连测试：ws://192.168.102.153:8082 → 连接成功（315ms），认证正常
  - Hub 可见 2 个 agent，channel WoClaw default 配置 enabled

### S5: VPS4 plugin 验证（v0.2）
> 评估：本地 Docker 环境，~3 步骤（注意 plugin ID mismatch 警告）

- [x] **S5-1（10min）：检查当前 plugin 状态** ✅ 2026-04-03
  - `openclaw status` + `openclaw channels list` 执行完毕
  - 结果：WoClaw channel "configured, enabled" ✅，Hub 健康 ✅ (`{"status":"ok","agents":2,"topics":2}`)
  - `xingp14-woclaw` (v0.4.3) 已安装，config 指向 Hub ws://192.168.102.153:8082 ✅
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

- [ ] **S6-1（10min）：审查 install.js 对 Claude Code 的支持**
  - 读取 `packages/woclaw-hooks/install.js` FRAMEWORK_CONFIG.claude-code
  - 确认 hook 文件检测、install、uninstall 逻辑是否正确

- [ ] **S6-2（10min）：测试 Claude Code hook 安装（dry-run 方式）**
  - 不实际修改 `~/.claude/`，只验证 install.js 逻辑
  - 或在临时目录模拟 `~/.claude/` 结构测试

### S7: Codex Hook 安装器完善（v0.3）
> 评估：需要统一 codex 安装入口，~2 步骤

- [ ] **S7-1（10min）：对比 install.py vs install.js 的 Codex 支持**
  - 检查 `packages/codex-woclaw/install.py` 内容
  - 检查 `packages/woclaw-hooks/install.js` --framework codex 的逻辑
  - 决定哪个作为 official installer

- [ ] **S7-2（10min）：统一 Codex 安装体验**
  - 确保 `npx woclaw-hooks --framework codex` 工作正常
  - 更新 README 明确推荐安装方式

### S8: MCP CLI serve 命令（v0.3）
> 评估：需要 OpenClaw CLI 集成，~4 步骤

- [ ] **S8-1（10min）：研究 openclaw mcp serve 接口**
  - 查看 OpenClaw CLI `openclaw mcp --help` 帮助
  - 理解 `openclaw mcp serve` 的工作方式（stdin/stdout MCP 协议）
  - 确认 woclaw-mcp 如何对接到 OpenClaw MCP serve

- [ ] **S8-2（10min）：设计 woclaw MCP serve 实现方案**
  - 方案A：woclaw-mcp 作为 OpenClaw MCP server 的 backend
  - 方案B：woclaw CLI 增加 `woclaw mcp serve` 命令
  - 输出：选择方案并设计接口

- [ ] **S8-3（10min）：实现 MCP serve 基本框架**
  - 创建 `packages/woclaw-mcp/` 目录结构（如不存在）
  - 实现 JSON-RPC 2.0 stdin/stdout 处理

- [ ] **S8-4（10min）：实现 woclaw tools（tools/list  handler）**
  - 实现 `woclaw_topics_list`, `woclaw_memory_read` 等 tools
  - 连接到 Hub REST API 获取数据

### S9: Memory Versioning（v0.4）
> 评估：Hub 侧改动，~4 步骤

- [ ] **S9-1（10min）：设计 Memory Versioning 方案**
  - 查看 `hub/src/memory.ts` 和 `hub/src/db.ts`
  - 设计：write 时保留旧值到 `memory_versions` 表
  - 输出：数据库 schema 变更方案

- [ ] **S9-2（10min）：实现 DB versioning 支持**
  - 在 `db.ts` 添加 `getMemoryVersions(key)` 方法
  - 修改 `setMemory` 在更新前保存旧值

- [ ] **S9-3（10min）：实现 REST API versioning 端点**
  - 添加 `GET /memory/:key/versions` 端点
  - 在 `rest_server.ts` 注册路由

- [ ] **S9-4（10min）：添加单元测试**
  - 在 `hub/test/memory.test.ts` 添加 versioning 测试
  - 运行 `npm test` 验证

### S10: Semantic Recall（v0.4）
> 评估：最复杂，~5 步骤

- [ ] **S10-1（10min）：设计 Semantic Recall 方案**
  - 方案A：关键词 + TF-IDF 评分（简单，无需外部依赖）
  - 方案B：向量嵌入 + 余弦相似度（准确，需要 embedding 模型）
  - 输出：选定方案（建议方案A起步）

- [ ] **S10-2（10min）：实现 recall(query) 函数**
  - 在 `memory.ts` 添加 `recall(query)` 方法
  - 基于关键词匹配 + 评分排序

- [ ] **S10-3（10min）：实现 recall intent 解析**
  - 支持 `intent` 参数（如 "project", "decision", "todo"）
  - 根据 intent 筛选相关 tags

- [ ] **S10-4（10min）：添加 REST API 端点**
  - `GET /memory/recall?q=<query>&intent=<intent>`
  - 更新 `rest_server.ts`

- [ ] **S10-5（10min）：测试 + 文档**
  - 手动测试 recall 效果
  - 更新 README 文档

### S11: Agent 发现 API（v0.4）
> 评估：简单 API 端点，~2 步骤

- [ ] **S11-1（10min）：实现 GET /agents 端点**
  - 在 `ws_server.ts` 维护 agents Map（agentId → metadata）
  - 在 `rest_server.ts` 添加 `GET /agents` 返回 agent 列表

- [ ] **S11-2（10min）：测试 + 补充字段**
  - 用 curl 测试 `GET http://vm153:8083/agents`
  - 补充 lastSeen, connectedAt 等字段

### S12: 任务委托机制（v0.4）
> 评估：复杂协议设计，~5 步骤

- [ ] **S12-1（10min）：设计委托协议**
  - 设计 delegation 消息格式（type, task, fromAgent, toAgent, status）
  - 确定 Hub 侧状态存储方式

- [ ] **S12-2（10min）：实现 delegation 消息路由**
  - 在 `ws_server.ts` 处理 `delegate` 消息类型
  - 将 delegation 转发给目标 agent

- [ ] **S12-3（10min）：实现委托状态跟踪**
  - 添加 `delegations` Map 存储状态
  - 支持 CANCEL 取消委托

- [ ] **S12-4（10min）：添加 REST API 端点**
  - `GET /delegations`, `POST /delegations`, `DELETE /delegations/:id`

- [ ] **S12-5（10min）：CLI 支持 + 测试**
  - 在 `plugin/bin/woclaw-cli.js` 添加 `delegate` 命令

### S13-S16: 迁移工具（v0.5）
> 评估：每个 ~4 步骤，以 S13 Codex 为例

- [ ] **S13-1（10min）：调研 Codex session 存储格式**
  - 查看 `~/.codex/sessions/` 目录结构
  - 确定 session transcript 文件格式（JSON?）

- [ ] **S13-2（10min）：实现 session parser**
  - 在 `packages/woclaw-hooks/` 创建 `codex-migrate.js`
  - 解析 Codex session JSON，提取 key decisions/context

- [ ] **S13-3（10min）：实现 `woclaw migrate --framework codex` CLI**
  - 添加到 `plugin/bin/woclaw-cli.js`
  - 调用 parser + 写入 Hub

- [ ] **S13-4（10min）：测试 + S14-S16 框架**
  - 用真实 Codex session 测试
  - 为 S14-S16 创建模板，复制 parser 框架

---

_Last updated: 2026-04-03 20:35 CST_
