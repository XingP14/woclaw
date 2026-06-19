# scripts/

Maintenance scripts for the WoClaw monorepo.

## sync-skill-frontmatter.mjs

Keeps the `compatible_with:` array across all `packages/*/SKILL.md` files in
sync. Without it, each subpackage drifts independently as new compatibility
tags are added — which means a tag-skill matcher in a marketplace might match
`woclaw-hooks` but miss `woclaw-vscode` for the same feature.

### Usage

```bash
# Dry-run: see which files would change
node scripts/sync-skill-frontmatter.mjs

# Apply changes
node scripts/sync-skill-frontmatter.mjs --write

# Use a specific subpackage as the canonical list
node scripts/sync-skill-frontmatter.mjs --source woclaw-hooks --write

# Verbose logging
node scripts/sync-skill-frontmatter.mjs --verbose
```

### Algorithm

1. Parse each `packages/*/SKILL.md` frontmatter (minimal inline-list scanner,
   no YAML dependency).
2. Build the **union** of all `compatible_with` items, deduplicated and
   case-insensitive sorted. With `--source <pkg>`, use a single package's
   list as the canonical source.
3. Re-emit the `compatible_with:` line in each file, leaving all other
   frontmatter fields and the body untouched.

### Properties

- **Idempotent** — running it twice in a row makes zero further changes.
- **No new dependencies** — pure Node 18+ ESM, no npm install required.
- **Safe by default** — exits with code 0 in dry-run mode and only writes
  files when `--write` is passed.
