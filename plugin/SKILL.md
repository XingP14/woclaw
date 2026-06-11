---
name: woclaw
description: Install the WoClaw OpenClaw channel plugin to bridge any OpenClaw runtime (including Microsoft Scout and the native OpenClaw app for Windows) with a WoClaw Hub — give OpenClaw a `woclaw` channel that publishes messages to WoClaw topics and reads/writes WoClaw shared memory. Compatible with Claude Code, Codex CLI, and ChatGPT via the SKILL.md open format; indexable by LobeHub Skills Marketplace, ClawHub, SkillHub.club, and the Anthropic Agent Skills catalog. Use when the user runs an OpenClaw agent/workspace (or Microsoft Scout on Windows) and wants topic-based multi-agent communication, shared project memory across distributed OpenClaw instances, or a CLI (`woclaw` bin) for one-shot send/read/peek operations against a Hub.
compatible_with: [openclaw, openclaw-runtime, microsoft-scout, microsoft-mxc, openshell-runtime, windows-execution-containers, claude-code, claude-managed-agents, aws-platform, mcp-tunnels, anthropic-agent-skills, self-hosted-sandboxes, lobehub-skills-marketplace, clawhub-skills, skillhub-club, open-format-skills, codex-cli, chatgpt-skills, vercel-skills, agensi, skills-sh]
---

# WoClaw OpenClaw Plugin

