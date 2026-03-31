# WoClaw 路线图 / Roadmap

> 规划 WoClaw 的发展方向，持续迭代

## 🎯 项目定位

**WoClaw = Shared Memory + Messaging Hub for AI Agents**

让 OpenClaw、Claude Code、Gemini CLI、OpenCode 等多个 AI 框架共享项目上下文、记忆和决策。解决"每个 AI 都从零开始"的问题。

**参考项目：** [Mnemon](https://github.com/mnemon-dev/mnemon) — LLM-supervised memory，WoClaw 将其扩展为网络原生、多框架共享。

---

## 🧠 核心功能设计：LLM-Supervised Shared Memory

基于 [Mnemon](https://github.com/mnemon-dev/mnemon) 架构，WoClaw 的共享记忆设计如下：

### 三个记忆原语（Three Memory Primitives）

| 原语 | 作用 | WoClaw 实现 |
|------|------|-------------|
| **`remember`** | 将信息写入共享记忆池 | `woclaw memory.write(key, value, tags, ttl)` |
| **`recall`** | 按意图检索记忆 | `woclaw memory.recall(query, intent)` |
| **`link`** | 将两条记忆关联起来 | `woclaw memory.link(from_key, to_key, relation)` |

> **设计原则**：命令名称映射到 LLM 的认知词汇（`remember` 而非 INSERT，`recall` 而非 SELECT），输出是结构化 JSON 而非原始数据。

### 四图知识存储（Four-Graph Memory）

每条记忆有四种边类型（参考 Mnemon）：
- **Temporal（时序边）** — 记忆创建的时间顺序
- **Entity（实体边）** — 记忆之间的主语/宾语关联
- **Semantic（语义边）** — 意图/主题相似性
- **Causal（因果边）** — 决策与结果之间的因果关系

### 生命周期钩子（Memory Lifecycle Hooks）

```
Session Start (Prime)
    → load guide.md — 加载行为手册，agent 了解共享记忆使用方式

User Prompt Submit (Remind)
    → agent 被提醒：先用 recall 检索相关记忆，再开始工作

Session Stop (Nudge)
    → agent 被提醒：用 remember 记住本次关键决策

Context PreCompact (Compact)
    → agent 被指导：提炼关键洞察写入 shared memory，防止丢失
```

### LLM 监督模式（LLM-Supervised Pattern）

- **WoClaw Hub** = 确定性计算层（存储、图索引、搜索、重要度衰减）
- **宿主 LLM** = 判断层（记什么？怎么关联？何时遗忘？）
- **无额外推理成本** — 不在管线中嵌入额外 LLM

### 记忆重要度衰减（Importance Decay）

- 默认半衰期 30 天（7天前 84%，30天前 50%）
- 重要决策半衰期更长（可通过 TTL 配置）
- 自动 flush 在上下文压缩时触发

---

## 🚀 v0.2 — P0 功能（当前）

### 核心已上线
- [x] WebSocket Hub (ws://vm153:8080) ✅
- [x] REST API (vm153:8081) ✅
- [x] Topic Pub/Sub ✅
- [x] Shared Memory Pool ✅
- [x] Message History (last 50) ✅
- [x] Token Authentication ✅
- [x] npm 包发布 (woclaw-hub@0.1.0, xingp14-woclaw@0.1.5) ✅

### P0 - 跨框架 Hook 集成
- [ ] **NEW** Claude Code Hook Scripts — SessionStart/Stop/PreCompact hooks 读写 WoClaw Memory
- [ ] **NEW** Gemini CLI MCP Bridge — WoClaw MCP server interface
- [ ] **NEW** OpenCode Hook Scripts — 同 Claude Code

### P0 - OpenClaw Plugin 完善
- [ ] Plugin 导出格式修复（使用 `defineChannelPluginEntry`）
- [ ] Plugin 在 vm153 上安装验证
- [ ] Plugin 在 VPS4 (本地) 安装验证

---

## 🔥 v0.3 — MCP + Hook 系统

### 发布
- [ ] Docker Hub 自动构建 (docker push on git tag)
- [ ] ClawHub Skill 发布（@XingP14 账号 2026-04-14 满14天后）

### MCP Bridge
- [ ] WoClaw MCP Server — 暴露 `woclaw_topics`, `woclaw_memory_read`, `woclaw_memory_write`, `woclaw_send` 工具
- [ ] MCP CLI 命令：`openclaw mcp serve` 暴露 WoClaw Hub

### Hook 系统
- [ ] Hook Scripts 模板 — Claude Code/Gemini CLI/OpenCode 一键安装
- [ ] `woclaw hook install --framework claude-code` 命令
- [ ] PreCompact hook — 自动将关键上下文写入 memory

---

## 🎯 v0.4 — 多框架共享记忆（核心里程碑）

> **这是父亲最需要的功能：多 AI 共享项目上下文，避免重复介绍**

### 记忆原语 API（NEW P0）
- [ ] `memory.write(key, content, tags[], ttl)` — remember 原语
- [ ] `memory.read(key)` — 读取单条记忆
- [ ] `memory.recall(query, intent)` — 意图感知检索（返回相关记忆列表）
- [ ] `memory.link(from_key, to_key, relation)` — link 原语（关联两条记忆）
- [ ] `memory.list(tags)` — 按标签列出记忆

### 四图存储实现（NEW）
- [ ] Temporal edges — 基于时间的重要性衰减
- [ ] Entity edges — 实体（项目名、文件名、决策点）关联
- [ ] Semantic edges — 意图/主题相似性聚类
- [ ] Causal edges — 决策→结果因果链记录

### 行为手册（Behavioral Guide）
- [ ] `woclaw guide.md` — agent 共享的"如何使用 WoClaw Memory"手册
- [ ] Prime hook 自动加载 guide.md
- [ ] 内含 recall/remember 的 prompt 模板

### 生命周期集成（跨框架）
- [ ] Claude Code: SessionStart / UserPromptSubmit / Stop / PreCompact 四钩子完整集成
- [ ] Gemini CLI: 同上
- [ ] OpenCode: 同上
- [ ] Codex / Copilot: MCP 接口集成

---

## 📦 v0.5 — 生态集成

### 发布到生态
- [ ] ClawHub Skill 发布
- [ ] GitHub Actions CI/CD 完善
- [ ] VS Code / Cursor 插件（可选）

### 文档
- [ ] Hook 集成指南（针对每个框架）
- [ ] MCP Server 使用文档
- [ ] 视频演示

---

## 🔮 v1.0+ — 高级特性

### 记忆增强
- [ ] Graph Memory — 图数据库后端（参考 Mnemon 的 temporal/entity/causal/semantic edges）
- [ ] Semantic Recall — 意图感知检索（intent-aware recall）
- [ ] Deduplication — 自动去重和冲突检测
- [ ] Memory Versioning — 保留历史版本

### Multi-Agent Orchestration
- [ ] Agent 发现 — 自动发现同 Hub 上其他 agent
- [ ] 委托任务 — agent 可以委托任务给其他 agent
- [ ] 任务状态追踪 — 跨 agent 任务状态同步

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
| **v0.4** | **父亲需求** | **多框架共享记忆（recall/remember/link 三原语 + 四图存储 + 生命周期钩子）** |
| v0.5 | 待定 | 生态集成、ClawHub |
| v1.0 | 待定 | Graph Memory、Federation |

---

## 🔗 参考资料

- [Mnemon GitHub](https://github.com/mnemon-dev/mnemon) — LLM-supervised persistent memory for AI agents
- [Mnemon 设计文档](https://github.com/mnemon-dev/mnemon/blob/master/docs/DESIGN.md) — 四图架构详解
- [OpenClaw Hooks](https://docs.openclaw.ai/concepts/hooks) — OpenClaw 钩子系统
- [MCP Protocol](https://modelcontextprotocol.io/) — Model Context Protocol 标准

---

_Last updated: 2026-03-31 17:50 CST_
