#!/usr/bin/env node
// scripts/sync-skill-frontmatter.mjs
// Sync the `compatible_with:` array across SKILL.md files in the woclaw
// monorepo to eliminate drift between subpackages.
//
// Usage:
//   node scripts/sync-skill-frontmatter.mjs                       # dry-run (default; packages/* only)
//   node scripts/sync-skill-frontmatter.mjs --write               # write back
//   node scripts/sync-skill-frontmatter.mjs --check               # CI mode: exit 1 if drift, no writes
//   node scripts/sync-skill-frontmatter.mjs --source <pkg>        # treat <pkg> as canonical list
//   node scripts/sync-skill-frontmatter.mjs --all                 # also include hub/ mcp-bridge/ plugin/ SKILL.md
//   node scripts/sync-skill-frontmatter.mjs --include <dirs>      # comma-sep extra dirs (one-level deep); each child subdir's SKILL.md scanned (07-01 cron fix: covers plugin/skills/* + skills/* drift)
//
// Strategy:
//   1. Read every packages/*/SKILL.md frontmatter block (YAML-like, parsed with a
//      minimal scanner that respects the inline `[a, b, c]` list form).
//      With --all, also scan hub/SKILL.md, mcp-bridge/SKILL.md, plugin/SKILL.md
//      (7 subpackages in total: codex-woclaw, opencode-woclaw-plugin, woclaw-hooks,
//      woclaw-vscode + hub + mcp-bridge + plugin).
//   2. Build the union of all `compatible_with` items. Optional `--source <pkg>`
//      uses a single subpackage's list as the canonical list (faster, no growth).
//   2b. With `--include <csv>`, also scan each listed directory's immediate
//      children for SKILL.md (one level deep). Used for `plugin/skills/*/SKILL.md`
//      and `skills/*/SKILL.md`, the per-skill workspace shims that the standard
//      packages/ + hub/ + mcp-bridge/ + plugin/ scan misses (07-01 cron fix).
//   3. Sort the items (case-insensitive) and re-emit a stable, single-line list.
//   4. Print a per-file diff; with --write, rewrite the file in place.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 06-20 00:43 cron fix: respect WOCLAW_ROOT env or process.cwd() so the script
// works from any directory (previously hardcoded to dirname(__dirname),
// which made subprocess-based tests + CI monorepo workarounds impossible).
const repoRoot = process.env.WOCLAW_ROOT || process.cwd();

const args = new Set(process.argv.slice(2));
const writeMode = args.has('--write') || args.has('-w');
const checkMode = args.has('--check');
const sourceIdx = process.argv.indexOf('--source');
const sourcePkg = sourceIdx > -1 ? process.argv[sourceIdx + 1] : null;
const verbose = args.has('--verbose') || args.has('-v');
const allMode = args.has('--all') || args.has('-a');
// --include <csv>: comma-separated list of directories (relative to repoRoot) to
// scan 1-level deep for SKILL.md. Each child subdir's SKILL.md is added to the
// discovery list. Used to cover per-skill workspace shims like plugin/skills/*
// and skills/* that the standard packages/+hub/+mcp-bridge/+plugin/ scan misses.
const includeIdx = process.argv.indexOf('--include');
const includeDirs = includeIdx > -1
  ? process.argv[includeIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
  : [];

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
  // 07-01 cron fix: --include <csv> extends discovery to extra 1-level-deep dirs.
  // This covers `plugin/skills/<name>/SKILL.md` and `skills/<name>/SKILL.md`,
  // which are the per-skill workspace shims. Without this, those 3 SKILL.md
  // drift in silence (script never sees them) — caught by 07-01 cron when
  // `plugin/skills/woclaw/SKILL.md` had no compatible_with field at all while
  // packages/* had ~100 entries each.
  for (const sub of includeDirs) {
    const dir = join(root, sub);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      log('--include dir missing or unreadable:', sub);
      continue;
    }
    for (const child of entries) {
      const childDir = join(dir, child);
      try {
        if (!statSync(childDir).isDirectory()) continue;
      } catch { continue; }
      const skillPath = join(childDir, 'SKILL.md');
      try {
        statSync(skillPath);
        // Tag with a synthetic pkg name: `<includeDir>:<child>` so the basename
        // stays unique across nested shims (e.g. plugin/skills/woclaw vs
        // packages/woclaw-hooks — both would otherwise collapse to `woclaw`).
        out.push({ path: skillPath, pkg: `${sub}:${child}` });
        continue;
      } catch { /* skip — no SKILL.md */ }
      // Allow plain SKILL.md directly under the include dir (rare; e.g. skills/SKILL.md).
      if (child === 'SKILL.md') {
        out.push({ path: join(dir, 'SKILL.md'), pkg: sub });
      }
    }
  }
  // If any entries are bare strings (the original shape) we kept them — but the
  // --include branch returns {path,pkg} objects. Normalise to the {path,pkg}
  // shape so the rest of main() stays uniform.
  return out.map(x => typeof x === 'string' ? { path: x, pkg: basename(dirname(x)) } : x);
}

