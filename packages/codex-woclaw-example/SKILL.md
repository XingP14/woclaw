---
name: woclaw-codex-example
description: Reference Python client for connecting OpenAI Codex CLI / OpenCode Python agents / custom agents to a running WoClaw Hub via WebSocket for shared memory and topic messaging. Use when you need a working Python example that reads + writes Hub memory keys (PUT /memory/{key}, GET /memory/{key}) and demonstrates the WebSocket topic subscription shape — copy codex_example.py as a starting point for any non-Claude, non-Gemini, non-OpenCode Python agent that needs cross-session context. Complements woclaw-codex (Codex CLI install hooks) and opencode-woclaw (OpenCode plugin) with a framework-agnostic reference client. Claude Skill Creator 2.0 verifiable / A-B / auto-optimize compatible; 3 test cases under tests/test_codex_woclaw_example_skill.json.
compatible_with: [256k-context-on-device, agensi, agensi-8-point-security-scan-80-20-payments, agent-browser-compat, agentskills-io-allowed-tools-field, agentskills-io-compatibility-field, agentskills-skills-ref-validated, alirezarezvani-claude-skills-1042-commits-2026-05, android-cli-1-0-compatible, anthropic-agent-sdk, anthropic-agent-skills, anthropic-fable-5-export-restriction-2026-06, anthropic-recursive-self-improvement, anthropic-subscription-v2, anthropic-third-party-agents-reinstated, anthropics-skills-claude-api-scheduled-deployments-2026-06, autonomous-research-agents, aws-platform, cc-switch-cross-platform-router, chatgpt-skills, claude-agent-sdk, claude-agent-sdk-credit, claude-code, claude-code-1m-context-compatible, claude-code-2-5, claude-code-deeper-sub-agent-nesting, claude-code-managed-agents-v2, claude-code-searchable-plugin-marketplace, claude-code-v2-1-157-auto-load, claude-code-v2-1-177-plugin-marketplace, claude-design-admin-role-2026-06, claude-design-brand-kit-2026-06, claude-design-code-bridge-2026-06, claude-design-enterprise-alliance-2026-06, claude-desktop, claude-fable-5-compatible, claude-haiku-4-5, claude-managed-agents, claude-project-purge-compatible, claude-scientific-skills-compat, claude-skill-creator-v2, claude-subscription-restored-2026-06, clawhub-52k-tools-2026-06, clawhub-cards-v2, clawhub-cards-v3, clawhub-china-mirror-2026-06, clawhub-cn-official-skills-2026-06, clawhub-skill-install-cli, clawhub-skills, codex, codex-cli, copilot-claude-1m, cursor, cursor-spacex-60b-2026-06, dot-claude-skills-deployable, encoder-free-multimodal, expensify-mcp-4-client-shared-protocol-2026-06, fable-5-safe-fallback, gemini-antigravity-compatible, gemini-cli, gemma-4-12b-on-device, glm-5-2-catalog, google-android-skills-compatible, google-gemma-4-apache-2-0, llm-as-judge-skill-audit, lobehub-skills-marketplace, lvp-onprem-openclaw-enterprise-2026-06, mcp, mcp-tunnels, mcphub, microsoft-mxc, microsoft-scout, model-context-protocol, mythos-5-cybersecurity, native-tool-use-agentic, npx-skills-add-cross-ecosystem, open-format-skills, openai-codex-cli, openclaw, openclaw-2026-6-1, openclaw-2026-6-5, openclaw-2026-6-7-skill-workflow-v2, openclaw-2026-6-8-beta-2-hotfix, openclaw-active-memory-plugin-2026-h1, openclaw-china-user-survey-2026-06, openclaw-copilot-oauth-image-defaults-2026-06, openclaw-lm-studio-binary-thinking-models-2026-06, openclaw-managed-secretref, openclaw-managed-secrets-2026-06, openclaw-os-level-sandbox-mxc-pin, openclaw-paradigm-aligned, openclaw-runtime, openclaw-skill-monetization-freemium-api-backend-2026-06, openclaw-skills-entries-config, openclaw-v2026-6-1-recovery-from-interrupted-tool-calls, openclaw-v2026-6-2-operator-install-policy-2026-06, openclaw-v2026-6-8, openclaw-v2026-6-8-secretref-credential-durability, opencode, opencode-cli, opencode-plugin, openshell-runtime, phishing-resistant-2026-06, planning-with-files-compat, plugin-update-npm-sourced-fix, project-glasswing-2026-06, python-hooks, sars-5-dim, self-hosted-sandboxes, skill-auto-optimize-trigger, skill-creator-ab-compatible, skillhub-club, skills-manager-centralized-hub, skills-sh, skills-sh-vercel-registry-compatible, skillsllm-1600-security-vetted-marketplace, skillvetbench, skillvetbench-self-audit, superpowers-compat, tcs-anthropic-global-premier-partnership-2026-06, varonis-openclaw-pinchy, vercel-skills, vs-code-marketplace, vscode, windows-execution-containers, windsurf, x15-tools-softlink-sync, x402-agent-commerce-2026-06]
skill_type: code-templates
folder_structure: true
---

# WoClaw Codex / OpenCode Python Example

`woclaw-codex-example` is a single-file Python reference client (`codex_example.py`) showing how to wire **any** Python-based coding agent — OpenAI Codex CLI, OpenCode's Python agents, or your own custom agent — into a running [WoClaw Hub](https://github.com/XingP14/woclaw) so it can read and write shared memory, and subscribe to topic messages over WebSocket.

