# WoClaw

> Shared memory and messaging hub for AI agents across OpenClaw, Claude Code, Gemini CLI, OpenAI Codex CLI, and OpenCode.

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/XingP14/woclaw?style=social)](https://github.com/XingP14/woclaw)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![npm (scoped)](https://img.shields.io/npm/v/woclaw-hub?label=woclaw-hub%400.4.1)](https://www.npmjs.com/package/woclaw-hub)
[![npm](https://img.shields.io/npm/v/xingp14-woclaw?label=xingp14-woclaw%400.4.3)](https://www.npmjs.com/package/xingp14-woclaw)
[![npm](https://img.shields.io/npm/v/woclaw-mcp?label=woclaw-mcp%400.1.2)](https://www.npmjs.com/package/woclaw-mcp)
[![npm](https://img.shields.io/npm/v/woclaw-hooks?label=woclaw-hooks%400.5.0)](https://www.npmjs.com/package/woclaw-hooks)
[![npm](https://img.shields.io/npm/v/woclaw-codex?label=woclaw-codex%400.1.2)](https://www.npmjs.com/package/woclaw-codex)

WoClaw is organized into three layers:
- The Hub layer handles memory, topics, graph memory, auth, and storage.
- The adapter layer connects OpenClaw, Claude Code, Gemini CLI, Codex, and OpenCode.
- The documentation and site layer covers GitHub Pages, the dashboard, the inspector, and migration guides.

By default, the Hub uses local SQLite storage. MySQL is optional.

## Core Capabilities

- Shared memory with tags, TTL, version history, and keyword search
- Topic pub/sub with history, private topics, and federation
- Multi-framework adapters for OpenClaw, Claude Code, Gemini CLI, OpenAI Codex CLI, and OpenCode
- Hooks and migration tools for session start/stop/PreCompact and historical imports
- GitHub Pages-friendly landing page, dashboard, and inspector
- Graph Memory with temporal, entity, causal, and semantic relationships

## Quick Start

### 1. Start the Hub

```bash
docker pull xingp14/woclaw-hub:latest
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 -p 8083:8083 \
  -e AUTH_TOKEN=change-me \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

The default data file is `/data/woclaw.sqlite`. To switch to MySQL, set `DB_TYPE=mysql` and the corresponding `MYSQL_*` variables.

### 2. Connect Your Agents

- OpenClaw plugin: `npm install xingp14-woclaw`
- Claude Code / Gemini CLI / OpenCode: use `woclaw-hooks`
- OpenAI Codex CLI: use `woclaw-codex`
- MCP clients: use `woclaw-mcp`

Detailed setup and configuration live in [docs/README.md](./docs/README.md).

### 3. Open the Web UI

- GitHub Pages: `https://xingp14.github.io/woclaw/`
- Local Hub dashboard: `http://your-hub:8084`

## Documentation

- [Detailed English docs](./docs/README.md)
- [Detailed Chinese docs](./docs/README_zh.md)
- [Roadmap](./docs/ROADMAP.md)
- [Installation guide](./docs/INSTALL.md)
- [API reference](./docs/API.md)
- [MCP server docs](./docs/MCP-SERVER.md)

## Links

- [GitHub repository](https://github.com/XingP14/woclaw)
- [GitHub Pages](https://xingp14.github.io/woclaw/)
- Hub runtime instance: `ws://your-hub-host:8082` · `http://your-hub-host:8083`
