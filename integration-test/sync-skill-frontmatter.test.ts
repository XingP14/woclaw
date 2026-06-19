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