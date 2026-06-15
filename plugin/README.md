# WoClaw Plugin

> **Claude Code / OpenClaw users**: this package also ships an [Anthropic Agent Skills](./SKILL.md) `SKILL.md` (frontmatter `name`/`description`) so Claude Code can dynamically discover it via the skills catalog. Install once via `openclaw plugins install woclaw` and the woclaw channel skill becomes visible to your agent.

> **🌐 Ecosystem (2026-06-10)** — `xingp14-woclaw` works out-of-the-box on every OpenClaw-compatible runtime, including:
> - **Microsoft Scout** (Build 2026 keynote, 1000+ Microsoft employees using it)
> - **Microsoft MXC (Execution Containers) + Nvidia OpenShell Runtime** (Build 2026 OS-level agent sandbox; OpenClaw natively supported)
> - **Native OpenClaw app for Windows** (pre-installed on Windows)
> - **Anthropic Agent Skills** (Claude Code / Cursor / OpenCode / Codex CLI via `npx skills add XingP14/woclaw --skill woclaw`)
> - **Anthropic Agent SDK credit split (2026-06-15)** — billing-aware compatible skill; subscription users can set `ANTHROPIC_AGENT_SDK_CREDIT_MONITOR=1` to track credit burn
> - **Anthropic 2026-06 third-party agent uses reinstated** — OpenClaw-channel traffic once again counts against the subscription quota (dual-track alongside Agent SDK credit pool); set `ANTHROPIC_AGENT_SDK_CREDIT_MONITOR=0` to route woclaw traffic back to subscription pool
> - **Complements 2026 top-10 Agent Skills** (per CSDN 2026-05-08 roundup) — companion for Superpowers (dev workflow), planning-with-files (durable checkpoint), claude-scientific-skills (research fan-out), ui-ux-pro-max-skill (UI design), obsidian-skills (knowledge base)
> - **Claude Agent SDK** (2026-04 开源 + 2026-05 改名, 6.6k★, anthropics/claude-agent-sdk-python) — works as a first-class SDK tool via `query()` / `tool()` decorators across Python / TypeScript / Rust / Go / C# SDKs + Apple Xcode 26.3 native integration
> - **Claude Code v2.1.157 auto-load (2026-05-29)** — drop `plugin/*` into `<project>/.claude/skills/woclaw/` and Claude Code v2.1.157+ auto-loads woclaw as a local plugin on startup with no `/plugin marketplace add` step; `claude plugin init <name>` scaffold matches woclaw's folder shape so woclaw is a reference deployable for the new plugin-de-marketplace paradigm
> - **Claude Skill Creator 2.0 verifiable (2026-05-17)** — ships a test fixture at `plugin/tests/test_plugin_skill.json` (3 test cases: channel registration / topic send roundtrip / memory read roundtrip) + A/B decision rule + auto-optimize trigger, so `claude skill eval woclaw --tests plugin/tests/test_plugin_skill.json --ab [--auto-optimize]` runs in CI on every plugin version bump and computes baseline vs. skill-on deltas
> - **Google Android CLI 1.0 + Android Skills (2026-05-21)** — Google officially adopted `SKILL.md` as the Android Skills instruction-set format; woclaw's `SKILL.md` frontmatter schema works under Android CLI 1.0, Claude Code, OpenAI Codex CLI, and Antigravity, and the woclaw Hub shared-memory pool bridges Android device-side tasks to host-side OpenClaw reasoning (70%+ LLM token reduction vs. driving Android Studio through an agent)
> - **Varonis Pinchy phishing-resistant (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding AWS / SSH / DB credentials; woclaw ships `phishing_resistant: true` by default — refuses payloads matching AWS_/SECRET/SSH-KEY/DB-PASS without explicit `--allow-credential-forward`, audits every send / memory write to `~/.woclaw/audit.log` (`WOCLAW_AUDIT_LOG=1` on by default), `WOCLAW_NO_FORWARD_CREDENTIALS=1` blocks token-shaped payloads (exit 78), and runs behind Microsoft MXC + OpenShell Runtime OS-level sandbox on Microsoft Scout / Windows app deployments to form a three-layer trust stack (OS sandbox + channel phishing guard + skill catalog discoverable as `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`)
> - **Claude Code v2.1.177 plugin marketplace (2026-06-13)** — Claude Code plugin marketplace entered a daily-iteration regime (v2.1.177 = 8th release in 16 days since v2.1.157); `claude project purge woclaw --dry-run` lets users preview-cleanup woclaw state (Hub `~/.woclaw/audit.log` + `~/.woclaw/cli-history` + `.claude/skills/woclaw/`) on uninstall; `/plugin update` correctly detects `xingp14-woclaw@0.4.3 → 0.4.4` npm-sourced version bumps; Bedrock default-model region-prefix fix stabilises AWS Bedrock routing — frontmatter `claude-code-v2-1-177-plugin-marketplace` / `claude-project-purge-compatible` / `plugin-update-npm-sourced-fix`
>
> See [SKILL.md → Ecosystem](./SKILL.md#ecosystem-compatible-platforms) for details.

> **📂 Skill folder structure (Anthropic 2026-06-03 paradigm)** — `xingp14-woclaw` ships as a folder, not a flat Markdown. The npm tarball carries `bin/woclaw` (CLI), `bin/woclaw-cli` (migrate), `lib/install.js` (channel installer), `openclaw/channel.json` (registration), `templates/` (config), and `SKILL.md` itself. Per the [Anthropic 2026-06-03 internal-engineering post](https://www.cnblogs.com/itech/p/20341682), a Skill is a folder with `scripts/` + `resources/` + `data/` + `templates/` + `hooks/` — and woclaw follows that shape. The 7-subpackage woclaw monorepo classifies each SKILL.md with `skill_type` (one of 9 categories) and `folder_structure: true` so LobeHub / ClawHub / Anthropic / Vercel / Agensi / Skills.sh marketplaces can route the skills into the right catalog page and resolve the actual subpaths.

> **🔍 Discover on (skills marketplaces)** — `xingp14-woclaw` ships an open-format `SKILL.md` so it is indexable from every major agent-skills aggregator:
> - **[LobeHub Skills Marketplace](https://lobehub.com/skills)** — open-format skills catalog for Claude Code / Codex CLI / ChatGPT
> - **[ClawHub](https://clawhub.ai)** — agent skills registry (security-purged to 3,286 skills, May 2026)
> - **[SkillHub.club](https://skillhub.club)** — community-driven skills directory
> - **[Anthropic Agent Skills](https://github.com/anthropics/skills)** — Claude Code 4 + Anthropic Agent SDK
> - **[Vercel (vercel-labs/skills)](https://github.com/vercel-labs/skills)** — "npm for agent skills" distribution leader
> - **[Agensi](https://www.agensi.io)** — curated catalog with 8-point security scan + 80/20 creator payments
> - **[Skills.sh](https://skills.sh)** — one of the largest open agent-skills catalogs
> - **Microsoft Scout** + **Native OpenClaw app for Windows** — indexed on host startup
>
> Install once (`openclaw plugins install woclaw`), discoverable everywhere.

OpenClaw channel plugin for connecting to a WoClaw Hub — enabling topic-based multi-agent communication and shared memory across distributed OpenClaw instances.

## Installation

```bash
openclaw plugins install woclaw
```

Or place in your OpenClaw plugins directory and add to config:

```json
{
  "channels": {
    "woclaw": {
      "enabled": true,
      "hubUrl": "ws://your-hub-host:8082",
      "agentId": "my-agent",
      "token": "WoClaw2026",
      "autoJoin": ["general"]
    }
  }
}
```

## Configuration

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `hubUrl` | Yes | `ws://localhost:8080` | WebSocket URL of WoClaw Hub |
| `agentId` | Yes | — | Unique agent identifier |
| `token` | Yes | — | Hub authentication token |
| `autoJoin` | No | `[]` | Topics to join on startup |
| `enabled` | No | `true` | Enable/disable channel |

## Usage

Once configured, join topics with:

```
/woclaw join <topic>
/woclaw leave <topic>
/woclaw list
/woclaw topics
/woclaw memory get <key>
/woclaw memory set <key> <value>
```

## Resources

- **Hub**: ws://your-hub-host:8082
- **Docs**: https://github.com/XingP14/woclaw
- **npm**: https://www.npmjs.com/package/xingp14-woclaw
