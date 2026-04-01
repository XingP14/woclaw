# WoClaw

> **Shared memory and messaging hub for AI agents across all frameworks** — OpenClaw, Claude Code, Gemini CLI, OpenCode.

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/XingP14/woclaw?style=social)](https://github.com/XingP14/woclaw)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

## The Problem

Every AI agent starts from scratch. Every session.

You use **Claude Code** for coding, **OpenClaw** for orchestration, **Gemini CLI** for research. Each one forgets everything when the session ends. You repeat the same context to every agent, every session.

```
┌─────────────────────────────────────────────────────┐
│  You (repeatedly):                                 │
│  "We're building a web app with React and Go..."    │
│  "Remember, use fs.promises not fs.sync..."         │
│  "The database schema is in docs/schema.md..."      │
└─────────────────────────────────────────────────────┘
```

## The Solution

WoClaw Hub is a **network-native shared brain** for all your AI agents.

```
┌──────────────────────────────────────────────────────────────┐
│                      WoClaw Hub                               │
│                ws://hub:8082 · REST :8083                   │
│                                                              │
│   Claude Code ──┐                                            │
│                 ├──▶ Shared Memory Pool ──▶ Gemini CLI      │
│   OpenClaw ─────┤    "project: web app"                     │
│                 ├──▶ Topics ──────────────▶ OpenCode        │
│   OpenCode ─────┘    general / dev / research               │
└──────────────────────────────────────────────────────────────┘
```

**One context. All your agents. Real-time.**

## Features

| Feature | Description |
|---------|-------------|
| 🧠 **Shared Memory Pool** | Global key-value store with Tags & TTL support |
| 📡 **Topic Pub/Sub** | Real-time message routing between agents |
| 🔗 **Multi-Framework** | Connect OpenClaw, Claude Code, Gemini CLI, OpenCode |
| 🌉 **MCP Bridge** | Built-in MCP server for MCP-capable agents |
| 🪝 **Hook Integration** | LLM-supervised memory via lifecycle hooks |
| 📜 **Message History** | Last 50 messages per topic on join |
| 🔒 **Token Auth** | Bearer token protection |
| ⚡ **Real-Time Sync** | WebSocket-driven, no polling |

## Quick Start

### 1. Deploy Hub

```bash
# Pull from Docker Hub (recommended)
docker pull xingp14/woclaw-hub:hub/v0.3.0
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 -p 8083:8083 \
  -e AUTH_TOKEN=change-me \
  --restart unless-stopped \
  xingp14/woclaw-hub:hub/v0.3.0
```

> Docker Hub 镜像由 GitHub Actions docker-publish.yml 自动构建，使用 `hub/v*` 标签触发。详见 [docs/PUBLISH.md](./docs/PUBLISH.md)。

### 2. Connect Your Agents

**OpenClaw (plugin):**
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

**Claude Code / Gemini CLI / OpenCode (hook scripts):**
```bash
# SessionStart: load shared context
curl -s http://your-hub:8083/memory/project-context

# Stop: save key insights
curl -X POST http://your-hub:8083/memory/discovered \
  -H "Authorization: Bearer change-me" \
  -d '{"value": "use fs.promises"}'
```

### Shared Memory: Tags & TTL

Memory entries support optional **tags** (categorization) and **TTL** (time-to-live):

```bash
# Write with tags and 1-hour TTL
curl -X POST http://your-hub:8083/memory/my-key \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "value": "Important finding",
    "tags": ["project-alpha", "decision"],
    "ttl": 3600
  }'

# Query memories by tag
curl http://your-hub:8083/memory/by-tag/project-alpha \
  -H "Authorization: Bearer change-me"

# Read a specific memory
curl http://your-hub:8083/memory/my-key \
  -H "Authorization: Bearer change-me"
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tags` | `string[]` | `[]` | Categorization labels (e.g. `project`, `fact`, `decision`) |
| `ttl` | `number` | `0` | Seconds until expiry (`0` = never expires) |

## Architecture

```
                      ┌──────────────────────────────────┐
                      │         WoClaw Hub              │
                      │   WebSocket :8082 · REST :8083  │
                      └──────┬──────────────────┬───────┘
                             │                  │
         ┌───────────────────┼──────┐    ┌─────┼────────────────┐
         │                   │      │    │     │                │
     ┌───┴───┐          ┌────┴────┐ │ ┌───┴─┐  ┌┴────┐     ┌────┴────┐
     │OpenClaw│          │Claude  │ │ │Gemini│  │Open │     │ MCP     │
     │Plugin │          │Code    │ │ │ CLI  │  │Code │     │ Clients │
     │       │          │(hooks) │ │ │(hook)│  │(hook)│     │         │
     └───────┘          └────────┘ │ └─────┘  └─────┘     └─────────┘

     Shared across all: Topics · Memory Pool · Message History
```

## Documentation

- [📖 中文文档](./docs/README_zh.md)
- [📦 Installation Guide](./docs/INSTALL.md)
- [🛠️ Development Guide](./docs/DEVELOPMENT.md)
- [🚀 Publishing Guide](./docs/PUBLISH.md)
- [🗺️ Roadmap](./docs/ROADMAP.md)

## npm Packages

| Package | Version | Description |
|---------|---------|-------------|
| [woclaw-hub](https://www.npmjs.com/package/woclaw-hub) | 0.2.0 | Hub server |
| [xingp14-woclaw](https://www.npmjs.com/package/xingp14-woclaw) | 0.3.0 | OpenClaw plugin |

## Links

- 🌐 **Website:** https://xingp14.github.io/woclaw.github.io/
- 📦 **npm:** https://www.npmjs.com/package/woclaw-hub
- 📖 **Docs:** https://github.com/XingP14/woclaw
- 🐛 **Issues:** https://github.com/XingP14/woclaw/issues

---

Built with ❤️ by [Xing (p14)](https://github.com/XingP14)

## MCP Bridge (npm)

Connect Claude Desktop, Cursor, Windsurf, or any MCP-capable agent to WoClaw Hub.

```bash
npm install -g woclaw-mcp
woclaw-mcp --hub=ws://vm153:8082 --token=WoClaw2026 --rest-url=http://vm153:8083
```

Or add to your MCP config:

```json
{
  "mcpServers": {
    "woclaw": {
      "command": "node",
      "args":["/path/to/node_modules/woclaw-mcp/dist/index.js","--hub=ws://vm153:8082","--token=WoClaw2026","--rest-url=http://vm153:8083"]
    }
  }
}
```

[![npm](https://img.shields.io/badge/npm-woclaw--mcp%400.1.2-blue.svg)](https://www.npmjs.com/package/woclaw-mcp)
