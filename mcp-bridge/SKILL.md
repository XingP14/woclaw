---
name: woclaw-mcp
description: Bridge a running WoClaw Hub's memory pool and topic messaging to any MCP-capable AI agent (Claude Desktop, Cursor, Windsurf, mcphub). Use when the user wants to expose WoClaw shared memory and inter-agent topics as Model Context Protocol tools, or wants to wire `woclaw_memory_read/write/list` and `woclaw_topics_list/topic_messages/topic_send/topic_join` into Claude Desktop or Cursor MCP settings.
compatible_with: [mcp, model-context-protocol, claude-desktop, cursor, windsurf, mcphub, claude-code, claude-managed-agents, mcp-tunnels, claude-code-2-5, autonomous-research-agents, openclaw-paradigm-aligned, claude-agent-sdk, anthropic-agent-sdk, claude-code-v2-1-157-auto-load, dot-claude-skills-deployable, claude-skill-creator-v2, skill-creator-ab-compatible, skill-auto-optimize-trigger, varonis-openclaw-pinchy, phishing-resistant-2026-06, openclaw-os-level-sandbox-mxc-pin]
skill_type: library-api-reference
folder_structure: true
---

# WoClaw MCP Bridge

`woclaw-mcp` is the Model Context Protocol (MCP) bridge between any MCP-capable AI agent and a running [WoClaw Hub](https://github.com/XingP14/woclaw). It exposes the Hub's shared-memory pool and inter-agent topic messaging as standard MCP tools so Claude Desktop / Cursor / Windsurf / mcphub can read/write shared context and coordinate with other agents through the Hub.

## When to use this skill

Use this skill when:

- The user runs Claude Desktop, Cursor, Windsurf, or another MCP-capable IDE/agent and wants access to WoClaw Hub memory.
- A WoClaw Hub is already running (or the user is willing to start one) at `ws://<host>:8082` (WebSocket) + `http://<host>:8083` (REST) with a shared auth token.
- The user mentions `woclaw_memory_read`, `woclaw_topics_list`, "expose WoClaw as MCP tools", "bridge woclaw to Claude Desktop", or wants to migrate coordination between agents via MCP.
- The user wants to register `woclaw-mcp` in `claude_desktop_config.json` / Cursor MCP settings / mcphub cross-client store.

**Do not use** when:

- The user only wants shell-level agent hooks for Claude Code / Gemini CLI / OpenCode / OpenAI Codex CLI — recommend the [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) skill instead (it covers SessionStart/Stop/PreCompact lifecycle hooks; `woclaw-mcp` is for IDE-side MCP tool exposure).
- The user wants to interact with WoClaw Hub directly from a custom Node.js app — point them to the Hub's REST API at `http://<host>:8083` and WebSocket at `ws://<host>:8082` instead.
- **Claude Managed Agents / Claude Platform on AWS users** — register `woclaw-mcp` as an MCP server inside a self-hosted sandbox and reach it through an MCP tunnel so Managed Agents can call `woclaw_memory_*` / `woclaw_topics_*` tools against a privately-hosted Hub.
- The WoClaw Hub is not deployed and the user does not want to deploy it.

## What this skill installs

Seven MCP tools, each backed by either the Hub REST API (`:8083`) or the Hub WebSocket (`:8082`):

| Tool | Backend | Purpose |
|------|---------|---------|
| `woclaw_memory_read` | REST `GET /memory/{key}` | Read a value from shared memory. |
| `woclaw_memory_write` | REST `PUT /memory/{key}` | Write to shared memory (with optional tags). |
| `woclaw_memory_list` | REST `GET /memory` | List all memory entries (filter by tags). |
| `woclaw_topics_list` | REST `GET /topics` | List all available topics. |
| `woclaw_topic_messages` | REST `GET /topics/{id}/messages` | Get recent messages from a topic. |
| `woclaw_topic_send` | WS `topic.publish` | Send a message to a topic. |
| `woclaw_topic_join` | WS `topic.subscribe` | Join a topic to receive updates. |

Plus a CLI entrypoint (`woclaw-mcp`) that spawns the MCP stdio server.

## Install

```bash
#1. Install the package globally
npm install -g woclaw-mcp

#2. Register in Claude Desktop (`claude_desktop_config.json`)
{
 "mcpServers": {
 "woclaw": {
 "command": "node",
 "args": ["/path/to/woclaw-mcp/dist/index.js",
 "--hub=ws://localhost:8082",
 "--token=WoClaw2026",
 "--rest-url=http://localhost:8083"]
 }
 }
}

# Or install into Cursor / Windsurf MCP Settings with the same JSON shape.
# Or install into the milisp/mcp-linker cross-client store with:
# claude mcp add woclaw-mcp -- npx -y woclaw-mcp

#3. Verify
curl http://localhost:8083/health
# Expect: {"status":"ok", ...}
```

## Inputs the skill expects

| Input | Default | Notes |
|-------|---------|-------|
| `--hub` | `ws://localhost:8082` | Hub WebSocket URL. |
| `--rest-url` | `http://localhost:8083` | Hub REST API base URL. |
| `--token` | (required) | Bearer token; must match Hub's `WOCLAW_TOKEN`. |

The MCP stdio server itself does not need any env vars — the agent (Claude Desktop, Cursor, etc.) launches it as a subprocess and pipes JSON-RPC over stdio.

## Outputs the skill produces

- A running MCP stdio server process, registered as `woclaw` in the agent's MCP config.
- Seven MCP tool definitions visible in the agent's tool palette (`woclaw_memory_*`, `woclaw_topics_*`, `woclaw_topic_*`).
- One Hub REST or WebSocket call per tool invocation (memory ops = REST; topic send/join = WS; topic list/messages = REST).

## Verification

After install, run from the host shell:

```bash
#1. Hub reachable
curl http://<host>:8083/health
# Expect: {"status":"ok"}

#2. MCP server starts cleanly
node /path/to/woclaw-mcp/dist/index.js --hub=ws://<host>:8082 --token=WoClaw2026 --rest-url=http://<host>:8083
# Expect: stdio listening, no crash

#3. End-to-end MCP tool call (from Claude Desktop or Cursor):
# - Call woclaw_memory_list
# - Expect: JSON array of memory entries (possibly empty)
# - Call woclaw_memory_write with key "test:hello" value "world"
# - Call woclaw_memory_read with key "test:hello"
# - Expect: {"value": "world", ...}
```

If step1 returns non-200, the Hub is down — start it before retrying.

## Failure modes

- **Hub unreachable**: MCP server exits with a WebSocket connection error. The agent shows `woclaw-mcp` as disconnected in its MCP status. Fix: start the Hub or correct `--hub` / `--rest-url`.
- **Token mismatch**: Hub returns `401` on memory ops or rejects WS handshake. Fix: align `--token` with the Hub's `WOCLAW_TOKEN` env.
- **Stale dist/**: edits to `src/index.js` not picked up because `build` is `cp -f src/index.js dist/`. Fix: `cd mcp-bridge && npm run build` after every source change.
- **Claude Desktop does not see tools**: confirm `claude_desktop_config.json` path is correct and that the JSON is valid (no trailing commas). Restart Claude Desktop after edits.

- **Claude Code v2.1.157 auto-load compatible (2026-05-29)** — drop `mcp-bridge/*` into `<project>/.claude/skills/woclaw-mcp/` and Claude Code v2.1.157+ auto-loads this MCP-bridge skill on startup with no `/plugin marketplace add` step.
- **Varonis Pinchy phishing-resistant compatible (2026-06-10)** — Varonis Threat Labs proved OpenClaw agents can be socially engineered into forwarding credentials; the woclaw-mcp bridge enforces payload-shape filtering (refuses AWS_/SECRET/SSH-KEY/DB-PASS payloads without explicit `--allow-credential-forward`), `WOCLAW_AUDIT_LOG=1` is on by default, and combined with Microsoft MXC + OpenShell Runtime OS-level sandbox forms a three-layer trust stack for enterprise MCP deployments — `phishing-resistant-2026-06` / `varonis-openclaw-pinchy` / `openclaw-os-level-sandbox-mxc-pin`.

## Skill Creator 2.0 verifiable (2026-05-17, 评测 / A-B / auto-optimize)

This SKILL.md ships with a verifiability fixture at `tests/test_mcp_bridge_skill.json` consumable by Anthropic **Skill Creator 2.0** (released 2026-05-17), which added three capabilities: (a) **eval** — Claude auto-generates test inputs, runs the Skill-on vs Skill-off pair, and quantifies pass-rate / failure / delta; (b) **A/B benchmarks** — same input set under loaded-vs-unloaded Skill, blind side-by-side, decision rule (regress → drop / slight lead → keep / large lead → expand); (c) **auto-optimize trigger** — Skill Creator 2.0 re-runs the suite on model upgrade or scene change without human prompting.

Run against this skill from CI:

```bash
# baseline vs skill-on delta
claude skill eval woclaw-mcp --tests mcp-bridge/tests/test_mcp_bridge_skill.json
# A/B mode
claude skill eval woclaw-mcp --tests mcp-bridge/tests/test_mcp_bridge_skill.json --ab
# auto-optimize on regression
claude skill eval woclaw-mcp --tests mcp-bridge/tests/test_mcp_bridge_skill.json --ab --auto-optimize
```

Three MCP-bridge verifiability cases ship in the fixture:
- **tc-01-mcp-handshake** — spawn `node dist/index.js --hub ws://localhost:8082` and confirm the MCP server prints its `Server started` line on stdout within 2s (startup smoke).
- **tc-02-memory-write-read-roundtrip** — call `woclaw_memory_write` then `woclaw_memory_read` over the MCP transport and assert the read echoes the write payload byte-for-byte (memory tool correctness).
- **tc-03-topic-send-list-roundtrip** — call `woclaw_topic_send` with a fresh `topic=<uuid>`, then `woclaw_topics_list` and assert the topic appears with the message count ≥ 1 (topic tool correctness).

Decision rule per case: `skill_score >= baseline_score + delta_threshold` (delta_threshold = 0.5). The fixture is part of the npm tarball (`files: ["tests/**/*"]` in `mcp-bridge/package.json`) so a `npm install woclaw-mcp` user gets the fixture immediately.

## Source

- Package: [`woclaw-mcp`](https://www.npmjs.com/package/woclaw-mcp) (v0.1.2)
- Repo: [`mcp-bridge/`](https://github.com/XingP14/woclaw/tree/master/mcp-bridge)
- Hub: [`WoClaw`](https://github.com/XingP14/woclaw)
- Standard: [Model Context Protocol — MCP servers](https://modelcontextprotocol.io/) + [Anthropic Agent Skills — SKILL.md frontmatter](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
