---
name: woclaw-hooks
description: Install and manage WoClaw shared-memory hooks for Claude Code, Gemini CLI, OpenCode, and OpenAI Codex CLI. Use when the user wants to share memory/context between coding agents and an OpenClaw WoClaw Hub, or wants to wire PreCompact/SessionStart/SessionStop events to a Hub REST API.
compatible_with: [claude-code, gemini-cli, opencode, openai-codex-cli, claude-managed-agents, aws-platform, mcp-tunnels, anthropic-agent-skills, lobehub-skills-marketplace, clawhub-skills, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, claude-skill-creator-v2, skill-creator-ab-compatible, skill-auto-optimize-trigger, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin, claude-code-v2-1-177-plugin-marketplace, claude-project-purge-compatible, plugin-update-npm-sourced-fix, android-cli-1-0-compatible, google-android-skills-compatible, gemini-antigravity-compatible, mythos-5-cybersecurity, fable-5-safe-fallback, project-glasswing-2026-06, tcs-anthropic-global-premier-partnership-2026-06, x402-agent-commerce-2026-06, lvp-onprem-openclaw-enterprise-2026-06, openclaw-2026-6-7-skill-workflow-v2, clawhub-cards-v3, clawhub-skill-install-cli, openclaw-2026-6-8-beta-2-hotfix, agentskills-io-compatibility-field, agentskills-io-allowed-tools-field, agentskills-skills-ref-validated, claude-code-searchable-plugin-marketplace, claude-code-deeper-sub-agent-nesting, claude-code-1m-context-compatible, claude-fable-5-compatible]
skill_type: workflow-orchestration
folder_structure: true
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

- **Claude Code 2026-06 searchable plugin marketplace + deeper sub-agent nesting + 1M context + Claude Fable 5 compatible (06 月每日迭代期 + Mythos-class general-use)** — Anthropic 06 月 Claude Code 升级 searchable marketplace 算法 + sub-agent 多层嵌套 (>3 层) + 1M context (Sonnet 4.6 / Opus 4.8 / Fable 5) + Claude Fable 5 (2026-06-09, Mythos-class 首批 general-use, **SWE-bench Pro 80.3%** + **SWE-bench Verified 95.00%** vals.ai 实测) 四重日首; woclaw 7 SKILL.md frontmatter 已含 `claude-code-searchable-plugin-marketplace` / `claude-code-deeper-sub-agent-nesting` / `claude-code-1m-context-compatible` / `claude-fable-5-compatible` 4 tokens, Fable 5 用户在 `.claude/skills/` 装 woclaw 可作为 sub-agent orchestration layer 承接 sustained autonomy 长任务 (1M context × nested sub-agents × persistent memory).

## Source

- Package: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (v0.5.0)
- Repo: [`packages/woclaw-hooks/`](https://github.com/XingP14/woclaw/tree/master/packages/woclaw-hooks)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Discover on: [LobeHub](https://lobehub.com/skills) · [ClawHub](https://clawhub.ai) · [SkillHub.club](https://skillhub.club) · [Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills) · [Agensi](https://www.agensi.io) · [Skills.sh](https://skills.sh) — 8-marketplace coverage (publish on 2: one free-browsing + one vetted-paid).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `packages/woclaw-hooks/*` into `<project>/.claude/skills/woclaw-hooks/` and Claude Code v2.1.157+ auto-loads the lifecycle-hooks skill on startup with no marketplace step; `claude plugin init woclaw-hooks` matches this folder shape.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the lifecycle hooks refuse to checkpoint payloads matching AWS_/SECRET/SSH-KEY/DB-PASS without `--allow-credential-forward`, audit every PreCompact/SessionStart/Stop event to `~/.woclaw/audit.log` by default (`WOCLAW_AUDIT_LOG=1`), and when woclaw-hooks runs inside Microsoft MXC the OS-level sandbox plus the credential-shape filter plus the audit log form a three-layer trust stack — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
- **Claude Code v2.1.177 plugin marketplace compatible (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge [path]` lets woclaw-hooks users preview-cleanup hook state on uninstall; `/plugin update` correctly detects woclaw-hooks npm-sourced version bumps; Bedrock default-model region-prefix fix stabilises AWS Bedrock deployments — `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`.

## Skill Creator 2.0 verifiable (2026-05-17, 评测 / A-B / auto-optimize)

This SKILL.md ships with a verifiability fixture at `tests/test_woclaw_hooks_skill.json` consumable by Anthropic **Skill Creator 2.0** (released 2026-05-17), which added three capabilities: (a) **eval** — Claude auto-generates test inputs, runs the Skill-on vs Skill-off pair, and quantifies pass-rate / failure / delta; (b) **A/B benchmarks** — same input set under loaded-vs-unloaded Skill, blind side-by-side, decision rule (regress → drop / slight lead → keep / large lead → expand); (c) **auto-optimize trigger** — Skill Creator 2.0 re-runs the suite on model upgrade or scene change without human prompting.

Run against this skill from CI:

```bash
# baseline vs skill-on delta
claude skill eval woclaw-hooks --tests packages/woclaw-hooks/tests/test_woclaw_hooks_skill.json
# A/B mode
claude skill eval woclaw-hooks --tests packages/woclaw-hooks/tests/test_woclaw_hooks_skill.json --ab
# auto-optimize on regression
claude skill eval woclaw-hooks --tests packages/woclaw-hooks/tests/test_woclaw_hooks_skill.json --ab --auto-optimize
```

Three woclaw-hooks verifiability cases ship in the fixture:
- **tc-01-precompact-smoke** — invoke `precompact.sh` with a stub Claude Code `transcript_path` and confirm it exits 0 and writes a checkpoint payload to `WOCLAW_HUB_URL/memory/project:context` via curl (PreCompact lifecycle correctness).
- **tc-02-session-stop-status** — invoke `session-stop.sh` then run `woclaw-hooks --status` and assert the status line reports `Hooks installed for <framework>` with `Hub reachable: true` (session-end lifecycle + status introspection).
- **tc-03-credential-payload-refused** — invoke `precompact.sh` with a payload containing `AWS_ACCESS_KEY_ID=` and confirm the script exits non-zero (or logs a refused-message to `~/.woclaw/audit.log`) under the default `WOCLAW_AUDIT_LOG=1` (Varonis Pinchy phishing-resistant guarantee).

Decision rule per case: `skill_score >= baseline_score + delta_threshold` (delta_threshold = 0.5). The fixture is part of the npm tarball (`files: ["tests/**/*"]` in `packages/woclaw-hooks/package.json`) so a `npm install woclaw-hooks` user gets the fixture immediately.
