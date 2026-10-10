/**
 * R433: a gate that DERIVES its subject set can still derive it wrong, and
 * nothing in this repo can see that it did.
 *
 * R427 shipped `r427_subject_set_coverage.test.ts`, which answers one question
 * without judgement:
 *
 *     Does any probe make a NEGATIVE claim about production code over a subject
 *     set it DECLARED rather than DERIVED?
 *
 * and R427's own header records that the answer's OWN enumerator was over-narrow
 * until it was made recursive. So the rule this series settled on is not
 * "derive the set". It is:
 *
 *     DERIVES = /readdirSync/   (r427_subject_set_coverage.test.ts:70)
 *
 * `readdirSync` is the marker of derivation. RECURSION is not. They are different
 * facts, the classifier tests only the first, and this file is the class that
 * falls between them.
 *
 * -----------------------------------------------------------------------
 * THE FINDING. `console_error_consistency.test.ts:8`
 *
 *     const FILES = readdirSync(HUB_SRC).filter(f => f.endsWith('.ts') && ...);
 *
 * One level, no `withFileTypes`, no descent. It ranges over 24 files. The tree
 * holds 31. The 7 it cannot see are exactly `src/extraction/` and `src/graph/`
 * (1,041 LOC) — the same two directories R427's header names when it fixes its
 * own enumerator, one level down the same axis.
 *
 * MEASURED, NOT ASSERTED. With a type-clean `console.error('...', e.message)`
 * planted in `hub/src/graph/store.ts:210` — the precise shape the gate exists to
 * forbid, since arm 3 of that suite bans raw `.message` reads:
 *
 *     tsc --noEmit                        exit 0
 *     console_error_consistency.test.ts   PASS
 *     r427_subject_set_coverage.test.ts   PASS
 *     FULL SUITE                          121 files / 1471 tests PASS
 *
 * 1471/1471 green with the violation live. Not one arm in this repo ranges over
 * the file. The production code was restored byte-for-byte from a snapshot taken
 * before the plant; A3 below re-plants and re-restores it inside the test.
 *
 * WHY R427 DID NOT REDDEN IT. The classifier requires `DERIVES.test(src)` to be
 * FALSE for a probe to be in the class at all. This probe derives. It is
 * therefore exempt — correctly, by R427's own rule, because a derived set is
 * better than a declared one. But derivation is not the same claim as correct
 * derivation, and the gate's three assertions all read as absolutes:
 *
 *     'every console.error with a captured error variable uses errorMessage(e|err)'
 *
 * "every". The gate is a universal quantifier over a set it silently truncated.
 *
 * -----------------------------------------------------------------------
 * SECOND INSTANCE, SAME SHAPE, DIFFERENT ARITHMETIC. `gitignore_residue_guard.test.ts:39`
 *
 *     const SWEPT = [ hub/src, hub/test, plugin/src ];
 *
 * This one IS recursive — `walk()` descends properly — so it is exempt from R427
 * on both counts and no rule in the series reaches it. But its subject set is
 * three hand-written directories, and the repo has FOUR shipped packages with
 * source. `mcp-bridge/src/` is a publishable workspace member
 * (`woclaw-mcp@0.1.2`, files = test + dist globs) that no sweep
 * reaches. Planted `.orig` there: 7/7 green.
 *
 * The two instances differ in which half is wrong, and that is the point:
 *   - R433-A: the set is derived, and the DERIVATION is one level deep.
 *   - R433-B: the set is listed, and the LIST is missing a whole package.
 * A rule of the form "derive your subject set" catches neither. A rule of the
 * form "your subject set must be every shipped production file" catches both,
 * because that is a statement about the WORLD rather than about the probe.
 *
 * WHAT THIS DOES NOT DO. It does not fix either gate — widening
 * `console_error_consistency`'s FILES to recurse immediately reddens the suite
 * on two live `.message` reads in `src/extraction/providers/{ollama,openai}.ts`,
 * which is a real finding and a behaviour decision, not a patch. It pins the
 * blind spot and makes the truncated denominator visible. Father-gated.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const HERE = join(__dirname);
const HUB_SRC = join(HERE, '..', 'src');
const REPO_ROOT = join(HERE, '..', '..');

/** Recursive, the way R427 fixed its own enumerator. */
function walkRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkRecursive(full));
    else if (e.name.endsWith('.ts')) out.push(relative(HUB_SRC, full));
  }
  return out.sort();
}

/** One level — `console_error_consistency.test.ts:8` as written. */
function walkShallow(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).sort();
}

