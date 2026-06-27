# WoClaw Agent Instructions

This repository is maintained by automated and human agents. Before making any
change, read this file and `docs/PROJECT-GOVERNANCE.md`.

## Non-Negotiable Rules

1. Keep the repository releasable. If GitHub Actions or local verification is
   red, stop feature work and fix the failure first.
2. Do real product work before ecosystem/marketplace metadata work. Pure
   roadmap, skill keyword, or marketplace-description commits are allowed only
   when linked to a concrete code, CI, packaging, or release task.
3. Never print, commit, or summarize secrets. Do not dump `~/.openclaw/openclaw.json`,
   credential files, npm tokens, GitHub tokens, or runtime auth tokens.
4. Keep commits small and reviewable. Use a concise Conventional Commit subject
   and put long evidence in the body or docs, not in a multi-paragraph subject.
5. Preserve user work. Do not reset, overwrite, or force-push existing changes
   unless the human explicitly asks for that operation.

## Required Work Loop

1. Check state:
   - `git status --short --branch`
   - `git log --oneline --decorate -n 8`
   - latest CI status for `XingP14/woclaw`
2. Pick work from this priority order:
   - failing CI or release blocker
   - security issue
   - package/runtime bug
   - test gap for existing behavior
   - documentation drift that affects install, publish, or API use
   - roadmap/spec grooming
3. Before committing, run the narrowest relevant verification from
   `docs/PROJECT-GOVERNANCE.md`.
4. Run the local watchdog gate when available:
   - `/usr/local/bin/heartbeat-watchdog.sh check woclaw "<commit subject>"`
5. Commit only if verification evidence is available. If verification cannot run,
   write down the blocker in the commit body or in `docs/ci-failures.md`.

## Project-Specific Guardrails

- The canonical governance document is `docs/PROJECT-GOVERNANCE.md`.
- The canonical roadmap is `docs/ROADMAP.md`; root `ROADMAP.md` is an entry point
  for runtimes that still read the repository root.
- `SPEC.md` is historical and partly stale. Do not use it as the sole source of
  current architecture.
- Do not commit `node_modules/`, `coverage/`, generated caches, runtime memory,
  or local OpenClaw state.
- Do not publish npm, Docker, VS Code Marketplace, or GitHub releases manually
  unless a release checklist has passed and the human approved the release.

