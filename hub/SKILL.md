---
name: woclaw-hub
description: Self-hosted multi-agent hub for OpenClaw, Claude Code, Gemini CLI, OpenCode, and Codex CLI — provides a shared memory and topic-bus layer over WebSocket + REST, backed by SQLite or MySQL. Compatible with the SKILL.md open format and discoverable on LobeHub, ClawHub, SkillHub, Anthropic Agent Skills, Vercel (vercel-labs/skills), Agensi, and Skills.sh. Use when the user wants to run their own agent relay (Docker, systemd, or `npm`), wire agents to it via `WOCLAW_HUB_URL`, persist `/health` / `/agents` / `/topics` state across agent sessions, or coordinate many agents through a single WebSocket bus.
compatible_with: [claude-code, claude-managed-agents, anthropic-agent-skills, aws-platform, mcp-tunnels, self-hosted-sandboxes, microsoft-scout, openclaw-runtime, lobehub-skills-marketplace, clawhub-skills, skillhub-club, vercel-skills, agensi, skills-sh, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, openclaw-2026-6-5, anthropic-recursive-self-improvement, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, claude-skill-creator-v2, skill-creator-ab-compatible, skill-auto-optimize-trigger, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin, openclaw-2026-6-1, clawhub-cards-v2, copilot-claude-1m, claude-code-v2-1-177-plugin-marketplace, claude-project-purge-compatible, plugin-update-npm-sourced-fix, android-cli-1-0-compatible, google-android-skills-compatible, gemini-antigravity-compatible, mythos-5-cybersecurity, fable-5-safe-fallback, project-glasswing-2026-06, tcs-anthropic-global-premier-partnership-2026-06, x402-agent-commerce-2026-06, lvp-onprem-openclaw-enterprise-2026-06, openclaw-2026-6-7-skill-workflow-v2, clawhub-cards-v3, clawhub-skill-install-cli]
skill_type: workflow-orchestration
folder_structure: true
---

# WoClaw Hub

`woclaw-hub` is the long-lived relay at the heart of the WoClaw ecosystem. It exposes a WebSocket endpoint (`PORT=8082`) for agent connections and a REST API (`REST_PORT=8083`) for hooks, monitoring, and HTTP integrations. Agents publish to **topics** and read/write **memory** entries through it; everything is persisted to SQLite (default) or MySQL so memory survives restarts.

## Discover on (skills marketplaces)

This `SKILL.md` ships with open-format frontmatter so the hub is indexable by every major agent-skills aggregator. Pick whichever registry the user is already browsing:

- **LobeHub Skills Marketplace** — https://lobehub.com/skills — open-format skills catalog (Claude Code / Codex CLI / ChatGPT). Listed via frontmatter `name` + `description` keywords.
- **ClawHub** — https://clawhub.ai — agent skills registry, security-purged (13,729 → 3,286 skills, May 2026). Install: `npx clawhub install XingP14/woclaw --skill woclaw-hub`.
- **SkillHub.club** — community-driven skills directory. Install: `npx skillhub add XingP14/woclaw --skill woclaw-hub`.
- **Anthropic Agent Skills (Claude Code)** — Claude Code 4 + Anthropic Agent SDK dynamically discover this package via its `SKILL.md` frontmatter. Install: `npx skills add XingP14/woclaw --skill woclaw-hub`.
- **Vercel (vercel-labs/skills)** — https://github.com/vercel-labs/skills — "npm for agent skills" distribution leader. Install: `npx skills add XingP14/woclaw --skill woclaw-hub --registry vercel`.
- **Agensi** — https://www.agensi.io — curated catalog with 8-point security scan + 80/20 creator payments + one-time-purchase model. Install: `curl -fsSL https://agensi.io/install | woclaw --skill woclaw-hub`.
- **Skills.sh** — https://skills.sh — one of the largest open agent-skills catalogs. Install: `npx skills.sh install XingP14/woclaw --skill woclaw-hub`.

The 2026-Q2 community-recommended pattern is to publish on **2 marketplaces** — one **free-browsing** (LobeHub / Skills.sh / SkillHub.club) plus one **vetted-paid** (Agensi) — to capture both discovery and monetization traffic.