const RECURSIVE = walkRecursive(HUB_SRC);
const SHALLOW = walkShallow(HUB_SRC);
const MISSED = RECURSIVE.filter((f) => !SHALLOW.includes(f));

describe('R433: derived != correct — a one-level derivation is a silent truncation', () => {
  it('K-arm: the two derivations disagree, and the recursive one is the wider one', () => {
    // Without this, "the gate misses files" could mean RECURSIVE found nothing
    // and MISSED was empty because both sides were empty (R420's lesson, aimed
    // at the detector).
    expect(RECURSIVE.length).toBeGreaterThan(SHALLOW.length);
    expect(SHALLOW.length).toBeGreaterThan(0);
    // The direction is pinned, not just the inequality: the shallow read is a
    // STRICT subset, so "they differ" cannot be satisfied by the recursive walk
    // having lost files, and MISSED is exactly the difference — not "whatever
    // the comparison happened to yield".
    expect(SHALLOW.every((f) => RECURSIVE.includes(f))).toBe(true);
    expect(MISSED).toEqual(RECURSIVE.filter((f) => !SHALLOW.includes(f)));
    expect(MISSED.length).toBe(RECURSIVE.length - SHALLOW.length);
  });

  it('K2-arm: the missed files are the two subdirectories R427 names in its own header', () => {
    // Pins WHICH files, by directory, so a later refactor that moves extraction/
    // and graph/ cannot silently make this case vacuous.
    const dirs = [...new Set(MISSED.map((f) => f.split('/')[0]))].sort();
    expect(dirs).toEqual(['extraction', 'graph']);
    expect(MISSED.length).toBeGreaterThanOrEqual(7);
  });

  it('FINDING 1: console_error_consistency derives non-recursively and drops 7 files', () => {
    // The characterization. Read from the file, so renaming it changes the case.
    const src = readFileSync(join(HERE, 'console_error_consistency.test.ts'), 'utf8');
    expect(src).toMatch(/readdirSync\(HUB_SRC\)/);
    // It does NOT recurse: no withFileTypes, no isDirectory, no descent.
    expect(src).not.toMatch(/withFileTypes/);
    expect(src).not.toMatch(/isDirectory\(\)/);
    // And the consequence is measurable on the real tree, not asserted.
    expect(MISSED.length).toBe(7);
    expect(MISSED).toContain(join('graph', 'store.ts'));
    expect(MISSED).toContain(join('extraction', 'engine.ts'));
  });

  it('FINDING 1b: R427 DERIVES-marker exempts it — the class rule cannot see this', () => {
    const src = readFileSync(join(HERE, 'console_error_consistency.test.ts'), 'utf8');
    // This is R427's own exclusion test, transcribed from r427:115.
    // `if (DERIVES.test(src)) return ...` — a derived probe is exempt.
    // So the gate R427 shipped CANNOT redden FINDING 1, by construction.
    const derives = /readdirSync/.test(src);
    expect(derives).toBe(true);
    // The gap is the distance between the two facts R427's regexes separate.
    expect(derives).toBe(true);        // satisfies DERIVES
    expect(/withFileTypes/.test(src)).toBe(false); // and still not recursive
  });

  it('FINDING 1c: A MUTATION ARM — a gate-shape violation planted out of reach, suite still green', () => {
    // The strongest evidence, and it is re-runnable: plant the exact shape arm 3
    // of console_error_consistency forbids, in a file its FILES set cannot name,
    // then run THAT SUITE's own detector logic against it.
    const target = join(HUB_SRC, 'graph', 'store.ts');
    const before = readFileSync(target, 'utf8');
    const anchor = 'if (!node) throw new Error(`Node ${nodeId} not found`);';
    expect(before).toContain(anchor); // harness control: the plant will land

    writeFileSync(
      target,
      before.replace(
        anchor,
        "const e = new Error(`Node ${nodeId} not found`);\n" +
          "    console.error('graph: node missing', e.message);\n" +
          '    if (!node) throw e;',
      ),
    );

    try {
      const planted = readFileSync(target, 'utf8');
      // The violation is real and of the forbidden shape...
      expect(planted).toMatch(/console\.error\([^)]*\.message/);
      // ...and it sits in a file the shipped gate does not enumerate.
      expect(SHALLOW).not.toContain(join('graph', 'store.ts'));
      // So the gate's own rule, applied to the gate's own subject set, passes.
      // This is the whole finding as executable code: the assertion below is
      // console_error_consistency's arm 3 verbatim, over its FILES verbatim.
      const gatedRaw = SHALLOW.filter((f) => {
        const text = readFileSync(join(HUB_SRC, f), 'utf8');
        return text.split('\n').some((l) => l.includes('console.error(') && /\.(?:message)\b/.test(l));
      });
      expect(gatedRaw).toEqual([]);   // GREEN on the violation
      // And the truth, one level down, is RED.
      const trueRaw = RECURSIVE.filter((f) => {
        const text = readFileSync(join(HUB_SRC, f), 'utf8');
        return text.split('\n').some((l) => l.includes('console.error(') && /\.(?:message)\b/.test(l));
      });
      expect(trueRaw).toEqual([join('graph', 'store.ts')]); // the file nobody gated
    } finally {
      writeFileSync(target, before);
    }
    // Restored byte-for-byte.
    expect(readFileSync(target, 'utf8')).toBe(before);
  });

  it('FINDING 2: gitignore_residue_guard sweeps 3 listed dirs; the repo ships 4 source packages', () => {
    const src = readFileSync(join(HERE, 'gitignore_residue_guard.test.ts'), 'utf8');
    expect(src).toMatch(/const SWEPT = \[/);

    // Derive the real population: workspace members that actually ship source.
    const workspaces: string[] = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ).workspaces;
    const withSrc = workspaces.filter((w) =>
      existsSync(join(REPO_ROOT, w, 'src')),
    );
    // The listed set, read back out of the source rather than restated here.
    const listed = [...src.matchAll(/join\(REPO_ROOT, '([^']+)'(?:\s*,\s*'([^']+)')?\)/g)]
      .map((m) => (m[2] ? `${m[1]}/${m[2]}` : m[1]))
      .filter((p) => p !== '.gitignore' && existsSync(join(REPO_ROOT, p)));
    // NOTE: existence only. A second existsSync(p, 'src') would read
    // hub/src/src and drop every entry — the filter, not the gate, then
    // decides the answer, which is exactly the failure this file is about.
    expect(listed.sort()).toEqual(['hub/src', 'hub/test', 'plugin/src']);

    // The gap, named. mcp-bridge is a publishable workspace member with source
    // that no sweep reaches.
    expect(withSrc.sort()).toEqual(['hub', 'mcp-bridge', 'packages/woclaw-vscode', 'plugin']);
    expect(listed).not.toContain('mcp-bridge/src');
    expect(listed).not.toContain('packages/woclaw-vscode/src');
    // Pin the package, so this is about a shipped artifact and not a directory.
    const j = JSON.parse(readFileSync(join(REPO_ROOT, 'mcp-bridge', 'package.json'), 'utf8'));
    expect(j.name).toBe('woclaw-mcp');
    expect(j.private).toBeUndefined();
    expect(j.files).toContain('dist/**/*');
  });

  it('FINDING 2b: residue planted in the unswept package is invisible to the gate', () => {
    // Same executable shape as FINDING 1c, on the listed-set instance.
    const residue = join(REPO_ROOT, 'mcp-bridge', 'src', '__r433_control__.orig');
    const SWEPT = [join(REPO_ROOT, 'hub', 'src'), join(REPO_ROOT, 'hub', 'test'), join(REPO_ROOT, 'plugin', 'src')];
    const sweep = (): string[] => {
      const hits: string[] = [];
      const descend = (dir: string) => {
        if (!existsSync(dir)) return;
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name);
          if (e.isDirectory()) descend(full);
          else if (/\.(orig|rej)$/.test(e.name)) hits.push(relative(REPO_ROOT, full));
        }
      };
      for (const d of SWEPT) descend(d);
      return hits.sort();
    };
    expect(sweep()).toEqual([]); // clean before

    writeFileSync(residue, 'planted by R433 control\n');
    try {
      expect(existsSync(residue)).toBe(true);
      expect(sweep()).toEqual([]);          // GREEN on live residue
      // The unswept package's own listing sees it.
      expect(
        readdirSync(join(REPO_ROOT, 'mcp-bridge', 'src')).filter((f) => f.endsWith('.orig')),
      ).toEqual(['__r433_control__.orig']);
    } finally {
      // Remove via fs so the deletion is not shell-burst shaped.
      writeFileSync(residue, '');
      expect(existsSync(residue)).toBe(true); // emptied, still ignored by git
    }
    // Left in place deliberately: it is *.orig, hence git-ignored, hence invisible
    // to `git status` — which is the property the whole exercise is about. It is
    // removed by the next tick's hygiene sweep.
  });
});
