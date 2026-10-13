/**
 * R451 — **property-based testing for agents is the plane, and WoClaw has 0% of
 * it.** The R74 in-cluster run (R441–R450, ten rounds) is discharged here by
 * leaving the probe plane for an external one.
 *
 * THE EXTERNAL PLANE. R74 wedge probe, 2026-10-14 01:0x, 60-day window:
 *
 *   HN 9/10 TRUE ZERO   `property based testing LLM agent invariant` · `metamorphic
 *                        testing agent trajectory` · `invariant testing autonomous
 *                        agent` · `agent property testing shrinking` · `differential
 *                        testing agent tool call` · `fast-check agent invariant
 *                        TypeScript` · `invariant fuzzing tool calling agent` ·
 *                        `semantic invariance agent evaluation` · `property test
 *                        coverage gate CI agent` — all 0.
 *   CONTROLS LIVE (R403): agent 4793 · AI agent 2220 · LLM 2103 · testing 445 ·
 *                        fuzzing 52. The zeros are evidence, not a dead socket.
 *   GitHub: sub-saturated, peak 8★ (`property based testing agent` total=41 is
 *   ~90% junk — three 2021 text-dump repos at 162/78/20★).
 *
 * WHY IT IS ORTHOGONAL AND NOT A RESTATEMENT. R449-2 stated the rule *"assert
 * relations, not inventories"* and R450 executed it on one suite. This round takes
 * the rule as a **substrate** rather than a **rule**: the whole discipline of
 * finding defects without an oracle, generalized to agents, is the external body
 * of work that rule came from.
 *
 * THE FINDING is not "WoClaw could use fast-check".
 *
 * Census: 120 test files, 1567 tests, and **zero** uses of a generative-input
 * library (`fast-check` / `pure-rand` / `jsverify` / `check.it` / `@given`).
 * Every input in every test is a hand-written literal. The cost of that is
 * concrete below.
 *
 * The scope guard (`hub/src/memory.ts:110-117`) is governed by three dedicated
 * suites (R408 / R409 / R410 — 22 arms, all green), and every seed they use obeys
 * an invariant the generator never had to respect: **the tags agree with the key.**
 * R408's own `seed()`:
 *
 *     await mp.write('openclaw:workspace:infra:ssh-key', 'WS', 'rest-api', ['infra'], 0);
 *     await mp.write('openclaw:session:main:agent:main:cron:abc', 'SS', 'rest-api', ['session'], 0);
 *
 * The property those suites cannot ask is: *is scope a partition of the memory
 * set?* — and over a generated alphabet the answer is no.
 * `isVisibleInScope` matches on `mem.tags.some(tag => tag.toLowerCase()
 * .includes(scope))`, and `includes` is a SUBSTRING test, not a token test. A
 * memory keyed `openclaw:session:agent-a:secret` and tagged `['workspace']` is
 * simultaneously workspace-visible and session-visible. Measured through the real
 * `MemoryPool`:
 *
 *     read  as scope=workspace : LEAK -> SESSION-ONLY-PAYLOAD
 *     read  as scope=session   : ok    -> SESSION-ONLY-PAYLOAD
 *     getAll(scope=workspace)  : [ 'openclaw:session:agent-a:secret' ]
 *     delete(scope=workspace)  : DELETED a session-owned memory
 *
 * A workspace-scoped caller can read, list **and delete** a session-owned
 * memory. `tags` is caller-supplied and unvalidated on the write path
 * (`MemoryPool.write(key, value, updatedBy, tags = [], ttl = 0)`), so any writer
 * can reach it. The three R4xx scope suites stay GREEN under this finding: they
 * are not wrong, they are **example-based**, and this is what they cannot reach.
 *
 * ── THE BINDING DEFECT THIS FILE ALREADY COMMITTED ONCE ─────────────────────
 *
 * The first version of this suite generated over the same alphabet but asserted
 * against a re-declared `visibleInScopeOracle`, and pinned violations with
 * `expect(n).toBeGreaterThan(0)`. The mutation matrix answered 1 KILLED / 4
 * SURVIVED — including the mutation that applies the real fix, and including an
 * ARMED CONTROL that deleted a suite assertion. Two independent defects:
 *
 *   (i) **the oracle was a copy of the subject, so no production change could
 *       reach it** — that is R442's text-coverage defect reproduced inside the
 *       fix for R442, one round later. An oracle you maintain by hand is a
 *       second implementation, and a second implementation can agree with
 *       production while measuring nothing;
 *   (ii) `toBeGreaterThan(0)` is **direction-agnostic**. It says violations
 *       exist; it cannot say they got worse or better. R449-13's rule —
 *       assert the divergence, never a bare count — applied to my own arm.
 *
 * So this version drives the **real MemoryPool** for every generated case and
 * pins **exact per-class violation counts**, so a change in either direction is
 * a change in a bound number. Both fixes are consequences of the matrix, not of
 * foresight: the matrix is the only reason they are here.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
 *
 * No production change. The fix is a decision, not a commit: either scope stops
 * being inferred from free-form tags, or the guard stops being read as an
 * isolation boundary. Both are father-gated — the `['workspace']`-tag path is
 * plausibly load-bearing for existing agents. Subject characterised, not
 * rewritten (R431 discipline).
 *
 * METHOD NOTES
 *
 * - **R451-1  A hand-rolled generator beats no generator.** The temptation on
 *   finding `fast-check` absent is to add the dependency. This suite adds none:
 *   the alphabet is ~15 lines and, critically, *legible* — a reviewer can see
 *   exactly which disagreements it explores. A black-box generator that shrank
 *   to `tags: ['workspace']` proves the same and hides the search.
 *
 * - **R451-2  The counterexample was found by a probe, not by reading.** The
 *   substring predicate is three grep-visible lines. Read, it looks fine. It took
 *   a 315-case generated alphabet to produce the inputs that violate the
 *   property.
 *
 * - **R451-3  Green is a statement about the seeds, not about the predicate.**
 *   R408's arms pass on seeds where tags and keys agree.
 *
 * - **R451-4  A restore path that does not restore makes every later
 *   measurement a fiction.** The first matrix run was going to mutate this suite
 *   while it was still untracked, so `git checkout --` — the restore mechanism —
 *   would have silently done nothing and M5 would have run against an
 *   already-mutated file. The harness now stages the suite and *asserts the
 *   index holds it* before mutating anything (R446-1's class).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { ClawDB } from '../src/db.js';
import { MemoryPool } from '../src/memory.js';

// ── the generator ────────────────────────────────────────────────────────────

/**
 * Tag alphabet, chosen to include every disagreement CLASS rather than a
 * representative sample: exact, case variants, plural, infix, BOTH scopes in one
 * token, unrelated, empty.
 */
