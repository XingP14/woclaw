/**
 * R423: a characterization that names the wrong package is still a false green.
 *
 * R422 (ac740fa) shipped `r422_pack_payload_provenance.test.ts`, whose headline
 * case is:
 *
 *     expect(shippingIgnoredBuildOutput.sort())
 *       .toEqual(['hub', 'plugin', 'woclaw-vscode']);
 *
 * and whose comment reads "hub, plugin and woclaw-vscode ALL ship a
 * git-ignored build output. That is the hazard, pinned as a fact."
 *
 * NOTE ON THIS HEADER: the glob literals below are written without their
 * trailing star-plus-slash sequence, because that sequence terminates a block
 * comment. R422 lost every one of its cases to exactly that, and found out
 * only because nothing had ever loaded the file. The globs are spelled out
 * here as "dist/<star>" so a reader can see the intent and the file can still
 * parse.
 *
 * Two independent defects, both verified by executing rather than reading:
 *
 *   1. THE DETECTOR ASKS ABOUT A LITERAL. Line 120 is
 *     `if (ignoredByGit('dist')) ...` -- the string 'dist', for every package,
 *     regardless of which directory that package actually ships. woclaw-vscode
 *     ships an `out` build directory. `out/` is NOT git-ignored, and
 *     `packages/woclaw-vscode/out/extension.js` is TRACKED IN GIT. So the case
 *     credits woclaw-vscode with a hazard it does not have, and does it only
 *     because a top-level `dist/` rule exists for a directory it does not use.
 *
 *   2. THE DENOMINATOR IS INHERITED. The repo has TEN package.json files;
 *     the case enumerates THREE, hardcoded. `mcp-bridge` ships a `dist` build
 *     directory, has NO prepack/prepare/prepublishOnly hook, and IS ignored --
 *     the single clearest instance of the exact hazard R422 set out to pin --
 *     and it was never in the subject set. This is R409 (denominator
 *     inherited -> wrong number) arriving one round after R409 was diagnosed,
 *     in the shape R421 named: a pinned list that can only get shorter.
 *
 * The corrected answer is ['hub', 'mcp-bridge', 'plugin'] -- the SAME COUNT (3),
 * a DIFFERENT SET. A count-preserving set correction is the hardest kind to
 * notice, because every summary statistic R422 reported still holds.
 *
 * WHAT THIS DOES NOT DO. It does not fix the packaging hazard, and it does not
 * change published output (that is father-gated). It corrects a committed
 * factual claim, which is the narrowest possible thing.
 *
 * ---------------------------------------------------------------------------
 * R423-AT-02:03 ADDENDUM -- THE CORRECTION ITSELF HAD A FALSE GREEN.
 *
 * The version of this file recovered from the 01:03 tick asserted the set above
 * and was RED (3 of 5 passing) for a reason that had nothing to do with the
 * claim: `allPublishable()` walked ONLY `packages/`. The three top-level
 * packages -- hub, plugin, mcp-bridge, which are exactly the packages the
 * assertion is about -- were never enumerated, so `packagesShippingIgnoredBuild
 * Output()` returned [] and the K-arm read that emptiness as a package set.
 *
 * That is the same failure R422 made, one level up: a detector whose subject
 * set it never actually built. The corrected claim was right and its
 * instrument was broken. R419's lesson again -- an artifact nobody ran is not
 * evidence -- had it been run by anything, the emptiness would have shown up
 * as a red test rather than being carried to a commit.
 *
 * The walk is now a depth-capped tree walk with an explicit SKIP_DIRS set, and
 * the K-arm pins the exact nine-name publishable set rather than a count. The
 * mutation matrix that drove the last two changes: M1 (stop descending) and
 * M3 (depth cap 0) each kill K-arm; M2b (plant a new publishable package under
 * packages/) kills K-arm AND the subject-set case; M4 (add 'packages' to
 * SKIP_DIRS) kills K-arm. `length > 3` was tried first and killed nothing --
 * it is satisfied by every superset, which is R409 and R421 with the sign
 * unchanged.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(HUB_ROOT, '..');

function pkg(dir: string): any {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
}

function gitignoreLines(): string[] {
  const p = join(REPO_ROOT, '.gitignore');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').map((l) => l.trim());
}

function ignoredByGit(dir: string): string | null {
  for (const line of gitignoreLines()) {
    if (!line || line.startsWith('#')) continue;
    if (line === `${dir}/` || line === dir) return line;
  }
  return null;
}

/**
 * Directories that never contain a publishable package of their own and would
 * otherwise turn the walk into a full-tree crawl.
 */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'out', 'build', 'lib', 'bin', 'media',
  'coverage', 'test', 'tests', '_tmp', '.git', 'site-static', 'data',
]);

