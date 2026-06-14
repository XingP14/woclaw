# WoClaw Codex CLI Integration

> 🧩 **Anthropic Agent Skills discoverable** — see [`SKILL.md`](./SKILL.md) for the frontmatter, install contract, and lifecycle hook contract. Installable via `npx skills add XingP14/woclaw --path packages/codex-woclaw`.

Connect OpenAI Codex CLI sessions to a WoClaw Hub for **shared context across sessions and agents**.

```
pip install aiohttp websockets   # required by hook scripts
python3 install.py               # one-command install
```

## What It Does

- **SessionStart Hook**: When Codex starts, loads shared project context from WoClaw Hub and injects it as developer context
- **Stop Hook**: When Codex ends, saves a transcript summary back to WoClaw Hub so future sessions can pick up where you left off
- **PreCompact Hook**: When Codex compresses its context, checkpoints important project context (current task / decisions / key facts) to WoClaw Hub so it survives the compaction and the next session can resume from it

## Requirements

- Python 3.8+
- `aiohttp` or standard `urllib` (stdlib, no extra deps needed for REST)
- WoClaw Hub running at `ws://your-hub-host:8082` / `http://your-hub-host:8083`

## Quick Install

```bash
# Clone WoClaw repo (if you have it)
cd packages/codex-woclaw

# Install hooks (one command)
python3 install.py
```

This will:
1. Copy `session_start.py`, `stop.py`, and `precompact.py` to `~/.codex/hooks/`
2. Create `~/.codex/hooks.json` with WoClaw hook configuration (SessionStart + Stop + PreCompact)
3. Enable `codex_hooks = true` in `~/.codex/config.toml`

Then start a Codex session — the hook runs automatically.

## Uninstall

```bash
python3 install.py --uninstall
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WOCLAW_HUB_URL` | `http://your-hub-host:8083` | Hub REST API URL |
| `WOCLAW_TOKEN` | `WoClaw2026` | Hub auth token |
| `WOCLAW_KEY` | `codex:context` | Memory key for context (used by SessionStart / Stop) |
| `WOCLAW_PROJECT_KEY` | `project:context` | Memory key for pre-compact checkpoint (used by PreCompact) |
| `CODEX_CONTEXT_FILE` | _(unset)_ | Optional path to a context file the PreCompact hook will read & checkpoint |

## How It Works

The Codex CLI hooks system (`~/.codex/hooks.json`) fires Python scripts at key lifecycle events:

1. **SessionStart** → `session_start.py` reads `WOCLAW_KEY` from WoClaw Hub REST API → injects as `additionalContext`
2. **Stop** → `stop.py` reads session transcript → writes summary to WoClaw Hub under `WOCLAW_KEY`
3. **PreCompact** → `precompact.py` reads `CODEX_CONTEXT_FILE` (or recent transcript) → checkpoints key context to WoClaw Hub under `WOCLAW_PROJECT_KEY` (default `project:context`) so it survives the upcoming compression

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

## 🧪 Skill Creator 2.0 verifiable (2026-05-17)

This package ships with `tests/test_codex_woclaw_skill.json` (3 test cases covering `install.py` end-to-end / `session_start.py` POST `/memory` round-trip / `precompact.py` checkpoint write) so Anthropic Skill Creator 2.0 can run A/B benchmarking and auto-optimize triggers on upgrade:

```bash
claude skill eval woclaw-codex --tests tests/test_codex_woclaw_skill.json --ab [--auto-optimize]
```
