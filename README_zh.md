# WoClaw

> **AI Agent 共享记忆与消息中枢** — 支持 OpenClaw、Claude Code、Gemini CLI、OpenCode 等多框架。

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/XingP14/woclaw?style=social)](https://github.com/XingP14/woclaw)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

## 问题背景

每个 AI Agent 每次会话都从零开始。

你用 **Claude Code** 写代码，**OpenClaw** 做编排，**Gemini CLI** 做调研。每个 Agent 在会话结束时遗忘一切，每次都要重复同样的上下文。

```
┌─────────────────────────────────────────────────────┐
│  你（反复说）：                                     │
│  "我们用 React + Go 构建 web app..."               │
│  "记得用 fs.promises 而不是 fs.sync..."            │
│  "数据库 schema 在 docs/schema.md..."              │
└─────────────────────────────────────────────────────┘
```

## 解决方案

WoClaw Hub 是所有 AI Agent 的**网络原生共享大脑**。

```
┌──────────────────────────────────────────────────────────────┐
│                      WoClaw Hub                             │
│                ws://hub:8082 · REST :8083                   │
│                                                              │
│   Claude Code ──┐                                           │
│                 ├──▶ Shared Memory Pool ──▶ Gemini CLI     │
│   OpenClaw ─────┤    "project: web app"                     │
│                 ├──▶ Topics ──────────────▶ OpenCode        │
│   OpenCode ─────┘    general / dev / research              │
└──────────────────────────────────────────────────────────────┘
```

**一次上下文，所有 Agent 共享，实时同步。**

## 功能特性

| 功能 | 说明 |
|------|------|
| 🧠 **共享记忆池** | 全局键值存储，支持标签（Tags）和 TTL 过期 |
| 📡 **Topic 订阅发布** | Agent 间实时消息路由 |
| 🔗 **多框架支持** | 连接 OpenClaw、Claude Code、 Gemini CLI、OpenCode |
| 🌉 **MCP Bridge** | 内置 MCP 服务器，供 MCP 化 Agent 使用 |
| 🪝 **Hook 集成** | 通过生命周期钩子实现 LLM 监督的记忆同步 |
| 📜 **消息历史** | 加入 Topic 时自动收到最近 50 条消息 |
| 🔒 **Token 认证** | Bearer Token 保护 |
| ⚡ **实时同步** | WebSocket 驱动，无需轮询 |

## 快速开始

### 1. 部署 Hub

```bash
# 从 Docker Hub 拉取（推荐）
docker pull xingp14/woclaw-hub:0.3.0
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 -p 8083:8083 \
  -e AUTH_TOKEN=change-me \
  --restart unless-stopped \
  xingp14/woclaw-hub:0.3.0
```

> Docker Hub 镜像由 GitHub Actions docker-publish.yml 自动构建，使用 `hub/v*` 标签触发。详见 [docs/PUBLISH.md](./docs/PUBLISH.md)。

### 2. 连接你的 Agent

**OpenClaw（插件）：**
```bash
npm install xingp14-woclaw
```
```json
"channels": {
  "woclaw": {
    "enabled": true,
    "hubUrl": "ws://your-hub:8082",
    "agentId": "my-openclaw",
    "token": "change-me",
    "autoJoin": ["general", "memory"]
  }
}
```

**Claude Code / Gemini CLI / OpenCode（Hook 脚本）：**
```bash
# 安装 WoClaw Hooks（Claude Code 推荐）
npm install -g woclaw-hooks
woclaw-hooks --install

# 或手动操作：
# SessionStart: 加载共享上下文
curl -s http://your-hub:8083/memory/project-context

# SessionStop: 保存关键信息
curl -X POST http://your-hub:8083/memory/discovered \
  -H "Authorization: Bearer change-me" \
  -d '{"value": "use fs.promises"}'
```

**OpenCode（插件 — 见 [packages/opencode-woclaw-plugin](./packages/opencode-woclaw-plugin/)）：**

```bash
# 安装插件
cp packages/opencode-woclaw-plugin/index.js ~/.config/opencode/plugins/woclaw.js

# 配置环境变量
export WOCLAW_HUB_URL=ws://your-hub:8082
export WOCLAW_TOKEN=change-me
```

然后 OpenCode 可使用内置工具：
```
/woclaw_memory_read project-context
/woclaw_memory_write discovered "use fs.promises"
/woclaw_topics_list
/woclaw_hub_status
```

**Python Codex agents（见 [packages/codex-woclaw-example](./packages/codex-woclaw-example/)）：**

```python
import asyncio
from codex_example import memory_read, memory_write, hub_health

async def main():
    health = await hub_health()
    await memory_write("codex:session", "Working on feature X")
    context = await memory_read("project:context")
```

**MCP Bridge（Node.js / Deno）：**
```bash
npm install woclaw-mcp
woclaw-mcp --hub ws://your-hub:8082 --token change-me
```

## Hub API 参考

| 端点 | 方法 | 说明 |
|------|------|------|
| `ws://hub:8082` | WebSocket | 实时消息和记忆读写 |
| `http://hub:8083/health` | GET | 健康检查 |
| `http://hub:8083/api/topics` | GET | 列出所有 Topic |
| `http://hub:8083/api/memory` | GET | 获取所有记忆 |
| `http://hub:8083/api/memory/:key` | GET/POST/PUT/DELETE | 读写单条记忆 |
| `http://hub:8083/api/memory/tags/:tag` | GET | 按标签查询记忆 |

详见 [SPEC.md](./SPEC.md)。

## 资源链接

- **GitHub**: https://github.com/XingP14/woclaw
- **npm**: https://www.npmjs.com/package/xingp14-woclaw
- **Docker Hub**: https://hub.docker.com/r/xingp14/woclaw-hub
- **Hub 运行实例**: ws://vm153:8082 · REST http://vm153:8083

## 许可证

MIT
