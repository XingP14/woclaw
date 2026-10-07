/**
 * Repo hygiene guard: the residue classes an agent session actually produces.
 *
 * THE FINDING. This repo's .gitignore guarded exactly one residue shape:
 *
 *     # Editor / sed backup files
 *     *.bak
 *
 * and nothing tested it at all (`grep -rl 'gitignore|check-ignore' hub/test`
 * returns nothing). Three other classes of artefact are produced here
 * routinely and none of them is ignored:
 *
 *   - *.orig / *.rej  `patch` writes .orig when the context does not match
 *                     exactly, and .rej alongside it. The pre-image lands
 *                     INSIDE src/ and shows up in every `git status`.
 *   - _tmp/           this repo's own probe backups (354 untracked entries at
 *                     2026-10-07 22:03) plus the llm-benchmark convention of
 *                     parking residue there.
 *
 * The failure mode is the same one llm-benchmark closed in 3501f85: a guard
 * written for one pattern goes stale, and the suite stays green because no
 * assertion ever mentioned the shapes that actually appear.
 *
 * WHAT THIS DOES NOT DO. It does not delete anything, and it does not make
 * `git status` clean on its own -- 6 untracked probe scripts (hub/r406-probe
 * *.mjs, vitest.probe.config.ts) still sit outside _tmp/ and are a Father-gated
 * cleanup, not a hygiene rule. What it does is make a FUTURE leak of an ignored
 * shape fail here instead of quietly reappearing in every git status.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, relative } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const GITIGNORE = join(REPO_ROOT, '.gitignore');

/** Directories where residue must never live: shipped source and the suites. */
const SWEPT = [
  join(REPO_ROOT, 'hub', 'src'),
  join(REPO_ROOT, 'hub', 'test'),
  join(REPO_ROOT, 'plugin', 'src'),
];

function checkIgnore(paths: string[]): { probe: string; exitCode: number }[] {
  return paths.map((probe) => {
    try {
      execFileSync('git', ['check-ignore', '-q', probe], { cwd: REPO_ROOT });
      return { probe, exitCode: 0 };
    } catch (err: unknown) {
      return { probe, exitCode: (err as { status?: number }).status ?? -1 };
    }
  });
}

describe('repo .gitignore: agent residue is ignored, and stays ignored', () => {
  it('K — CONTROL. a path this suite expects to be ignored IS ignored', () => {
    // Without this, "nothing is broken" could mean check-ignore never returns 0
    // for anything (the R420 lesson aimed at the detector instead of the subject).
    expect(checkIgnore(['hub/src/db.ts.bak'])[0].exitCode).toBe(0);
  });

  it('K2 — CONTROL. a tracked source path is NOT ignored', () => {
    // The other half: a rule set so broad that it eats real source would pass
    // every assertion below while destroying the repo.
    expect(checkIgnore(['hub/src/ws_server.ts'])[0].exitCode).toBe(1);
  });

  it('1) .gitignore pins *.orig and *.rej as their own lines', () => {
    const content = readFileSync(GITIGNORE, 'utf-8');
    expect(content).toMatch(/^\*\.orig$/m);
    expect(content).toMatch(/^\*\.rej$/m);
  });

  it('2) git check-ignore exits 0 for patch residue inside src/ and test/', () => {
    // hub/src/index.ts.runbench.orig is the exact shape that leaked in
    // llm-benchmark (3501f85); the second is the sibling .rej.
    const probes = [
      'hub/src/index.ts.runbench.orig',
      'hub/src/ws_server.rej',
      'hub/test/r421_subject_set_binding.test.ts.orig',
      'plugin/src/index.rej',
    ];
    expect(checkIgnore(probes)).toEqual(probes.map((probe) => ({ probe, exitCode: 0 })));
  });

  it('3) the probe tree (_tmp/) is ignored, so backups stop polluting git status', () => {
    const probes = ['_tmp/scratch.ts', 'hub/_tmp/probe-backup.py', 'hub/_tmp/x.orig'];
    expect(checkIgnore(probes)).toEqual(probes.map((probe) => ({ probe, exitCode: 0 })));
  });

  it('4) no .orig/.rej residue is live in src/ or test/ right now', () => {
    // A real filesystem sweep, so the guard is not the only thing standing:
    // a planted file with the rules intact fails THIS case alone.
    const residue: string[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(orig|rej)$/.test(e.name)) residue.push(relative(REPO_ROOT, full));
      }
    };
    for (const dir of SWEPT) walk(dir);
    expect(residue).toEqual([]);
  });

  it('5) the sweep arm detects a planted residue file (harness control)', () => {
    // K3. Without planting one, case 4 could pass because the walk never ran
    // (a typo'd path, a renamed dir) rather than because the tree is clean.
    const planted = join(REPO_ROOT, 'hub', 'src', '__hygiene_control__.orig');
    writeFileSync(planted, 'planted by the hygiene guard control case\n');
    let residue: string[] = [];
    try {
      const walk = (dir: string) => {
        if (!existsSync(dir)) return;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (/\.(orig|rej)$/.test(e.name)) residue.push(relative(REPO_ROOT, full));
        }
      };
      for (const dir of SWEPT) walk(dir);
    } finally {
      rmSync(planted, { force: true });
    }
    expect(residue).toEqual(['hub/src/__hygiene_control__.orig']);
    expect(existsSync(planted)).toBe(false);
  });
});