`woclaw` (npm: [`xingp14-woclaw`](https://www.npmjs.com/package/xingp14-woclaw) v0.4.3) is the [OpenClaw](https://github.com/openclaw) channel plugin that wires an OpenClaw runtime (including **Microsoft Scout** and the **native OpenClaw app for Windows**) to a running [WoClaw Hub](https://github.com/XingP14/woclaw). It registers a `woclaw` channel inside OpenClaw (id `woclaw`, label "WoClaw", blurb "Connect to WoClaw Hub for topic-based multi-agent communication.") so any OpenClaw workspace can publish to Hub topics and read/write shared-memory keys via the Hub REST + WebSocket APIs. It also ships a CLI binary (`woclaw`) for one-shot send/read/peek from any shell.

## Ecosystem (compatible platforms)

This skill ships as an OpenClaw channel plugin and is therefore automatically available on every OpenClaw-compatible runtime — including the high-profile ones from Microsoft and the OpenClaw foundation:

- **Microsoft Scout** — Microsoft's personal-assistant app, announced at Microsoft Build 2026 (June 2, 2026, [CNET keynote highlights](https://www.cnet.com/videos/microsoft-build-2026-keynote-highlights/), [TechCrunch](https://techcrunch.com/2026/06/02/microsoft-launches-scout-an-openclaw-inspired-personal-assistant/)). Scout is built on the OpenClaw framework, so once `xingp14-woclaw` is installed on the host, the `woclaw` channel becomes visible inside Scout's skill catalog — Microsoft has 1000+ internal employees (including Satya Nadella) using Scout, and the Scout skill marketplace will index any OpenClaw plugin that ships a `SKILL.md`.
- **Microsoft MXC (Execution Containers) + Nvidia OpenShell Runtime** — announced at Microsoft Build 2026 (June 4, 2026, [VentureBeat](https://venturebeat.com/security/microsoft-launches-mxc-an-os-level-sandbox-for-ai-agents-with-openai-and-nvidia-already-on-board), [Ground News summary](https://ground.news/article/microsoft-build-2026-windows-gets-built-in-ai-agent-sandboxing-with-mxc-openclaw-support-and-nvidia-openshell)). MXC is the first **OS-kernel-level sandbox layer** for AI agents on Windows, and Microsoft explicitly stated that **OpenClaw is supported** in MXC. The "composable sandbox spectrum" ranges from lightweight process isolation (already adopted by GitHub Copilot CLI) up through micro-VMs, Linux containers, and **Windows 365 cloud instances**. Nvidia's **OpenShell Runtime** is built on top of MXC and runs OpenClaw agents in sandboxed environments. When `xingp14-woclaw` runs inside a Scout / Windows app instance wrapped by MXC, the `woclaw` channel inherits the OS-enforced policy boundaries (file / network / process isolation) automatically — no extra configuration needed beyond declaring the channel in the OpenClaw runtime. Peter Steinberger (OpenClaw creator) confirmed Scout is "the OpenClaw gateway", making MXC + Scout the production deployment target for Windows users.
- **Native OpenClaw app for Windows** — pre-installed by Microsoft on Windows as part of the OpenClaw foundation's push to make agentic runtimes a first-class Windows citizen. `xingp14-woclaw` installs as a standard OpenClaw channel, so it works out-of-the-box on the native Windows app — no extra wrapper needed.
- **Anthropic Agent Skills** — Claude Code 4 (Apr 2026 redesign) + Anthropic Agent SDK dynamically discover this package via its `SKILL.md` frontmatter when installed through `npx skills add XingP14/woclaw --skill woclaw`, so the same skill is reachable from Claude Code / Cursor / OpenCode / Codex CLI side-by-side with OpenClaw / Scout users.

In short: install `xingp14-woclaw` once on any OpenClaw runtime and the `woclaw` channel (topics + shared memory + CLI) becomes a discoverable skill for both OpenClaw-native hosts (Scout, native Windows app) and Claude-Code-style hosts (via Anthropic Skills).

## Discover on (skills marketplaces)

This `SKILL.md` ships with open-format frontmatter so the package is indexable by every major agent-skills aggregator. Install with one command from the host that the user is already in:

- **LobeHub Skills Marketplace** — https://lobehub.com/skills — aggregates skills "compatible with Claude Code, Codex CLI, and ChatGPT, all in SKILL.md, the open format for AI coding assistants". Listed via frontmatter `name` + `description` keywords; searchable from a Claude Code / Codex CLI / ChatGPT host.
- **ClawHub** — https://clawhub.ai — agent skills registry with security-purge curation (13,729 → 3,286 skills after May 2026 purge, see [Medium roundup](https://medium.com/@tentenco/the-best-clawhub-skills-worth-installing-now-a-category-by-category-guide-5221c4850d21)). Install: `npx clawhub install XingP14/woclaw`.
- **SkillHub.club** — community-driven skills directory; install via `npx skillhub add XingP14/woclaw`.
- **Anthropic Agent Skills (Claude Code)** — Claude Code 4 (April 2026 redesign) and Anthropic Agent SDK dynamically discover this package via its `SKILL.md` frontmatter. Install: `npx skills add XingP14/woclaw --skill woclaw`.
- **Microsoft Scout** — Scout indexes any OpenClaw plugin that ships a `SKILL.md`. No additional command — Scout picks up the skill on host startup.
- **Native OpenClaw app for Windows** — pre-installed skill catalog; no extra command.
- **Vercel (vercel-labs/skills)** — https://github.com/vercel-labs/skills — Vercel's open registry positioning itself as "npm for agent skills" (distribution leader). Install: `npx skills add XingP14/woclaw --skill woclaw --registry vercel`.
- **Agensi** — https://www.agensi.io — curated skills catalog with 8-point security scan + 80/20 creator payments + one-time-purchase model. Install: `curl -fsSL https://agensi.io/install | woclaw --skill woclaw`.
- **Skills.sh** — https://skills.sh — one of the largest open catalogs of agent skills. Install: `npx skills.sh install XingP14/woclaw --skill woclaw`.

The same `xingp14-woclaw@0.4.3` package is therefore discoverable from Claude Code, Codex CLI, ChatGPT, Microsoft Scout, the native OpenClaw Windows app, and every Claude-Code-compatible skills aggregator (LobeHub / ClawHub / SkillHub.club / Anthropic catalog / Vercel / Agensi / Skills.sh) — install once, surface everywhere. The 2026-Q2 community-recommended pattern is to publish on **2 marketplaces** — one **free-browsing** (LobeHub / Skills.sh / SkillHub.club) plus one **vetted-paid** (Agensi) — to capture both discovery and monetization traffic.

## When to use this skill

Use this skill when:

- The user runs an OpenClaw workspace/agent and wants it to talk to a WoClaw Hub.
- A WoClaw Hub is already running (or the user is willing to start one) at `ws://<host>:8082` (WebSocket) + `http://<host>:8083` (REST) with a shared auth token.
- The user mentions `openclaw plugins install woclaw`, `WOCLAW_HUB_URL`, `WOCLAW_AGENT_ID`, or wants to coordinate several OpenClaw instances through a shared topic bus + memory pool.
- **Microsoft Scout user** — installs `xingp14-woclaw` once on the host and the `woclaw` channel shows up in Scout's skill catalog (Scout indexes any OpenClaw plugin that ships a `SKILL.md`).
- The user wants a CLI to send/read Hub memory from a non-OpenClaw shell (`woclaw send <topic> <msg>`, `woclaw memory read <key>`, `woclaw peek <key>`).

**Do not use** when:

- The user is on Claude Code / Gemini CLI / OpenCode / Codex CLI (no OpenClaw runtime) — recommend [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) for those shells (it auto-installs lifecycle hooks; the OpenClaw plugin only fires when OpenClaw itself is the host).
- The user wants to expose the Hub as MCP tools to Claude Desktop / Cursor — use [`woclaw-mcp`](https://www.npmjs.com/package/woclaw-mcp) instead (the plugin speaks the Hub WebSocket directly, not MCP).
- The user wants to deploy the Hub itself — use [`woclaw-hub`](https://www.npmjs.com/package/woclaw-hub) (Docker / systemd / `npm install -g woclaw-hub`) first; this plugin is a *client* that talks to a Hub.
- The user wants a VS Code sidebar / status-bar view of Hub state — use [`woclaw-vscode`](https://marketplace.visualstudio.com/items?itemName=XingP14.woclaw-vscode) instead.
- **Claude Managed Agents / Claude Platform on AWS users** — install `xingp14-woclaw` into a self-hosted sandbox running an OpenClaw runtime (or alongside Microsoft Scout on Windows), point `WOCLAW_HUB_URL` at a Hub reachable through an MCP tunnel, and the `woclaw` channel feeds Managed Agents a privately-hosted Hub. Compatible with dreaming / multiagent orchestration / outcomes workflows (Code with Claude 2026).

## What this skill installs

- An **OpenClaw channel plugin** (`dist/index.js`) that registers `channel.id = "woclaw"` inside the OpenClaw runtime. Once OpenClaw loads the plugin, all `woclaw send …`, `woclaw memory …`, `woclaw peek …` commands inside OpenClaw route through the Hub.
- A **CLI binary** (`woclaw`, from `bin/woclaw.js`) for one-shot send/read/peek from any shell — JSON output, `--hub`, `--rest-url`, `--agent-id`, `--token`, `--interactive` flags; command history at `~/.woclaw/cli-history`.
- A **migration tool** (`woclaw-cli`, from `bin/woclaw-cli.js`) that imports history into the Hub from OpenClaw workspace root docs (`MEMORY.md`, `SOUL.md`, `AGENTS.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `IDENTITY.md`) + content under `memory/`, `_tmp/`, `_archive/`, `ai_diary/`, `ai_tech/`, `docs/`.
- Default environment: `WOCLAW_HUB_URL=ws://localhost:8082`, `WOCLAW_REST_URL=http://localhost:8083`, `WOCLAW_TOKEN=WoClaw2026`, `WOCLAW_AGENT_ID=woclaw-cli-<random>`.

## Install

```bash
# 1. Install via OpenClaw's plugin manager (preferred)
openclaw plugins install woclaw

# Or install via npm (peer-deps requires openclaw >= 2026.1.0)
npm install -g xingp14-woclaw

# 2. Configure the Hub URL + token (if not on localhost with default token)
echo 'WOCLAW_HUB_URL=ws://localhost:8082'   >> ~/.woclaw/.env
echo 'WOCLAW_REST_URL=http://localhost:8083' >> ~/.woclaw/.env
echo 'WOCLAW_TOKEN=your-secure-token'        >> ~/.woclaw/.env
echo 'WOCLAW_AGENT_ID=openclaw-bot-1'        >> ~/.woclaw/.env

# 3. Restart OpenClaw so it picks up the channel plugin
openclaw restart

# 4. Verify
woclaw --hub=http://localhost:8083 --token=$WOCLAW_TOKEN ping
# Expect: {"ok":true,"agents":...,"topics":...}
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `WOCLAW_HUB_URL` env | `ws://localhost:8082` | Hub WebSocket URL. |
| `WOCLAW_REST_URL` env | `http://localhost:8083` | Hub REST API base URL. |
| `WOCLAW_TOKEN` env | `WoClaw2026` | Bearer token; must match Hub's `AUTH_TOKEN`. |
| `WOCLAW_AGENT_ID` env | `woclaw-cli-<random>` | Stable id for this OpenClaw instance — visible in `GET /agents`. |
| `WOCLAW_AUTO_JOIN` env | (none) | Comma-separated topic names to auto-subscribe on connect. |
| OpenClaw version | `>= 2026.1.0` | Peer-dependency; older runtimes will refuse to load the plugin. |

## Outputs the skill produces

- One **OpenClaw channel registration** at startup (`channel.id=woclaw`).
- One **WebSocket connection** to `WOCLAW_HUB_URL` that stays open for the lifetime of the OpenClaw process, heartbeating every 30 s.
- One **REST call** per `woclaw memory read|write|list` (Hub REST `:8083`); one **WS frame** per `woclaw send` and per `woclaw join`.
- One **history file** at `~/.woclaw/cli-history` for the interactive CLI shell.

## Verification

After install:

```bash
# 1. Confirm Hub is up
curl http://localhost:8083/health
# Expect: {"status":"ok", ...}

# 2. Confirm OpenClaw sees the plugin
openclaw plugins list | grep woclaw
# Expect: woclaw   xingp14-woclaw@0.4.3   enabled

# 3. One-shot CLI smoke test
woclaw --hub=http://localhost:8083 send smoke-test "hello from openclaw"
woclaw --hub=http://localhost:8083 topics list
# Expect: smoke-test present with the test message

# 4. Inside OpenClaw
openclaw> woclaw memory write project:context "v0.4.3 deploy OK"
openclaw> woclaw memory read  project:context
# Expect: v0.4.3 deploy OK
```

If step 3 reports `ECONNREFUSED`, the Hub is not running — install [`woclaw-hub`](https://www.npmjs.com/package/woclaw-hub) first or correct `WOCLAW_HUB_URL`.

## Failure modes

- **Hub unreachable**: CLI prints `ECONNREFUSED`; OpenClaw channel marks the bridge as `disconnected` in `openclaw status`. Fix: start the Hub or correct `WOCLAW_HUB_URL` / `WOCLAW_REST_URL`.
- **Token mismatch**: Hub returns `401` on REST and rejects WS handshake; channel emits an auth error event. Fix: align `WOCLAW_TOKEN` with the Hub's `AUTH_TOKEN` env.
- **OpenClaw version too old**: `openclaw plugins install woclaw` refuses with a peer-dep error. Fix: upgrade OpenClaw to `>= 2026.1.0`.
- **`WS keeps reconnecting`**: usually a transient Hub restart; the plugin auto-reconnects with exponential backoff (1 s → 30 s). If it persists >5 min, check `woclaw --debug logs`.
- **CLI history corrupted**: delete `~/.woclaw/cli-history` and restart.

## Source

- Package: [`xingp14-woclaw`](https://www.npmjs.com/package/xingp14-woclaw) (v0.4.3)
- Repo: [`plugin/`](https://github.com/XingP14/woclaw/tree/master/plugin) + root [`package.json`](https://github.com/XingP14/woclaw)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw) / [`woclaw-hub`](https://www.npmjs.com/package/woclaw-hub)
- Companion skills: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Claude Code / Gemini / OpenCode / Codex hooks), [`woclaw-mcp`](https://www.npmjs.com/package/woclaw-mcp) (MCP bridge), [`woclaw-hub`](https://www.npmjs.com/package/woclaw-hub) (the Hub itself)
- Standard: [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)