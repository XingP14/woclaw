// integration-test/skill-md-subpackage-count-parity.test.ts
//
// Workspace-level invariant (07-09 23:38 cron tick):
//   no top-level SKILL.md (hub/ + plugin/ + mcp-bridge/) or packages/*/SKILL.md
//   may contain a stale "N subpackages" inline phrase where N does not equal
//   the current root package.json#workspaces count.
//
// Pre-fix (07-09 22:03 woclaw LICENSE parity closure flagged this drift
// downstream):
//   - plugin/SKILL.md contained 4 stale "all 7 subpackages" /
//     "across all 7 subpackages" references (L66, L70, L74, L114)
//   - hub/SKILL.md contained 1 stale "all 7 subpackages" reference (L50)
//   But the actual root package.json#workspaces array has 8 entries:
//     hub, plugin, mcp-bridge,
//     packages/woclaw-hooks, packages/codex-woclaw,
//     packages/codex-woclaw-example, packages/opencode-woclaw-plugin,
//     packages/woclaw-vscode
//
// This drift was silent because:
//   (a) sync-skill-frontmatter.mjs only syncs `compatible_with:` frontmatter
//       arrays, not inline narrative text in the body.
//   (b) subpackage-skill-parity.test.ts only asserts SKILL.md existence +
//       package.json#files inclusion, not body-text count claims.
//   (c) docs/ROADMAP.md mentions the 8-subpackage count for the audit but
//       never pinned the body-text count invariant.
//
// This test reads root package.json#workspaces, then for every top-level
// SKILL.md (hub/ + plugin/ + mcp-bridge/) and every packages/*/SKILL.md:
//   1. asserts workspaces.length === 8 (canonical count, matching
//      scripts/sync-skill-frontmatter.mjs L43 comment "8 subpackages in total")
//   2. asserts NO stale "\b7 subpackages?\b" inline phrase remains
//   3. asserts NO stale "\b7 packages?\b" inline phrase remains
//   4. parity cross-check: when workspaces.length === N, no SKILL.md body
//      uses "N-1 subpackages" / "N-2 subpackages" (drift detector covering
//      any N < canonical count, not just 7 < 8)
//   5. gates that scripts/sync-skill-frontmatter.mjs comment
//      "8 subpackages in total" is present (cross-check that the script
//      itself stays aligned with the canonical count)
//
// If a future contributor adds a 9th subpackage but forgets to bump the
// "8 subpackages" inline narrative (or the script comment), this test trips.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../integration-test
const REPO_ROOT = dirname(TEST_DIR); // .../woclaw (repo root)

// Canonical subpackage count comes from root package.json#workspaces.
function getCanonicalSubpkgCount(): number {
  const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    workspaces?: string[];
  };
  return rootPkg.workspaces?.length ?? 0;
}

function getCanonicalSubpkgList(): string[] {
  const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    workspaces?: string[];
  };
  return rootPkg.workspaces ?? [];
}

// Top-level subpackages: hub + plugin + mcp-bridge (not under packages/).
const TOP_LEVEL_SUBPKGS = ['hub', 'plugin', 'mcp-bridge'];

function listPackageSubdirs(): string[] {
  const pkgsDir = join(REPO_ROOT, 'packages');
  if (!existsSync(pkgsDir)) return [];
  return readdirSync(pkgsDir).filter((name) => {
    const full = join(pkgsDir, name);
    return existsSync(join(full, 'SKILL.md'));
  });
}

interface SkillFileResult {
  path: string;       // relative to REPO_ROOT
  has7Subpackages: boolean;
  has7Packages: boolean;
  staleCounts: number[]; // counts found that are < canonical
}

function scanSkillFile(relPath: string, canonical: number): SkillFileResult {
  const txt = readFileSync(join(REPO_ROOT, relPath), 'utf8');
  const has7Subpackages = /\b7\s+subpackages?\b/i.test(txt);
  const has7Packages = /\b7\s+packages?\b/i.test(txt);
  // Cross-check: any "N subpackages" claim where N < canonical is stale.
  const staleMatches = [...txt.matchAll(/\b(\d+)\s+subpackages?\b/gi)];
  const staleCounts = [
    ...new Set(
      staleMatches
        .map((m) => parseInt(m[1], 10))
        .filter((n) => n < canonical)
    ),
  ];
  return { path: relPath, has7Subpackages, has7Packages, staleCounts };
}

