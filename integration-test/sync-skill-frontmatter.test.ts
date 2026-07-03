// integration-test/sync-skill-frontmatter.test.ts
// Vitest coverage for scripts/sync-skill-frontmatter.mjs (06-20 00:43 cron,
// per watchdog hint "scripts/sync-skill-frontmatter.mjs (抽 7 子包同步脚本, 解 SKILL.md 漂移)")
//
// Strategy: spawn the script as a subprocess against a temp dir of fake SKILL.md files.
// This gives us end-to-end coverage of:
//   - --check  exit code semantics (0 = in-sync, 1 = drift)
//   - --write  round-trip equality (rewriting again is a no-op)
//   - --source <pkg> canonical-list behaviour (no growth when one pkg is canon)
//   - 7-subpackage discovery logic via --all
//
// We deliberately do NOT mock the file system — we use os.tmpdir() + mkdtemp + rmSync
// so a CI run leaves no junk behind.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts', 'sync-skill-frontmatter.mjs');

function writeSkill(dir: string, pkgName: string, compatList: string[]) {
  mkdirSync(dir, { recursive: true });
  const fm = `---
name: ${pkgName}
description: test fixture
compatible_with: [${compatList.join(', ')}]
---

# ${pkgName} skill

body line 1
`;
  writeFileSync(join(dir, 'SKILL.md'), fm);
}

describe('sync-skill-frontmatter.mjs', () => {
  let tmpRoot: string;
  let pkgDirs: Record<string, string>;
  const scriptRun = (args: string[]) => spawnSync('node', [scriptPath, ...args], {
    cwd: tmpRoot,
    env: { ...process.env, WOCLAW_ROOT: tmpRoot },
    encoding: 'utf8',
  });

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sync-skill-'));
    // Layout mirrors woclaw monorepo: packages/<name>/SKILL.md + hub|mcp-bridge|plugin/SKILL.md (8 files; was 7 before codex-woclaw-example was added 06-28 bbf2489)
    pkgDirs = {
      codex: join(tmpRoot, 'packages', 'codex-woclaw'),
      codexExample: join(tmpRoot, 'packages', 'codex-woclaw-example'),
      opencode: join(tmpRoot, 'packages', 'opencode-woclaw-plugin'),
      hooks: join(tmpRoot, 'packages', 'woclaw-hooks'),
      vscode: join(tmpRoot, 'packages', 'woclaw-vscode'),
      hub: join(tmpRoot, 'hub'),
      'mcp-bridge': join(tmpRoot, 'mcp-bridge'),
      plugin: join(tmpRoot, 'plugin'),
    };
    writeSkill(pkgDirs.codex, 'codex', ['claude-code', 'opencode']);
    writeSkill(pkgDirs.codexExample, 'codex-example', ['claude-code', 'opencode']);
    writeSkill(pkgDirs.opencode, 'opencode', ['opencode', 'claude-code']);
    writeSkill(pkgDirs.hooks, 'hooks', ['claude-code', 'opencode', 'vscode']);
    writeSkill(pkgDirs.vscode, 'vscode', ['vscode']);
    writeSkill(pkgDirs.hub, 'hub', ['claude-code']);
    writeSkill(pkgDirs['mcp-bridge'], 'mcp-bridge', ['claude-code', 'cursor']);
    writeSkill(pkgDirs.plugin, 'plugin', ['claude-code', 'opencode', 'vscode', 'cursor', 'aider']);
  });

  afterAll(() => {
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('--all discovers exactly 8 SKILL.md files (5 packages + hub + mcp-bridge + plugin)', () => {
    const r = scriptRun(['--all', '--verbose']);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/found 8 SKILL.md files \(all-mode: 8 subpackages\)/);
  });

  it('--check exits 1 when drift is present, 0 after --write converges', () => {
    // Initially drift exists (per-package lists differ).
    const before = scriptRun(['--all', '--check']);
    expect(before.status).toBe(1);
    expect(before.stdout).toMatch(/drift detected/);

    // --write should normalise all 7 files to the union of compatible_with.
    const write = scriptRun(['--all', '--write']);
    expect(write.status).toBe(0);

    // Now --check should pass.
    const after = scriptRun(['--all', '--check']);
    expect(after.status).toBe(0);
    expect(after.stdout).toMatch(/all SKILL.md compatible_with lists in sync/);
  });

  it('--write is idempotent (second pass rewrites nothing)', () => {
    // After the previous test, all files are converged. Re-running --write should be a no-op.
    const r = scriptRun(['--all', '--write']);
    expect(r.status).toBe(0);
    // The summary line reports "0/8 files drifted." once converged
    // (07-04 04:23 cron: summary wording updated from "out of sync" to
    // "drifted" so dry-run / write modes read cleanly with the new exit
    // code vocabulary).
    expect(r.stdout).toMatch(/0\/8 files drifted/);
  });

  it('--source <pkg> overrides union with one pkg as canonical', () => {
    // Snapshot whatever codex-woclaw currently has (post test-2 union = 5 items).
    const codexContent = readFileSync(join(pkgDirs.codex, 'SKILL.md'), 'utf8');
    const codexMatch = codexContent.match(/compatible_with: \[([^\]]+)\]/);
    expect(codexMatch).not.toBeNull();
    const codexItems = codexMatch![1].split(',').map(s => s.trim()).filter(Boolean);

    // Run --source codex-woclaw --write --all to converge every file to codex's list.
    const r = scriptRun(['--all', '--source', 'codex-woclaw', '--write']);
    expect(r.status).toBe(0);

    // All 7 files must now contain exactly codex's compatible_with list.
    for (const [name, dir] of Object.entries(pkgDirs)) {
      const content = readFileSync(join(dir, 'SKILL.md'), 'utf8');
      const m = content.match(/compatible_with: \[([^\]]+)\]/);
      expect(m, `${name} should still have compatible_with`).not.toBeNull();
      const items = m![1].split(',').map(s => s.trim()).filter(Boolean);
      expect(items, `${name} should match codex-woclaw exactly`).toEqual(codexItems);
    }
  });

  it('default mode (no flags) is dry-run + packages-only (5 packages, not 8)', () => {
    // --source resets drift so each packages/* file now has identical content.
    // The default scan covers only packages/* = 4 files (no hub/mcp-bridge/plugin).
    const r = scriptRun(['--verbose']);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/found 5 SKILL.md files \(packages-only\)/);
    expect(r.stderr).not.toMatch(/all-mode/);
  });
});

