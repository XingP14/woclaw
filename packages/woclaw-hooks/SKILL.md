---
name: woclaw-hooks
description: Install and manage WoClaw shared-memory hooks for Claude Code, Gemini CLI, OpenCode, and OpenAI Codex CLI. Use when the user wants to share memory/context between coding agents and an OpenClaw WoClaw Hub, or wants to wire PreCompact/SessionStart/SessionStop events to a Hub REST API.
compatible_with: [claude-code, gemini-cli, opencode, openai-codex-cli, claude-managed-agents, aws-platform, mcp-tunnels, anthropic-agent-skills, lobehub-skills-marketplace, clawhub-skills, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned]
---

# WoClaw Hooks

`woclaw-hooks` is the bridge between coding-agent shell hooks (Claude Code, Gemini CLI, OpenCode, OpenAI Codex CLI) and a running [WoClaw Hub](https://github.com/XingP14/woclaw) REST API. It checkpoints and replays shared project context across agent runs so memory survives compaction, restarts, and IDE switches.

## When to use this skill

Use this skill when:

- The user runs Claude Code, Gemini CLI, OpenCode, or OpenAI Codex CLI and wants cross-session memory.
- A WoClaw Hub is already running (or the user is willing to start one) at `http://<host>:8083` with a shared auth token.
- The user mentions `~/.woclaw/`, `project:context`, `WOCLAW_HUB_URL`, or wants to migrate history from one agent framework to another.
- The user wants `PreCompact` (pre-compression checkpoint) + `SessionStart` + `SessionStop` lifecycle hooks wired automatically.

**Do not use** when:

- The user only wants a *Claude Code Skills directory entry* with no install behavior. This skill IS the install — if they just want discoverability, point them to the README instead.
- The user is on OpenAI Codex CLI AND wants PreCompact + config.toml auto-enable — recommend the dedicated [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) package instead (`woclaw-hooks --framework codex` covers SessionStart/Stop only).
- **Claude Managed Agents users (AWS deploy)** — install this skill into a self-hosted sandbox, point `WOCLAW_HUB_URL` at a Hub reachable through an MCP tunnel, and PreCompact/SessionStart/Stop events will checkpoint shared memory to a privately-hosted Hub. Compatible with dreaming / multiagent orchestration / outcomes workflows (Code with Claude 2026).
- The WoClaw Hub is not deployed and the user does not want to deploy it.

## What this skill installs

For each supported framework, three lifecycle hooks:

| Hook event | What it does |
|------------|--------------|
| `SessionStart` (or `SessionStart.sh` per framework) | Reads `project:context` from WoClaw Hub and prepends it to the agent's first prompt, so the agent wakes up with prior context. |
| `SessionStop` (or `SessionStop.sh` per framework) | Writes the agent's session summary back to the Hub under the same key, so the next session inherits it. |
| `PreCompact` (Claude Code + Codex only) | Snapshots the current context window to the Hub *before* the framework compresses it, so nothing is lost. |

Plus a migration CLI (`woclaw-hooks --migrate`) that imports existing history from one of: OpenClaw workspace root docs (`MEMORY.md`, `SOUL.md`, `AGENTS.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `IDENTITY.md`) plus content under `memory/`, `_tmp/`, `_archive/`, `ai_diary/`, `ai_tech/`, `docs/`; Claude Code `~/.claude/history.jsonl`; Gemini CLI `~/.gemini/tmp/**/chats/*.json`; Codex `~/.codex/history.jsonl`.

## Install

```bash
#1. Install the package globally
npm install -g woclaw-hooks

#2. Run interactive setup (prompts for framework + hub URL)
woclaw-hooks

# Or non-interactive:
woclaw-hooks --install --framework claude-code
woclaw-hooks --install --framework gemini
woclaw-hooks --install --framework opencode
woclaw-hooks --install --framework codex # SessionStart/Stop only; add codex_hooks = true to ~/.codex/config.toml

#3. (Optional) Configure environment
echo 'WOCLAW_HUB_URL=http://localhost:8083' >> ~/.woclaw/.env
echo 'WOCLAW_TOKEN=WoClaw2026' >> ~/.woclaw/.env
echo 'WOCLAW_PROJECT_KEY=project:context' >> ~/.woclaw/.env

#4. Verify
woclaw-hooks --status
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `--framework` | (prompts) | One of `claude-code`, `gemini`, `opencode`, `codex`. |
| `WOCLAW_HUB_URL` env | `http://localhost:8083` | Hub REST API base URL. |
| `WOCLAW_TOKEN` env | `WoClaw2026` | Bearer token; must match Hub's `WOCLAW_TOKEN`. |
| `WOCLAW_PROJECT_KEY` env | `project:context` | Memory key the hooks read/write. |

## Outputs the skill produces

- Hook shell scripts copied into the framework's hooks directory (`~/.claude/hooks/`, `~/.gemini/hooks/`, `~/.opencode/hooks/`, `~/.codex/hooks.json`).
- A `~/.woclaw/.env` file (if missing) with default Hub URL + token.
- One HTTP `GET /memory/{key}` on every `SessionStart` and one HTTP `PUT /memory/{key}` on every `SessionStop` (and one `PUT` on `PreCompact`).

## Verification

After install, run:

```bash
woclaw-hooks --status
# Expect: "Hooks installed for <framework>" + "Hub reachable: true"

# End-to-end smoke test:
#1. Start a Claude Code session, confirm Hub context appears in the first prompt.
#2. End the session, confirm the summary lands at `GET http://localhost:8083/memory/project:context`.
```

If `--status` reports `Hub reachable: false`, double-check `WOCLAW_HUB_URL` and that the Hub process is alive: `curl http://<host>:8083/health` should return `{"status":"ok"}`.

## Failure modes

- **Hub unreachable**: hooks degrade silently and log to `~/.woclaw/hooks.log`. The agent still runs but starts with no shared context. Fix: restart Hub or correct `WOCLAW_HUB_URL`.
- **Token mismatch**: Hub returns401; hooks write the failure to `~/.woclaw/hooks.log`. Fix: align `WOCLAW_TOKEN` in `~/.woclaw/.env` with the Hub's `WOCLAW_TOKEN` env.
- **Codex + no PreCompact**: expected. Use `woclaw-codex` instead for full coverage.

## Source

- Package: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (v0.5.0)
- Repo: [`packages/woclaw-hooks/`](https://github.com/XingP14/woclaw/tree/master/packages/woclaw-hooks)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Discover on: [LobeHub](https://lobehub.com/skills) · [ClawHub](https://clawhub.ai) · [SkillHub.club](https://skillhub.club) · [Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills) · [Agensi](https://www.agensi.io) · [Skills.sh](https://skills.sh) — 8-marketplace coverage (publish on 2: one free-browsing + one vetted-paid).
