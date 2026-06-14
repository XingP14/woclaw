---
name: woclaw-codex
description: Install and manage WoClaw shared-memory hooks for OpenAI Codex CLI. Use when the user wants cross-session context between Codex CLI runs and a running WoClaw Hub, or wants to wire SessionStart/Stop/PreCompact Python hooks to a Hub REST API. Complements woclaw-hooks (which targets Claude Code / Gemini / OpenCode) with full Codex-specific PreCompact coverage. Claude Skill Creator 2.0 verifiable / A-B / auto-optimize compatible; 3 test cases under tests/test_codex_woclaw_skill.json.
compatible_with: [openai-codex-cli, codex, python-hooks, claude-managed-agents, aws-platform, mcp-tunnels, anthropic-agent-skills, lobehub-skills-marketplace, clawhub-skills, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, claude-skill-creator-v2, skill-creator-ab-compatible, skill-auto-optimize-trigger, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin]
skill_type: workflow-orchestration
folder_structure: true
---

# WoClaw Codex CLI Integration

`woclaw-codex` is the Codex CLI counterpart to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks). It connects OpenAI Codex CLI sessions to a running [WoClaw Hub](https://github.com/XingP14/woclaw) REST API so memory survives compaction, restarts, and IDE switches — with full `PreCompact` support that the Codex path of `woclaw-hooks` cannot enable.

## When to use this skill

Use this skill when:

- The user runs **OpenAI Codex CLI** and wants shared context across sessions.
- A WoClaw Hub is already running (or the user is willing to start one) at `http://<host>:8083` with a shared auth token.
- The user wants **all three** Codex lifecycle hooks wired automatically: `SessionStart` + `Stop` + **`PreCompact`** (full coverage).
- The user mentions `~/.codex/hooks.json`, `WOCLAW_HUB_URL`, `codex_hooks = true`, or wants Codex → Hub memory sync.
- The user is on Claude Code / Gemini / OpenCode AND wants the same behavior — point them to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Node-based, those frameworks).

**Do not use** when:

- The user only wants a *Claude Code Skills directory entry* with no install behavior. This skill IS the install — if they just want discoverability, point them to the README instead.
- The WoClaw Hub is not deployed and the user does not want to deploy it.
- **Claude Managed Agents users (AWS deploy)** — pair this Codex skill with `woclaw-hooks` and run both inside a self-hosted sandbox, pointing `WOCLAW_HUB_URL` at a Hub reachable through an MCP tunnel. Codex-specific PreCompact coverage (which `woclaw-hooks` cannot enable) then feeds Managed Agents a private Hub.
- The user wants a non-Codex framework — use `woclaw-hooks` instead.

## What this skill installs

Three Python lifecycle hooks, copied into `~/.codex/hooks/`:

| Hook script | Codex event | What it does |
|-------------|-------------|--------------|
| `session_start.py` | `SessionStart` | Reads `WOCLAW_KEY` (default `codex:context`) from the Hub via REST and injects it as Codex `additionalContext` so the agent wakes up with prior context. |
| `stop.py` | `Stop` | Reads the Codex session transcript, summarizes it, and writes the summary back to the Hub under `WOCLAW_KEY` so the next session inherits it. |
| `precompact.py` | `PreCompact` | Snapshots current context (plus optional `CODEX_CONTEXT_FILE`) to the Hub under `WOCLAW_PROJECT_KEY` *before* Codex compresses, so nothing is lost across compaction. |

Plus a generated `~/.codex/hooks.json` registering all three events to the corresponding scripts, and a one-line edit adding `codex_hooks = true` to `~/.codex/config.toml`.

## Install

```bash
#1. (Optional) Install Python deps for async + websocket hooks
pip install aiohttp websockets

#2. Install the package globally (pulls the Python hooks)
npm install -g woclaw-codex

#3. Run the installer (interactive)
python3 $(npm root -g)/woclaw-codex/install.py
# Or non-interactive after `cd packages/codex-woclaw && python3 install.py`

#4. Configure environment
echo 'WOCLAW_HUB_URL=http://localhost:8083' >> ~/.woclaw/.env
echo 'WOCLAW_TOKEN=WoClaw2026' >> ~/.woclaw/.env
echo 'WOCLAW_KEY=codex:context' >> ~/.woclaw/.env
echo 'WOCLAW_PROJECT_KEY=project:context' >> ~/.woclaw/.env

#5. Verify
ls ~/.codex/hooks/    # expect: session_start.py, stop.py, precompact.py
cat ~/.codex/hooks.json
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `WOCLAW_HUB_URL` env | `http://your-hub-host:8083` | Hub REST API base URL. |
| `WOCLAW_TOKEN` env | `WoClaw2026` | Bearer token; must match Hub's `WOCLAW_TOKEN`. |
| `WOCLAW_KEY` env | `codex:context` | Memory key SessionStart reads / Stop writes. |
| `WOCLAW_PROJECT_KEY` env | `project:context` | Memory key PreCompact checkpoints to. |
| `CODEX_CONTEXT_FILE` env | _(unset)_ | Optional file the PreCompact hook reads and uploads. |

