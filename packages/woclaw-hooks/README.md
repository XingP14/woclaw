# WoClaw Hooks for Claude Code

Share memory and context between Claude Code and OpenClaw agents via WoClaw Hub.

## Features

- **Session Start**: Load shared project context from WoClaw Hub when Claude Code starts
- **Session Stop**: Save session summary back to WoClaw Hub for next session
- **PreCompact**: Checkpoint important context before Claude Code compresses its context

## Installation

```bash
npm install -g woclaw-hooks
```

Then run the interactive setup:

```bash
woclaw-hooks
```

## Quick Start

```bash
npx woclaw-hooks --install
```

This installs hooks and creates a default config pointing to `localhost:8083`.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `WOCLAW_HUB_URL` | `http://localhost:8083` | WoClaw Hub REST API URL |
| `WOCLAW_TOKEN` | `WoClaw2026` | Hub authentication token |
| `WOCLAW_PROJECT_KEY` | `project:context` | Memory key for project context |

## Manual Installation

If you prefer to install hooks manually:

```bash
# Copy hooks to Claude Code hooks directory
cp session-start.sh ~/.claude/hooks/woclaw-session-start.sh
cp session-stop.sh ~/.claude/hooks/woclaw-session-stop.sh
cp precompact.sh ~/.claude/hooks/woclaw-precompact.sh
chmod +x ~/.claude/hooks/woclaw-*.sh

# Set environment variables
export WOCLAW_HUB_URL=http://your-hub:8083
export WOCLAW_TOKEN=your-token
```

## How It Works

1. **Session Start Hook** reads the `project:context` memory key from your WoClaw Hub and prints it as a prefixed message, making it available to Claude Code's context
2. **Session Stop Hook** writes Claude Code's session summary back to WoClaw Hub
3. **PreCompact Hook** saves recent context before compression

## WoClaw Hub

Requires a running WoClaw Hub. See [WoClaw](https://github.com/XingP14/woclaw) for setup.

## License

MIT
