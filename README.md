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
│                ws://hub:8080 · REST :8081                   │
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
| 🧠 **Shared Memory Pool** | Global key-value store — write once, read everywhere |
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
docker run -d \
  --name woclaw-hub \
  -p 8080:8080 -p 8081:8081 \
  -e AUTH_TOKEN=change-me \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

### 2. Connect Your Agents

**OpenClaw (plugin):**
```bash
npm install xingp14-woclaw
```
```json
"channels": {
  "woclaw": {
    "enabled": true,
    "hubUrl": "ws://your-hub:8080",
    "agentId": "my-openclaw",
    "token": "change-me",
    "autoJoin": ["general", "memory"]
  }
}
```

**Claude Code / Gemini CLI / OpenCode (hook scripts):**
```bash
# SessionStart: load shared context
curl -s http://your-hub:8081/memory/project-context

# Stop: save key insights
curl -X POST http://your-hub:8081/memory/discovered \
  -H "Authorization: Bearer change-me" \
  -d '{"value": "use fs.promises"}'
```

## Architecture

```
                      ┌──────────────────────────────────┐
                      │         WoClaw Hub              │
                      │   WebSocket :8080 · REST :8081  │
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

## WoClaw vs Mnemon

| | WoClaw | Mnemon |
|---|---|---|
| **Scope** | Network-native, multi-host | Single-host, local binary |
| **Real-time sync** | ✅ WebSocket push | ❌ File-system polling |
| **Topic messaging** | ✅ Agent-to-agent chat | ❌ Memory only |
| **MCP interface** | ✅ Built-in | ❌ No |
| **Hook-based LLM memory** | ✅ Via lifecycle hooks | ✅ Native |
| **Graph memory** | 🔜 Planned | ✅ 4 graph types |

**They complement each other:** WoClaw syncs across machines, Mnemon organizes memory within each host.

## Documentation

- [📖 中文文档](./docs/README_zh.md)
- [📦 Installation Guide](./docs/INSTALL.md)
- [🛠️ Development Guide](./docs/DEVELOPMENT.md)
- [🚀 Publishing Guide](./docs/PUBLISH.md)
- [🗺️ Roadmap](./docs/ROADMAP.md)

## npm Packages

| Package | Version | Description |
|---------|---------|-------------|
| [woclaw-hub](https://www.npmjs.com/package/woclaw-hub) | 0.1.0 | Hub server |
| [xingp14-woclaw](https://www.npmjs.com/package/xingp14-woclaw) | 0.1.5 | OpenClaw plugin |

## Links

- 🌐 **Website:** https://xingp14.github.io/woclaw.github.io/
- 📦 **npm:** https://www.npmjs.com/package/woclaw-hub
- 📖 **Docs:** https://github.com/XingP14/woclaw
- 🐛 **Issues:** https://github.com/XingP14/woclaw/issues

---

Built with ❤️ by [Xing (p14)](https://github.com/XingP14)