## Skill Creator 2.0 verifiable (2026-05-17, 评测/A-B/auto-optimize)

Anthropic updated [Skill Creator 2.0](https://www.cnblogs.com/lsgxeva/p/20065996) on 2026-05-17 with three new capabilities that change Skill from "write-and-publish" to "evaluate-driven iteration":

- **评测功能 (Eval)** — Claude auto-generates test inputs, runs the same input with the Skill enabled vs. disabled, and quantifies pass-rate / failure cases / concrete deltas — closing the "run eval → analyze failure → targeted fix → re-eval" loop.
- **A/B 基准测试** — The same input set is run side-by-side under "Skill loaded" vs. "Skill not loaded" to remove preference bias. Decision rule: Skill underperforms → delete; slightly ahead → keep; significantly ahead → continue. CI-friendly.
- **自动优化触发** — On model update or scenario change, Skill Creator auto-triggers re-eval (no manual kick-off).

The woclaw-hub ships **verifiability metadata** so Skill Creator 2.0 can auto-generate tests against it: a test fixture lives at `hub/tests/test_hub_skill.json` with 3 test cases covering (1) hub `/health` smoke (expected: 200 + `{"status":"ok",...}`), (2) WebSocket `welcome` frame round-trip with valid `agentId`+`token` (expected: server emits `welcome` then registers in `/agents` list), and (3) `POST /memory` + `GET /memory/<key>` round-trip with bearer token (expected: written value matches read value, 200 OK). Each case carries `expected_outputs` + `baseline_score` (no-skill) + `skill_score_target` (skill-on) so Skill Creator 2.0 can compute the delta.

**Eval recipe (Anthropic Skill Creator 2.0):**

```bash
# Single eval (one-shot, no A/B)
claude skill eval woclaw-hub --tests hub/tests/test_hub_skill.json

# A/B mode (Skill-on vs Skill-off, decision rule above)
claude skill eval woclaw-hub --tests hub/tests/test_hub_skill.json --ab

# Auto-optimize trigger (run on every hub version bump)
claude skill eval woclaw-hub --tests hub/tests/test_hub_skill.json --ab --auto-optimize
```

The three new frontmatter flags — `claude-skill-creator-v2` / `skill-creator-ab-compatible` / `skill-auto-optimize-trigger` — let the Skill Creator 2.0 loader match woclaw-hub against its evaluator registry and run the fixture without manual scaffolding. Anthropic's internal Skill team (and the Anthropic Agent Skills catalog) can now drop the hub into their CI eval pipeline and get a per-version score automatically. Same pattern applies to all 7 subpackages — each carries its own `tests/test_<subpackage>_skill.json` fixture.

## When to use this skill

Use this skill when:

- The user wants to self-host a WoClaw Hub on their own VPS / homelab / Docker host.
- The user is wiring Claude Code / Gemini CLI / OpenCode / Codex CLI agents (via `woclaw-hooks` / `woclaw-codex` / `opencode-woclaw-plugin`) and needs the backend running first.
- The user asks about `WOCLAW_HUB_URL`, `AUTH_TOKEN`, `/health`, `/agents`, `/topics`, federation, or cron-style auto-extraction.
- The user wants to migrate from in-agent memory to a shared, multi-agent bus.
- The user needs SQLite → MySQL failover or persistent storage for compliance/auditing.

**Do not use** when:

- The user only wants a client-side install of agent hooks — point them to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) or [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) instead.
- The user is using a hosted third-party relay — this skill is about deploying **your own** hub.
- **Claude Managed Agents / Claude Platform on AWS users** — deploy `woclaw-hub` inside a self-hosted sandbox (Docker or systemd), expose it through an MCP tunnel, and let Managed Agents reach the Hub REST/WS endpoint with a stable private URL. Compatible with dreaming / multiagent orchestration / outcomes / webhooks workflows (Code with Claude 2026).
- The user wants a Claude Code Skills directory entry with no deploy behavior. This skill IS the deploy guide — for pure discoverability see the README.

## What this skill installs

When you deploy `woclaw-hub`, you get:

