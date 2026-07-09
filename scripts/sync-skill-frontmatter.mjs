#!/usr/bin/env node
// scripts/sync-skill-frontmatter.mjs
// Sync the `compatible_with:` array across SKILL.md files in the woclaw
// monorepo to eliminate drift between subpackages.
//
// Usage:
//   node scripts/sync-skill-frontmatter.mjs                       # dry-run (default; packages/* only)
//   node scripts/sync-skill-frontmatter.mjs --write               # write back
//   node scripts/sync-skill-frontmatter.mjs --check               # CI mode: exit 0/1/2/3 (see Exit codes), no writes
//   node scripts/sync-skill-frontmatter.mjs --source <pkg>        # treat <pkg> as canonical list
//   node scripts/sync-skill-frontmatter.mjs --all                 # also include hub/ mcp-bridge/ plugin/ SKILL.md
//   node scripts/sync-skill-frontmatter.mjs --include <dirs>      # comma-sep extra dirs (one-level deep); each child subdir's SKILL.md scanned (07-01 cron fix: covers plugin/skills/* + skills/* drift)
//   node scripts/sync-skill-frontmatter.mjs --exclude <tags>      # comma-sep pkg tags to skip (07-01 03:03 cron: for skill spec docs that are intentionally not compatible_with lists)
//   node scripts/sync-skill-frontmatter.mjs --diff                # dry-run + per-file unified-diff (07-06 06:43 cron) — shows the byte-level change before --write
//   node scripts/sync-skill-frontmatter.mjs --verbose             # verbose logging (drift details, included shim files)
//
// Exit codes (--check only):
//   0 = all SKILL.md compatible_with lists in sync
//   1 = auto-fixable drift (run with --write to converge)
//   2 = manual-fix required: at least one file has NO frontmatter block
//       (run with --write --exclude '<pkg-tag>' or add a --- block manually)
//   3 = both (1 + 2) — some files drift and some are missing frontmatter
//
// Strategy:
//   1. Read every packages/*/SKILL.md frontmatter block (YAML-like, parsed with a
//      minimal scanner that respects the inline `[a, b, c]` list form).
//      With --all, also scan hub/SKILL.md, mcp-bridge/SKILL.md, plugin/SKILL.md
//      (8 subpackages in total: codex-woclaw, codex-woclaw-example, opencode-woclaw-plugin, woclaw-hooks,
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
// --diff: in dry-run mode, also print a per-file unified-diff so operators can see
// the byte-level change before committing --write. Under --write the file already
// changes on disk (no need to print); under --check the diff is useful so operators
// can audit what would change before deciding to --write.
const diffMode = args.has('--diff') || args.has('-d');
// --include <csv>: comma-separated list of directories (relative to repoRoot) to
// scan 1-level deep for SKILL.md. Each child subdir's SKILL.md is added to the
// discovery list. Used to cover per-skill workspace shims like plugin/skills/*
// and skills/* that the standard packages/+hub/+mcp-bridge/+plugin/ scan misses.
const includeIdx = process.argv.indexOf('--include');
const includeDirs = includeIdx > -1
  ? process.argv[includeIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
  : [];
// --exclude <csv>: comma-separated list of pkg tags to skip during sync.
// Useful for skill spec docs (e.g. plugin/skills/woclaw-hub-test/SKILL.md) that
// are intentionally not compatible_with lists. Tag format matches whatever
// findSkillFiles emits: basename for packages/*, `<dir>:<child>` for
// --include directories, or `hub` / `mcp-bridge` / `plugin` for top-level.
const excludeIdx = process.argv.indexOf('--exclude');
const excludeTags = new Set(excludeIdx > -1
  ? process.argv[excludeIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
  : []);

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
  // 07-01 03:03 cron fix: if the frontmatter has NO `compatible_with:` line,
  // the regex replace below is a silent no-op and --write falsely reports
  // "wrote X (0 → N items)" without actually changing the file. The bug bit
  // 520a1c7 (--include feature) on the real woclaw monorepo where 3 shim files
  // (skills/woclaw, plugin/skills/woclaw, plugin/skills/woclaw-hub-test) had
  // no compatible_with line at all. The script "wrote" them and they stayed
  // unchanged. Now we inject the line at the end of the frontmatter block
  // (just before the closing `---`) when the regex misses.
  const re = /^compatible_with:\s*\[.*?\]\s*$/m;
  if (re.test(rawFrontmatter)) {
    return rawFrontmatter.replace(re, `compatible_with: [${joined}]`);
  }
  // Inject inside the frontmatter block, just before the closing `---`.
  // The script captures the full match (---\n...\n---) into rawFrontmatter, so
  // we splice the new key between the inner content and the trailing closer.
  // Use indexOf on the LAST `\n---` to find the closing marker — YAML allows
  // multi-line strings in the body so we cannot assume the frontmatter only
  // contains one `---` line (the opener is followed by content; only the
  // closer ends the block).
  const closerIdx = rawFrontmatter.lastIndexOf('\n---');
  if (closerIdx < 0) {
    // Defensive: shouldn't happen since `fm[0]` was matched by /^---\n([\s\S]*?)\n---/,
    // but if the frontmatter is malformed (no closing ---) bail out by
    // returning the input unchanged so --write is a no-op rather than
    // corrupting the file.
    return rawFrontmatter;
  }
  const inner = rawFrontmatter.slice(0, closerIdx);
  return `${inner}\ncompatible_with: [${joined}]\n---`;
}


/**
 * Build a minimal unified-diff (lines starting with ' ', '-', '+') for a single
 * SKILL.md file. Scope is restricted to the frontmatter block to keep output
 * short — the rest of the file is byte-identical so showing it would be noise.
 * Returns a string ready to print to stdout.
 */
function formatUnifiedDiff(filePath, beforeText, afterText) {
  const beforeFmMatch = beforeText.match(/^---\n([\s\S]*?)\n---\n/);
  const afterFmMatch = afterText.match(/^---\n([\s\S]*?)\n---\n/);
  const beforeFm = beforeFmMatch ? beforeFmMatch[0] : '<no frontmatter>\n';
  const afterFm = afterFmMatch ? afterFmMatch[0] : '<no frontmatter>\n';
  if (beforeFm === afterFm) return '';
  const beforeLines = beforeFm.split('\n');
  const afterLines = afterFm.split('\n');
  const out = ['--- a/' + filePath, '+++ b/' + filePath, '@@ frontmatter @@'];
  // Emit deletions first, then additions. We use a simple longest-common-prefix
  // (LCP) approach: lines present in before but not in after are '-', vice versa.
  const afterSet = new Set(afterLines);
  const beforeSet = new Set(beforeLines);
  for (const ln of beforeLines) {
    if (afterSet.has(ln)) out.push(' ' + ln);
    else out.push('-' + ln);
  }
  for (const ln of afterLines) {
    if (!beforeSet.has(ln)) out.push('+' + ln);
  }
  return out.join('\n');
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
    // so all 8 subpackages stay in sync. The "8 subpackages" are:
    //   1. packages/codex-woclaw
    //   2. packages/codex-woclaw-example
    //   3. packages/opencode-woclaw-plugin
    //   4. packages/woclaw-hooks
    //   5. packages/woclaw-vscode
    //   6. hub
    //   7. mcp-bridge
    //   8. plugin
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
    ? '(all-mode: 8 subpackages)'
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

  // 07-04 04:23 cron: split drift into two buckets so --check can return a
  // distinct exit code for "auto-fixable" (changedCount) vs "manual-fix
  // required" (manualFixCount). Pre-this-change, both buckets collapsed to
  // a single exit 1, which made CI hard to triage (a single missing
  // frontmatter file would block the gate even though --write could not
  // fix it). See exit code table at the top of the file.
  let changedCount = 0;
  const manualFixRequired = []; // [{ pkg, path, reason }]
  let manualFixCount = 0;
  for (const p of parsed) {
    // 07-01 03:03 cron: --exclude lets the operator drop a file from the
    // sync without deleting it. Used for skill spec docs that are
    // intentionally not compatible_with lists.
    if (excludeTags.has(p.pkg)) {
      log(p.pkg, 'excluded via --exclude; skipping');
      continue;
    }
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
    // Peek at the raw file BEFORE we bump any counter, so the no-frontmatter
    // branch below can route the file into the manual-fix bucket without it
    // ALSO showing up in the auto-fixable bucket. Pre-this-change, we bumped
    // `changedCount` unconditionally above this branch (line ~264 in the old
    // ordering) and then "un-counted" via a comment — but the bump still
    // happened first, so a missing-frontmatter file was counted in BOTH
    // buckets and the exit code went 3 instead of 2 when it should have been 2.
    // (Bug caught 07-04 04:23 cron by the new exit-code semantics test.)
    const text = readFileSync(p.path, 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) {
      // 07-01 03:03 cron: surface this case so --check exits with the
      // manual-fix bucket (exit 2). The file is missing frontmatter entirely
      // and we deliberately do NOT auto-create one, since that would risk
      // clobbering body content. Operator must add a frontmatter block first.
      // 07-04 04:23 cron: increment ONLY the manual-fix counter here, not
      // changedCount — the file cannot be auto-fixed, so it has no business
      // counting as "auto-fixable drift".
      console.error(`⚠ ${p.pkg}: no frontmatter block — --write cannot inject compatible_with; add \`---\` block manually`);
      manualFixRequired.push({ pkg: p.pkg, path: p.path, reason: 'no frontmatter block' });
      manualFixCount++;
      continue;
    }
    // From here on, the file IS auto-fixable.
    changedCount++;
    const newFm = rewriteCompatible(fm[0], canonical);
    const newText = text.replace(fm[0], newFm);
    if (writeMode) {
      writeFileSync(p.path, newText, 'utf8');
      console.log(`✏️  wrote ${p.path} (${before.length} → ${canonical.length} items)`);
    } else {
      console.log(`🔎 would rewrite ${p.path} (${before.length} → ${canonical.length} items)`);
      if (diffMode) {
        // 07-06 06:43 cron: --diff prints the byte-level change so operators can
        // audit the rewrite before committing --write. Scope to the frontmatter
        // block only — the rest of the file is unchanged so showing it would be
        // pure noise.
        const diff = formatUnifiedDiff(p.path, text, newText);
        if (diff) console.log(diff);
      }
    }
  }

  // 07-04 04:23 cron: include manualFixCount in the summary line so dry-run
  // and --write modes also surface the no-frontmatter case clearly. Without
  // this, operators running `node sync-skill-frontmatter.mjs --write`
  // saw "0/11 files out of sync" even though 1 file was silently skipped.
  const driftSummary = manualFixCount > 0
    ? `${changedCount}/${parsed.length} auto-fixable, ${manualFixCount} manual-fix`
    : `${changedCount}/${parsed.length}`;
  console.log(`\n[${writeMode ? 'WRITE' : checkMode ? 'CHECK' : 'DRY-RUN'}] ${driftSummary} files drifted.`);
  if (checkMode) {
    // --check: CI-friendly. Exit code encodes the kind of drift found
    // (see exit-code table at the top of this file):
    //   0 = clean
    //   1 = auto-fixable drift (changedCount > 0)
    //   2 = manual-fix required (manualFixCount > 0)
    //   3 = both buckets non-empty (1 | 2)
    // Without this split, a single missing-frontmatter file would surface
    // the same way as 50 auto-fixable files, so the cron CI gate could
    // not distinguish "run --write" from "add a frontmatter block manually".
    const exitCode = (changedCount > 0 ? 1 : 0) | (manualFixCount > 0 ? 2 : 0);
    if (exitCode === 0) {
      console.log(`✓ all SKILL.md compatible_with lists in sync.`);
      process.exit(0);
    }
    if (changedCount > 0) {
      console.log(`✗ auto-fixable drift detected (${changedCount}/${parsed.length} files) — re-run with --write to fix.`);
    }
    if (manualFixCount > 0) {
      console.log(`✗ manual-fix required (${manualFixCount} file${manualFixCount === 1 ? '' : 's'} missing frontmatter):`);
      for (const m of manualFixRequired) {
        console.log(`   - ${m.pkg}: ${m.path} (${m.reason})`);
      }
      console.log(`  options: (a) add a --- frontmatter block, or (b) re-run with --write --exclude '<pkg-tag>' to skip`);
    }
    process.exit(exitCode);
  }
  if (!writeMode && changedCount > 0) {
    console.log('Re-run with --write to apply.');
    process.exit(0);
  }
  process.exit(0);
}

main();
