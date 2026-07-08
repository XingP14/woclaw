# scripts/

Maintenance scripts for the WoClaw monorepo.

## sync-skill-frontmatter.mjs

Keeps the `compatible_with:` array across all `packages/*/SKILL.md` files in
sync. Without it, each subpackage drifts independently as new compatibility
tags are added — which means a tag-skill matcher in a marketplace might match
`woclaw-hooks` but miss `woclaw-vscode` for the same feature.

Discovers **8 subpackages** total: the 5 packages under `packages/*` (codex-woclaw,
codex-woclaw-example, opencode-woclaw-plugin, woclaw-hooks, woclaw-vscode) plus
`hub/`, `mcp-bridge/`, and `plugin/` (their SKILL.md files participate in the
same `compatible_with` union via `--all`). The headline count grew from 7 to 8
when `codex-woclaw-example` was added on 06-28 bbf2489 (07-02 01:33 cron fix).

### Usage

```bash
# Dry-run: see which files would change (default scope = packages/* only)
node scripts/sync-skill-frontmatter.mjs

# Write back: actually rewrite the SKILL.md files
node scripts/sync-skill-frontmatter.mjs --write

# Recommended pre-write audit: see the unified diff BEFORE --write lands
# the change. Pair `--diff` + `--write` is a no-op (file already changes on
# disk). Workflow: --diff first, --write after review (07-06 06:43 cron).
node scripts/sync-skill-frontmatter.mjs --diff

# CI gate: dry-run + exit-code encoded drift bucket (see Exit codes below)
node scripts/sync-skill-frontmatter.mjs --check

# Use a specific subpackage as the canonical list (faster, no growth)
node scripts/sync-skill-frontmatter.mjs --source woclaw-hooks --write

# Discover 8 subpackages instead of 5 (include hub/ + mcp-bridge/ + plugin/)
node scripts/sync-skill-frontmatter.mjs --all

# Scan per-skill workspace shims that the default packages/* scan misses
# (plugin/skills/* and skills/* are NOT under packages/, so they need an
# explicit include; 07-01 cron fix).
node scripts/sync-skill-frontmatter.mjs --include plugin/skills,skills --write

# Skip specific pkg tags during sync (used for skill spec docs that are
# intentionally NOT compatible_with lists — e.g. plugin/skills:woclaw-hub-test;
# 07-01 03:03 cron regression gate).
node scripts/sync-skill-frontmatter.mjs --exclude plugin/skills:woclaw-hub-test

# Verbose logging (drift details, included shim files, etc.)
node scripts/sync-skill-frontmatter.mjs --verbose
```

### Exit codes (`--check` only)

The `--check` mode returns 4 distinct exit codes so CI consumers can decide
whether the drift is auto-fixable (just re-run with `--write`) or requires
manual intervention (add a `---` frontmatter block to the offending file).
Added 07-04 04:23 cron.

| Exit code | Meaning | Remediation |
| --------- | ------- | ----------- |
| 0 | All SKILL.md `compatible_with` lists in sync | None — clean baseline |
| 1 | Auto-fixable drift (some files have an older `compatible_with` list) | Re-run with `--write` to converge |
| 2 | Manual-fix required: at least one file has NO frontmatter block | Run `--write --exclude '<pkg-tag>'` or add the `---` block manually |
| 3 | Both 1 and 2 — some files drift and some are missing frontmatter | Address the bucket-2 files first, then re-run with `--write` |

### Algorithm

1. Parse each `packages/*/SKILL.md` frontmatter (minimal inline-list scanner,
   no YAML dependency).
2. Build the **union** of all `compatible_with` items, deduplicated and
   case-insensitive sorted. With `--source <pkg>`, use a single package's
   list as the canonical source.
3. With `--all`, also scan `hub/SKILL.md`, `mcp-bridge/SKILL.md`,
   `plugin/SKILL.md` (giving 8 subpackages total). With `--include <csv>`,
   additionally scan the immediate children of each listed directory
   (one-level deep) — used for `plugin/skills/*/SKILL.md` and
   `skills/*/SKILL.md` shims.
4. Re-emit the `compatible_with:` line in each file, leaving all other
   frontmatter fields and the body untouched.

### Properties

- **Idempotent** — running it twice in a row makes zero further changes.
- **No new dependencies** — pure Node 18+ ESM, no npm install required.
- **Safe by default** — exits with code 0 in dry-run mode and only writes
  files when `--write` is passed.

### Maintenance

The `--check` exit-code table, the `8 subpackages` headline, and the
flag-by-flag Usage block above are gated against `scripts/sync-skill-frontmatter.mjs`
itself by `integration-test/scripts-readme-cli-parity.test.ts`. A future cron
that adds or renames a flag MUST update both the script's top-of-file Usage
block AND this README, otherwise the parity test fails (07-09 06:23 cron).