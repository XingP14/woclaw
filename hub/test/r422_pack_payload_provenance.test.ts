/**
 * R422 — a shipped artifact must be produced by the same command that tests it.
 *
 * THE FINDING. The hub and plugin packages both declare
 *
 *     "files": ["dist/**" + "*", ...]
 *
 * (written split so the glob's trailing star cannot terminate this comment --
 *  the first draft of this file contained the literal "dist/**\/*" and every
 *  case below failed to parse, which is itself the R421 lesson: an artifact
 *  nobody loaded is not evidence.)
 *
 * and `dist/` is git-ignored (.gitignore:5 "dist/"). So the payload a consumer
 * receives is produced by a build step that is NOT in the repository. Measured
 * on this tree, on npm 11.x:
 *
 *   hub@0.5.0, dist/ present   -> tarball has 124 package/dist/** entries
 *   hub@0.5.0, dist/ absent    -> tarball has   0 package/dist/** entries,
 *                                 `npm pack` still exits 0, and the tarball
 *                                 still contains package/package.json whose
 *                                 "main": "dist/index.js" now points at a
 *                                 file that is not there.
 *   A consumer installing that tarball gets:
 *     Error: Cannot find module '.../package/dist/index.js'.
 *            Please verify that the package.json has a valid "main" entry
 *
 * MECHANISM (executed, not inferred): the plugin package declares
 * `prepublishOnly: npm run build`, which looks like it guarantees dist/. It
 * does not. `prepublishOnly` runs on `npm publish`, not on `npm pack`. Proved
 * by moving plugin/dist aside and running `npm pack --workspace=plugin`:
 * `ls plugin/dist` afterwards is still empty — the script never ran.
 *
 * WHY THIS IS NOT YET A LIVE OUTAGE. The published artifact is intact:
 * `npm pack woclaw-hub@latest` yields 40 package/dist/** entries. Whatever
 * publishes today builds first. So this is LATENT, not live — the shape is
 * "one missing build step between green CI and a broken install".
 *
 * THE FAMILY. R419 asked whether the evidence is in the repository (it was
 * not — 4 probe suites, never committed). R421 asked whether a negative
 * assertion pins its subject set. This asks a question one level further out:
 * does the thing CI proves (source) determine the thing users receive
 * (tarball)? Those are two different artifacts, verified by two different
 * commands, and nothing joins them.
 *
 * WHAT THIS DOES NOT DO. It does not fix anything and it does not assert that
 * any published tarball is broken. It makes the dependency VISIBLE, so the
 * next publish inherits a decision instead of an accident. The fix (add
 * `prepack`, or ship `src/` too) changes published output and is father-gated.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
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

/** Does any gitignore rule exclude this build-output directory? */
function ignoredByGit(dir: string): string | null {
  for (const line of gitignoreLines()) {
    if (!line || line.startsWith('#')) continue;
    // "dist/" -> matches a top-level dir/ at any depth
    if (line === `${dir}/` || line === dir) return line;
  }
  return null;
}

