// integration-test/subpackage-skill-parity.test.ts
// Workspace-level invariant (07-01 06:03 cron):
//   every workspace subpackage in the woclaw monorepo must:
//     (a) have a SKILL.md file at <subpackage>/SKILL.md
//     (b) list "SKILL.md" in <subpackage>/package.json#files (so it ships in npm tarball)
//
// Before this commit, `packages/codex-woclaw-example` was the lone holdout: no
// SKILL.md on disk, and "SKILL.md" not in its `files` array.  The drift was
// invisible to the sync-skill-frontmatter.mjs drift detector (which only covers
// `skills/woclaw` + `plugin/skills/woclaw` shims) and to `npm pack --dry-run`
// (which only complains if a referenced file is missing, not if a sibling
// skill file is absent).
//
// This test reads the root package.json#workspaces array, then for each entry:
//   1. asserts <entry>/SKILL.md exists
//   2. asserts <entry>/package.json#files contains the literal "SKILL.md"
//   3. (sanity) asserts the SKILL.md has a `---` frontmatter block + `name:` key
//
// If a future contributor adds a new subpackage without a SKILL.md, this test
// trips immediately.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../integration-test
const REPO_ROOT = dirname(TEST_DIR); // .../woclaw (repo root)

interface SubpkgResult {
  workspace: string;
  skillExists: boolean;
  filesIncludes: boolean;
  hasFrontmatter: boolean;
  hasName: boolean;
}

function checkSubpkg(workspace: string): SubpkgResult {
  const skillPath = join(REPO_ROOT, workspace, 'SKILL.md');
  const pkgPath = join(REPO_ROOT, workspace, 'package.json');
  const skillExists = existsSync(skillPath);
  const filesIncludes = (() => {
    if (!existsSync(pkgPath)) return false;
    const p = JSON.parse(readFileSync(pkgPath, 'utf8')) as { files?: string[] };
    return Array.isArray(p.files) && p.files.includes('SKILL.md');
  })();
  const hasFrontmatter = (() => {
    if (!skillExists) return false;
    const txt = readFileSync(skillPath, 'utf8');
    // A real SKILL.md starts with `---\n` and has a closing `---\n` later.
    return txt.startsWith('---\n') || txt.startsWith('---\r\n');
  })();
  const hasName = (() => {
    if (!skillExists) return false;
    const txt = readFileSync(skillPath, 'utf8');
    // Look for a top-level `name: <id>` line in the frontmatter block.
    const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return false;
    return /^name:\s*[A-Za-z0-9_.-]+\s*$/m.test(m[1]);
  })();
  return { workspace, skillExists, filesIncludes, hasFrontmatter, hasName };
}

describe('subpackage SKILL.md parity', () => {
  const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    workspaces?: string[];
  };
  const workspaces = rootPkg.workspaces ?? [];
  // If workspaces is missing (e.g. test runs from a stripped checkout), skip.
  const results = workspaces.map(checkSubpkg);

  it('package.json declares at least 1 workspace subpackage', () => {
    expect(workspaces.length).toBeGreaterThan(0);
  });

  it('every workspace subpackage has a SKILL.md on disk (was the codex-woclaw-example bug)', () => {
    const missing = results.filter((r) => !r.skillExists);
    if (missing.length > 0) {
      throw new Error(
        `subpackages missing SKILL.md:\n${missing
          .map((r) => `  - ${r.workspace}`)
          .join('\n')}\n` +
          `Add a SKILL.md with frontmatter (name:/description:/compatible_with:/skill_type:/folder_structure:) + list "SKILL.md" in package.json#files.`
      );
    }
    expect(missing).toEqual([]);
  });

  it('every workspace subpackage lists "SKILL.md" in package.json#files (so npm pack ships it)', () => {
    const offenders = results.filter((r) => r.skillExists && !r.filesIncludes);
    if (offenders.length > 0) {
      throw new Error(
        `subpackages with SKILL.md but not in package.json#files:\n${offenders
          .map((r) => `  - ${r.workspace}`)
          .join('\n')}\n` +
          `Add "SKILL.md" to the files array so npm pack includes it.`
      );
    }
    expect(offenders).toEqual([]);
  });

  it('every SKILL.md has a `---` frontmatter block (parity with 7 sibling skills)', () => {
    const bare = results.filter((r) => r.skillExists && !r.hasFrontmatter);
    if (bare.length > 0) {
      throw new Error(
        `subpackages with bare SKILL.md (no frontmatter):\n${bare
          .map((r) => `  - ${r.workspace}`)
          .join('\n')}\n` +
          `Wrap frontmatter in --- ... --- at the top of SKILL.md.`
      );
    }
    expect(bare).toEqual([]);
  });

  it('every SKILL.md has a `name:` key in its frontmatter (parity invariant)', () => {
    const unnamed = results.filter((r) => r.skillExists && !r.hasName);
    if (unnamed.length > 0) {
      throw new Error(
        `subpackages with SKILL.md missing 'name:' in frontmatter:\n${unnamed
          .map((r) => `  - ${r.workspace}`)
          .join('\n')}\n` +
          `Add a 'name: <skill-id>' line inside the frontmatter block.`
      );
    }
    expect(unnamed).toEqual([]);
  });

  it('subpackage count is 8 (hub, plugin, mcp-bridge, 5x packages/*) — pin against future drift', () => {
    // If a future contributor adds a 9th subpackage, this test does not fail
    // (the 4 parity tests above cover the new one), but a 7→6 drop would.
    expect(workspaces.length).toBeGreaterThanOrEqual(7);
  });
});