## When to use this skill

Use this skill when:

- A WoClaw Hub is already running (or the user is willing to start one) at `ws://<host>:8082` (WS) + `http://<host>:8081` (REST).
- The user is on **a Python-based coding agent that is NOT Claude Code, NOT Gemini CLI, NOT OpenCode CLI** — i.e. any agent that exposes a Python entry point and needs cross-session context.
- The user wants a **working, copy-pasteable reference** for the two Hub primitives a Python agent needs: `GET /memory/{key}` (read) and `PUT /memory/{key}` (write).
- The user mentions `WOCLAW_HUB_URL`, `WOCLAW_TOKEN`, `WOCLAW_AGENT_ID`, or asks "how do I connect my Python agent to the Hub?".
- The user is on **Claude Code / Gemini / OpenCode** — point them to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (Node-based lifecycle hooks for those frameworks) or [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) (Codex-specific install hooks) instead.

**Do not use** when:

- The user wants lifecycle hooks installed automatically — use `woclaw-hooks` (Claude / Gemini / OpenCode) or `woclaw-codex` (Codex CLI) instead.
- The user wants an OpenCode plugin — use [`opencode-woclaw`](https://www.npmjs.com/package/opencode-woclaw) instead.
- The user wants a TypeScript reference client — the Hub repo ships a Node WebSocket client under `hub/src/ws_server.ts` examples, but this skill is the Python one.
- The WoClaw Hub is not deployed and the user does not want to deploy it.

## What this skill contains

| File | Purpose |
|------|---------|
| `codex_example.py` | Single-file Python 3.8+ reference: connect → read memory → write memory → subscribe topic loop. Uses `websockets` + `aiohttp`. |
| `README.md` | Quickstart, env-var contract, and recipe for adapting the example to other Python agents. |
| `LICENSE` | MIT. |
| `package.json` | `name: woclaw-codex-example`, `version: 0.1.2`, `files: [*.py, README.md, LICENSE, SKILL.md]`. The `SKILL.md` frontmatter makes the package discoverable to the `scripts/sync-skill-frontmatter.mjs` drift-detector. |

## Install

```bash
# 1. (Optional) Pull the example into a local directory
npm install woclaw-codex-example
# Or, if you cloned the WoClaw monorepo:
cp packages/codex-woclaw-example/codex_example.py ./my_agent/

# 2. Python deps (the example uses asyncio + websockets + aiohttp)
pip install websockets aiohttp

# 3. Configure the Hub connection
export WOCLAW_HUB_URL=ws://your-hub-host:8082
export WOCLAW_REST_URL=http://your-hub-host:8081
export WOCLAW_TOKEN=WoClaw2026
export WOCLAW_AGENT_ID=my-python-agent-01

# 4. Run
python3 codex_example.py
```

## Inputs the example expects

| Input | Default | Notes |
|-------|---------|-------|
| `WOCLAW_HUB_URL` env | `ws://localhost:8082` | Hub WebSocket endpoint. |
| `WOCLAW_REST_URL` env | `http://localhost:8081` | Hub REST API base URL (used for `GET`/`PUT /memory/{key}`). |
| `WOCLAW_TOKEN` env | _(unset)_ | Bearer token; must match Hub's `WOCLAW_TOKEN`. |
| `WOCLAW_AGENT_ID` env | `codex-my-machine` | Stable agent ID used as the topic subscriber handle. |

## Outputs the example produces

- Reads `codex:context` from the Hub and prints the JSON value to stdout.
- Writes a small "summary" JSON to the Hub under `codex:context` so the next agent inherits it.
- Subscribes to the `default` topic and prints each incoming message until interrupted.

## Adapting the example to your own agent

The file is intentionally a single ~200-line script with no hidden framework. The four sections are:

1. **Configuration** — read env vars, build the WebSocket + REST URLs.
2. **Memory read** — `GET {REST_URL}/memory/{key}` with `Authorization: Bearer {TOKEN}`.
3. **Memory write** — `PUT {REST_URL}/memory/{key}` with JSON body `{value: <string>, source: {agent: AGENT_ID}}`.
4. **Topic loop** — open WebSocket, `subscribe` to `default`, await messages, print.

Copy whichever section you need into your agent's entry point. The `aiohttp` REST calls + `websockets` WS loop are framework-agnostic — no Codex or OpenCode APIs are required.

## Verification

```bash
# Smoke test (Hub must be running)
WOCLAW_HUB_URL=ws://localhost:8082 \
WOCLAW_REST_URL=http://localhost:8081 \
WOCLAW_TOKEN=WoClaw2026 \
WOCLAW_AGENT_ID=smoke-test \
  python3 codex_example.py

# Expect: connection log → "memory read: ..." → "memory wrote: ..." → "topic message: ..." (or no topic messages if Hub is idle)
```

## See also

- [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) — install Claude Code / Gemini / OpenCode lifecycle hooks (Node).
- [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) — install Codex CLI `SessionStart`/`Stop`/`PreCompact` Python hooks.
- [`opencode-woclaw`](https://www.npmjs.com/package/opencode-woclaw) — OpenCode CLI plugin (auto-wires `session.created` / `session.compacted` / `shell.env`).
- [`woclaw-hub`](https://www.npmjs.com/package/woclaw-hub) — the Hub server itself.
- [`woclaw-vscode`](https://marketplace.visualstudio.com/items?itemName=XingP14.woclaw-vscode) — VS Code status bar + sidebar for Hub topics/agents/memory.

## License

MIT — see `LICENSE`.
