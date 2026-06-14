---
name: opencode-woclaw
description: Install and use the WoClaw Hub plugin for OpenCode CLI — shared memory, topic messaging, and multi-agent context across OpenCode, Claude Code, Gemini CLI, and Codex. Use when the user runs OpenCode and wants to wire session.created/session.compacted/shell.env hooks to a running WoClaw Hub, or share project:context with other agents through one REST/WS API.
compatible_with: [opencode, opencode-cli, claude-code, gemini-cli, codex, claude-managed-agents, aws-platform, mcp-tunnels, opencode-plugin, anthropic-agent-skills, lobehub-skills-marketplace, clawhub-skills, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin]
skill_type: workflow-orchestration
folder_structure: true
---

# WoClaw Plugin for OpenCode

`opencode-woclaw` is the OpenCode counterpart to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (which targets Claude Code / Gemini CLI / Codex). It registers as an [OpenCode plugin](https://opencode.ai) and exposes six `woclaw_*` tools plus three lifecycle hooks (`session.created`, `session.compacted`, `shell.env`) so memory and env vars survive restarts, compaction, and cross-agent handoffs.

## When to use this skill

Use this skill when:

- The user runs **OpenCode CLI** and wants shared memory across OpenCode sessions.
- A WoClaw Hub is already running (or the user is willing to start one) at `ws://<host>:8082` (WS) and `http://<host>:8083` (REST) with a shared `WOCLAW_TOKEN`.
- The user wants to **share `project:context` (or any memory key) with Claude Code / Gemini / Codex / OpenClaw** through a single Hub.
- The user mentions `opencode.json`, `~/.config/opencode/plugins/`, `WOCLAW_HUB_URL`, or wants OpenCode ↔ WoClaw memory sync.
- The user wants `WOCLAW_*` env vars auto-injected into every shell command OpenCode runs.

**Do not use** when:

- The user only wants Claude Code / Gemini / Codex hooks — use [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Node-based, broader framework coverage).
- The user wants a VS Code editor view of the Hub — use [`woclaw-vscode`](https://marketplace.visualstudio.com/items?itemName=XingP14.woclaw-vscode).
- The WoClaw Hub is not deployed and the user does not want to deploy it.
- **Claude Managed Agents users (AWS deploy)** — install this OpenCode plugin inside a self-hosted sandbox and route `WOCLAW_HUB_URL` through an MCP tunnel so OpenCode session.created / session.compacted / shell.env hooks can checkpoint memory to a privately-hosted Hub. Compatible with dreaming / multiagent orchestration / outcomes workflows.
- The user wants MCP server discovery — use [`woclaw-mcp`](https://github.com/XingP14/woclaw/tree/master/mcp-bridge) instead.

## What this skill installs

- An OpenCode plugin entry (`index.js`,235 LOC) registering six tools:
 - `woclaw_memory_read <key>` — read a memory value
 - `woclaw_memory_write <key> <value>` — write a memory value
 - `woclaw_memory_list` — list all memory keys
 - `woclaw_memory_delete <key>` — delete a memory key
 - `woclaw_topics_list` — list Hub topics
 - `woclaw_hub_status` — ping the Hub REST API
- Three lifecycle hooks auto-wired to OpenCode events:
 - `session.created` → load shared context from Hub
 - `session.compacted` → save session snapshot to Hub
 - `shell.env` → inject `WOCLAW_HUB_URL`, `WOCLAW_TOKEN`, `WOCLAW_AGENT_ID`, `WOCLAW_REST_URL`, `WOCLAW_PROJECT_KEY` into every shell command

## Install

```bash
# Option1 (recommended for single-user installs)
mkdir -p ~/.config/opencode/plugins/
cp index.js ~/.config/opencode/plugins/woclaw.js

# Option2 (npm, for project-scoped installs)
# Add to your opencode.json:
# { "plugins": ["opencode-woclaw"] }
# Then:
npm install opencode-woclaw

# Set Hub env vars (add to ~/.bashrc or ~/.zshrc):
export WOCLAW_HUB_URL=ws://your-hub-host:8082
export WOCLAW_TOKEN=WoClaw2026
export WOCLAW_AGENT_ID=opencode-my-machine
export WOCLAW_REST_URL=http://your-hub-host:8083
export WOCLAW_PROJECT_KEY=project:context
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `WOCLAW_HUB_URL` env | `ws://localhost:8080` | WoClaw Hub WebSocket endpoint. Must be reachable from OpenCode. |
| `WOCLAW_REST_URL` env | derived from `WOCLAW_HUB_URL` | WoClaw Hub REST endpoint (port8083 by convention). |
| `WOCLAW_TOKEN` env | `WoClaw2026` | Bearer token matching Hub's `WOCLAW_TOKEN`. |
| `WOCLAW_AGENT_ID` env | `opencode-<hostname>` | Stable agent id (so other agents see this OpenCode instance by name). |
| `WOCLAW_PROJECT_KEY` env | (none) | Default memory key on which this agent reads/writes project context. |
| `~/.config/opencode/plugins/woclaw.js` | (none) | Drop-in location for Option1 install. |
| `opencode.json` `plugins` array | `["opencode-woclaw"]` | Required entry for Option2 install. |

## Outputs the skill produces

- One HTTP call per tool invocation: `GET /memory/:key` / `PUT /memory/:key` / `GET /memory` / `DELETE /memory/:key` / `GET /topics` / `GET /health`.
- One Hub write on `session.compacted` (snapshot of session memory).
- One Hub read on `session.created` (auto-load `WOCLAW_PROJECT_KEY` if set).
- `WOCLAW_*` env injection into every shell command OpenCode runs.

## Verification

After install:

```bash
#1. Confirm Hub is up:
curl http://your-hub-host:8083/health
# Expect: {"status":"ok", ...}

#2. In OpenCode, run:
/woclaw_hub_status
# Expect: Hub reachable, agents/topic counts reported.

#3. Round-trip a memory key:
/woclaw_memory_write project-status "OpenCode ↔ WoClaw online"
/woclaw_memory_read project-status
# Expect: value echoes back; other agents (Claude Code / Gemini / Codex) reading
# the same key via `woclaw memory read project-status` see the same value.

#4. Trigger compaction and confirm the snapshot lands on Hub:
# - Run a long OpenCode session.
# - Trigger `/compact`.
# - Inspect Hub memory: `woclaw memory list | grep opencode-session`.
```

If `woclaw_hub_status` fails, check `WOCLAW_HUB_URL` / `WOCLAW_REST_URL` and that `curl http://<host>:8083/health` returns `{"status":"ok"}`.

## Failure modes

- **Hub unreachable**: `woclaw_hub_status` returns an error; all `woclaw_memory_*` tools5xx. Fix: start Hub or correct `WOCLAW_HUB_URL` / `WOCLAW_REST_URL`.
- **Token mismatch**: Hub returns401; writes silently fail. Fix: align `WOCLAW_TOKEN` with Hub's `WOCLAW_TOKEN` env.
- **Plugin not loaded**: OpenCode does not register `woclaw_*` tools. Fix: confirm `~/.config/opencode/plugins/woclaw.js` exists, or `opencode.json` has `["opencode-woclaw"]` and `npm install opencode-woclaw` ran cleanly.
- **Env not injected in shell**: shell commands in OpenCode don't see `WOCLAW_*`. Fix: confirm `shell.env` hook is firing (check OpenCode plugin logs); restart OpenCode after env var changes.
- **Agent id collision**: two OpenCode instances on the same machine get the same `WOCLAW_AGENT_ID`. Fix: set a unique `WOCLAW_AGENT_ID` per instance (e.g. `opencode-laptop`, `opencode-server`).

## Source

- Package: [`opencode-woclaw`](https://www.npmjs.com/package/opencode-woclaw) (v0.1.0)
- Repo: [`packages/opencode-woclaw-plugin/`](https://github.com/XingP14/woclaw/tree/master/packages/opencode-woclaw-plugin)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Companion skills: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Claude Code / Gemini / Codex), [`woclaw-vscode`](https://marketplace.visualstudio.com/items?itemName=XingP14.woclaw-vscode) (Hub status UI), [`woclaw-mcp`](https://github.com/XingP14/woclaw/tree/master/mcp-bridge) (MCP server)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Discover on: [LobeHub](https://lobehub.com/skills) · [ClawHub](https://clawhub.ai) · [SkillHub.club](https://skillhub.club) · [Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills) · [Agensi](https://www.agensi.io) · [Skills.sh](https://skills.sh) — 8-marketplace coverage (publish on 2: one free-browsing + one vetted-paid).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `packages/opencode-woclaw-plugin/*` into `<project>/.claude/skills/opencode-woclaw/` and Claude Code v2.1.157+ auto-loads the OpenCode plugin skill on startup with no marketplace step.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the OpenCode plugin filters `session.created` / `session.compacted` / `shell.env` payloads for AWS_/SECRET/SSH-KEY/DB-PASS without explicit `--allow-credential-forward`, audits every checkpoint to `~/.woclaw/audit.log` by default (`WOCLAW_AUDIT_LOG=1`), and runs behind Microsoft MXC OS-level sandbox on enterprise Windows deployments — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