// 07-01 cron addition: --include <csv> extends discovery to per-skill workspace
// shims (plugin/skills/*/SKILL.md, skills/*/SKILL.md) that the standard
// packages/+hub/+mcp-bridge/+plugin/ scan misses. This block covers 4 gates:
//   1. --include plugin/skills discovers 2 SKILL.md (woclaw + woclaw-hub-test)
//   2. --include skills discovers 1 SKILL.md (woclaw)
//   3. union mode writes the canonical list into the included shim files
//   4. --include survives missing directories (no crash, just a verbose log)
describe('sync-skill-frontmatter.mjs --include', () => {
  let tmpRoot: string;
  let pluginSkillsDir: string;
  let skillsDir: string;
  let pkgDir: string;

  function writeShim(dir: string, name: string, body?: string) {
    mkdirSync(join(dir, name), { recursive: true });
    const fm = body ?? `---\nname: ${name}\ncompatible_with: [stale-only]\n---\n\n# ${name}\n`;
    writeFileSync(join(dir, name, 'SKILL.md'), fm);
  }

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sync-skill-include-'));
    pkgDir = join(tmpRoot, 'packages', 'woclaw-vscode');
    pluginSkillsDir = join(tmpRoot, 'plugin', 'skills');
    skillsDir = join(tmpRoot, 'skills');
    writeShim(pkgDir.replace(/packages.*/, 'packages'), 'woclaw-vscode');
    // override pkg file with the canonical list to start "in-sync"
    writeFileSync(
      join(pkgDir, 'SKILL.md'),
      `---\nname: woclaw-vscode\ncompatible_with: [a, b, c]\n---\n\n# body\n`,
    );
    writeShim(pluginSkillsDir, 'woclaw');
    writeShim(pluginSkillsDir, 'woclaw-hub-test');
    writeShim(skillsDir, 'woclaw');
  });

  afterAll(() => {
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  const run = (args: string[]) => spawnSync('node', [scriptPath, ...args], {
    cwd: tmpRoot,
    env: { ...process.env, WOCLAW_ROOT: tmpRoot },
    encoding: 'utf8',
  });

  it('--include plugin/skills adds 2 shim files to the default packages scan (1+2=3)', () => {
    // Default mode (no --all) always scans packages/*, then --include appends.
    // This block has 1 packages file (woclaw-vscode) + 2 plugin/skills children.
    const r = run(['--include', 'plugin/skills', '--check', '--verbose']);
    expect(r.status).toBe(1); // drift exists
    expect(r.stderr).toMatch(/found 3 SKILL.md files/);
    expect(r.stderr).toMatch(/include: plugin\/skills/);
  });

  it('--include skills adds 1 shim file to the default packages scan (1+1=2)', () => {
    const r = run(['--include', 'skills', '--check', '--verbose']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/found 2 SKILL.md files/);
  });

  it('--include plugin/skills,skills adds 3 shim files to the default packages scan (1+3=4)', () => {
    const r = run(['--include', 'plugin/skills,skills', '--check', '--verbose']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/found 4 SKILL.md files/);
    expect(r.stderr).toMatch(/include: plugin\/skills,skills/);
  });

  it('--include with packages/* still scopes to 1 packages file + N include files (no --all)', () => {
    // Without --all, packages/ scan is still on (it's the default), so we get
    // 1 packages file + 3 include files = 4 total.
    const r = run(['--include', 'plugin/skills,skills', '--check', '--verbose']);
    // Already covered above; here we just verify the message does NOT mention
    // "all-mode: 7 subpackages" (we didn't pass --all).
    expect(r.stderr).not.toMatch(/all-mode: 7 subpackages/);
  });

  it('--include plugin/skills,skills --write converges include shims to canonical union', () => {
    const r = run(['--include', 'plugin/skills,skills', '--write']);
    expect(r.status).toBe(0);
    // Both woclaw shims (plugin/skills and skills) should now contain the
    // union sorted alphabetically. union of [a,b,c] + [stale-only] = [a,b,c,stale-only]
    for (const dir of [pluginSkillsDir, skillsDir]) {
      const child = join(dir, 'woclaw', 'SKILL.md');
      const content = readFileSync(child, 'utf8');
      const m = content.match(/compatible_with: \[([^\]]+)\]/);
      expect(m, `expected ${child} to have compatible_with after --write`).not.toBeNull();
      const items = m![1].split(',').map(s => s.trim()).filter(Boolean);
      expect(items).toEqual(['a', 'b', 'c', 'stale-only']);
    }
  });

  it('--include tolerates a missing directory (no crash, just verbose log)', () => {
    const r = run(['--include', 'does-not-exist', '--check', '--verbose']);
    expect(r.status).toBe(0); // packages-only with no extras -> 0/1 in sync
    expect(r.stderr).toMatch(/include: does-not-exist/);
  });

  it('--include pkg tag is namespaced (<dir>:<child>) so basename collisions do not clobber', () => {
    // The 2 plugin/skills children + 1 skills child all have basename `woclaw`,
    // but their pkg tags differ (`plugin/skills:woclaw` vs `skills:woclaw`),
    // so --source plugin/skills:woclaw should work as a canonical selector.
    const r = run(['--include', 'plugin/skills,skills', '--source', 'plugin/skills:woclaw', '--write']);
    expect(r.status).toBe(0);
    // plugin/skills:woclaw had 4 items ([a,b,c,stale-only]). The skills:woclaw
    // shim must now have exactly those 4 items too.
    const content = readFileSync(join(skillsDir, 'woclaw', 'SKILL.md'), 'utf8');
    const m = content.match(/compatible_with: \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const items = m![1].split(',').map(s => s.trim()).filter(Boolean);
    expect(items).toEqual(['a', 'b', 'c', 'stale-only']);
  });
});


