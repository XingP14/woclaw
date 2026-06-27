# WoClaw Project Governance

Last reviewed: 2026-06-27 on `vps4` (`/root/.openclaw/workspace/woclaw`).

This document is the operating contract for OpenClaw and other agents working on
WoClaw. It separates the current project map from durable rules. When facts drift,
update the factual snapshot and keep the rules intact unless the maintainer changes
the operating model.

## Current Snapshot

- Repository: `git@github.com:XingP14/woclaw.git`
- Default branch: `master`
- Local state on review: clean working tree, local `master` ahead of
  `origin/master` by several automated commits.
- Public GitHub release observed: `hub/v0.5.0`, published 2026-06-02.
- Public Git tags observed: `hub/v0.3.0`, `hub/v0.5.0`.
- npm package versions observed:
  - `woclaw-hub@0.5.0`
  - `xingp14-woclaw@0.4.3`
  - `woclaw-hooks@0.5.0`
  - `woclaw-mcp@0.1.2`
  - `woclaw-codex@0.1.2`
  - `opencode-woclaw@0.1.0`
- Development cadence: high-frequency automated commits, with multiple commits
  per active day. Public releases are not daily; they are tag-driven and package
  specific.

## Project Structure

| Path | Responsibility | Release surface |
| --- | --- | --- |
| `hub/` | REST/WebSocket Hub, memory, graph memory, sessions, federation, storage, scheduler, Web UI server | npm `woclaw-hub`, Docker image `xingp14/woclaw-hub` |
| `plugin/` | OpenClaw channel plugin, CLI, plugin manifest, OpenClaw skill assets | npm `xingp14-woclaw` |
| `mcp-bridge/` | MCP stdio bridge for WoClaw tools | npm `woclaw-mcp` |
| `packages/woclaw-hooks/` | Claude/Gemini/Codex/OpenClaw hook installers and migration scripts | npm `woclaw-hooks` |
| `packages/codex-woclaw/` | OpenAI Codex CLI lifecycle hooks and installer | npm `woclaw-codex` |
| `packages/opencode-woclaw-plugin/` | OpenCode plugin | npm `opencode-woclaw` |
| `packages/woclaw-vscode/` | VS Code/Cursor extension | VS Code Marketplace package, not npm |
| `site/` | GitHub Pages static site | `gh-pages` branch |
| `docs/` | User docs, API docs, release docs, roadmap, runbooks | repository docs |
| `docs/superpowers/` | Design specs and implementation plans for larger changes | internal agent workflow |
| `scripts/` | Repository maintenance automation, especially SKILL metadata sync | local and CI tooling |
| `integration-test/` | Cross-package integration tests | CI/local verification |
| `memory/` | Local automated notes only; ignored and not tracked | not a release artifact |

## Product Direction

WoClaw is a shared memory and messaging hub for AI agents across OpenClaw,
Claude Code, Gemini CLI, OpenAI Codex CLI, OpenCode, VS Code/Cursor, MCP clients,
and planned Hermes Agent support.

The product plan is:

1. Keep the Hub stable and releasable: REST/WS health, SQLite/MySQL storage,
   session memory, graph memory, encryption, federation, and Web UI must remain
   compatible with existing clients.
2. Reduce documentation drift: every package README, root README, `docs/README*`,
   `docs/PUBLISH.md`, package metadata, and workflow tag trigger must agree on
   current versions and install paths.
3. Improve release quality: CI must be green before new feature work, package
   contents must be checked with dry runs, and public release tags must be tied
   to matching package versions.
4. Finish known blockers before speculative work:
   - resolve open CI/failure notes in `docs/ci-failures.md`
   - settle encryption-at-rest versus searchable recall behavior
   - keep `scripts/sync-skill-frontmatter.mjs` as the single source for repeated
     SKILL metadata updates
   - prepare `hub` split/runbook work only after CI and package metadata are clean
5. Treat ecosystem and marketplace compatibility metadata as supporting work.
   It must not displace code, tests, packaging, or release blockers.

## Release Cadence

WoClaw uses package-specific semantic versioning while the project is still in
the `0.x` stage. Public releases are tag-driven, not heartbeat-driven.

