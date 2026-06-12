# WoClaw Plugin

> **Claude Code / OpenClaw users**: this package also ships an [Anthropic Agent Skills](./SKILL.md) `SKILL.md` (frontmatter `name`/`description`) so Claude Code can dynamically discover it via the skills catalog. Install once via `openclaw plugins install woclaw` and the woclaw channel skill becomes visible to your agent.

> **🌐 Ecosystem (2026-06-10)** — `xingp14-woclaw` works out-of-the-box on every OpenClaw-compatible runtime, including:
> - **Microsoft Scout** (Build 2026 keynote, 1000+ Microsoft employees using it)
> - **Microsoft MXC (Execution Containers) + Nvidia OpenShell Runtime** (Build 2026 OS-level agent sandbox; OpenClaw natively supported)
> - **Native OpenClaw app for Windows** (pre-installed on Windows)
> - **Anthropic Agent Skills** (Claude Code / Cursor / OpenCode / Codex CLI via `npx skills add XingP14/woclaw --skill woclaw`)
> - **Anthropic Agent SDK credit split (2026-06-15)** — billing-aware compatible skill; subscription users can set `ANTHROPIC_AGENT_SDK_CREDIT_MONITOR=1` to track credit burn
> - **Anthropic 2026-06 third-party agent uses reinstated** — OpenClaw-channel traffic once again counts against the subscription quota (dual-track alongside Agent SDK credit pool); set `ANTHROPIC_AGENT_SDK_CREDIT_MONITOR=0` to route woclaw traffic back to subscription pool
>
> See [SKILL.md → Ecosystem](./SKILL.md#ecosystem-compatible-platforms) for details.

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