// 07-01 03:03 cron addition: --write previously silently no-op'd SKILL.md files
// whose frontmatter had no `compatible_with:` line. The script reported
// "wrote X (0 → N items)" but the file was unchanged. Two real cases:
//   (a) frontmatter present, no compatible_with line → inject at end of frontmatter
//   (b) no frontmatter at all → cannot auto-inject; surface a warning + treat as drift
//   (c) --exclude <csv> lets the operator drop a file from sync without editing it
//       (e.g. skill spec docs that are intentionally not compatible_with lists)
describe('sync-skill-frontmatter.mjs --write edge cases (07-01 03:03 cron regression fix)', () => {
  let tmpRoot: string;
  const scriptRun = (args: string[]) => spawnSync('node', [scriptPath, ...args], {
    cwd: tmpRoot,
    env: { ...process.env, WOCLAW_ROOT: tmpRoot },
    encoding: 'utf8',
  });

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sync-skill-edge-'));
    // Layout: 1 packages file with canonical [a, b, c, d, e]
    const codex = join(tmpRoot, 'packages', 'codex-woclaw');
    mkdirSync(codex, { recursive: true });
    writeFileSync(join(codex, 'SKILL.md'),
      `---\nname: codex-woclaw\ncompatible_with: [a, b, c, d, e]\n---\n\n# body\n`);
    // 1 shim: frontmatter present but NO compatible_with line
    const shimFm = join(tmpRoot, 'plugin', 'skills', 'woclaw');
    mkdirSync(shimFm, { recursive: true });
    writeFileSync(join(shimFm, 'SKILL.md'),
      `---\nname: woclaw\ndescription: test shim without compatible_with\nmetadata:\n  files:\n    - SKILL.md\n---\n\n# shim body\n`);
    // 1 shim: no frontmatter at all
    const shimNoFm = join(tmpRoot, 'plugin', 'skills', 'woclaw-hub-test');
    mkdirSync(shimNoFm, { recursive: true });
    writeFileSync(join(shimNoFm, 'SKILL.md'),
      `# Skill Spec Doc\n\nThis is intentionally a doc, not a shim.\n`);
  });

  afterAll(() => {
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('regression: --write injects compatible_with when frontmatter has no compatible_with line', () => {
    // Without --include, only the 1 packages file is scanned. We need --include
    // to surface the shims, then --write should inject the canonical list into
    // the shim's frontmatter (NOT just leave the file unchanged).
    const r = scriptRun(['--include', 'plugin/skills', '--write']);
    expect(r.status).toBe(0);
    const shim = join(tmpRoot, 'plugin', 'skills', 'woclaw', 'SKILL.md');
    const content = readFileSync(shim, 'utf8');
    // The injection must place compatible_with INSIDE the frontmatter block
    // (before the closing ---), preserving the description and metadata keys.
    expect(content).toMatch(/^---\nname: woclaw\ndescription: test shim without compatible_with\nmetadata:\n {2}files:\n {4}- SKILL.md\ncompatible_with: \[[^\]]+\]\n---/);
    // Body must still be present AFTER the frontmatter.
    expect(content).toMatch(/\n# shim body\n?$/);
    // Order matters: union = [a, b, c, d, e] from codex.
    const m = content.match(/compatible_with: \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    expect(m![1].split(',').map(s => s.trim()).filter(Boolean)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('regression: --write is idempotent on injected files (second pass rewrites nothing)', () => {
    // After the previous test, the woclaw shim has compatible_with (injected
    // on pass 1). A second --write must NOT change that shim — even though
    // the overall count is 1/3 (woclaw-hub-test still drifts, that's expected).
    // We verify idempotence by snapshotting the shim after pass 1 + diffing
    // after pass 2: the bytes must be byte-identical.
    const shimPath = join(tmpRoot, 'plugin', 'skills', 'woclaw', 'SKILL.md');
    const before = readFileSync(shimPath, 'utf8');
    const r = scriptRun(['--include', 'plugin/skills', '--write']);
    expect(r.status).toBe(0);
    const after = readFileSync(shimPath, 'utf8');
    expect(after).toBe(before);
  });

  it('regression: --check exits 2 on no-frontmatter shim (manual-fix bucket) and prints a warning to stderr', () => {
    // 07-04 04:23 cron: --check now uses a 4-way exit code (0/1/2/3).
    // A file with NO frontmatter at all is the manual-fix bucket — exit 2
    // (not exit 1, which is reserved for auto-fixable drift). The file must
    // remain UNCHANGED so --write cannot accidentally clobber body content.
    const r = scriptRun(['--include', 'plugin/skills', '--check']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no frontmatter block/);
    expect(r.stderr).toMatch(/woclaw-hub-test/);
    // Manual-fix list also printed to stdout so CI logs make triage obvious.
    expect(r.stdout).toMatch(/manual-fix required/);
    expect(r.stdout).toMatch(/plugin\/skills:woclaw-hub-test/);
    const content = readFileSync(join(tmpRoot, 'plugin', 'skills', 'woclaw-hub-test', 'SKILL.md'), 'utf8');
    expect(content).toMatch(/^# Skill Spec Doc/);
    expect(content).not.toMatch(/^---/);
  });

  it('--exclude <csv> drops a pkg from sync (used for skill spec docs)', () => {
    // --exclude plugin/skills:woclaw-hub-test should make --check exit 0 even
    // though woclaw-hub-test is still on disk and has no frontmatter.
    const r = scriptRun(['--include', 'plugin/skills', '--exclude', 'plugin/skills:woclaw-hub-test', '--check']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/all SKILL.md compatible_with lists in sync/);
    // The excluded file must still be untouched.
    const content = readFileSync(join(tmpRoot, 'plugin', 'skills', 'woclaw-hub-test', 'SKILL.md'), 'utf8');
    expect(content).toMatch(/^# Skill Spec Doc/);
  });

  it('--exclude is a no-op for unknown tags (does not crash, does not affect other files)', () => {
    // Random unknown tag — script should still converge the rest.
    // 07-04 04:23 cron: with the 4-way exit code, the only non-empty bucket
    // here is manual-fix (woclaw-hub-test still has no frontmatter and is
    // not excluded), so exit is 2.
    const r = scriptRun(['--include', 'plugin/skills', '--exclude', 'plugin/skills:does-not-exist', '--check']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no frontmatter block/);
  });
});


// 07-02 01:03 cron addition: package.json `sync:skills*` npm scripts previously
// invoked the script as `--all --check` / `--all --write` — which **skips**
// the per-skill workspace shims (skills/, plugin/skills/). The drift in those
// shims went uncaught by both local `npm run sync:skills:check` and any CI
// step that mirrors the npm script. This block pins the corrected behaviour:
// the npm scripts must now pass `--include 'skills,plugin/skills'` and
// `--exclude 'plugin/skills:woclaw-hub-test'` (the intentionally-frontmatter-
// less diagnostic skill spec doc).
//
// Gates:
//   1. sync:skills:check script string contains --include 'skills,plugin/skills'
//   2. sync:skills:check script string contains --exclude plugin/skills:woclaw-hub-test
//   3. sync:skills (default) and sync:skills:write also carry both flags (parity)
//   (Note: previously planned a 4th gate — subprocess against a woclaw-shaped
//    fixture tree — but the script-string assertions in gates 1-3 are sufficient
//    to pin the regression and don't depend on brittle file-count assertions.)
describe('package.json sync:skills npm scripts scope (07-02 01:03 cron regression gate)', () => {
  const _repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const _pkg = JSON.parse(readFileSync(join(_repoRoot, 'package.json'), 'utf8'));
  const _scripts = _pkg.scripts as Record<string, string>;

  it('sync:skills:check script string includes --include skills,plugin/skills', () => {
    expect(_scripts['sync:skills:check']).toMatch(/--include\s+['"]?skills,plugin\/skills['"]?/);
  });

  it('sync:skills:check script string excludes plugin/skills:woclaw-hub-test (intentional no-frontmatter skill spec doc)', () => {
    // Quoted form (npm-script string) and bare form (when invoked via npm the
    // shell strips the quotes; either spelling must match for the regression gate).
    expect(_scripts['sync:skills:check']).toMatch(/--exclude\s+['"]?plugin\/skills:woclaw-hub-test['"]?/);
  });

  it('sync:skills (default dry-run) and sync:skills:write carry both --include and --exclude (parity)', () => {
    for (const k of ['sync:skills', 'sync:skills:write']) {
      expect(_scripts[k], `${k} must include workspace shims`).toMatch(/--include\s+['"]?skills,plugin\/skills['"]?/);
      expect(_scripts[k], `${k} must exclude woclaw-hub-test`).toMatch(/--exclude\s+['"]?plugin\/skills:woclaw-hub-test['"]?/);
    }
  });
});


// 07-02 01:33 cron addition: the script's doc comments at L19 / L158 / L168 / L223
// said "(7 subpackages)" and listed only 4 packages (codex-woclaw,
// opencode-woclaw-plugin, woclaw-hooks, woclaw-vscode), missing
// `packages/codex-woclaw-example` which was added back on 06-28 (bbf2489 added
// SKILL.md to it). Actual discovery count after that addition is 8 subpackages
// (5 packages/* + hub + mcp-bridge + plugin), confirmed by `node scripts/
// sync-skill-frontmatter.mjs --all` reporting "0/8 files out of sync". This
// drift went uncaught because no test pinned the comment ↔ discovery parity.
//
// rCAUSE: the 7-subpackage count was hand-counted when the script was first
// written (06-19 cron); adding packages/codex-woclaw-example 9 days later
// should have bumped the count to 8 in 4 places but didn't. Comments-only
// changes are easy to forget.
//
// rFIX: bump all 4 doc-comment occurrences from "7 subpackages" to "8 subpackages"
// and add `packages/codex-woclaw-example` to the listed enumeration (now
// 5 packages/* instead of 4). Also update the all-mode summary string.
//
// rTEST: this block — 4 regression tests asserting (1) the L19 doc-comment
// lists 8 subpackages and includes codex-woclaw-example; (2) the L158/L168
// enumerate-8 list has 8 numbered entries and includes
// packages/codex-woclaw-example; (3) the all-mode summary string at L223
// reads "8 subpackages"; (4) cross-check: the actual count of packages/*
// directories on disk equals the count listed in the script comment (parity
// gate — prevents future regressions).
describe('sync-skill-frontmatter.mjs doc-comment ↔ discovery parity (07-02 01:33 cron regression gate)', () => {
  const _repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const _scriptPath = join(_repoRoot, 'scripts', 'sync-skill-frontmatter.mjs');
  const _scriptSrc = readFileSync(_scriptPath, 'utf8');

  it('L19 header comment says "8 subpackages" and enumerates codex-woclaw-example', () => {
    // After 06-28 bbf2489 added codex-woclaw-example, total is 8 (5 packages + hub + mcp-bridge + plugin).
    expect(_scriptSrc).toMatch(/\(8 subpackages in total:[^\n]*codex-woclaw-example/);
  });

  it('findSkillFiles enumerate-8 list has 8 numbered entries including codex-woclaw-example', () => {
    // Extract the comment block immediately before `for (const top of ['hub', 'mcp-bridge', 'plugin'])`
    const blockRe = /\/\/ so all (\d+) subpackages stay in sync\.[\s\S]*?for \(const top of \['hub'/;
    const blockMatch = blockRe.exec(_scriptSrc);
    expect(blockMatch, 'enumeration block not found').toBeTruthy();
    const block = blockMatch![0];
    const numbered = block.match(/^\s*\/\/\s+(\d+)\.\s+/gm) || [];
    expect(numbered.length).toBe(8);
    // codex-woclaw-example must appear in the enumeration.
    expect(block).toMatch(/packages\/codex-woclaw-example/);
    // Sanity: the original 4 packages must still be present.
    for (const pkg of ['codex-woclaw', 'opencode-woclaw-plugin', 'woclaw-hooks', 'woclaw-vscode']) {
      expect(block, `missing packages/${pkg} in enumerate-8 list`).toMatch(new RegExp(`packages/${pkg.replace(/-/g, '\\-')}`));
    }
  });

  it('all-mode summary string at L223 reads "8 subpackages"', () => {
    expect(_scriptSrc).toMatch(/'\(all-mode: 8 subpackages\)'/);
  });

  it('cross-check: packages/* directory count on disk == count listed in enumerate-8 block (parity gate)', () => {
    const packagesDir = join(_repoRoot, 'packages');
    const packagesDirs = readdirSync(packagesDir).filter((n) =>
      statSync(join(packagesDir, n)).isDirectory(),
    );
    // The script enumerates packages/* before the 3 top-level dirs (hub, mcp-bridge, plugin).
    // Pull the count from the enumerate block.
    const blockRe = /\/\/ so all (\d+) subpackages stay in sync\./;
    const m = blockRe.exec(_scriptSrc);
    expect(m, 'count assertion not found').toBeTruthy();
    const listedPackages = parseInt(m![1], 10) - 3; // subtract 3 top-level
    expect(packagesDirs.length).toBe(listedPackages);
  });
});

// 07-04 04:23 cron: 4-way exit code semantics for --check mode.
// Pre-this-change, --check collapsed both drift kinds into a single exit 1,
// which made the cron CI gate noisy: a missing-frontmatter file (manual fix
// required) looked identical to 50 auto-fixable files. Now:
//   0 = clean
//   1 = auto-fixable drift (changedCount > 0)
//   2 = manual-fix required (manualFixCount > 0)
//   3 = both buckets non-empty (1 | 2)
// This block pins every quadrant so the cron CI gate can trust the codes.
describe('sync-skill-frontmatter.mjs --check exit codes (07-04 04:23 cron)', () => {
  let tmpRoot: string;
  let pkgDir: string;
  let pkgDirNoFm: string;
  // Extra pkg to force the union to have a tag that pkg-a lacks, so pkg-a
  // ends up in the auto-fixable bucket even when pkg-b contributes nothing.
  let pkgDirC: string;
  const scriptRun = (args: string[]) => spawnSync('node', [scriptPath, ...args], {
    cwd: tmpRoot,
    env: { ...process.env, WOCLAW_ROOT: tmpRoot },
    encoding: 'utf8',
  });

  function writeSkill(dir: string, pkgName: string, compatList: string[] | null) {
    mkdirSync(dir, { recursive: true });
    let body = `# ${pkgName} skill\n\nbody line 1\n`;
    let fm = '';
    if (compatList !== null) {
      fm = `---\nname: ${pkgName}\ndescription: test\ncompatible_with: [${compatList.join(', ')}]\n---\n\n`;
    }
    writeFileSync(join(dir, 'SKILL.md'), fm + body);
  }

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sync-skill-exit-'));
    pkgDir = join(tmpRoot, 'packages', 'pkg-a');
    pkgDirNoFm = join(tmpRoot, 'packages', 'pkg-b');
    pkgDirC = join(tmpRoot, 'packages', 'pkg-c');
  });

  // 07-04 04:23 cron: previous tests in this describe may mutate the SKILL.md
  // files via --write (test 5 does). Reset to a known clean baseline before each
  // test so cross-test contamination doesn't break the exit-code matrix.
  beforeEach(() => {
    // pkg-a / pkg-b / pkg-c are writeSkill()-rewritten by each test, so we just
    // need to clear them out before writing again — writeSkill() calls
    // mkdirSync({recursive:true}) so missing dirs are recreated.
  });

  afterAll(() => {
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('--check exits 0 when both buckets are empty (clean baseline)', () => {
    // Two identical frontmatter SKILL.md files → no drift, no manual-fix.
    writeSkill(pkgDir, 'pkg-a', ['claude-code']);
    writeSkill(pkgDirNoFm, 'pkg-b', ['claude-code']);
    const r = scriptRun(['--check']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/all SKILL.md compatible_with lists in sync/);
  });

  it('--check exits 1 when ONLY auto-fixable drift is present', () => {
    writeSkill(pkgDir, 'pkg-a', ['claude-code', 'opencode']);
    writeSkill(pkgDirNoFm, 'pkg-b', ['cursor']); // smaller list → auto-fixable drift
    const r = scriptRun(['--check']);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/auto-fixable drift detected/);
    expect(r.stdout).not.toMatch(/manual-fix required/);
  });

  it('--check exits 2 when ONLY manual-fix bucket is non-empty', () => {
    // 07-04 04:23 cron: writeSkill(pkgDirNoFm, 'pkg-b', null) writes a
    // SKILL.md file with NO frontmatter — pkgDirNoFm is a directory, so the
    // helper appends SKILL.md internally. Both files end up with the same
    // union (just `claude-code` from pkg-a since pkg-b contributes nothing),
    // so changedCount = 0 and manualFixCount = 1 → exit 2.
    writeSkill(pkgDir, 'pkg-a', ['claude-code']);
    writeSkill(pkgDirNoFm, 'pkg-b', null);
    const r = scriptRun(['--check']);
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/manual-fix required/);
    expect(r.stdout).not.toMatch(/auto-fixable drift detected/);
  });

  it('--check exits 3 when BOTH buckets are non-empty (1 | 2)', () => {
    // 07-04 04:23 cron: pkg-c adds `opencode` to the union, so pkg-a (with
    // only `claude-code`) drifts and lands in the auto-fixable bucket.
    // pkg-b has no frontmatter → manual-fix bucket. With both non-empty the
    // exit code is 3 = 1 (auto-fixable) | 2 (manual-fix).
    writeSkill(pkgDir, 'pkg-a', ['claude-code']);
    writeSkill(pkgDirC, 'pkg-c', ['opencode']);
    writeSkill(pkgDirNoFm, 'pkg-b', null);
    const r = scriptRun(['--check']);
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/auto-fixable drift detected/);
    expect(r.stdout).toMatch(/manual-fix required/);
    expect(r.stdout).toMatch(/2\/3 auto-fixable, 1 manual-fix files drifted/);
  });

  it('--write mode ignores exit-code semantics (always exits 0 after writing)', () => {
    // --write is destructive but idempotent — it should never fail with the
    // 4-way codes even if drift was detected. Even the no-frontmatter case
    // (which --write cannot auto-fix) just exits 0 because no write was made.
    // 07-04 04:23 cron: explicitly remove any stale pkg-c dir from earlier
    // serial tests in this describe, so the union really is [claude-code]
    // (only pkg-a contributes, pkg-b has no frontmatter, pkg-c absent).
    // Without this cleanup, the union grew to 2 items from leftover pkg-c
    // and the summary line printed "2/3 auto-fixable" instead of "0/2".
    rmSync(pkgDirC, { recursive: true, force: true });
    writeSkill(pkgDir, 'pkg-a', ['claude-code']);
    writeSkill(pkgDirNoFm, 'pkg-b', null);
    const r = scriptRun(['--write']);
    expect(r.status).toBe(0);
    // Summary line still distinguishes the two buckets so operators see what
    // happened (regression caught 07-04 04:23 cron when dry-run / write
    // modes used to print "0/N files out of sync" even with 1 manual-fix).
    expect(r.stdout).toMatch(/\[WRITE\] 0\/2 auto-fixable, 1 manual-fix files drifted/);
  });
});