| Surface | Version source | Public trigger | Required preflight |
| --- | --- | --- | --- |
| Hub npm | `hub/package.json` | tag `hub/vX.Y.Z` -> `hub-publish.yml` | `cd hub && npm ci && npm run build && npm test` |
| Hub Docker | `hub/package.json` and tag | tag `hub/vX.Y.Z` or default-branch push -> `docker.yml` | hub preflight plus Docker build metadata and image tag check |
| OpenClaw plugin | `plugin/package.json` and `plugin/openclaw.plugin.json` | tag `plugin/vX.Y.Z` -> `publish.yml` | `cd plugin && npm ci && npm run build && npm test && npm pack --dry-run` |
| Hooks | `packages/woclaw-hooks/package.json` | tag `hooks/vX.Y.Z` -> `hooks-publish.yml` | package dry run and hook install smoke test |
| Codex hooks | `packages/codex-woclaw/package.json` | maintainer-controlled npm publish | `npm pack --dry-run`, installer smoke test |
| MCP bridge | `mcp-bridge/package.json` | maintainer-controlled npm publish | build/copy check and MCP stdio smoke test |
| OpenCode plugin | `packages/opencode-woclaw-plugin/package.json` | maintainer-controlled npm publish | package dry run and plugin load smoke test |
| VS Code extension | `packages/woclaw-vscode/package.json` | maintainer `vsce publish` | `npm run compile && npm test && vsce package` |

Cadence policy:

- Automated development may run daily.
- Public patch releases may happen when a verified bug fix or packaging fix is
  ready and CI is green.
- Minor releases should batch user-visible features and docs into a coherent
  release note.
- Never cut a release from a red CI state, a dirty working tree, or mismatched
  package versions.
- Never publish directly from a local shell unless the maintainer explicitly
  approved it for that release.

## Requirements Rules

Every non-trivial change needs a clear requirement before implementation:

- problem statement: what workflow is broken or improved
- affected packages: one or more paths from the structure table
- acceptance criteria: exact behavior, command output, API response, or package
  content expected after the change
- compatibility: whether the change affects REST/WS protocol, package exports,
  hook environment variables, DB schema, Docker runtime, or OpenClaw plugin APIs
- rollback: how to revert if CI or runtime fails

Do not start work from vague prompts such as "improve marketplace compatibility"
unless it is linked to a real package, install path, user journey, or CI/release
failure.

## Design Rules

Use the lightweight path for small fixes and the documented design path for
cross-cutting changes.

Small fixes need:

- one focused diff
- one narrow test or build command
- changelog/doc update only if behavior, install, API, or release metadata changed

Cross-cutting changes need a design in `docs/superpowers/specs/` before code when
they touch any of these:

- database schema or migration behavior
- REST/WS protocol surface
- encryption, auth, token handling, federation, or private topics
- package boundaries or repository split
- release workflow or publishing automation
- multi-framework hook behavior

Design documents must include alternatives considered, compatibility notes,
testing plan, and rollback plan.

## Development Rules

- Prefer package-local changes. Do not edit every subpackage unless the change is
  genuinely cross-package and scripted.
- Keep generated output out of source control unless the package release requires
  it. Avoid committing `coverage/`, `node_modules/`, runtime memory, Python
  caches, browser profiles, OpenClaw state, and temporary archives.
- Use structured APIs and parsers for JSON, package metadata, and workflow files.
- Keep TypeScript type tightening paired with tests where behavior could drift.
- For DB or protocol changes, update `docs/API.md`, `docs/README.md`,
  `docs/README_zh.md`, and `CHANGELOG.md` when user-visible behavior changes.
- For package metadata changes, verify `npm pack --dry-run` or `npm view` as
  appropriate.
- Commit subjects should be short and searchable:
  - good: `fix(hub): persist encrypted memory value`
  - good: `test(vscode): cover typed httpGet call sites`
  - bad: multi-paragraph subject lines with full verification logs

## Testing Matrix

Run the narrowest relevant commands first, then broaden when the change crosses
package boundaries.

