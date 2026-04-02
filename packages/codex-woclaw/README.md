# WoClaw Codex CLI Integration

Connect OpenAI Codex CLI sessions to a WoClaw Hub for **shared context across sessions and agents**.

```
pip install aiohttp websockets   # required by hook scripts
python3 install.py               # one-command install
```

## What It Does

- **SessionStart Hook**: When Codex starts, loads shared project context from WoClaw Hub and injects it as developer context
- **Stop Hook**: When Codex ends, saves a transcript summary back to WoClaw Hub so future sessions can pick up where you left off

## Requirements

- Python 3.8+
- `aiohttp` or standard `urllib` (stdlib, no extra deps needed for REST)
- WoClaw Hub running at `ws://vm153:8082` / `http://vm153:8083`

## Quick Install

```bash
# Clone WoClaw repo (if you have it)
cd packages/codex-woclaw

# Install hooks (one command)
python3 install.py
```

This will:
1. Copy `session_start.py` and `stop.py` to `~/.codex/hooks/`
2. Create `~/.codex/hooks.json` with WoClaw hook configuration
3. Enable `codex_hooks = true` in `~/.codex/config.toml`

Then start a Codex session — the hook runs automatically.

## Uninstall

```bash
python3 install.py --uninstall
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WOCLAW_HUB_URL` | `http://vm153:8083` | Hub REST API URL |
| `WOCLAW_TOKEN` | `WoClaw2026` | Hub auth token |
| `WOCLAW_KEY` | `codex:context` | Memory key for context |

## How It Works

The Codex CLI hooks system (`~/.codex/hooks.json`) fires Python scripts at key lifecycle events:

1. **SessionStart** → `session_start.py` reads `WOCLAW_KEY` from WoClaw Hub REST API → injects as `additionalContext`
2. **Stop** → `stop.py` reads session transcript → writes summary to WoClaw Hub under `WOCLAW_KEY`

## NPM Package

Publishing as `woclaw-codex` npm package for easy distribution:

```bash
cd packages/codex-woclaw
npm publish --access public
# → woclaw-codex on npm
```

After npm install, users get:
```
npx woclaw-codex install   # installs hooks
```