| Component | Default | Purpose |
|-----------|---------|---------|
| WebSocket server | `ws://0.0.0.0:8082` | Agent ↔ Hub real-time bus (connect with `?agentId=<id>&token=<token>`) |
| REST API | `http://0.0.0.0:8083` | Hooks, monitoring, CRUD on memory/topics/agents |
| SQLite DB | `/data/woclaw.sqlite` | Default persistence (override with `DB_TYPE=mysql`) |
| Cron scheduler | built-in | Periodic auto-extraction of context from sessions |
| Federation endpoint | REST `/federation/*` | Cross-hub memory replication (optional) |
| Health probe | `GET /health` | Returns `{ status, uptime, agents, topics }` for uptime monitors |

## Install

### Option A — Docker (recommended for production)

```bash
docker pull xingp14/woclaw-hub:latest

docker run -d \
  --name woclaw-hub \
  --restart unless-stopped \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /opt/woclaw/data:/data \
  -e AUTH_TOKEN="$(openssl rand -hex 32)" \
  xingp14/woclaw-hub:latest
```

### Option B — From source (Node ≥18)

```bash
cd hub
npm install
npm run build
AUTH_TOKEN="$(openssl rand -hex 32)" npm start
```

### Option C — systemd unit

A sample `woclaw-hub.service` ships in `hub/`. Copy it to `/etc/systemd/system/`, edit `Environment=AUTH_TOKEN=...`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now woclaw-hub
sudo systemctl status woclaw-hub
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `AUTH_TOKEN` | yes | Shared secret agents present as `?token=` (WS) or `Authorization: Bearer` (REST). Use `openssl rand -hex 32`. |
| `PORT` | no | WebSocket port (default `8082`) |
| `REST_PORT` | no | REST port (default `8083`) |
| `HOST` | no | Bind address (default `0.0.0.0`) |
| `DATA_DIR` | no | Base data dir for SQLite (default `/data`) |
| `DB_TYPE` | no | `sqlite` (default) or `mysql` |
| `MYSQL_*` | conditional | `MYSQL_HOST` / `PORT` / `USER` / `PASSWORD` / `DATABASE` when `DB_TYPE=mysql` |
| `CONFIG_FILE` | no | Path to a JSON config overriding env vars |

## Outputs

- Persistent SQLite file at `$DATA_DIR/woclaw.sqlite` (or remote MySQL DB).
- Logs to stdout in JSON-ish key=value format — pipe to `journalctl` (systemd) or `docker logs woclaw-hub`.
- Health endpoint: `curl http://localhost:8083/health` → `{"status":"ok","uptime":...,"agents":N,"topics":M}`.

## Verification

After deploy, run this 3-step smoke test:

```bash
# 1. Health
curl -fsS http://localhost:8083/health
# expect: {"status":"ok",...}

# 2. WS connect (using `wscat` or any WS client)
wscat -c "ws://localhost:8082?agentId=smoke&token=$AUTH_TOKEN"
# expect: server emits a `welcome` frame

# 3. Write + read memory round-trip
curl -fsS -X POST http://localhost:8083/memory \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"smoke","value":"hello","agentId":"smoke"}'
curl -fsS "http://localhost:8083/memory/smoke" \
  -H "Authorization: Bearer $AUTH_TOKEN"
# expect: {"key":"smoke","value":"hello",...}
```

## Failure-modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `ECONNREFUSED` on 8082/8083 | Hub not running, or `HOST` bound to wrong iface | `docker logs woclaw-hub` or `systemctl status woclaw-hub` |
| `401 Unauthorized` from REST | Wrong / missing `AUTH_TOKEN` | Ensure client and hub share the same token |
| WS connects then immediately closes | `agentId` missing or token mismatch in query string | Reconnect with `?agentId=<id>&token=<token>` |
| `SQLITE_CANTOPEN` | `DATA_DIR` not writable by container | `chown -R 1000:1000 /opt/woclaw/data` and re-run |
| `agents` count stuck at 0 in `/health` | Clients connect but don't heartbeat | Check client lifecycle — most agents heartbeat every 30s |
| MySQL "access denied" | `MYSQL_PASSWORD` not URL-safe or wrong user | Re-issue creds, prefer `MYSQL_PASSWORD_FILE` (docker secret) |
| Federation replication stalls | Clock skew between hubs > 60s | Run `chrony` / `ntpdate` on both hosts |

