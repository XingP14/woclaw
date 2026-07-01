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
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
    // Layout mirrors woclaw monorepo: packages/<name>/SKILL.md + hub|mcp-bridge|plugin/SKILL.md (7 files)
    pkgDirs = {
      codex: join(tmpRoot, 'packages', 'codex-woclaw'),
      opencode: join(tmpRoot, 'packages', 'opencode-woclaw-plugin'),
      hooks: join(tmpRoot, 'packages', 'woclaw-hooks'),
      vscode: join(tmpRoot, 'packages', 'woclaw-vscode'),
      hub: join(tmpRoot, 'hub'),
      'mcp-bridge': join(tmpRoot, 'mcp-bridge'),
      plugin: join(tmpRoot, 'plugin'),
    };
    writeSkill(pkgDirs.codex, 'codex', ['claude-code', 'opencode']);
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

  it('--all discovers exactly 7 SKILL.md files (4 packages + hub + mcp-bridge + plugin)', () => {
    const r = scriptRun(['--all', '--verbose']);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/found 7 SKILL.md files \(all-mode: 7 subpackages\)/);
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
    // The summary line reports "0/7 files out of sync" once converged.
    expect(r.stdout).toMatch(/0\/7 files out of sync/);
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

  it('default mode (no flags) is dry-run + packages-only (4 packages, not 7)', () => {
    // --source resets drift so each packages/* file now has identical content.
    // The default scan covers only packages/* = 4 files (no hub/mcp-bridge/plugin).
    const r = scriptRun(['--verbose']);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/found 4 SKILL.md files \(packages-only\)/);
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

  it('regression: --check exits 1 on no-frontmatter shim and prints a warning to stderr', () => {
    // The woclaw-hub-test shim has no frontmatter at all. --check must:
    //   - exit 1 (drift)
    //   - print a warning to stderr pointing at the file
    const r = scriptRun(['--include', 'plugin/skills', '--check']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no frontmatter block/);
    expect(r.stderr).toMatch(/woclaw-hub-test/);
    // The file must be UNCHANGED (we deliberately do not auto-create frontmatter
    // since that would risk clobbering body content).
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
    const r = scriptRun(['--include', 'plugin/skills', '--exclude', 'plugin/skills:does-not-exist', '--check']);
    // woclaw-hub-test is still in scope and still drifts → exit 1.
    expect(r.status).toBe(1);
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