## Outputs the skill produces

- Three Python hook scripts copied to `~/.codex/hooks/`.
- A `~/.codex/hooks.json` registering `SessionStart` + `Stop` + `PreCompact` to the scripts.
- A `codex_hooks = true` line added to `~/.codex/config.toml` (created if missing).
- One HTTP `GET /memory/{key}` on every `SessionStart` and one HTTP `PUT /memory/{key}` on every `Stop` (and one `PUT` on `PreCompact`).

## Verification

After install:

```bash
# 1. Hooks present
ls -la ~/.codex/hooks/
cat ~/.codex/hooks.json
grep codex_hooks ~/.codex/config.toml   # expect: codex_hooks = true

# 2. Hub reachable
curl http://<host>:8083/health           # expect: {"status":"ok",...}

# 3. End-to-end smoke test
#   a. Start a Codex session, confirm Hub context appears in the first prompt
#      (look for `additionalContext` from WoClaw).
#   b. End the session, confirm the summary lands at
#      GET http://<host>:8083/memory/codex:context.
```

If the Hub is unreachable, the hooks still run but log a warning to `~/.woclaw/codex-hooks.log`.

## Failure modes

- **Hub unreachable**: hooks degrade gracefully and log to `~/.woclaw/codex-hooks.log`. Codex still runs but starts with no shared context. Fix: restart Hub or correct `WOCLAW_HUB_URL`.
- **Token mismatch**: Hub returns 401; hooks write the failure to the same log. Fix: align `WOCLAW_TOKEN` in `~/.woclaw/.env` with the Hub's `WOCLAW_TOKEN` env.
- **Missing `aiohttp` / `websockets`**: installer warns but does not fail (stdlib `urllib` covers REST). Install with `pip install aiohttp websockets` if you also use the websocket transport.
- **`codex_hooks` not enabled in config.toml**: hooks will be installed but never fire. Re-run `python3 install.py` to repair.

## Source

- Package: [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) (v0.1.2)
- Repo: [`packages/codex-woclaw/`](https://github.com/XingP14/woclaw/tree/master/packages/codex-woclaw)
- Sibling: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Claude Code / Gemini / OpenCode)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Discover on: [LobeHub](https://lobehub.com/skills) · [ClawHub](https://clawhub.ai) · [SkillHub.club](https://skillhub.club) · [Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills) · [Agensi](https://www.agensi.io) · [Skills.sh](https://skills.sh) — 8-marketplace coverage (publish on 2: one free-browsing + one vetted-paid).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `packages/codex-woclaw/*` into `<project>/.claude/skills/woclaw-codex/` and Claude Code v2.1.157+ auto-loads the Codex-CLI bridge skill on startup with no marketplace step.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the Codex-CLI bridge filters payloads matching AWS_/SECRET/SSH-KEY/DB-PASS without explicit `--allow-credential-forward`, logs every CLI invocation to `~/.woclaw/audit.log` by default (`WOCLAW_AUDIT_LOG=1`), and combined with Microsoft MXC OS-level sandbox forms a three-layer trust stack for enterprise Codex deployments — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
- **Skill Creator 2.0 verifiable (2026-05-17, 评测/A-B/auto-optimize)** — Anthropic Skill Creator 2.0 (https://www.cnblogs.com/lsgxeva/p/20065996 + https://blog.csdn.net/lsgxeva/article/details/158500000) introduces three capabilities: (a) 评测 — Claude auto-generates test inputs and runs them with/without the skill to quantify pass-rate / failures / deltas; (b) A/B benchmarking — double-blind side-by-side evaluation under Skill-loaded vs Skill-unloaded conditions; (c) auto-optimize trigger — re-runs the eval suite when the underlying model changes. The Codex-CLI bridge ships with a verifiable test fixture (`tests/test_codex_woclaw_skill.json`, 3 test cases: Python `install.py` end-to-end smoke / `session_start.py` POST `/memory` round-trip / `precompact.py` checkpoint write before Hub compress) so Skill Creator 2.0 can generate A/B baselines and auto-regress on upgrade — `claude skill eval woclaw-codex --tests tests/test_codex_woclaw_skill.json --ab [--auto-optimize]`.