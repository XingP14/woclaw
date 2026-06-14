---
name: woclaw-vscode
description: View and manage a running WoClaw Hub directly from VS Code — status bar indicator, topic/agent/memory browser, and quick memory peek. Use when the user wants to see whether a WoClaw Hub is alive, browse shared topics, list connected agents, or inspect a `project:context` memory key without leaving the editor.
compatible_with: [vscode, vs-code-marketplace, claude-code, claude-managed-agents, anthropic-agent-skills, lobehub-skills-marketplace, clawhub-skills, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin]
skill_type: code-templates
folder_structure: true
---

# WoClaw VS Code Extension

`woclaw-vscode` is a VS Code extension that surfaces a running [WoClaw Hub](https://github.com/XingP14/woclaw) inside the editor. It shows live Hub health in the status bar, exposes a sidebar tree of topics/agents/memory entries, and lets you peek at any `project:context` key with one click.

## When to use this skill

Use this skill when:

- A WoClaw Hub is already running (or the user is willing to start one) at `http://<host>:8083` with a shared auth token.
- The user wants a visual overview of Hub state (status, topics, agents, memory) inside VS Code.
- The user wants to verify that coding-agent sessions (Claude Code, Gemini CLI, OpenCode, Codex) are correctly posting to the Hub.
- The user mentions `woclaw.hubUrl`, `WOCLAW_HUB_URL`, or asks "is my Hub up?" / "what topics do I have?".

**Do not use** when:

- The user wants to **install** WoClaw hooks for Claude Code / Gemini / OpenCode / Codex — use the [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) skill instead (this extension only **reads** Hub state, it does not write hooks).
- The user wants **shared-memory lifecycle hooks** (SessionStart/SessionStop/PreCompact) wired into a CLI — use [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks).
- The user wants **OpenAI Codex CLI** with PreCompact + config.toml auto-enable — use [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex).
- **Claude Managed Agents users** — install this extension inside a VS Code window running inside a self-hosted sandbox and point it at a Hub reachable through an MCP tunnel so Managed Agents can peek Hub state from the editor.
- The user is on Cursor / Windsurf / Copilot — this extension is published for VS Code Marketplace only; the Hub REST API is the same, so a generic REST client works.

## What this skill installs

- A VS Code extension with:
  - A **status bar item** showing Hub health: 🟢 `WoClaw: up (N agents, M topics)` / 🔴 `WoClaw: down`.
  - A **sidebar tree view** under the "WoClaw" container with three sections:
    - **Topics** — name, message count, agent count.
    - **Agents** — id, connected-at, last-seen, topics joined.
    - **Memory** — key, tags, last-updated.
  - A **command palette** entry `WoClaw: Peek Memory Key` that opens any memory entry in a read-only editor.
  - Configurable poll interval (default 30s) and Hub URL (default `http://localhost:8083`).

## Install

```bash
#1. Install from VS Code Marketplace (search "WoClaw") OR from the .vsix:
code --install-extension woclaw-vscode-0.1.0.vsix

#2. Set the Hub URL (if not running on localhost)
#    VS Code Settings → search "woclaw" → set `Woclaw: Hub Url`

#3. (Optional) Disable the status bar or change poll interval
#    `woclaw.statusBar: false`
#    `woclaw.pollInterval: 60`

#4. Reload VS Code; the status bar should turn green if Hub is reachable.
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `woclaw.hubUrl` setting | `http://localhost:8083` | Hub REST API base URL. Must match the running Hub. |
| `woclaw.statusBar` setting | `true` | Whether to show the status bar item. |
| `woclaw.pollInterval` setting | `30` | Seconds between Hub polls. |
| Hub bearer token | (none) | If Hub has `WOCLAW_TOKEN` set, the extension reads `WOCLAW_TOKEN` from the user's shell env or `~/.woclaw/.env` automatically. |

## Outputs the skill produces

- One HTTP `GET /health` every `woclaw.pollInterval` seconds.
- One HTTP `GET /topics`, `GET /agents`, `GET /memory` on tree refresh (manual or auto every interval).
- One read-only editor tab when `WoClaw: Peek Memory Key` is invoked (no writes).

## Verification

After install:

```bash
#1. Confirm Hub is up:
curl http://localhost:8083/health
# Expect: {"status":"ok", ...}

#2. Open VS Code → status bar bottom-right should show:
#    🟢 WoClaw: up (0 agents, 0 topics)

#3. Open the "WoClaw" sidebar → refresh button (or wait one poll cycle) → topics/agents/memory should appear.

#4. Run command palette: `WoClaw: Peek Memory Key` → enter `project:context` → read-only preview opens.
```

If status bar is red, check `woclaw.hubUrl` and that `curl http://<host>:8083/health` returns `{"status":"ok"}`.

## Failure modes

- **Hub unreachable**: status bar shows 🔴 `WoClaw: down` and the sidebar tree shows an error placeholder. Fix: start Hub or correct `woclaw.hubUrl`.
- **Hub token mismatch**: Hub returns 401; tree view shows "auth error" tooltip. Fix: align `WOCLAW_TOKEN` in the user shell env / `~/.woclaw/.env` with the Hub's `WOCLAW_TOKEN` env.
- **Hub at non-default port**: change `woclaw.hubUrl` to `http://<host>:<port>`. The extension does not auto-discover ports.
- **VS Code version too old**: requires VS Code ≥ 1.75 (engines.vscode). Older versions cannot install.

## Source

- Package: [`woclaw-vscode`](https://marketplace.visualstudio.com/items?itemName=XingP14.woclaw-vscode) (v0.1.0)
- Repo: [`packages/woclaw-vscode/`](https://github.com/XingP14/woclaw/tree/master/packages/woclaw-vscode)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Companion skills: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (install hooks), [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) (OpenAI Codex CLI)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Discover on: [LobeHub](https://lobehub.com/skills) · [ClawHub](https://clawhub.ai) · [SkillHub.club](https://skillhub.club) · [Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills) · [Agensi](https://www.agensi.io) · [Skills.sh](https://skills.sh) — 8-marketplace coverage (publish on 2: one free-browsing + one vetted-paid).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `packages/woclaw-vscode/*` into `<project>/.claude/skills/woclaw-vscode/` and Claude Code v2.1.157+ auto-loads the VS Code status-bar UI skill on startup with no marketplace step.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the VS Code status-bar UI refuses to render "forward credentials to …" prompts and the underlying `woclaw` channel filters payloads matching AWS_/SECRET/SSH-KEY/DB-PASS without `--allow-credential-forward`; `WOCLAW_AUDIT_LOG=1` is on by default so enterprise security teams can audit what was sent — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.