describe('SKILL.md inline subpackage-count parity', () => {
  const canonical = getCanonicalSubpkgCount();
  const subpkgList = getCanonicalSubpkgList();

  it('root package.json declares 8 workspace subpackages (canonical count)', () => {
    expect(canonical).toBe(8);
    expect(subpkgList).toContain('hub');
    expect(subpkgList).toContain('plugin');
    expect(subpkgList).toContain('mcp-bridge');
    expect(subpkgList).toContain('packages/woclaw-hooks');
    expect(subpkgList).toContain('packages/codex-woclaw');
    expect(subpkgList).toContain('packages/codex-woclaw-example');
    expect(subpkgList).toContain('packages/opencode-woclaw-plugin');
    expect(subpkgList).toContain('packages/woclaw-vscode');
  });

  it('every top-level SKILL.md does NOT contain stale "7 subpackages" inline phrase', () => {
    const results = TOP_LEVEL_SUBPKGS.map((name) =>
      scanSkillFile(`${name}/SKILL.md`, canonical)
    );
    const stale = results.filter((r) => r.has7Subpackages);
    if (stale.length > 0) {
      const details = stale.map((r) => `  ${r.path}: contains stale "\\b7 subpackages\\b"`).join('\n');
      throw new Error(
        `Found stale "7 subpackages" inline phrase in ${stale.length} top-level SKILL.md file(s):\n${details}\n` +
        `The woclaw monorepo now has ${canonical} workspace subpackages per root package.json#workspaces.\n` +
        `Run: grep -nE '\\b7 subpackages?\\b' ${stale.map((r) => r.path).join(' ')}`
      );
    }
    expect(stale.length).toBe(0);
  });

  it('every packages/*/SKILL.md does NOT contain stale "7 subpackages" inline phrase', () => {
    const subdirs = listPackageSubdirs();
    const results = subdirs.map((name) =>
      scanSkillFile(`packages/${name}/SKILL.md`, canonical)
    );
    const stale = results.filter((r) => r.has7Subpackages);
    if (stale.length > 0) {
      const details = stale.map((r) => `  ${r.path}: contains stale "\\b7 subpackages\\b"`).join('\n');
      throw new Error(
        `Found stale "7 subpackages" inline phrase in ${stale.length} packages/*/SKILL.md file(s):\n${details}\n` +
        `The woclaw monorepo now has ${canonical} workspace subpackages per root package.json#workspaces.\n` +
        `Run: grep -nE '\\b7 subpackages?\\b' ${stale.map((r) => r.path).join(' ')}`
      );
    }
    expect(stale.length).toBe(0);
  });

  it('no SKILL.md contains stale "7 packages" inline phrase either (broader drift detector)', () => {
    const subdirs = listPackageSubdirs();
    const allPaths = [
      ...TOP_LEVEL_SUBPKGS.map((n) => `${n}/SKILL.md`),
      ...subdirs.map((n) => `packages/${n}/SKILL.md`),
    ];
    const results = allPaths.map((p) => scanSkillFile(p, canonical));
    const stale = results.filter((r) => r.has7Packages);
    if (stale.length > 0) {
      const details = stale.map((r) => `  ${r.path}`).join('\n');
      throw new Error(
        `Found stale "7 packages" inline phrase in ${stale.length} SKILL.md file(s):\n${details}\n` +
        `Run: grep -nE '\\b7 packages?\\b' ${stale.map((r) => r.path).join(' ')}`
      );
    }
    expect(stale.length).toBe(0);
  });

  it('cross-check: no SKILL.md uses any "N subpackages" where N < canonical (drift detector for any future count change)', () => {
    const subdirs = listPackageSubdirs();
    const allPaths = [
      ...TOP_LEVEL_SUBPKGS.map((n) => `${n}/SKILL.md`),
      ...subdirs.map((n) => `packages/${n}/SKILL.md`),
    ];
    const results = allPaths.map((p) => scanSkillFile(p, canonical));
    const offenders = results.filter((r) => r.staleCounts.length > 0);
    if (offenders.length > 0) {
      const details = offenders
        .map((r) => `  ${r.path}: stale counts ${r.staleCounts.join(',')}`)
        .join('\n');
      throw new Error(
        `Found ${offenders.length} SKILL.md file(s) claiming subpackage count < ${canonical}:\n${details}\n` +
        `If you bumped the canonical count (e.g. added a 9th subpackage), update the inline narrative too.`
      );
    }
    expect(offenders.length).toBe(0);
  });

  it('scripts/sync-skill-frontmatter.mjs comment still says "8 subpackages in total" (cross-check script alignment)', () => {
    const scriptPath = join(REPO_ROOT, 'scripts/sync-skill-frontmatter.mjs');
    if (!existsSync(scriptPath)) {
      throw new Error(`scripts/sync-skill-frontmatter.mjs missing at ${scriptPath}`);
    }
    const txt = readFileSync(scriptPath, 'utf8');
    const hasCanonicalPhrase = /\b8\s+subpackages?\s+in\s+total\b/i.test(txt);
    if (!hasCanonicalPhrase) {
      throw new Error(
        `scripts/sync-skill-frontmatter.mjs no longer contains "8 subpackages in total" canonical phrase.\n` +
        `If canonical count changed from 8, update both the inline narrative AND the script comment.`
      );
    }
    expect(hasCanonicalPhrase).toBe(true);
  });
});