const TAG_ALPHABET = [
  'workspace', 'session',                 // exact
  'Workspace', 'SESSION',                 // case — production lowercases
  'workspaces', 'sessions',               // plural — `includes` still matches
  'my-workspace', 'a-session-b',          // infix
  'cross-workspace-session',              // both scopes in ONE token
  'project-session', 'infra', 'user',     // unrelated
  '',                                     // empty
] as const;

/** Keys: each scope prefix, a prefix containing BOTH, upper-cased, and bare. */
const KEY_ALPHABET = [
  'openclaw:workspace:infra:ssh-key',
  'openclaw:session:main:agent:main:cron:abc',
  'openclaw:workspace:session:both',      // key claims both scopes
  'openclaw:session:',
  'openclaw:workspace:',
  'note',
  'OPENCLAW:WORKSPACE:UPPER',             // production lowercases the key
] as const;

const TAG_ARITIES = [1, 2, 3] as const;

interface Case { key: string; tags: string[]; arity: number }

/** Derived by comprehension, never hand-listed (R427/R437). */
function* generated(): Generator<Case> {
  for (const key of KEY_ALPHABET) {
    for (const arity of TAG_ARITIES) {
      for (let start = 0; start + arity <= TAG_ALPHABET.length; start++) {
        yield { key, tags: TAG_ALPHABET.slice(start, start + arity), arity };
      }
    }
  }
}

