# Repository Hygiene

This file records what belongs in the WoClaw repository and what must stay local
to a development host.

## Tracked Source

- Product source: `hub/`, `plugin/`, `mcp-bridge/`, `packages/`, `site/`,
  `scripts/`, `integration-test/`
- Product docs: root README files, `docs/`, `CHANGELOG.md`, `SECURITY.md`,
  `CONTRIBUTING.md`, `MAINTENANCE.md`, `AGENTS.md`
- Package manifests and lock files that define reproducible installs:
  `package.json`, `package-lock.json`, and package-local lock files
- Release metadata: package manifests, workflow files, Dockerfile, service files,
  plugin manifests, and SKILL files

## Ignored Local State

These are intentionally ignored and should not be committed:

- dependency trees: `node_modules/`
- generated build output: `dist/`, `build/`, VS Code `out/` when regenerated
- test reports: `coverage/`
- local worktrees: `.worktrees/`
- local runtime memory: `memory/`
- Python caches: `__pycache__/`, `*.pyc`, `*.pyo`, `*.pyd`
- credentials and environment files: `.env`, `.env.local`, `.env.*.local`,
  `.npmrc`

## Cleanup Rules

1. Use `git status --ignored --short` and `git clean -ndX` before deleting
   ignored files.
2. Do not run `git clean -fdX` blindly from the repository root. It can remove
   package-local dependency trees and local worktrees that are useful for
   debugging.
3. Before removing a large ignored directory, verify it is not registered with
   `git worktree list --porcelain` and does not contain uncommitted work.
4. Keep release-required generated files only when a package manifest includes
   them in `files[]` and the package is designed to publish generated output.
5. Move runtime notes out of the repository. If a future agent needs persistent
   notes, store them in the OpenClaw runtime state or an external backup path,
   not in `memory/`.

## Current Cleanup Decision

As of 2026-06-27, the old tracked `memory/*.md` files and the tracked Codex
Python bytecode cache were removed from source control. The local `memory/`
directory was backed up before removal.
