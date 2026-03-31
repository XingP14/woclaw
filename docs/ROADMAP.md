# WoClaw 路线图 / Roadmap

> 规划 WoClaw 的发展方向，持续迭代

## 🎯 项目定位

**WoClaw = Shared Memory + Messaging Hub for AI Agents**

让 OpenClaw、Claude Code、Gemini CLI、OpenCode 等多个 AI 框架共享项目上下文、记忆和决策。解决"每个 AI 都从零开始"的问题。

**核心方向：** 跨框架共享记忆 + 实时消息路由。

## 🚀 v0.2 — P0 功能（当前）

### 核心已上线
- [x] WebSocket Hub (ws://vm153:8082) ✅
- [x] REST API (vm153:8083) ✅
- [x] Topic Pub/Sub ✅
- [x] Shared Memory Pool ✅
- [x] Message History (last 50) ✅
- [x] Token Authentication ✅
- [x] npm 包发布 (woclaw-hub@0.1.0, xingp14-woclaw@0.1.5) ✅

### P0 - 跨框架 Hook 集成
- [ ] Claude Code Hook Scripts — SessionStart/Stop/PreCompact hooks 读写 WoClaw Memory
- [ ] Gemini CLI MCP Bridge — WoClaw MCP server interface
- [ ] OpenCode Hook Scripts — 同 Claude Code

### P0 - OpenClaw Plugin 完善
- [ ] Plugin 导出格式修复（使用 `defineChannelPluginEntry`）
- [ ] Plugin 在 vm153 上安装验证
- [ ] Plugin 在 VPS4 (本地) 安装验证

## 🔥 v0.3 — MCP + Hook 系统

### 发布
- [ ] Docker Hub 自动构建 (docker push on git tag)
- [ ] ClawHub Skill 发布（@XingP14 账号 2026-04-13 满14天后；GitHub 创建于 2026-03-30）

### MCP Bridge
- [x] WoClaw MCP Server — 暴露 `woclaw_topics`, `woclaw_memory_read`, `woclaw_memory_write`, `woclaw_send` 工具 ✅ (0.1.0 published)
- [ ] MCP CLI 命令：`openclaw mcp serve` 暴露 WoClaw Hub

### Hook 系统
- [ ] Hook Scripts 模板 — Claude Code/Gemini CLI/OpenCode 一键安装
- [ ] `woclaw hook install --framework claude-code` 命令
- [ ] PreCompact hook — 自动将关键上下文写入 memory

## 🎯 v0.4 — 多框架共享记忆

### Shared Memory 增强
- [ ] Memory TTL — 支持设置过期时间
- [ ] Memory Tags — 支持分类标签（project/fact/decision/config）
- [ ] Memory Versioning — 保留历史版本

### Multi-Agent Orchestration
- [ ] Agent 发现 — 自动发现同 Hub 上其他 agent
- [ ] 委托任务 — agent 可以委托任务给其他 agent
- [ ] 任务状态追踪 — 跨 agent 任务状态同步

### 记忆原语设计

| 原语 | 作用 | WoClaw 实现 |
|------|------|-------------|
| **`remember`** | 将信息写入共享记忆池 | `woclaw memory.write(key, value, tags, ttl)` |
| **`recall`** | 按意图检索记忆 | `woclaw memory.recall(query, intent)` |
| **`link`** | 将两条记忆关联起来 | `woclaw memory.link(from_key, to_key, relation)` |

## 📦 v0.5 — 生态集成

### 发布到生态
- [ ] ClawHub Skill 发布
- [ ] GitHub Actions CI/CD 完善
- [ ] VS Code / Cursor 插件（可选）

### 文档
- [ ] Hook 集成指南（针对每个框架）
- [ ] MCP Server 使用文档
- [ ] 视频演示

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
| v0.3 | 待定 | MCP Bridge、Hook 系统 |
| v0.4 | 2026-03-31 | 多框架共享记忆（Tags + TTL）✅ 核心实现 |
| v0.5 | 待定 | 生态集成、ClawHub |
| v1.0 | 待定 | Graph Memory、Federation |

---

_Last updated: 2026-03-31 18:05 CST_
