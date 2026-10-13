/**
 * R453 — **the one enumeration surface an operator would actually use is the
 * only one that is broken.**
 *
 * R451 queued this candidate verbatim: *"run the generator over a second surface
 * — `handleMemoryByTag` / `search()`, and the read-vs-delete asymmetry is a
 * relation this method is built to find."* R453 executes it.
 *
 * R451's finding was a **leak** — scope is not a partition. This round asks the
 * other direction of the same guard. Its first draft claimed "scope is not
 * ENUMERABLE"; a re-measurement **falsified** that — three of the four
 * enumeration surfaces are complete. The finding is narrower, and sharper.
 *
 *     hub/src/memory.ts:110-117  isVisibleInScope(mem, scope)
 *       route 1 (key):   mem.key.toLowerCase().includes('openclaw:workspace:')
 *       route 2 (tags):  mem.tags.some(t => t.toLowerCase().includes('workspace'))
 *
 *     hub/src/memory.ts:205-207  queryByTag(tag, scope)
 *       dialect:          m.tags.includes(tag)          // EXACT, case-sensitive
 *
 * `includes('workspace')` — folded, substring — admits a memory the exact
 * `includes('workspace')` selector cannot name. So the question an operator
 * actually asks to audit a scope —
 *
 *     GET /memory?tags=workspace&scope=workspace
 *
 * — returns **10 of the 92** memories the guard admits. **89% missing.**
 *
 *   surface (all on the same admitted set of 92)      returns
 *   ────────────────────────────────────────────────────────────────
 *   queryByTag('workspace', 'workspace')   ← the audit question    10
 *   queryByTag(<the row's own tag>, scope)                           92
 *   search('workspace', 500, 'workspace')    ← fuzzy, folds          92
 *   recall('workspace', …, 500, 'workspace')                        92
 *
 * And in the opposite direction all four are **sound**: 0/140 rows come back from
 * any query while the guard denies them. So this is not a leak (R451's) — it is
 * an **audit gap**: the guard admits, three APIs can enumerate, and the one
 * spelled the way the REST route documents it cannot.
 *
 * The 82 invisible rows split by admission route, and the split is why `?tags=`
 * fails:
 *     key-prefix only (tag names neither scope)   32   →  0/32 enumerable
 *     tag only (key off-prefix)                    36   →  6/36
 *     both routes                                  24   →  4/24
 * `?tags=workspace` only ever names rows that LITERALLY carry `workspace` —
 * the minority route. **The surface's completeness is a function of how the
 * writer chose to key the row.** Nothing states that anywhere.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
 *
 * No production change. Two defensible fixes, both behaviour decisions:
 *   (a) make `queryByTag` speak the guard's dialect (fold + substring) — widens
 *       what `?tags=` returns for every existing caller; or
 *   (b) make admission speak the selector's dialect (exact, case-sensitive) —
 *       breaks the `['Workspace']` / `['my-workspace']` admissions R451's suites
 *       rely on and that real agents may write today.
 * Both father-gated. Subject characterised, not rewritten (R431 discipline).
 *
 * METHOD NOTES
 *
 * - **R453-1 pin the relation and the per-route table, never one count.** The
 *   headline is a direction (`admitted ⟹ enumerable`); the residue is pinned per
 *   admission route, so a fix cannot improve one route by wrecking another.
 * - **R453-2 completeness and soundness are separate arms.** They fail in
 *   opposite directions; pinning only completeness lets a leaky "fix" pass.
 * - **R453-3 assert the uniformity of the WORKING surfaces, or arm G is
 *   decoration.** `search`/`recall` look like a workaround; pinned at 92 they
 *   become the evidence that the defect is `queryByTag`'s dialect and not the
 *   rows. Removing either surface must redden this suite.
 * - **R453-4 every case's store must be a function of its own setup.** Two probe
 *   bugs, both caught by reading an impossible number, both silent (exit 0):
 *   `delete()` mutates the store it measures, and N writes to one key collapse
 *   to the last. R453's first claim ALSO said `search`/`recall` were incomplete
 *   because it passed the TAG where those surfaces take the scope WORD —
 *   corrected before any number was quoted (M410).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClawDB } from '../src/db.js';
import { MemoryPool } from '../src/memory.js';

/** Tag alphabet: every admission/selector disagreement class, not a sample. */
const TAG_ALPHABET = [
  'workspace', 'session',              // exact — the canonical selector
  'Workspace', 'SESSION', 'WorkSpace', // case — guard folds, selector does not
  'workspaces', 'sessions',            // plural — guard substring-matches
  'my-workspace', 'a-session-b',       // infix
  'cross-workspace-session',           // both routes' nouns in one token
  'project-session', 'infra', 'user',  // unrelated — key-prefix admission only
  '',                                  // empty
] as const;