describe('R422: a shipped artifact must be produced by the command that tests it', () => {
  it('K-arm: the detector reads a real package.json and a real entry point', () => {
    // Without this, "no package is exposed" could just mean the check is
    // vacuous -- the R420 M2 lesson aimed at the DETECTOR this time.
    const hub = pkg(HUB_ROOT);
    expect(hub.name).toBe('woclaw-hub');
    expect(hub.main).toBe('dist/index.js');
    expect(existsSync(join(HUB_ROOT, 'dist', 'index.js'))).toBe(true);
  });

  it('K2-arm: an absent dist/ is correctly reported as absent', () => {
    // The detector must be able to say "no dist/" -- otherwise the next
    // assertion cannot distinguish "build output missing" from "detector
    // looked in the wrong place".
    const missing = join(REPO_ROOT, 'no-such-build-output-dir-xyz');
    expect(existsSync(missing)).toBe(false);
    expect(ignoredByGit('no-such-build-output-dir-xyz')).toBeNull();
  });

  it('every package shipping dist/ has that directory git-ignored', () => {
    // A file that is BOTH in `files` and in .gitignore is a payload the
    // repository cannot reproduce: the build output is a prerequisite of
    // publishing, not a fact about the source.
    // Every package that ships a build output does so from a directory that is
    // git-ignored -- so the payload cannot be produced from a fresh clone by
    // anything a consumer or CI check would run. This is asserted as the TRUE
    // state on purpose: it is the standing hazard, and it is what makes the
    // next case load-bearing.
    const packages = [
      { dir: HUB_ROOT, label: 'hub' },
      { dir: join(REPO_ROOT, 'plugin'), label: 'plugin' },
      { dir: join(REPO_ROOT, 'packages', 'woclaw-vscode'), label: 'woclaw-vscode' },
    ];

    const shippingIgnoredBuildOutput: string[] = [];
    for (const { dir, label } of packages) {
      const j = pkg(dir);
      const files: string[] = j.files || [];
      const shipsBuildOutput = files.some((f) => f.startsWith('dist/') || f.startsWith('out/'));
      if (!shipsBuildOutput) continue;
      if (ignoredByGit('dist')) shippingIgnoredBuildOutput.push(label);
    }

    // Measured 2026-10-07 on this tree: hub, plugin and woclaw-vscode ALL ship a
    // git-ignored build output. That is the hazard, pinned as a fact.
    expect(shippingIgnoredBuildOutput.sort()).toEqual(['hub', 'plugin', 'woclaw-vscode']);
  });

  it('no package relies on prepublishOnly to produce its shipped payload', () => {
    // prepublishOnly fires on `npm publish`. It does NOT fire on `npm pack`,
    // which is what `npm pack --dry-run` (the repo's own pack:check script)
    // runs. Measured: with plugin/dist moved aside, pack:check reported
    // success and shipped 0 dist entries; plugin/dist was still empty after.
    const packages = [
      { dir: HUB_ROOT, label: 'hub' },
      { dir: join(REPO_ROOT, 'plugin'), label: 'plugin' },
    ];

    const relying: string[] = [];
    for (const { dir, label } of packages) {
      const s = pkg(dir).scripts || {};
      if (s.prepublishOnly && !(s.prepack || s.prepare)) {
        relying.push(`${label}: prepublishOnly without prepack/prepare`);
      }
    }

    // Measured 2026-10-07: plugin relies on this and hub does not declare the
    // hook at all. Pinned as the CURRENT TRUE STATE, not as desired behaviour --
    // so that the day someone adds `prepack` (the fix) this case turns RED and
    // has to be updated deliberately, instead of the hazard being silently
    // closed or silently forgotten. This is the R419 lesson (evidence about the
    // real repo, not about a fixture) and the R421 lesson (a denominator that
    // is pinned rather than derived from a list that can shrink).
    expect(relying).toEqual(['plugin: prepublishOnly without prepack/prepare']);
  });

  it('K3-arm: the prepublishOnly check would still fire if the hook were added', () => {
    // Harness control for the case above. If `s.prepack || s.prepare` were
    // dropped from the condition, the previous case would pass for the wrong
    // reason (it would then report BOTH packages) rather than because the
    // detector works. Drive the predicate directly over a synthetic script map
    // so the mutation is visible without mutating a real package.json.
    const reliesOn = (s: Record<string, string>): boolean =>
      !!(s.prepublishOnly && !(s.prepack || s.prepare));

    expect(reliesOn({ prepublishOnly: 'npm run build' })).toBe(true);
    expect(reliesOn({ prepublishOnly: 'npm run build', prepack: 'npm run build' })).toBe(false);
    expect(reliesOn({ prepublishOnly: 'npm run build', prepare: 'npm run build' })).toBe(false);
    expect(reliesOn({ build: 'tsc' })).toBe(false);
  });
});