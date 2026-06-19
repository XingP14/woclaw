#!/usr/bin/env node
// scripts/sync-skill-frontmatter.mjs
// Sync the `compatible_with:` array across SKILL.md files in the woclaw
// monorepo to eliminate drift between subpackages.
//
// Usage:
//   node scripts/sync-skill-frontmatter.mjs                # dry-run (default; packages/* only)
//   node scripts/sync-skill-frontmatter.mjs --write        # write back
//   node scripts/sync-skill-frontmatter.mjs --source <pkg> # treat <pkg> as canonical list
//   node scripts/sync-skill-frontmatter.mjs --all          # also include hub/ mcp-bridge/ plugin/ SKILL.md
//
// Strategy:
//   1. Read every packages/*/SKILL.md frontmatter block (YAML-like, parsed with a
//      minimal scanner that respects the inline `[a, b, c]` list form).
//      With --all, also scan hub/SKILL.md, mcp-bridge/SKILL.md, plugin/SKILL.md
//      (7 subpackages in total: codex-woclaw, opencode-woclaw-plugin, woclaw-hooks,
//      woclaw-vscode + hub + mcp-bridge + plugin).
//   2. Build the union of all `compatible_with` items. Optional `--source <pkg>`
//      uses a single subpackage's list as the canonical list (faster, no growth).
//   3. Sort the items (case-insensitive) and re-emit a stable, single-line list.
//   4. Print a per-file diff; with --write, rewrite the file in place.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

const args = new Set(process.argv.slice(2));
const writeMode = args.has('--write') || args.has('-w');
const sourceIdx = process.argv.indexOf('--source');
const sourcePkg = sourceIdx > -1 ? process.argv[sourceIdx + 1] : null;
const verbose = args.has('--verbose') || args.has('-v');
const allMode = args.has('--all') || args.has('-a');

function log(...a) { if (verbose) console.error('[sync]', ...a); }

/**
 * Parse the frontmatter block of a SKILL.md file.
 * Returns { attrs: {key: rawValue}, body } or null if no frontmatter.
 */
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const block = m[1];
  const body = text.slice(m[0].length);
  const attrs = {};
  // We only need: name, description, compatible_with (everything else is preserved as-is).
  for (const key of ['name', 'description', 'skill_type', 'folder_structure']) {
    const re = new RegExp(`^${key}:\\s*(.*)$`, 'm');
    const mm = block.match(re);
    if (mm) attrs[key] = mm[1].trim();
  }
  // compatible_with is on a single line as an inline list
  const cw = block.match(/^compatible_with:\s*\[(.*?)\]\s*$/m);
  if (cw) {
    attrs.compatible_with = cw[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  } else {
    // multi-line list fallback
    const block2 = block.match(/^compatible_with:\s*\[([\s\S]*?)\]/m);
    if (block2) {
      attrs.compatible_with = block2[1]
        .split(/[\n,]/)
        .map(s => s.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      attrs.compatible_with = [];
    }
  }
  return { attrs, body, raw: m[0] };
}

/**
 * Re-emit the compatible_with line. We keep the rest of the frontmatter
 * untouched to minimise accidental churn.
 */
function rewriteCompatible(rawFrontmatter, newList) {
  const sorted = [...new Set(newList.map(s => s.trim()))]
    .filter(Boolean)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const joined = sorted.join(', ');
  return rawFrontmatter.replace(
    /^compatible_with:\s*\[.*?\]\s*$/m,
    `compatible_with: [${joined}]`
  );
}

function findSkillFiles(root) {
  const out = [];
  const packagesDir = join(root, 'packages');
  for (const name of readdirSync(packagesDir)) {
    const dir = join(packagesDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const skillPath = join(dir, 'SKILL.md');
    try {
      statSync(skillPath);
      out.push(skillPath);
    } catch { /* skip — no SKILL.md */ }
  }
  if (allMode) {
    // Extend coverage to the 3 top-level SKILL.md files (hub, mcp-bridge, plugin)
    // so all 7 subpackages stay in sync. The "7 subpackages" are:
    //   1. packages/codex-woclaw
    //   2. packages/opencode-woclaw-plugin
    //   3. packages/woclaw-hooks
    //   4. packages/woclaw-vscode
    //   5. hub
    //   6. mcp-bridge
    //   7. plugin
    for (const top of ['hub', 'mcp-bridge', 'plugin']) {
      const skillPath = join(root, top, 'SKILL.md');
      try {
        statSync(skillPath);
        out.push(skillPath);
      } catch { /* skip — no SKILL.md */ }
    }
  }
  return out;
}

function main() {
  const files = findSkillFiles(repoRoot);
  log('found', files.length, 'SKILL.md files', allMode ? '(all-mode: 7 subpackages)' : '(packages-only)');
  if (!files.length) {
    console.error('No SKILL.md files found under packages/.');
    process.exit(1);
  }

  const parsed = files.map(p => {
    const pkg = basename(dirname(p));
    return { path: p, pkg, ...parseFrontmatter(readFileSync(p, 'utf8')) };
  });

  let canonical;
  if (sourcePkg) {
    const src = parsed.find(p => p.pkg === sourcePkg);
    if (!src) {
      console.error(`--source ${sourcePkg} not found. Available: ${parsed.map(p => p.pkg).join(', ')}`);
      process.exit(2);
    }
    canonical = src.attrs.compatible_with;
    log('using', sourcePkg, 'as canonical with', canonical.length, 'items');
  } else {
    const counts = parsed.map(p => [p.pkg, p.attrs.compatible_with.length]);
    log('per-package compatible_with counts:', counts);
    const set = new Set();
    for (const p of parsed) for (const x of p.attrs.compatible_with) set.add(x);
    canonical = [...set];
    log('union size:', canonical.length);
  }

  let changedCount = 0;
  for (const p of parsed) {
    const before = p.attrs.compatible_with;
    const beforeSet = new Set(before);
    const afterSet = new Set(canonical);
    const sameSize = before.length === canonical.length;
    const sameSet = before.length === [...beforeSet].filter(x => afterSet.has(x)).length && sameSize;
    if (sameSet) {
      log(p.pkg, 'already in sync (' + before.length + ' items)');
      continue;
    }
    changedCount++;
    const text = readFileSync(p.path, 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) { log(p.pkg, 'no frontmatter — skip'); continue; }
    const newFm = rewriteCompatible(fm[0], canonical);
    const newText = text.replace(fm[0], newFm);
    if (writeMode) {
      writeFileSync(p.path, newText, 'utf8');
      console.log(`✏️  wrote ${p.path} (${before.length} → ${canonical.length} items)`);
    } else {
      console.log(`🔎 would rewrite ${p.path} (${before.length} → ${canonical.length} items)`);
    }
  }

  console.log(`\n[${writeMode ? 'WRITE' : 'DRY-RUN'}] ${changedCount}/${parsed.length} files out of sync.`);
  if (!writeMode && changedCount > 0) {
    console.log('Re-run with --write to apply.');
    process.exit(0);
  }
  process.exit(0);
}

main();
