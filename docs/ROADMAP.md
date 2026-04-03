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
- [ ] **Story: Codex Hook npm 发布** — `woclaw-codex` npm publish --access public
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

> 每个 Story 应在 1 次心跳（15 分钟）内完成，或明确拆分步骤

### 待办 Stories（按优先级）

| # | Story | 版本 | 状态 |
|---|-------|------|------|
| S1 | Gemini CLI Hook 脚本 | v0.2 | 🛑 |
| S2 | OpenCode Hook 脚本 | v0.2 | 🛑 |
| S3 | Codex Hook npm 发布 | v0.2 | 🛑 |
| S4 | vm153 plugin 验证 | v0.2 | 🛑 |
| S5 | VPS4 plugin 验证 | v0.2 | 🛑 |
| S6 | Claude Code Hook 安装器 | v0.3 | 🛑 |
| S7 | Codex Hook 安装器 | v0.3 | 🛑 |
| S8 | MCP CLI serve 命令 | v0.3 | 🛑 |
| S9 | Memory Versioning | v0.4 | 🛑 |
| S10 | Semantic Recall | v0.4 | 🛑 |
| S11 | Agent 发现 API | v0.4 | 🛑 |
| S12 | 任务委托机制 | v0.4 | 🛑 |
| S13 | Codex 迁移工具 | v0.5 | 🛑 |
| S14 | Claude Code 迁移工具 | v0.5 | 🛑 |
| S15 | Gemini CLI 迁移工具 | v0.5 | 🛑 |
| S16 | OpenClaw 迁移工具 | v0.5 | 🛑 |

---

_Last updated: 2026-04-03 17:38 CST_
