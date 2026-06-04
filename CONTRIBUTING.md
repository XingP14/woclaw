# Contributing to WoClaw

> WoClaw = Shared Memory + Messaging Hub for AI Agents.
> This document explains how to file issues, send pull requests, and run the project locally.
> For full developer docs, see [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

Thanks for your interest in improving WoClaw! 🎉
WoClaw is a small monorepo: contributions of all sizes — typo fixes, doc clarifications, new hook adapters, hub features — are welcome.

## 🧭 Code of Conduct

By participating, you agree to follow the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
Please read [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) for the full text, enforcement process, and contact channel. Be respectful and constructive.

## 🐛 Reporting Bugs

**Please do not file security-sensitive bugs in public issues.** Use [GitHub Private Vulnerability Reporting](https://github.com/XingP14/woclaw/security/advisories/new) — see [`SECURITY.md`](./SECURITY.md) for the full process.

For non-security bugs:

1. Search [existing issues](https://github.com/XingP14/woclaw/issues?q=is%3Aissue) to avoid duplicates.
2. Open a new issue and include:
   - **What you did** (commands, code, config)
   - **What you expected** (one sentence)
   - **What happened** (actual output, stack trace, screenshot)
   - **Environment:** WoClaw package(s) + version (`npm ls woclaw-hub`, `docker images xingp14/woclaw-hub`), Node.js version, OS
3. Use a clear, lowercase, hyphen-separated title (e.g. `hub: /ready returns 503 when sqlite is locked`).

## 💡 Suggesting Features

Open an issue with the `enhancement` label and include:

- **Problem statement** — what workflow or pain point this addresses
- **Proposed solution** — high-level design (REST endpoint, CLI flag, hook event, etc.)
- **Alternatives considered** — why this approach over others
- **Affected packages** — `woclaw-hub` / `woclaw-hooks` / `woclaw-codex` / `woclaw-mcp` / `xingp14-woclaw` / `opencode-woclaw` / `woclaw-vscode`

Maintainers will triage and reply within a few days. Large features (new REST surface, new hook framework, schema changes) should be discussed in an issue **before** you start coding — this saves wasted PRs.

## 🔀 Pull Requests

### 1. Fork & branch

```bash
# Fork via GitHub UI, then:
git clone https://github.com/<your-username>/woclaw.git
cd woclaw
git remote add upstream https://github.com/XingP14/woclaw.git
git checkout -b <type>/<short-topic>
```

Branch name conventions:

| Type | Example | Use for |
|------|---------|---------|
| `feat/` | `feat/hub-graph-export` | New user-facing capability |
| `fix/` | `fix/ready-timeout-503` | Bug fixes |
| `docs/` | `docs/contributing-clarify` | Docs / comments / typos |
| `refactor/` | `refactor/db-init-extract` | Internal restructuring, no behavior change |
| `chore/` | `chore/deps-bump-better-sqlite3` | Tooling, deps, CI |

### 2. Develop

```bash
# Install hub deps (the rest of the monorepo shares the root workspaces)
cd hub
npm install
npm run build
npm run dev   # hot-reload on :8082 (WS) / :8083 (REST) / :8084 (Web UI)
```

See [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) for the full project layout, scripts, and test commands.

### 3. Test locally

We **do not** run `npm test` as part of PR CI yet (it is on the roadmap). Before requesting review:

```bash
cd hub
npm run build            # TypeScript must compile clean
node dist/index.js &     # smoke-test the hub on :8082/:8083
curl -s http://localhost:8083/health
node test-connect.mjs    # WS + REST round-trip
```

If your change touches `hub/src/extraction/`, also run `npx vitest run test/extraction_engine.test.ts` (or the relevant test file).

### 4. Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) — this lets `git log` stay searchable and aligns with future automated changelogs.

Format:

```
<type>(<scope>): <short summary>

<body explaining *why* (not *what* — the diff shows the what)

<footer with BREAKING CHANGE: ... or Refs: #123 if applicable>
```

Examples:

```
feat(hub): add /memory/:key/versions endpoint
fix(hooks): replace HUB_URL env in install.js for windows paths
docs(security): add SECURITY.md vulnerability disclosure policy
chore(deps): bump better-sqlite3 to 11.x
```

Scopes (use the package name when relevant): `hub`, `hooks`, `codex`, `mcp`, `plugin`, `vscode`, `site`, `docs`, `ci`, `deps`.

### 5. Push & open the PR

```bash
git push -u origin <your-branch>
# Open PR via GitHub UI against XingP14/woclaw master
```

PR checklist:

- [ ] Title follows Conventional Commits
- [ ] Body explains the **why** and links the issue (e.g. `Closes #42`)
- [ ] `hub` package builds clean (`cd hub && npm run build`)
- [ ] No stray `console.log` / `debugger` / commented-out code
- [ ] New REST endpoint or CLI flag is mentioned in the relevant `docs/*.md` and `CHANGELOG.md`
- [ ] Public API changes are noted in the PR description (these need maintainer review before merge)

## 🧱 Repository Layout (cheat sheet)

```
woclaw/
├── hub/                       # woclaw-hub@0.5.0 — REST/WS/Graph/Forgetting
├── packages/
│   ├── woclaw-hooks/          # woclaw-hooks@0.5.0 — multi-framework hook installer
│   ├── codex-woclaw/          # woclaw-codex@0.1.2 — OpenAI Codex CLI hooks
│   ├── mcp-bridge/            # woclaw-mcp@0.1.2 — MCP server (stdio JSON-RPC)
│   ├── woclaw-vscode/         # woclaw-vscode@0.1.x — VS Code/Cursor extension
│   └── opencode-woclaw/       # opencode-woclaw@0.1.0 — OpenCode plugin
├── plugin/                    # xingp14-woclaw@0.4.3 — OpenClaw plugin + CLI
├── site/                      # GitHub Pages (gh-pages branch)
├── docs/                      # Markdown docs (DEVELOPMENT, HOOKS, MCP, ROADMAP, …)
├── SECURITY.md                # Vulnerability reporting
├── CONTRIBUTING.md            # ← you are here
└── ROADMAP.md                 # Project roadmap (canonical: docs/ROADMAP.md)
```

## 🚀 Release & Publishing

Maintainers handle releases:

| Package | Registry | Trigger | Notes |
|---|---|---|---|
| `woclaw-hub` | npm + Docker Hub | GitHub Actions on `hub/v*` tag | See `docs/PUBLISH.md` |
| `woclaw-hooks` | npm | Manual `npm publish` in `packages/woclaw-hooks/` | — |
| `woclaw-codex` | npm | Manual `npm publish` in `packages/codex-woclaw/` | — |
| `woclaw-mcp` | npm | Manual `npm publish` in `packages/mcp-bridge/` | — |
| `opencode-woclaw` | npm | Manual `npm publish` in `packages/opencode-woclaw/` | — |
| `xingp14-woclaw` (plugin) | npm | Manual `npm publish` in `plugin/` | — |
| `woclaw-vscode` | VS Code Marketplace | `vsce publish` | publisher: `XingP14` |

You do **not** need to bump versions in your PR — maintainers will do that as part of release.

## ❓ Questions?

- **Bug?** Open an issue (see "Reporting Bugs" above).
- **Security?** Use [private reporting](https://github.com/XingP14/woclaw/security/advisories/new) — see [`SECURITY.md`](./SECURITY.md).
- **Discussion / RFC?** Open an issue with the `discussion` label; for larger proposals, draft a doc in `docs/` and link it.

Thanks for helping make WoClaw better! 🐾
