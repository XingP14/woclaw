# Security Policy

> WoClaw = Shared Memory + Messaging Hub for AI Agents.
> This document covers **vulnerability reporting** and **supported versions** for all WoClaw packages.

## Supported Versions

| Package | Registry | Supported versions | Notes |
|---|---|---|---|
| `woclaw-hub` | [npm](https://www.npmjs.com/package/woclaw-hub) · [Docker Hub](https://hub.docker.com/r/xingp14/woclaw-hub) | `0.5.x` | Active. Memory Encryption (AES-256-GCM) in `0.5.0+` |
| `xingp14-woclaw` (plugin/CLI) | [npm](https://www.npmjs.com/package/xingp14-woclaw) | `0.4.x` | Active |
| `woclaw-hooks` | [npm](https://www.npmjs.com/package/woclaw-hooks) | `0.5.x` | Active. Multi-framework hook installer |
| `woclaw-mcp` | [npm](https://www.npmjs.com/package/woclaw-mcp) | `0.1.x` | Active. MCP bridge (stdio JSON-RPC) |
| `woclaw-codex` | [npm](https://www.npmjs.com/package/woclaw-codex) | `0.1.x` | Active. OpenAI Codex CLI hooks |
| `opencode-woclaw` | [npm](https://www.npmjs.com/package/opencode-woclaw) | `0.1.x` | Active. OpenCode plugin |
| `woclaw-vscode` | VS Code Marketplace (publisher: `XingP14`) | `0.1.x` | Active |

> All packages are **pre-1.0** (`0.x.y`). Only the **latest minor release** of each package receives security fixes.
> Older minor versions are not patched — please upgrade.

## Reporting a Vulnerability

**Please do not open public GitHub Issues for security-sensitive reports.**

Use **GitHub Private Vulnerability Reporting** (preferred):

1. Go to <https://github.com/XingP14/woclaw/security/advisories/new>
2. Fill in: title, affected package + version, impact, reproduction steps, optional PoC
3. Submit — the report is private and visible only to maintainers.

If you cannot use GitHub Advisories, fall back to opening a **private security discussion**:
<https://github.com/XingP14/woclaw/discussions/new?category=security>

> ℹ️ If the report affects a separate package repo (`woclaw-hub`, `woclaw-hooks`, `woclaw-mcp`, `woclaw-codex`, `opencode-woclaw`), please file the advisory in **that** repo. (Some of these will be split out — see [`docs/ROADMAP.md` § Repo 拆分计划](./docs/ROADMAP.md#-v05----).)

## What to Include

A good report accelerates triage. Please include:

- **Affected package** + exact version (`npm ls <pkg>` or `woclaw --version`)
- **WoClaw Hub deployment** (Docker image tag, Node.js version, OS)
- **Vulnerability class** (RCE, auth bypass, info disclosure, DoS, supply chain, …)
- **Reproduction steps** or PoC (curl / ws cat / minimal script)
- **Impact** (data exfil? privilege escalation? cross-agent memory leak?)
- **Discoverer** name / handle for the advisory credit (optional)

## Response Timeline

| Stage | SLA |
|---|---|
| **Acknowledgement** | within 7 days of report |
| **Initial triage** (severity, scope, affected versions) | within 14 days |
| **Patch** for `latest` minor | within 30 days for High/Critical, 90 days for Medium/Low |
| **Public disclosure** | coordinated with reporter, defaults to **patch + 14 days** |

We follow [GitHub's coordinated disclosure norms](https://docs.github.com/en/code-security/security-advisories/guidance-on-coordinated-disclosure-of-security-vulnerabilities). Critical RCE / auth-bypass issues are eligible for **embargoed early disclosure** — please mention this in the report if your team needs the patch before public CVE.

## Scope — In-Scope Issues

Examples of issues we will investigate and patch:

- **Auth bypass** on the Hub WebSocket (`:8082`) or REST (`:8083`) port, including token confusion between `currentToken` / `nextToken` rotation
- **TLS** misconfiguration leading to downgrade (`ws://` ↔ `wss://`) or cert validation skip
- **Memory Encryption at Rest** (AES-256-GCM + PBKDF2 in `hub/src/crypto.ts`): nonce reuse, weak KDF params, plaintext leakage
- **Federation peer trust**: forged `hubId` / `federationToken` allowing unauthorized cross-Hub message routing
- **Hook injection** in `woclaw-hooks` install scripts (path traversal, env var injection from `~/.woclaw/.env`)
- **Memory pool** conflicts allowing unauthorized read/write of `memory:*` keys (key namespace confusion across agents)
- **Topic access control bypass** for private/invite-only topics (`hub/src/topics.ts`)
- **Graph Memory** traversal DoS (`hub/src/graph/store.ts` — BFS depth / cycle handling)
- **Web UI** (`:8084` static server) XSS / path traversal / open redirect
- **Supply chain** — compromised npm publish token, malicious transitive dep

## Scope — Out-of-Scope

- Reports against **unmaintained / deprecated** minor versions (please upgrade first)
- Issues requiring **physical access** to the Hub host
- **Self-XSS** (paste a payload into your own terminal)
- **Rate limiting** / DoS reports that require the Hub to be deployed on the public Internet without a reverse proxy (WoClaw assumes deployment behind a private network or with a TLS-terminating proxy)
- Best-practice recommendations without a concrete exploit

## Recognition

We credit reporters in:

1. The fix commit (`Co-discovered-by:` / `Reported-by:` trailer)
2. The CHANGELOG `[Unreleased] > Security` entry
3. The GitHub Security Advisory (with reporter's consent)

Anonymous reports are honored but cannot be credited.

## Security Architecture Notes (for reviewers)

- **Transport**: `wss://` + `https://` supported via `TLS_KEY` / `TLS_CERT` env vars ([`docs/INSTALL.md` § 🔐 TLS/SSL 加密连接](./docs/INSTALL.md))
- **Auth**: single shared token (`CLAW_TOKEN`) with optional `nextAuthToken` + grace period ([`hub/src/ws_server.ts` S22])
- **At-rest**: `hub/src/crypto.ts` provides AES-256-GCM (`ENC:v1:` prefix)
- **Rate limiting**: `hub/src/ws_server.ts` S19 (per-IP WebSocket connection cap)
- **Multi-Hub Federation**: `hub/src/federation/*` — pre-shared `federationToken` per peer

## Versions of this Policy

- **v1.0** (2026-06-04) — initial policy, aligned with `woclaw-hub@0.5.0` and `xingp14-woclaw@0.4.3` release line.