| Changed area | Required verification |
| --- | --- |
| `hub/src/**` | `cd hub && npm run build && npm test` |
| Hub API docs only | command examples checked against current source; run targeted tests if examples imply behavior |
| `hub/src/db.ts`, encryption, memory, session store | `cd hub && npm run build && npx vitest run test/db.test.ts test/db_session.test.ts test/memory.test.ts test/encryption_integration.test.ts` |
| REST/WS server | `cd hub && npm run build && npm test`; add targeted integration or smoke test when endpoints change |
| `plugin/**` | `cd plugin && npm run build && npm pack --dry-run` |
| `mcp-bridge/**` | `cd mcp-bridge && npm run build`; run a stdio JSON-RPC smoke test if behavior changed |
| `packages/woclaw-hooks/**` | package dry run plus relevant shell or migration script test |
| `packages/codex-woclaw/**` | `python3 -m py_compile *.py`; installer dry run or controlled smoke test |
| `packages/opencode-woclaw-plugin/**` | plugin syntax check and package dry run |
| `packages/woclaw-vscode/**` | `cd packages/woclaw-vscode && npm run compile && npm test` |
| `scripts/**` | targeted script test and `npm run sync:skills:check` when SKILL metadata is involved |
| `.github/workflows/**` | validate trigger, path, cache key, and install command against package layout |
| docs/release metadata | verify package versions and tags with authoritative package files and registries |

Before declaring work complete, record exactly which commands ran and whether
they passed. If a command was skipped, record the reason.

## CI And Failure Policy

CI failures outrank new work. Follow `MAINTENANCE.md`.

When CI fails:

1. Fetch the failing workflow run and job log.
2. Classify it as code bug, package/lock issue, workflow issue, registry/network
   issue, or external service issue.
3. Reproduce locally when possible.
4. Fix the root cause, not just the symptom.
5. Update `docs/ci-failures.md` when the failure is non-trivial or when a prior
   entry is superseded.
6. Push only after local verification and watchdog gate pass.

## OpenClaw Automation Rules

OpenClaw cron agents must obey this project-specific loop:

1. Read `AGENTS.md`, this document, `MAINTENANCE.md`, and today's
   `memory/YYYY-MM-DD.md` if it exists.
2. Check CI before selecting work.
3. Prefer the highest-priority real-code candidate from
   `/usr/local/bin/heartbeat-watchdog.sh hint woclaw`.
4. Do not produce more than two `docs(roadmap)` commits per local day.
5. Do not make `feat(skill)`, `feat(type)`, `feat(docs)`, `feat(roadmap)`,
   `chore(docs)`, or generic `docs(*)` commits unless the watchdog gate allows
   them and they are tied to a concrete next code step.
6. Use concise commit subjects and place evidence in the body.
7. If push fails, leave the commit in place, document the failure, and stop
   retrying until the transport or remote state is understood.
8. If there are unpushed commits, do not rebase, amend, or squash them unless the
   maintainer explicitly asked for history cleanup.

## Security Rules

- Keep credential-bearing files mode `0600`.
- Do not print token-bearing JSON. Use `jq` projections that exclude secret
  values when inspecting config.
- `gateway.controlUi.dangerouslyDisableDeviceAuth=true` and
  `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork=true` are break-glass style
  settings. Keep them only on trusted networks and document why they are needed.
- Configure gateway auth rate limiting when the gateway bind is not loopback.
- Security-sensitive bugs go through GitHub private vulnerability reporting, not
  public issues.

## Documentation Rules

- Keep root `README.md`, `README_zh.md`, `docs/README.md`, `docs/README_zh.md`,
  `docs/PUBLISH.md`, package READMEs, and package metadata aligned.
- Do not rewrite historical changelog entries except to mark a superseded note
  clearly. Add new entries under `Unreleased`.
- Mark stale specs explicitly instead of silently relying on them. `SPEC.md`
  currently contains historical architecture details and must be cross-checked
  with current source and `docs/ROADMAP.md`.

## Release Checklist

1. Working tree clean except intentional version/changelog/release changes.
2. `git pull --rebase origin master` completed or remote state explicitly
   understood.
3. Package version, changelog, README badges, package manifest, and workflow tag
   trigger agree.
4. Required testing matrix commands passed.
5. `npm pack --dry-run` or Docker build metadata verified for release surfaces.
6. GitHub Actions on target commit are green.
7. Maintainer approved the release.
8. Create and push the package-specific tag.
9. Verify registry or Docker artifact after publish.
10. Record the release in `CHANGELOG.md` and docs if user-visible behavior
    changed.