const KEY_ALPHABET = [
  'openclaw:workspace:infra:ssh-key',           // canonical key prefix, workspace
  'openclaw:session:main:agent:main:cron:abc',  // canonical key prefix, session
  'openclaw:session:agent-a:secret',            // the R451 counterexample's
  'openclaw:workspace:agent-a:secret',          //   two subjects
  'deploy/bastion1/ssh-key',                    // off-prefix — tag-only admission
] as const;

type Scope = 'workspace' | 'session';

type Row = {
  key: string;
  tag: string;
  scope: Scope;
  admitted: boolean;        // getAll(scope) contains the key
  canonicalQuery: boolean;  // queryByTag(scope, scope)   ← the audit question
  ownTagQuery: boolean;     // queryByTag(tag, scope)
  searchPath: boolean;      // search(scope, 500, scope)
  recallPath: boolean;      // recall(scope, …, 500, scope)
  viaKeyPrefix: boolean;
  viaTag: boolean;
};

let rows: Row[] = [];
let deleteOutcome = new Map<string, boolean>();

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'r453-'));
  try {
    const db = new ClawDB(dir);
    const pool = new MemoryPool(db);

    // The key carries the tag so each (key, tag) is its own record (R453-4).
    for (const key of KEY_ALPHABET) {
      for (const tag of TAG_ALPHABET) {
        await pool.write(`${key}#${tag || 'EMPTY'}`, `payload-of-${key}`, 'rest-api', [tag], 0);
      }
    }

    const visible = new Map<Scope, string[]>();
    for (const scope of ['workspace', 'session'] as Scope[]) {
      visible.set(scope, (await pool.getAll(scope)).map(m => m.key));
    }

    for (const key of KEY_ALPHABET) {
      for (const tag of TAG_ALPHABET) {
        const full = `${key}#${tag || 'EMPTY'}`;
        for (const scope of ['workspace', 'session'] as Scope[]) {
          rows.push({
            key: full,
            tag,
            scope,
            admitted: visible.get(scope)!.includes(full),
            canonicalQuery: (await pool.queryByTag(scope, scope)).map(m => m.key).includes(full),
            ownTagQuery: (await pool.queryByTag(tag, scope)).map(m => m.key).includes(full),
            searchPath: (await pool.search(scope, 500, scope)).map(m => m.key).includes(full),
            recallPath: (await pool.recall(scope, undefined, 500, scope)).map(m => m.key).includes(full),
            viaKeyPrefix: full.toLowerCase().includes(`openclaw:${scope}:`),
            viaTag: tag.toLowerCase().includes(scope),
          });
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Destructive path, fresh store per case (R453-4: delete() mutates).
  for (const row of rows.filter(r => r.admitted)) {
    const d = mkdtempSync(join(tmpdir(), 'r453-del-'));
    try {
      const db = new ClawDB(d);
      const pool = new MemoryPool(db);
      await pool.write(row.key, `payload-of-${row.key}`, 'rest-api', [row.tag], 0);
      deleteOutcome.set(`${row.key}|${row.scope}`, await pool.delete(row.key, row.scope));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

afterAll(() => {
  rows = [];
  deleteOutcome = new Map();
});

const admitted = () => rows.filter(r => r.admitted);
const byRoute = (pred: (r: Row) => boolean) => admitted().filter(pred);

describe('R453 · scope is admitted by two routes; `?tags=` speaks only one', () => {
  it('A · the guard has exactly TWO admission routes and they exhaust admission', () => {
    const table = {
      both:    byRoute(r => r.viaKeyPrefix && r.viaTag).length,
      keyOnly: byRoute(r => r.viaKeyPrefix && !r.viaTag).length,
      tagOnly: byRoute(r => !r.viaKeyPrefix && r.viaTag).length,
      neither: byRoute(r => !r.viaKeyPrefix && !r.viaTag).length,
    };
    // `neither: 0` proves the two routes EXHAUST admission — a third route would
    // land here, and every relation arm below would still pass.
    expect(table).toEqual({ both: 24, keyOnly: 32, tagOnly: 36, neither: 0 });
    expect(admitted().length).toBe(92);
  });

  it('B · 🔴 THE FINDING: the canonical tag query returns 10 of 92 admitted', () => {
    const a = admitted();
    const missing = a.filter(r => !r.canonicalQuery);
    expect(missing.length).toBe(82);
    // 89% missing. A bare count is direction-agnostic; the ratio is not.
    expect(missing.length / a.length).toBeGreaterThan(0.85);
    expect(a.filter(r => r.canonicalQuery).length).toBe(10);
  });

  it('C · 🔴 completeness tracks the admission ROUTE, not the writer', () => {
    // Per-route pinning (R453-1): a fix that flips one route cannot hide by
    // flipping the other.
    const keyOnly = byRoute(r => r.viaKeyPrefix && !r.viaTag);
    const tagOnly = byRoute(r => !r.viaKeyPrefix && r.viaTag);
    const both = byRoute(r => r.viaKeyPrefix && r.viaTag);
    // `?tags=workspace` only ever names rows that LITERALLY carry the tag.
    expect(keyOnly.filter(r => r.canonicalQuery).length).toBe(0);
    expect(tagOnly.filter(r => r.canonicalQuery).length).toBe(6);
    expect(both.filter(r => r.canonicalQuery).length).toBe(4);
  });

  it('D · the mechanism, bound: a case variant or plural is admitted but unnamed', () => {
    // Bind the finding to its CAUSE (R452-3's rule applied to a dialect mismatch):
    // the guard folds case and substring-matches; the selector does neither.
    for (const spelling of ['Workspace', 'WorkSpace', 'workspaces', 'my-workspace', 'SESSION', 'sessions', 'a-session-b']) {
      const row = admitted().find(r => r.tag === spelling);
      expect(row, `expected an admitted row tagged ${spelling}`).toBeDefined();
      expect(row!.admitted).toBe(true);
      expect(row!.canonicalQuery).toBe(false);
      // ...and it IS reachable through the fuzzy surfaces, so the data is fine.
      expect(row!.ownTagQuery).toBe(true);
    }
  });

  it('E · the own-tag query agrees with the guard on every admitted row', () => {
    // Pin the dialect that DOES work, so a fix to queryByTag shows up here.
    expect(admitted().filter(r => r.ownTagQuery).length).toBe(92);
  });

  it('F · 🔴 soundness, pinned separately: NO query over-reaches (R453-2)', () => {
    // Completeness and soundness fail in opposite directions. With only arm B,
    // a "fix" that made `?tags=workspace` return session rows would pass.
    for (const field of ['canonicalQuery', 'ownTagQuery', 'searchPath', 'recallPath'] as const) {
      const bypass = rows.filter(r => r[field] && !r.admitted);
      expect(bypass.length, `${field} returned a denied row`).toBe(0);
    }
  });

  it('G · 🔴 the fuzzy surfaces are COMPLETE — so the defect is the dialect, not the data', () => {
    // search() and recall() return all 92. That is what pins the fix to
    // queryByTag's `tags.includes(tag)` rather than to anything about the rows.
    // If either surface regresses this arm reddens — it is not decoration.
    expect(admitted().filter(r => r.searchPath).length).toBe(92);
    expect(admitted().filter(r => r.recallPath).length).toBe(92);
    // …and the audit question is still 10, so the gap is real on the same data.
    expect(admitted().filter(r => r.canonicalQuery).length).toBe(10);
  });

  it('H · delete() succeeds on every admitted row — the gap is purely observational', () => {
    // Reachability is complete; enumeration is not. That is what makes this an
    // audit gap rather than a hole, and why fix (a) is comparatively safe.
    const outcomes = [...deleteOutcome.values()];
    expect(outcomes.length).toBe(92);
    expect(outcomes.filter(Boolean).length).toBe(92);
  });

  it('I · nothing is enumerable by NOTHING — a caller is never left blind', () => {
    // The falsification of this round's own first draft, which claimed 4 rows were
    // reachable but enumerable by no surface. Measured: 0. This arm is here so
    // that claim can never be re-derived by hand.
    const blind = admitted().filter(
      r => !r.canonicalQuery && !r.ownTagQuery && !r.searchPath && !r.recallPath,
    );
    expect(blind.length).toBe(0);
  });

  it('J · 🔴 M6 ARMED: a session row whose CONTENT names another scope stays private', async () => {
    // The mutation matrix's only survivor, and it was a REAL LEAK — the main
    // alphabet coincidentally hides it, because every payload there is
    // `payload-of-<key>` and identical across scopes (R454-1).
    //
    // Removing search()'s scope filter does not show up above: every row in the
    // generated alphabet is either in scope or scores 0. This arm supplies the
    // input the alphabet lacks — a row that is OUT of scope for a scope, yet whose
    // text is exactly what a search for that scope asks for.
    const dir = mkdtempSync(join(tmpdir(), 'r453-j-'));
    try {
      const db = new ClawDB(dir);
      const pool = new MemoryPool(db);
      await pool.write('openclaw:session:agent-a:secret', 'the workspace ssh key rotates monthly', 'rest-api', ['infra'], 0);
      await pool.write('openclaw:workspace:infra:ssh-key', 'workspace note', 'rest-api', ['workspace'], 0);

      const admittedWs = (await pool.getAll('workspace')).map(m => m.key);
      const foundWs = (await pool.search('workspace', 500, 'workspace')).map(m => m.key);
      const leaked = foundWs.filter(k => !admittedWs.includes(k));

      expect(admittedWs).toEqual(['openclaw:workspace:infra:ssh-key']);
      // At baseline the leak is correctly ABSENT (that is the arm's job). The
      // intermediate is that this row DOES match the query — so the only thing
      // stopping it is the scope filter. Asserted positively so the arm measures
      // the guard rather than passing because the row scored 0.
      expect(foundWs).toContain('openclaw:workspace:infra:ssh-key');
      expect(leaked.length, 'a session-owned row surfaced to a workspace-scoped search').toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});