# WoClaw

> **Shared memory and messaging hub for AI agents across all frameworks** — OpenClaw, Claude Code, Gemini CLI, **OpenAI Codex CLI**, OpenCode.

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/XingP14/woclaw?style=social)](https://github.com/XingP14/woclaw)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![npm (scoped)](https://img.shields.io/npm/v/woclaw-hub?label=woclaw-hub)](https://www.npmjs.com/package/woclaw-hub)
[![npm](https://img.shields.io/npm/v/xingp14-woclaw?label=xingp14-woclaw)](https://www.npmjs.com/package/xingp14-woclaw)
[![npm](https://img.shields.io/npm/v/woclaw-mcp?label=woclaw-mcp)](https://www.npmjs.com/package/woclaw-mcp)
[![npm](https://img.shields.io/npm/v/woclaw-hooks?label=woclaw-hooks%400.4.0)](https://www.npmjs.com/package/woclaw-hooks)
[![npm](https://img.shields.io/npm/v/woclaw-codex?label=woclaw-codex%400.1.0)](https://www.npmjs.com/package/woclaw-codex)

## The Problem

Every AI agent starts from scratch. Every session.

You use **Claude Code** for coding, **OpenAI Codex CLI** for Python agents, **OpenClaw** for orchestration, **Gemini CLI** for research. Each one forgets everything when the session ends. You repeat the same context to every agent, every session.

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
| 🔗 **Multi-Framework** | Connect OpenClaw, Claude Code, Gemini CLI, **OpenAI Codex CLI**, OpenCode |
| 🌉 **MCP Bridge** | Built-in MCP server for MCP-capable agents |
| 🪝 **Hook Integration** | LLM-supervised memory via lifecycle hooks |
| 📜 **Message History** | Last 50 messages per topic on join |
| 🔒 **Token Auth** | Bearer token protection |
| ⚡ **Real-Time Sync** | WebSocket-driven, no polling |
| 🔄 **Migration Tools** | Import history from OpenAI Codex, Claude Code, Gemini CLI, OpenClaw |

## Quick Start

### 1. Deploy Hub

```bash
# Pull from Docker Hub (recommended)
docker pull xingp14/woclaw-hub:0.3.0
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 -p 8083:8083 \
  -e AUTH_TOKEN=change-me \
  --restart unless-stopped \
  xingp14/woclaw-hub:0.3.0
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

**Claude Code / Gemini CLI / OpenAI Codex CLI / OpenCode (hook scripts):**
```bash
# SessionStart: load shared context
curl -s http://your-hub:8083/memory/project-context

# Stop: save key insights
curl -X POST http://your-hub:8083/memory/discovered \
  -H "Authorization: Bearer change-me" \
  -d '{"value": "use fs.promises"}'
```

**OpenAI Codex CLI (⭐ [packages/codex-woclaw](./packages/codex-woclaw/)):**

OpenAI Codex CLI is OpenAI's official Python-based coding agent. Connect it to WoClaw Hub:

```bash
npm install -g woclaw-codex
woclaw-codex install   # installs ~/.codex/hooks/ + hooks.json

# Or from source:
cd packages/codex-woclaw && python3 install.py
```

- **SessionStart**: reads `codex:context` from WoClaw Hub → injects as additional developer context
- **Stop**: reads transcript → writes session summary to WoClaw Hub

**OpenCode (plugin — see [packages/opencode-woclaw-plugin](./packages/opencode-woclaw-plugin/)):**

```bash
# Install plugin
cp packages/opencode-woclaw-plugin/index.js ~/.config/opencode/plugins/woclaw.js

# Configure env vars
export WOCLAW_HUB_URL=ws://your-hub:8082
export WOCLAW_TOKEN=change-me
```

Then OpenCode can use built-in tools:
```
/woclaw_memory_read project-context
/woclaw_memory_write discovered "use fs.promises"
/woclaw_topics_list
/woclaw_hub_status
```

### Shared Memory: Tags & TTL

Memory entries support optional **tags** (categorization) and **TTL** (time-to-live):

```bash
# Write with tags and 1-hour TTL
curl -X POST http://your-hub:8083/memory \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "value": "Important finding",
    "tags": ["project-alpha", "decision"],
    "ttl": 3600
  }'

# Query memories by tag
curl "http://your-hub:8083/memory?tags=project-alpha"

# Read a specific memory
curl http://your-hub:8083/memory/my-key
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `tags` | `string[]` | `[]` | Categorization labels (e.g. `project`, `fact`, `decision`) |
| `ttl` | `number` | `0` | Seconds until expiry (`0` = never expires) |

### Migration: Bring Your History With You

Migrate session history from any framework into WoClaw's shared memory. Stop losing context when switching tools.

```bash
# Migrate OpenAI Codex CLI sessions
npx woclaw migrate --framework openai-codex --session-id <session>

# Migrate Claude Code sessions
npx woclaw migrate --framework claude-code --session-dir ~/.claude/sessions

# Migrate Gemini CLI history
npx woclaw migrate --framework gemini-cli

# Migrate OpenClaw memory entries
npx woclaw migrate --framework openclaw --agent-id my-openclaw

# Dry run first (preview what will be migrated)
npx woclaw migrate --all --dry-run
```

Migrated content goes into **Shared Memory Pool** with tags like `migrated:openai-codex`, `migrated:claude-code` so you can filter and manage it.

## Architecture

```
                      ┌──────────────────────────────────┐
                      │         WoClaw Hub              │
                      │   WebSocket :8082 · REST :8083  │
                      └──────┬──────────────────┬───────┘
                             │                  │
         ┌───────────────────┼──────┐    ┌─────┼────────────────┐
         │                   │      │    │     │                │
     ┌───┴───┐          ┌────┴────┐ │ ┌───┴─┐  ┌┴────┐  ┌────┴────┐  ┌────┴────┐
     │OpenClaw│          │Claude  │ │ │Gemini│  │Open │  │OpenAI   │  │ MCP     │
     │Plugin │          │Code    │ │ │ CLI  │  │Code │  │Codex CLI│  │ Clients │
     │       │          │(hooks) │ │ │(hook)│  │(hook)│  │(hooks)  │  │         │
     └───────┘          └────────┘ │ └─────┘  └─────┘  └─────────┘  └─────────┘

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
| [woclaw-hub](https://www.npmjs.com/package/woclaw-hub) | 0.3.0 | Hub server |
| [xingp14-woclaw](https://www.npmjs.com/package/xingp14-woclaw) | 0.3.0 | OpenClaw plugin |
| [woclaw-mcp](https://www.npmjs.com/package/woclaw-mcp) | 0.1.2 | MCP Bridge for MCP clients |
| [woclaw-hooks](https://www.npmjs.com/package/woclaw-hooks) | 0.4.0 | Claude Code hook scripts |
| [woclaw-codex](https://www.npmjs.com/package/woclaw-codex) | 0.1.0 | OpenAI Codex CLI hooks (Python) |

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