const CASES = [...generated()];

/** Stable id. The tag list is part of the key so collisions are visible, not silent. */
const caseId = (c: Case): string => `${c.key}#${c.tags.join('|')}#${c.arity}`;

// ── production-derived visibility ────────────────────────────────────────────

/**
 * Drive the REAL MemoryPool. `isVisibleInScope` is not exported, so the only
 * honest way to observe it is through the public surface that uses it — which is
 * exactly the point of defect (i) above: the previous version of this file
 * measured a hand-written copy of the predicate instead.
 *
 * A case is visible in scope S iff `pool.read(key, S)` resolves it.
 */
async function deriveVisibility(): Promise<Record<string, { w: boolean; s: boolean }>> {
  const dir = mkdtempSync(join(tmpdir(), 'r451-derive-'));
  const db = new ClawDB(dir);
  await db.getTopicStats(); // force the ready promise (see db_legacy_import_guards)
  const pool = new MemoryPool(db);
  const out: Record<string, { w: boolean; s: boolean }> = {};
  try {
    // Write every case under a DISTINCT key so one write cannot overwrite
    // another — otherwise a collision would read as "invisible".
    for (const [i, c] of CASES.entries()) {
      await pool.write(`${c.key}@${i}`, c.tags.join(','), 'generator', c.tags, 0);
    }
    for (const [i, c] of CASES.entries()) {
      const key = `${c.key}@${i}`;
      const w = (await pool.read(key, 'workspace')) !== undefined;
      const s = (await pool.read(key, 'session')) !== undefined;
      out[caseId(c)] = { w, s };
    }
  } finally {
    await db.close();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

/**
 * The violation taxonomy. Two derivable classes, so the pinned counts describe a
 * SHAPE rather than a curiosity: if a number moves, a class boundary moved.
 *
 *   class-1 (cross-tag)  a tag naming ONE scope sits on a key naming the OTHER
 *   class-2 (union-tag) a single tag names BOTH scopes, on any key
 */
function classify(c: Case, v: { w: boolean; s: boolean }): 'class-1' | 'class-2' | null {
  if (!v.w || !v.s) return null;
  const lc = c.tags.map((t) => t.toLowerCase());
  if (lc.some((t) => t.includes('workspace') && t.includes('session'))) return 'class-2';
  const wsTag = lc.some((t) => t.includes('workspace'));
  const ssTag = lc.some((t) => t.includes('session'));
  const k = c.key.toLowerCase();
  if ((k.includes('openclaw:workspace:') && ssTag) || (k.includes('openclaw:session:') && wsTag)) {
    return 'class-1';
  }
  return null;
}

let VIS: Record<string, { w: boolean; s: boolean }> = {};
let COUNTS: Record<string, number> = { 'class-1': 0, 'class-2': 0 };
/**
 * 🔴 R451-7 — the taxonomy was INCOMPLETE and the first version of P1 asserted
 * it accounted for every violation (`expect(OTHER_VIOLATIONS).toBe(0)`). The
 * census says otherwise: 13 violations are class-3, and reading them shows why.
 * `note#workspace|session#2` — key `note` names NEITHER scope, tags name BOTH,
 * one per tag. That is not class-2 (which needs BOTH names in ONE tag) and not
 * class-1 (which needs the key to name one scope). So:
 *
 *   class-3 (disjoint-tags, bare key)  the two scopes are split ACROSS tags
 *                                     while the key names neither
 *
 * The lesson is the one R438/R446 keep teaching in new costumes: a pinned
 * `toBe(0)` on the residue of your own taxonomy is an assertion that your
 * taxonomy is complete, made by the author of the taxonomy. It was red on its
 * first honest run, and the number it went red on was the finding.
 */
let OTHER_VIOLATIONS = 0;
let OTHER_SAMPLE = '';

beforeAll(async () => {
  VIS = await deriveVisibility();
  for (const c of CASES) {
    const v = VIS[caseId(c)];
    if (!v.w || !v.s) continue;
    const k = classify(c, v);
    if (k) COUNTS[k]++;
    else { OTHER_VIOLATIONS++; if (!OTHER_SAMPLE) OTHER_SAMPLE = caseId(c); }
  }
});

// ── arms ─────────────────────────────────────────────────────────────────────

describe('R451 — a property the example-based scope suites cannot reach', () => {
  it('A (control): the generator is non-vacuous and production was actually driven', () => {
    expect(CASES.length).toBeGreaterThan(200);
    expect(new Set(CASES.map((c) => c.key)).size).toBe(KEY_ALPHABET.length);
    // Visibility was DERIVED from production for every case — a missing entry
    // would mean the probe silently skipped its subject (R421).
    expect(Object.keys(VIS).length).toBe(CASES.length);
    // Production really is discriminating (both answers occur in the generated set).
    expect(Object.values(VIS).some((v) => v.w && !v.s)).toBe(true);
    expect(Object.values(VIS).some((v) => v.s && !v.w)).toBe(true);
    // …and the AGREEING seeds — the shape R408 uses — are visible in their own
    // scope only. If this were false, the finding below would be vacuous.
    const agreeingWs = CASES.find((c) => c.key === 'openclaw:workspace:infra:ssh-key'
      && c.arity === 1 && c.tags[0] === 'infra')!;
    const agreeingSs = CASES.find((c) => c.key === 'openclaw:session:main:agent:main:cron:abc'
      && c.arity === 1 && c.tags[0] === 'session')!;
    expect(VIS[caseId(agreeingWs)]).toEqual({ w: true, s: false });
    expect(VIS[caseId(agreeingSs)]).toEqual({ w: false, s: true });
  });

  it('P1 — DISJOINTNESS: scope is NOT a partition; pinned per-class violation counts', () => {
    // ⭐ THE FINDING, pinned in BOTH directions (R449-13: assert the divergence,
    // never a bare count — the first version used `toBeGreaterThan(0)` and the
    // matrix showed it could not detect the fix).
    //
    // Each number is a BOUND on a violation CLASS, so a production change in
    // either direction changes a bound number. Applying the fix means editing
    // these to 0 — which is the point: it should be a visible, deliberate edit,
    // not something the suite absorbs.
    // Every number below is MEASURED by `scripts/r451_census.ts`, not written
    // down and hoped for (R443-7). The first draft guessed 27/45; the measured
    // values are 114/42/13 and the guess was wrong in the way that matters —
    // it implied the taxonomy was complete, which it is not.
    expect(COUNTS['class-1']).toBe(114);
    expect(COUNTS['class-2']).toBe(42);
    // The residue is class-3 (see the note above) and is pinned too, so the
    // taxonomy's blind spot is a bound number rather than a shrug.
    expect(OTHER_VIOLATIONS).toBe(13);
    expect(OTHER_SAMPLE).toBe('note#workspace|session#2');
    // Total: 169 of 252 generated cases answer to BOTH scopes. 67% of the input
    // space, from a guard whose job is to partition it.
    expect(COUNTS['class-1'] + COUNTS['class-2'] + OTHER_VIOLATIONS).toBe(169);
  });

  it('P2 — the canonical counterexample, reached through production, on every path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'r451-e2e-'));
    const db = new ClawDB(dir);
    await db.getTopicStats();
    const pool = new MemoryPool(db);
    try {
      await pool.write('openclaw:session:agent-a:secret', 'SESSION-ONLY-PAYLOAD', 'agent-a', ['workspace'], 0);

      const asWorkspace = await pool.read('openclaw:session:agent-a:secret', 'workspace');
      const asSession = await pool.read('openclaw:session:agent-a:secret', 'session');
      expect(asWorkspace?.value).toBe('SESSION-ONLY-PAYLOAD'); // cross-scope READ
      expect(asSession?.value).toBe('SESSION-ONLY-PAYLOAD');   // own-scope read still fine
      expect((await pool.getAll('workspace')).map((m) => m.key))
        .toContain('openclaw:session:agent-a:secret');          // cross-scope LIST

      // …and delete. Runs last: it mutates the fixture.
      expect(await pool.delete('openclaw:session:agent-a:secret', 'workspace')).toBe(true);
      expect(await pool.read('openclaw:session:agent-a:secret', 'all')).toBeUndefined();
    } finally {
      await db.close();
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('P3 — REFLEXIVITY: a key carrying its own scope prefix is always visible there', () => {
    // A property that DOES hold, over the whole generated set. Included so the
    // suite is not a one-claim probe: if every arm failed, nothing is localised.
    let checked = 0;
    for (const c of CASES) {
      if (!c.key.toLowerCase().includes('openclaw:workspace:')) continue;
      expect(VIS[caseId(c)].w).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('P4 — the three R4xx scope suites are example-based: every seed agrees', () => {
    // Why the defect survived 22 green arms: their seeds put a workspace key on
    // workspace-ish tags and a session key on session-ish tags. Characterises
    // the subject rather than judging it.
    const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
    const seeds = ['r408_scope_coverage.test.ts', 'r409_scope_denominator.test.ts',
                   'r410_enumeration_scope.test.ts']
      .flatMap((f) => [...read(f).matchAll(
        /\.write\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*\[([^\]]*)\]/g)]);

    expect(seeds.length).toBeGreaterThan(3); // non-vacuous: seeds were parsed

    const disagreeing = seeds.filter(([, key, tags]) => {
      const ts = [...tags.matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase());
      const wTagged = ts.some((t) => t.includes('workspace'));
      const sTagged = ts.some((t) => t.includes('session'));
      const k = key.toLowerCase();
      return (k.includes('openclaw:workspace:') && sTagged)
          || (k.includes('openclaw:session:') && wTagged);
    });
    // Zero disagreeing seeds — the region P1 explores was never sampled.
    expect(disagreeing.length).toBe(0);
  });

  it('P5 — CENSUS: the substrate is absent, and the count is bound', () => {
    // R438: a stated number needs an assertion binding it. This binds the claim
    // "no generative-input layer", so a later round adding fast-check must
    // revisit this file instead of leaving a lie in it.
    const pkg = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');
    expect(pkg.slice(pkg.indexOf('"devDependencies"')))
      .not.toMatch(/fast-check|pure-rand|jsverify|testcheck|quickcheck/);

    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        if (e === 'node_modules') continue;
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (e.endsWith('.test.ts')) files.push(f);
      }
    };
    walk(__dirname);
    expect(files.length).toBeGreaterThan(100);

    // 🔴 R447-1, hit by this arm's first run: the census sweeps every `.test.ts`
    // INCLUDING ITSELF, and this file contains the very regex literals it greps
    // for — so the guard proving "no generative-input layer" reported the
    // existence of the guard. The fix is NOT to loosen the pattern; it is to
    // exclude the plane that documents the finding, pinned by name (exactly one
    // file), never "exclude whatever is inconvenient".
    const SELF = basename(__filename);
    const generative = files
      .filter((f) => basename(f) !== SELF)
      .filter((f) =>
        /fast-check|pure-rand|fc\.(assert|property)|check\.it\b|jsverify|@given\b/.test(
          readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')));
    expect(generative).toEqual([]);
  });
});

/**
 * R451-6 (method note, not an arm). An earlier draft of P5 walked the test tree
 * through a recursive read whose base case was unasserted — R446-5's shape, where
 * an unbounded enumeration window reports a number nobody checked. The offline
 * census was taken by `scripts/r451_audit.ts` (120 files, gen-lib=0,
 * hand-rolled RNG=14, numeric-for-loops=6, metamorphic vocab=32); the bound that
 * ships is the `package.json` one, which is total and needs no window.
 */