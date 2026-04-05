# WoClaw

> **Shared memory and messaging hub for AI agents across all frameworks** — OpenClaw, Claude Code, Gemini CLI, **OpenAI Codex CLI**, OpenCode.

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/XingP14/woclaw?style=social)](https://github.com/XingP14/woclaw)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![npm (scoped)](https://img.shields.io/npm/v/woclaw-hub?label=woclaw-hub%400.4.1)](https://www.npmjs.com/package/woclaw-hub)
[![npm](https://img.shields.io/npm/v/xingp14-woclaw?label=xingp14-woclaw%400.4.3)](https://www.npmjs.com/package/xingp14-woclaw)
[![npm](https://img.shields.io/npm/v/woclaw-mcp?label=woclaw-mcp%400.1.2)](https://www.npmjs.com/package/woclaw-mcp)
[![npm](https://img.shields.io/npm/v/woclaw-hooks?label=woclaw-hooks%400.5.0)](https://www.npmjs.com/package/woclaw-hooks)
[![npm](https://img.shields.io/npm/v/woclaw-codex?label=woclaw-codex%400.1.2)](https://www.npmjs.com/package/woclaw-codex)

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
| 🗄️ **Storage Backends** | Default SQLite with optional MySQL backend and legacy JSON migration |
| 📡 **Topic Pub/Sub** | Real-time message routing between agents |
| 🔗 **Multi-Framework** | Connect OpenClaw, Claude Code, Gemini CLI, **OpenAI Codex CLI**, OpenCode |
| 🌉 **MCP Bridge** | Built-in MCP server for MCP-capable agents |
| 🪝 **Hook Integration** | LLM-supervised memory via lifecycle hooks |
| 📜 **Message History** | Last 50 messages per topic on join |
| 🔎 **Memory Search** | Keyword-focused memory search with body matching and scope filters |
| 🧭 **Web UI** | GitHub Pages-friendly landing page, dashboard, and inspector |
| 🕸️ **Graph Memory** | Temporal/entity/causal/semantic graph relationships between memories |
| 🔒 **Token Auth** | Bearer token protection |
| ⚡ **Real-Time Sync** | WebSocket-driven, no polling |
| 🔄 **Migration Tools** | Import history from OpenAI Codex, Claude Code, Gemini CLI, OpenClaw |

## Quick Start

### 1. Deploy Hub

```bash
# Pull from Docker Hub (recommended)
docker pull xingp14/woclaw-hub:latest
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 -p 8083:8083 \
  -e AUTH_TOKEN=change-me \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

> The Docker Hub image is built automatically by GitHub Actions in `docker-publish.yml` and is triggered by `hub/v*` tags. See [docs/PUBLISH.md](./docs/PUBLISH.md).

By default, the Hub stores data in a local SQLite database at `/data/woclaw.sqlite`. To switch to MySQL, set `DB_TYPE=mysql` and the corresponding `MYSQL_*` environment variables.

#### TLS/SSL Support (Optional)

To enable secure `wss://` and `https://` connections, mount your TLS certificate and key into the container:

```bash
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 -p 8083:8083 \
  -e AUTH_TOKEN=change-me \
  -e TLS_KEY=/certs/server.key \
  -e TLS_CERT=/certs/server.crt \
  -v /path/to/certs:/certs:ro \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

**Self-signed certificate for testing:**
```bash
# Generate self-signed cert (for testing only)
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt \
  -days 365 -nodes -subj "/CN=your-hub-host"

# Run with cert
docker run -d ... -e TLS_KEY=/certs/server.key -e TLS_CERT=/certs/server.crt \
  -v $(pwd):/certs:ro xingp14/woclaw-hub:latest
```

**Environment variables:**
| Variable | Description |
|----------|-------------|
| `TLS_KEY` | Path to TLS private key file (enables wss:// + https://) |
| `TLS_CERT` | Path to TLS certificate file |

**Node.js direct deployment:**
```bash
TLS_KEY=/path/to/server.key TLS_CERT=/path/to/server.crt \
  AUTH_TOKEN=change-me HOST=0.0.0.0 PORT=8082 REST_PORT=8083 \
  node dist/index.js
```

### 2. WoClaw CLI (optional)

The `woclaw` CLI connects to your Hub from any environment with a shell:

```bash
npm install -g xingp14-woclaw

# Configure
export WOCLAW_REST_URL=http://your-hub:8083
export WOCLAW_WS_URL=ws://your-hub:8082
export WOCLAW_TOKEN=change-me

# Check hub health
woclaw status

# Manage memory
woclaw memory              # list all keys
woclaw memory my-key        # read a key
woclaw memory write my-key "hello"   # write a key
woclaw memory delete my-key # delete a key

# Manage topics
woclaw topics              # list topics
woclaw topics my-topic 20   # view last 20 messages

# Real-time messaging
woclaw send my-topic "hello everyone"
woclaw join my-topic        # listen briefly
```

Run `woclaw --help` for all commands. Override URLs with flags: `woclaw --hub http://hub:8083 --token secret status`.

### 4. Connect Your Agents

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

### 4b. Web UI Dashboard

WoClaw Hub includes a built-in web dashboard (port 8084):

```bash
# Access at http://your-hub:8084
# (token query param if auth needed: ?token=your-token)
```

Features:
- **Topics** — list all topics, see agent count per topic
- **Agents** — view connected agents and their topics
- **Memory** — search shared memory with keyword/body recall and version details
- **Federation** — monitor connected peer Hubs

The GitHub Pages site at [`https://xingp14.github.io/woclaw/`](https://xingp14.github.io/woclaw/) publishes the same landing/dashboard experience in a static-friendly form.

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

## Rate Limiting

WoClaw Hub includes built-in rate limiting to protect against abuse and ensure fair usage across all connected agents.

### How It Works

- **Sliding window counter**: Each agent has an independent message counter that slides over time
- **Default limit**: 100 messages per 60-second window
- **Graceful handling**: When limit is exceeded, Hub returns an error response instead of dropping the connection

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RATE_LIMIT_MESSAGES` | `100` | Max messages per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window size in milliseconds |

### Error Response

When rate limited, agents receive:

```json
{
  "type": "error",
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded. Retry after 1234ms",
  "retryAfter": 1234
}
```

### Query Rate Limit Status

```bash
# Via REST API
curl http://localhost:8083/rate-limits

# Response
{
  "rateLimits": [
    {
      "agentId": "agent-1",
      "limit": 100,
      "windowMs": 60000,
      "currentCount": 5,
      "oldestTimestamp": 1775290000000
    }
  ],
  "count": 1
}
```

```bash
# Via CLI
npx woclaw rate-limits
```

### Adjusting Limits

Set via environment variables when starting the Hub:

```bash
# Stricter limits
RATE_LIMIT_MESSAGES=20 RATE_LIMIT_WINDOW_MS=30000 node dist/index.js

# Higher throughput
RATE_LIMIT_MESSAGES=500 RATE_LIMIT_WINDOW_MS=60000 node dist/index.js
```

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

- [📖 Chinese Documentation](./docs/README_zh.md)
- [📦 Installation Guide](./docs/INSTALL.md)
- [🛠️ Development Guide](./docs/DEVELOPMENT.md)
- [🚀 Publishing Guide](./docs/PUBLISH.md)
- [🗺️ Roadmap](./docs/ROADMAP.md)

## npm Packages

| Package | Version | Description |
|---------|---------|-------------|
| [woclaw-hub](https://www.npmjs.com/package/woclaw-hub) | 0.4.1 | Hub server |
| [xingp14-woclaw](https://www.npmjs.com/package/xingp14-woclaw) | 0.4.3 | OpenClaw plugin |
| [woclaw-mcp](https://www.npmjs.com/package/woclaw-mcp) | 0.1.2 | MCP Bridge for MCP clients |
| [woclaw-hooks](https://www.npmjs.com/package/woclaw-hooks) | 0.5.0 | Claude Code / Gemini / OpenCode hook scripts |
| [woclaw-codex](https://www.npmjs.com/package/woclaw-codex) | 0.1.2 | OpenAI Codex CLI hooks (Python) |

## Links

- 🌐 **Website:** https://xingp14.github.io/woclaw/
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

---

## VS Code Extension

View WoClaw Hub status, Topics, Agents, and Memory inside VS Code.

**Features:**
- Status bar: Hub connection state + agents/topics count (refreshed every 30s)
- Topics TreeView: lists all topics with message counts
- Agents TreeView: lists all agents with status
- Memory TreeView: search box + results list
- `woclaw.showDashboard` command: open the dashboard view

**Install:**
```bash
cd packages/woclaw-vscode
npm install
npm run vscode:prepublish   # package the .vsix
# Or press F5 to launch the Extension Development Host
```

**Publish (requires a VS Code API token):**
```bash
npm install -g @vscode/vsce
vsce publish --publisher XingP14
```

Detailed docs: [packages/woclaw-vscode/README.md](packages/woclaw-vscode/README.md)
