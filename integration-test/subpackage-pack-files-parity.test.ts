// integration-test/subpackage-pack-files-parity.test.ts
// Workspace-level npm-pack `files` parity invariant (07-09 03:43 cron):
//   every workspace subpackage's package.json#files MUST include every
//   real test file on disk. If `<subpkg>/test/*.test.ts` (or `.test.js` /
//   `tests/*.test.py`) exists, the published tarball MUST ship it.
//
// Why this test exists:
//   `hub/package.json` and `plugin/package.json#files` listed `tests/**/*`
//   (plural — for the tiny `tests/test_<name>_skill.json` fixtures) but
//   NOT `test/**/*` (singular — for the 30+ real vitest suites under
//   `hub/test/`). Result: `npm pack --dry-run` shipped 1 fixture JSON but
//   NONE of the actual vitest suites — consumers cloning the published
//   tarball could not run `npm test`. The regression was silent (no error),
//   since npm happily packs a non-existent directory.
//
//   `codex-woclaw-example` had the same shape with `tests/test_example_log.py`:
//   `package.json#files` was just `['*.py', 'README.md', 'SKILL.md', 'LICENSE']`
//   so the glob `*.py` matched only top-level `*.py` files (not the test
//   file in `tests/`), and `tests/test_example_log.py` was silently dropped.
//
// This test pins BOTH invariants:
//   1. Every subpackage whose disk contains real *.test.{ts,js,py} files
//      has those files resolved by at least one package.json#files glob.
//   2. Specific floors + filename pins for hub (≥20 suites) and plugin
//      (its 3 named adapter-config / channel / errors suites) so future
//      contributors can't quietly drop a test from the published tarball.
//
// Mirrors the subpackage-license-parity.test.ts in style: workspace-aware,
// scans every declared subpackage, gives a helpful error pointing to the
// offending package.json line.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename);
const REPO_ROOT = dirname(TEST_DIR);

interface PackCheck {
  workspace: string;
  onDiskTestFiles: string[];
  declaredGlobs: string[];
  resolvedTestFiles: string[];
}

function listDirRecursive(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listDirRecursive(full));
    else out.push(full);
  }
  return out;
}

// Tiny glob-to-regex matcher: `**` matches any path segments, `*` matches
// anything except `/`. Everything else is literal.
function globToRegex(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|+?()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re);
}

function isTestFile(p: string): boolean {
  // .test.{ts,js,tsx,jsx} for vitest/jest, .test.py for pytest.
  return /\.(test\.[jt]sx?|test\.py)$/i.test(p);
}

function checkSubpkg(workspace: string): PackCheck {
  const subpkgRoot = join(REPO_ROOT, workspace);
  const pkgPath = join(subpkgRoot, 'package.json');
  const onDiskTestFiles: string[] = [];
  let declaredGlobs: string[] = [];
  const resolvedTestFiles: string[] = [];

  // Collect on-disk test files from test/ and tests/ (the two layouts
  // used in the woclaw monorepo).
  for (const sub of ['test', 'tests']) {
    const subDir = join(subpkgRoot, sub);
    if (!existsSync(subDir)) continue;
    for (const abs of listDirRecursive(subDir)) {
      const rel = relative(subpkgRoot, abs);
      if (isTestFile(rel)) onDiskTestFiles.push(rel);
    }
  }

  if (existsSync(pkgPath)) {
    const p = JSON.parse(readFileSync(pkgPath, 'utf8')) as { files?: string[] };
    declaredGlobs = Array.isArray(p.files) ? p.files : [];

    for (const glob of declaredGlobs) {
      const re = globToRegex(glob);
      // Literal filename globs like "LICENSE" or "openclaw.plugin.json"
      // reference a single root file — handle those directly without
      // trying to scandir the file itself.
      if (!glob.includes('*') && !glob.includes('?')) {
        const abs = join(subpkgRoot, glob);
        if (existsSync(abs)) {
          const rel = relative(subpkgRoot, abs);
          const st = statSync(abs);
          if (!st.isDirectory() && isTestFile(rel)) {
            resolvedTestFiles.push(rel);
          }
        }
        continue;
      }
      // Globs starting with a literal top-level dir ("dist/**/*",
      // "test/**/*", "bin/**/*", "skills/**/*", "lib/**/*") get walked
      // from <subpkg>/<top>. Globs starting with a wildcard top ("**/*",
      // "*.py") get walked from the subpkg root.
      const topSeg = glob.split('/')[0];
      const candidateRoot = topSeg.includes('*') || topSeg.includes('.')
        ? subpkgRoot
        : join(subpkgRoot, topSeg);
      if (!existsSync(candidateRoot)) continue;
      const st = statSync(candidateRoot);
      if (!st.isDirectory()) continue;
      for (const abs of listDirRecursive(candidateRoot)) {
        const rel = relative(subpkgRoot, abs);
        if (re.test(rel) && isTestFile(rel)) resolvedTestFiles.push(rel);
      }
    }
  }

  return { workspace, onDiskTestFiles, declaredGlobs, resolvedTestFiles };
}

