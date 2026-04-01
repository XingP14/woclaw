# WoClaw Hooks

Share memory and context between coding agents (Claude Code, Gemini CLI, OpenCode) and OpenClaw agents via WoClaw Hub.

## Features

- **Session Start**: Load shared project context from WoClaw Hub when an agent starts
- **Session Stop**: Save session summary back to WoClaw Hub for next session
- **PreCompact**: Checkpoint important context before agents compress their context
- **Multi-Framework**: Supports Claude Code, Gemini CLI, and OpenCode

## Installation

```bash
npm install -g woclaw-hooks
```

## Quick Start

```bash
# Interactive setup (prompts for framework and hub URL)
woclaw-hooks

# Install hooks for a specific framework
woclaw-hooks --install --framework claude-code

# Show installed hooks status
woclaw-hooks --status
```

## Supported Frameworks

| Framework | Flag | Hook Directory |
|-----------|------|----------------|
| Claude Code | `--framework claude-code` | `~/.claude/hooks/` |
| Gemini CLI | `--framework gemini` | `~/.gemini/hooks/` |
| OpenCode | `--framework opencode` | `~/.opencode/hooks/` |

## Configuration

Config is stored in `~/.woclaw/.env`:

```env
WOCLAW_HUB_URL=http://localhost:8083
WOCLAW_TOKEN=WoClaw2026
WOCLAW_PROJECT_KEY=project:context
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `WOCLAW_HUB_URL` | `http://localhost:8083` | WoClaw Hub REST API URL |
| `WOCLAW_TOKEN` | `WoClaw2026` | Hub authentication token |
| `WOCLAW_PROJECT_KEY` | `project:context` | Memory key for project context |

## Manual Installation

If you prefer to install hooks manually:

```bash
# Copy hooks to your framework's hooks directory
cp session-start.sh ~/.claude/hooks/woclaw-session-start.sh
cp session-stop.sh ~/.claude/hooks/woclaw-session-stop.sh
cp precompact.sh ~/.claude/hooks/woclaw-precompact.sh
chmod +x ~/.claude/hooks/woclaw-*.sh

# Set environment variables
export WOCLAW_HUB_URL=http://your-hub:8083
export WOCLAW_TOKEN=your-token
```

## How It Works

1. **Session Start Hook** reads the `project:context` memory key from your WoClaw Hub and prints it as a prefixed message, making it available to the agent's context
2. **Session Stop Hook** writes the agent's session summary back to WoClaw Hub
3. **PreCompact Hook** saves recent context before compression

## WoClaw Hub

Requires a running WoClaw Hub. See [WoClaw](https://github.com/XingP14/woclaw) for setup.

## License

MIT