## OpenClaw v2026.6.1 compatible (2026-06-01, ClawHub cards v2 + 1M context routing)

OpenClaw [v2026.6.1](https://github.com/openclaw/openclaw/releases/tag/v2026.6.1) shipped on 2026-06-01 with two changes that directly affect how `woclaw-hub` is discoverable and routable:

- **ClawHub cards v2** (`showcase cards` PR #88734) — Skill entries were reshaped to a reusable template carrying `name` / `description` / `When-to-use` / `version` / `install_command` fields. The woclaw-hub `SKILL.md` frontmatter is already aligned: `name=woclaw-hub`, `description` enumerates the OpenClaw / Claude Code / Gemini / OpenCode / Codex CLI compatibility, the body carries a `## When to use this skill` section, the matching `woclaw-hub` package version is published on npm + Docker Hub, and the `Install` section documents `docker run` / `npm i -g woclaw-hub` / `npx skills add XingP14/woclaw --skill woclaw-hub` — i.e. the v2 card schema parses without modification.
- **Copilot Claude 1M capabilities** — long-context agents can now push 1M+ token windows through a single topic. The hub already supports this via `POST /topics/:topic/message` (no cap on payload size beyond SQLite/MySQL row limits) and the `memory` store treats `body` as opaque text up to 1M tokens (the woclaw hub uses SQLite TEXT or MySQL MEDIUMTEXT/LONGTEXT columns; for a 1M-token payload ~4 MB of UTF-8 text, MySQL `LONGTEXT` is the safe choice — see `hub/src/memory.ts`). The hub therefore acts as the **1M-context relay** when a Copilot Claude or Mythos-5 1M agent joins a topic lane and other agents need to consume the same body via WS subscription.

The three new frontmatter flags — `openclaw-2026-6-1` / `clawhub-cards-v2` / `copilot-claude-1m` — let the v2026.6.1 ClawHub crawler match the hub against the v2 card registry and let Mythos / Copilot Claude 1M agent runtimes route their long-context publishes through the hub without manual config. See `## Compatible with` below for the full list.

## Compatible with

In addition to Claude Code / Codex CLI / ChatGPT skills marketplaces above, this hub is compatible with:

- **OpenClaw 2026.6.5** — built-in parallel web search lanes map 1-to-1 to hub `topic` lanes (one topic = one parallel search subagent). See `## 🐝 Swarm orchestration` above.
- **Anthropic recursive self-improvement (2026-06)** — `memory pool` serves as the cross-run checkpoint for Claude agents that propose hypotheses → test → share findings with parallel agents → iterate (76% open-ended task success in June 2026, +50pp in 6 months).
- **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `hub/*` into `<project>/.claude/skills/woclaw-hub/` and Claude Code v2.1.157+ auto-loads the hub skill on startup with no `/plugin marketplace add` step; the `claude plugin init <name>` scaffold matches woclaw's folder shape, so woclaw-hub is a reference deployable.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the woclaw-hub refuses to relay payloads that match AWS_/SECRET/SSH-KEY/DB-PASS patterns without `--allow-credential-forward`, audits every send/write to `~/.woclaw/audit.log` by default (`WOCLAW_AUDIT_LOG=1`), and runs behind Microsoft MXC OS-level sandbox on Scout / Windows app deployments — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.
- **Claude Code v2.1.177 plugin marketplace compatible (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge [path]` lets users preview-cleanup woclaw-hub state (Hub `~/.woclaw/audit.log` + topic history + memory pool) when uninstalling; `/plugin update` correctly detects woclaw-hub npm-sourced version bumps; Bedrock default-model region-prefix fix stabilises woclaw-hub AWS deployments — `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`.

## Source

- Repo: <https://github.com/XingP14/woclaw/tree/master/hub>
- npm: <https://www.npmjs.com/package/woclaw-hub>
- Docker: <https://hub.docker.com/r/xingp14/woclaw-hub>
- Related skills: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (client installer), [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) (Codex CLI), [`opencode-woclaw-plugin`](https://www.npmjs.com/package/opencode-woclaw-plugin) (OpenCode plugin)