function main() {
  const entries = findSkillFiles(repoRoot);
  // entries is now an array of {path, pkg} (mixed: packages use basename,
  // --include uses `<dir>:<child>`). Back-compat: if a legacy caller still
  // returns strings we wrap them.
  const files = entries.map(e => typeof e === 'string' ? { path: e, pkg: basename(dirname(e)) } : e);
  const modeLabel = allMode && includeDirs.length === 0
    ? '(all-mode: 7 subpackages)'
    : includeDirs.length > 0
      ? `(include: ${includeDirs.join(',')})`
      : '(packages-only)';
  log('found', files.length, 'SKILL.md files', modeLabel);
  if (!files.length) {
    console.error('No SKILL.md files found under packages/.');
    process.exit(1);
  }

  const parsed = files.map(e => {
    // 07-01 cron fix: --include may surface SKILL.md files that lack a
    // compatible_with field (e.g. plugin/skills/woclaw-hub-test/SKILL.md uses
    // a metadata-block layout). Default missing keys so downstream code can
    // safely read .attrs.compatible_with without nullish guards.
    const fm = parseFrontmatter(readFileSync(e.path, 'utf8')) || {
      attrs: { compatible_with: [] },
      body: '',
      raw: '',
    };
    return { path: e.path, pkg: e.pkg, ...fm };
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
    // Sort alphabetically so all 7 SKILL.md files converge to identical byte order;
    // otherwise Set insertion order depends on file enumeration and the union drifts
    // across runs (regression caught by integration-test/sync-skill-frontmatter).
    canonical = [...set].sort();
    log('union size:', canonical.length);
  }

  let changedCount = 0;
  for (const p of parsed) {
    const before = p.attrs.compatible_with;
    // Same content AND same order → skip. Order matters: the integration test
    // expects all 7 SKILL.md files to be byte-identical, and a Set-equality
    // check would leave files written in their original list order even after
    // the union is sorted (regression caught 06-20 by integration-test).
    const sameSize = before.length === canonical.length;
    const sameOrder = sameSize && before.every((x, i) => x === canonical[i]);
    if (sameOrder) {
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

  console.log(`\n[${writeMode ? 'WRITE' : checkMode ? 'CHECK' : 'DRY-RUN'}] ${changedCount}/${parsed.length} files out of sync.`);
  if (checkMode) {
    // --check: CI-friendly. exit 1 if any drift detected (without modifying files).
    // Useful for pre-commit / CI gating: `node sync-skill-frontmatter.mjs --check --all`
    if (changedCount > 0) {
      console.log(`✗ drift detected — re-run with --write to fix.`);
      process.exit(1);
    }
    console.log(`✓ all SKILL.md compatible_with lists in sync.`);
    process.exit(0);
  }
  if (!writeMode && changedCount > 0) {
    console.log('Re-run with --write to apply.');
    process.exit(0);
  }
  process.exit(0);
}

main();