/**
 * Every workspace package that can be published (not private).
 *
 * THE R423 DEFECT, verbatim: the original walked only `packages/`, so the three
 * TOP-LEVEL packages -- hub, plugin, mcp-bridge, which are precisely the
 * packages the assertion is about -- were never enumerated. The list came back
 * empty and the assertion read that emptiness as "no hazards".
 */
function allPublishable(): { dir: string; label: string }[] {
  const found: { dir: string; label: string }[] = [];
  const walk = (rel: string, depth: number) => {
    if (depth > 3) return;
    let entries: string[];
    try {
      entries = readdirSync(join(REPO_ROOT, rel));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
      const childRel = rel ? `${rel}/${entry}` : entry;
      let isDir: boolean;
      try {
        isDir = statSync(join(REPO_ROOT, childRel)).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      if (existsSync(join(REPO_ROOT, childRel, 'package.json'))) {
        const j = pkg(join(REPO_ROOT, childRel));
        if (!j.private && j.name) found.push({ dir: childRel, label: j.name });
      }
      walk(childRel, depth + 1);
    }
  };
  walk('', 0);
  return found;
}

/**
 * Ask about the directory a package SHIPS, not about a literal.
 * This is the whole difference between R422's detector and this one.
 */
function packagesShippingIgnoredBuildOutput(): string[] {
  const hits: string[] = [];
  for (const { dir, label } of allPublishable()) {
    const j = pkg(join(REPO_ROOT, dir));
    for (const entry of j.files || []) {
      const top = entry.split('/')[0];
      if (!/^(dist|out|build|lib)$/.test(top)) continue;
      if (ignoredByGit(top)) hits.push(`${label} ships git-ignored ${top}/`);
    }
  }
  return hits.sort();
}

describe('R423: the R422 characterization named the wrong package', () => {
  it('K-arm: the enumerator sees the real package set, not a hardcoded three', () => {
    // Without this, "three packages" could just mean the walk found three.
    //
    // PINNED SET, NOT A COUNT. The first version of this case asserted
    // `length > 3` and three named members, and the mutation matrix killed
    // that: planting a whole new publishable package anywhere in the tree
    // left it green. `> 3` is satisfied by every superset, which is exactly
    // R409 (a denominator that can only grow) and R421 (a negative assertion
    // that does not pin its subject set). R422's original error was a
    // hardcoded three; the corrected error would be an open-ended count.
    const names = allPublishable().map((p) => p.label).sort();
    expect(names).toEqual([
      'opencode-woclaw',
      'woclaw-codex',
      'woclaw-codex-example',
      'woclaw-examples',
      'woclaw-hooks',
      'woclaw-hub',
      'woclaw-mcp',
      'woclaw-vscode',
      'xingp14-woclaw',
    ]);
    // The workspace root is private and must NOT appear.
    expect(names).not.toContain('woclaw-workspace');
  });

  it('K2-arm: ignoredByGit can say "no" about a real, unignored directory', () => {
    // The R420 M2 lesson aimed at the DETECTOR: without a negative arm, a
    // detector that always returned a hit would pass every positive case.
    expect(ignoredByGit('out')).toBeNull();
    expect(ignoredByGit('dist')).toBe('dist/');
    expect(ignoredByGit('no-such-dir-xyz')).toBeNull();
  });

  it('woclaw-vscode is NOT a hazard: it ships out/, which is tracked in git', () => {
    // This is the specific false credit. R422 lists it; it does not apply.
    const j = pkg(join(REPO_ROOT, 'packages/woclaw-vscode'));
    expect(j.files).toContain('out/**/*');
    expect(j.files).not.toContain('dist/**/*');
    expect(ignoredByGit('out')).toBeNull();
    // And the shipped artifact is not a build product at all -- it is in git.
    expect(existsSync(join(REPO_ROOT, 'packages/woclaw-vscode/out/extension.js'))).toBe(true);
  });

  it('mcp-bridge IS a hazard, and R422 never enumerated it', () => {
    const j = pkg(join(REPO_ROOT, 'mcp-bridge'));
    expect(j.files).toContain('dist/**/*');
    expect(ignoredByGit('dist')).toBe('dist/');
    expect(j.scripts?.prepack || j.scripts?.prepare).toBeUndefined();
    expect(j.scripts?.prepublishOnly).toBeUndefined();
  });

  it('the corrected subject set is hub + mcp-bridge + plugin -- same count, different set', () => {
    const hits = packagesShippingIgnoredBuildOutput();
    expect(hits).toEqual([
      'woclaw-hub ships git-ignored dist/',
      'woclaw-mcp ships git-ignored dist/',
      'xingp14-woclaw ships git-ignored dist/',
    ]);
    // R422's set, asserted false so the correction cannot silently regress.
    expect(hits).not.toContain('woclaw-vscode ships git-ignored out/');
  });
});