describe('subpackage npm-pack files parity (regression 07-09 03:43 cron)', () => {
  const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    workspaces?: string[];
  };
  const workspaces = rootPkg.workspaces ?? [];
  const results = workspaces.map(checkSubpkg);

  it('package.json declares at least 1 workspace subpackage', () => {
    expect(workspaces.length).toBeGreaterThan(0);
  });

  it('every subpackage with real test files on disk ships ALL of them via npm pack', () => {
    // The original bug: hub + plugin had `tests/**/*` (plural — for the
    // tiny fixture JSON) but NOT `test/**/*` (singular — for the actual
    // vitest suites). npm pack silently shipped 1 fixture and 0 tests.
    // The gate here: if `<subpkg>/test/*.test.ts` (or `.test.js` /
    // `tests/*.test.py`) exists on disk, every such file MUST appear in
    // the resolved pack set, otherwise `npm test` in a fresh clone would
    // skip those tests entirely.
    const offenders = results
      .filter((r) => r.onDiskTestFiles.length > 0)
      .filter((r) => {
        const resolvedSet = new Set(r.resolvedTestFiles);
        return !r.onDiskTestFiles.every((f) => resolvedSet.has(f));
      });
    if (offenders.length > 0) {
      throw new Error(
        `subpackages with real test files on disk that npm pack would NOT ship:\n` +
          offenders
            .map((r) => {
              const resolvedSet = new Set(r.resolvedTestFiles);
              const missing = r.onDiskTestFiles.filter((f) => !resolvedSet.has(f));
              return (
                `  - ${r.workspace}: ${missing.length} test file(s) missing from pack.\n` +
                `      on-disk tests: ${JSON.stringify(r.onDiskTestFiles)}\n` +
                `      declared files: ${JSON.stringify(r.declaredGlobs)}\n` +
                `      missing: ${JSON.stringify(missing)}\n` +
                `    Add "test/**/*" (singular) or "tests/**/*" to package.json#files.`
              );
            })
            .join('\n\n') +
          `\nThis is a SILENT regression: 'npm pack' ships a non-existent dir with no error,\n` +
          `so consumers cloning the published tarball cannot run 'npm test'.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('hub ships ≥20 vitest suites via npm pack (regression 07-09 03:43 cron)', () => {
    // hub has ~50 vitest suites under test/. A healthy npm pack ships
    // all of them. The pre-fix tarball shipped 0 (just 1 fixture JSON).
    // Pin the floor to 20 so accidental dropping of the test/**/* glob
    // trips immediately, but allow for organic growth.
    const hub = results.find((r) => r.workspace === 'hub');
    expect(hub).toBeDefined();
    const tsFiles = hub!.resolvedTestFiles.filter((f) => f.endsWith('.test.ts'));
    expect(
      tsFiles.length,
      `hub should ship ≥20 *.test.ts via npm pack, found ${tsFiles.length}`,
    ).toBeGreaterThanOrEqual(20);
  });

  it('plugin ships its 3 adapter-config/channel/errors suites via npm pack (regression 07-09 03:43 cron)', () => {
    const plugin = results.find((r) => r.workspace === 'plugin');
    expect(plugin).toBeDefined();
    const tsFiles = plugin!.resolvedTestFiles.filter((f) => f.endsWith('.test.ts'));
    expect(
      tsFiles.length,
      `plugin should ship its 3 *.test.ts suites, found ${tsFiles.length}`,
    ).toBeGreaterThanOrEqual(3);
    // Pin specific filenames so a rename wouldn't sneak past the count gate.
    for (const expected of [
      'test/adapter-config.test.ts',
      'test/channel.test.ts',
      'test/errors.test.ts',
    ]) {
      expect(plugin!.resolvedTestFiles, `plugin should ship ${expected}`).toContain(expected);
    }
  });

  it('all subpackages report green — no silent test-file drops in npm pack', () => {
    // The all-green sanity floor. Mirrors subpackage-license-parity:
    // every subpackage either has no real tests on disk OR ships them
    // all via the declared package.json#files globs.
    const offenders = results.filter((r) => {
      if (r.onDiskTestFiles.length === 0) return false;
      const resolvedSet = new Set(r.resolvedTestFiles);
      return !r.onDiskTestFiles.every((f) => resolvedSet.has(f));
    });
    expect(
      offenders,
      `silent test-file drops: ${JSON.stringify(offenders.map((r) => r.workspace))}`,
    ).toEqual([]);
  });
});
