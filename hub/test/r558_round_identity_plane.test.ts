/**
 * R558 — THE ROUND-IDENTITY PLANE: the narrative says a round happened; the
 * repository does not carry it.
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * R557 (route-offset plane) measured a defect in woclaw's REST router and
 * cited a PRIOR round — "R532" — as the round that had already found two of
 * the same class of site, and had pinned the count at `toBe(2)`.
 *
 * R557's headline finding was "R532's derivation window truncated the set".
 * This round starts from the prior sentence:
 *
 *     **If R532's own suite is not in the repository, what did R557's
 *      "R532 measured this" actually rest on?**
 *
 * ── What is actually in the tree ──────────────────────────────────────────
 *
 * `hub/test/r532_rest_parameter_layer.test.ts` exists in **exactly one**
 * place on this machine: the third parent of `git stash@{0}` — the
 * untracked-files component of a stash created at 2026-11-26 03:19:38,
 * i.e. **during the R557 round itself**. It has **0 commits** on every ref
 * (`git log --all -- <path>` is empty). It is **not** at HEAD.
 *
 * The same is true of **14** more suite files (15 counting two whose names
 * do not encode a round ID). And the narrative is not ambiguous about R532:
 * `LEARNING_PLAN.md` line 16773 says
 *
 *     "R532 量过 REST 查询参数面的 `gracePeriodMs=abc`（凭据面）"
 *
 * — "R532 measured the REST query-parameter surface's `gracePeriodMs=abc`
 * (credential plane)" — and treats it as an ESTABLISHED neighbour, the way
 * one treats a shipped measurement. R557.23 lists "R532's
 * `expect(misaligned.length).toBe(2)`" as a father-gated item, and
 * R557.6 offers to "correct R532's write-up".
 *
 * ⇒ **There is no R532 woclaw write-up.** `memory/` contains files that
 *   mention "R532", and every one of them is about **llm-benchmark's**
 *   R532 (the multi-turn consistency plane, sha `8adfdeb`) — a different
 *   repo, a different subject, a different date (2026-11-06), four days
 *   before R557 claims to have superseded it (2026-11-21).
 *
 * ⇒ **The round ID collided across two repos.** `llm-benchmark` really does
 *   have an R532 (`tests/r532-multi-turn-consistency-plane.test.ts` at HEAD,
 *   sha `8adfdeb`, and the plan's `#### 532.` header is *that* round). The
 *   woclaw R532 is a DIFFERENT round with the SAME number, and it exists
 *   only in a stash.
 *
 * ⇒ **The collision is not a one-off.** A mechanical cross-repo census
 *   (`scripts/r558_cross_repo_collision_census.py`) derives the overlap of
 *   the two repos' HEAD round-ID namespaces from `git ls-tree` alone:
 *
 *       woclaw 101 distinct round IDs · llm-benchmark 25 · OVERLAP = 7
 *       R459  R487  R488  R497  R501  R553  R556
 *
 *   Seven numbers mean TWO DIFFERENT ROUNDS in two different repos. The
 *   narrative has been citing bare `RNNN` across both repos since R553.
 *
 * ── The consequence that is NOT a bookkeeping detail ──────────────────────
 *
 * The stashed woclaw R532 suite measured a **credential** defect:
 * `POST /admin/token/rotate?gracePeriodMs=abc` →
 * `parseIntParam` → `NaN` → `gracePeriodEnd = Date.now() + NaN` → `NaN` →
 * `Date.now() >= NaN` is **false forever** ⇒ the old token never stops being
 * authorised.
 *
 * **That defect is LIVE at HEAD today.** Measured on the real production
 * classes in this round (arms 7–12 below): the state is mutated *before* the
 * `new Date(NaN).toISOString()` throw, the operator gets **HTTP 500** and
 * never receives the new token, the hub is left running on a token nobody
 * has, and the token that was supposed to be rotated OUT is still
 * authorised — **forever**.
 *
 * And the poisoning is **not confined to the one call**:
 *
 *   - `rotateToken` also does `this.gracePeriodMs = grace` (ws_server.ts:983)
 *     ⇒ the hub's **default** grace period becomes `NaN` **permanently**;
 *   - ⇒ every SUBSEQUENT rotation that omits `gracePeriodMs` computes
 *     `Date.now() + NaN` and **also throws** ⇒ the hub cannot rotate its
 *     token again unless the operator explicitly passes a finite number;
 *   - ⇒ and `this.config.nextAuthToken` is left pointing at the token from
 *     the PREVIOUS rotation, so the credential chain drifts.
 *
 * That is a **persistent** fault, not a per-request one — and it is
 * strictly stronger than what the orphaned suite recorded.
 *
 * The at-HEAD suite that covers this exact area (`r553_revocation_plane`)
 * never drives a non-numeric grace: every one of its 11 rotations passes a
 * literal number. So it is "covered" in the R557-P3 sense and "not caught"
 * in the same sense — but the *reason* it is not caught is new: **the suite
 * that WOULD have caught it was never in the repository.**
 *
 * ── What is pinned here ───────────────────────────────────────────────────
 *
 * This is a RECORD-plane census with a live-defect tail:
 *   - arms 0–3: the census itself (round-ID collision, no witness at HEAD,
 *     the stash is the only home, the narrative's claim);
 *   - arms 4–6: the CROSS-REPO collision census (7 overlapping IDs) and
 *     the narrative's unqualified citations of them;
 *   - arms 7–12: the defect the orphaned round measured, re-measured on the
 *     real classes at HEAD (so the finding does not depend on the stash),
 *     plus the end-to-end REST reachability and the poisoning tail.
 *
 * Zero production changes. Every arm is measured, not inferred.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORKSPACE = resolve(REPO, '..');
const HUB_SRC = join(REPO, 'hub', 'src');

/**
 * ⚠️ CI-SAFETY: the NARRATIVE files live in the WORKSPACE, not in this
 * repository:
 *
 *   - `LEARNING_PLAN.md`  → `../LEARNING_PLAN.md`  (workspace root)
 *   - `memory/*.md`       → `../memory/`           (gitignored — `.gitignore:52`)
 *
 * A CI checkout of woclaw is SINGLE-REPO (`actions/checkout@v4`, no `path:`,
 * no submodules), so **neither exists in CI**. Every arm that reads them
 * MUST degrade to "not observable here" rather than fail — a suite that is
 * RED in CI gets deleted or ignored, which is worse than the finding it
 * carries.
 *
 * ⇒ The arms are SPLIT into two classes:
 *   - TREE arms (0, 1, 1b, 1c, 1d, 4, 4b, 6, 7–12): measure THIS repo ⇒
 *     always run. These are the load-bearing arms.
 *   - NARRATIVE arms (2, 2b, 3, 5): measure files outside the repo ⇒ run
 *     only when the workspace is present; otherwise they report that the
 *     subject is NOT OBSERVABLE here and return.
 *
 * The CI-visible claim is therefore the tree-side one; the narrative-side
 * claim is verified on the agent's machine, where the workspace exists.
 */
function workspaceFile(...parts: string[]): string | null {
  const p = resolve(WORKSPACE, ...parts);
  return existsSync(p) ? p : null;
}

function readWorkspaceFile(...parts: string[]): string | null {
  const p = workspaceFile(...parts);
  if (p === null) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function git(...args: string[]): string {
  return execSync(`git -C ${JSON.stringify(REPO)} ${args.join(' ')}`, {
    encoding: 'utf8',
  });
}

function gitQuiet(...args: string[]): string {
  try {
    return git(...args);
  } catch {
    return '';
  }
}

/** Every file at HEAD (unbounded derivation — no line window). */
function headFiles(): string[] {
  return git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);
}

/**
 * The round ID a filename encodes, if any.
 * `hub/test/r532_rest_parameter_layer.test.ts` -> 532
 *
 * NOTE: the pattern is `rNNN_` with NO leading-slash requirement. Two
 * orphan suites live under `plugin/test/`, and an anchored `/r\d+_` would
 * silently drop them — a window that manufactures false negatives, the
 * R557-P1 failure shape.
 */
function roundIdOf(file: string): number | null {
  const m = file.match(/r(\d+)_/);
  return m ? Number(m[1]) : null;
}

/**
 * Every round ID that has a file at HEAD.
 */
function headRoundIds(): Set<number> {
  const s = new Set<number>();
  for (const f of headFiles()) {
    const r = roundIdOf(f);
    if (r !== null) s.add(r);
  }
  return s;
}

/**
 * Files present in a stash's UNTRACKED component but absent at HEAD.
 *
 * `git stash` with `--include-untracked` stores the untracked files in a
 * THIRD parent of the stash commit. `git show <stash>^3 --name-only` lists
 * them.
 *
 * ⚠️ TWO DIFFERENT PHENOMENA, and conflating them is a subject-set error:
 *
 *   (a) an UNTRACKED file parked by `git stash -u` → lives in `<stash>^3`.
 *       This stash has THREE parents. The file was never in git.
 *   (b) a TRACKED file that the stash REVERTED (i.e. the stash's diff
 *       deletes it) → lives in the stash's TREE, and `git stash show
 *       --name-only` lists it. This stash has TWO parents.
 *
 * `git stash show --include-untracked --name-only` lists BOTH kinds, so it
 * is a SUPERSET of the `^3` derivation. The two derivations are therefore
 * NOT expected to be equal — the `^3` one is the NARROWER, correct
 * definition of "was never committed".
 *
 * ⇒ The suite derives BOTH, asserts the relation between them
 *   (`^3` ⊆ `show`), and asserts that the ONE extra element is a
 *   TRACKED-and-reverted file (phenomenon (b)), not an orphan.
 *
 * NOTE: a stashed file may ALSO have been committed later (the stash is a
 * snapshot, not a tombstone). So "in a stash" does NOT imply "never
 * committed" — the suite filters on the COMMIT COUNT separately, and the
 * census reports the two facts independently. Conflating them would be
 * R557-P2's mistake (a count bound to a wrong subject set).
 */
function stashUntrackedFiles(): string[] {
  const out = new Set<string>();
  const stashes = gitQuiet('stash', 'list', '--format=%gd').split('\n').filter(Boolean);
  for (const s of stashes) {
    // A stash made WITHOUT `--include-untracked` has only TWO parents, so
    // `<stash>^3` is an invalid revision. Asking git for it and swallowing
    // the error as "nothing here" would TRUNCATE the subject set — exactly
    // the R557-P1 failure (a window that manufactures false negatives). So
    // the third parent's existence is CHECKED first.
    const third = gitQuiet('rev-parse', '--verify', '--quiet', `${s}^3`);
    if (!third.trim()) continue; // no untracked component — nothing to list
    const names = gitQuiet('show', `${s}^3`, '--name-only', '--pretty=format:');
    for (const n of names.split('\n')) {
      const t = n.trim();
      if (t && /\/r\d+_/.test(t)) out.add(t);
    }
  }
  return [...out].sort();
}

/** Everything `git stash show --include-untracked` reports (both phenomena). */
function stashShowFiles(): string[] {
  const out = new Set<string>();
  const stashes = gitQuiet('stash', 'list', '--format=%gd').split('\n').filter(Boolean);
  for (const s of stashes) {
    const names = gitQuiet('stash', 'show', '--include-untracked', '--name-only', s);
    for (const n of names.split('\n')) {
      const t = n.trim();
      if (t && /\/r\d+_/.test(t)) out.add(t);
    }
  }
  return [...out].sort();
}

/**
 * The suite files that are in a stash AND were NEVER committed on any ref
 * AND are absent at HEAD — i.e. genuinely orphaned artefacts.
 *
 * The three conditions are ANDed deliberately: each one alone would be a
 * different claim.
 */
function orphanedSuites(): string[] {
  const head = new Set(headFiles());
  return stashUntrackedFiles().filter(
    f => f.endsWith('.test.ts') && !head.has(f) && commitCountFor(f) === 0
  );
}

/** How many commits (on ANY ref) touch a path. */
function commitCountFor(path: string): number {
  const out = gitQuiet('log', '--all', '--oneline', '--', path);
  return out.split('\n').filter(Boolean).length;
}

// ───────────────────────────────────────────────────────────────────────────
// Fx: the real production classes, driven for real.
// ───────────────────────────────────────────────────────────────────────────

async function fx() {
  const { WSServer } = await import('../src/ws_server.js');
  const { ClawDB } = await import('../src/db.js');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'r558-'));
  const db = new ClawDB(dir);
  const cfg: any = {
    authToken: 'OLD-TOKEN-AAA',
    host: '127.0.0.1',
    port: 0,
    restPort: 0,
    dataDir: dir,
    logLevel: 'info',
  };
  const server = new WSServer(cfg, db);
  return { server, cfg, db, dir };
}

// Teardown. A `WSServer` that is never closed keeps its listener and its
// 30s ping timer alive, and the arm TIMES OUT at 10s instead of finishing
// (measured: my first version hung on arm 4 — a probe bug, not a finding).
// R553 records the same shape: an unclosed server poisons the NEXT arm.
const live: Array<{ server: any; db: any; rest?: any }> = [];

afterEach(async () => {
  for (const f of live) {
    try { f.rest?.close(); } catch { /* ignore */ }
    try { f.server.close(); } catch { /* ignore */ }
    try { await f.db.close(); } catch { /* ignore */ }
  }
  live.length = 0;
});

describe('R558 — the ROUND-IDENTITY plane', () => {
  /* ── 0: DERIVATION NON-EMPTINESS (both sides) ─────────────────────── */

  it('0. DERIVATION — both indexes are non-empty and the round-ID extraction works', () => {
    const head = headFiles();
    expect(head.length).toBeGreaterThan(100);

    const ids = headRoundIds();
    // The witness index must find the round IDs we know are at HEAD.
    expect(ids.has(550)).toBe(true);
    expect(ids.has(553)).toBe(true);
    expect(ids.has(557)).toBe(true);

    // And the round-ID extraction must be exact, not fuzzy: the filename
    // shape `.../rNNN_...` is the ONLY source of a round ID.
    expect(roundIdOf('hub/test/r532_rest_parameter_layer.test.ts')).toBe(532);
    expect(roundIdOf('hub/src/rest_server.ts')).toBeNull();
  });

  /* ── 1: THE ORPHAN ─────────────────────────────────────────────────── */

  it('1. HEADLINE — the woclaw R532 suite is NOT at HEAD, and has 0 commits on ANY ref', () => {
    const orphan = 'hub/test/r532_rest_parameter_layer.test.ts';

    // (a) absent at HEAD
    expect(headFiles()).not.toContain(orphan);
    expect(existsSync(join(REPO, orphan))).toBe(false);

    // (b) never committed on any ref — not "deleted", NEVER COMMITTED
    expect(commitCountFor(orphan)).toBe(0);

    // (c) but it EXISTS — in exactly one place: a stash's untracked component.
    const stashOnly = stashUntrackedFiles();
    expect(stashOnly).toContain(orphan);

    // ⇒ "not at HEAD" is not "never happened". The artefact exists; the
    // repository is not where it is.
  });

  it('1b. CONTROL — the orphans are not a one-off: 13 suite files share the shape', () => {
    const orphans = orphanedSuites();
    // MEASURED: 15 orphan suites (13 of which encode a round ID; two are
    // `r518c_…` / `probe_r532e_tmp` style names that do NOT match the
    // `rNNN_` shape). The floor is 13 because the round-ID-shaped subset is
    // the stable quantity — the total drifts as stashes are pruned.
    expect(orphans.length).toBeGreaterThanOrEqual(13);

    // Every one of them has ZERO commits — none of these was ever in git.
    for (const f of orphans) {
      expect(commitCountFor(f)).toBe(0);
    }

    // And every one of them is ABSENT at HEAD.
    const head = new Set(headFiles());
    for (const f of orphans) {
      expect(head.has(f)).toBe(false);
    }
  });

  it('1d. DERIVATION COMPLETENESS — the two stash derivations are related, and the difference is understood', () => {
    // The subject set for "artefacts that exist only in a stash" is derived
    // by walking EVERY stash. Two derivations exist:
    //   (a) via the third parent (`<stash>^3`)  = UNTRACKED files parked by
    //       `git stash -u`; only stashes WITH an untracked component have
    //       one, and asking for `^3` on a two-parent stash is an ERROR;
    //   (b) via `git stash show --include-untracked --name-only` = BOTH
    //       untracked files AND tracked files the stash REVERTED.
    //
    // (a) ⊆ (b) is the expected relation — NOT equality. (measured: the
    // difference is exactly `hub/test/r424_preview_plane.test.ts`, a file
    // that WAS tracked at its stash's base and that the stash REVERTED —
    // a different phenomenon, not an orphan.)
    //
    // If (a) were swallowed as an empty set when git errored, the subject
    // set would shrink and every count would become a true statement about
    // a false set — R557-P1 / R557-P2. So both are derived, the relation
    // is asserted, and the difference is characterised rather than ignored.
    const stashes = gitQuiet('stash', 'list', '--format=%gd').split('\n').filter(Boolean);
    expect(stashes.length).toBeGreaterThanOrEqual(2);

    const viaParents = new Set(stashUntrackedFiles());
    const viaShow = new Set(stashShowFiles());

    expect(viaParents.size).toBeGreaterThan(0);
    expect(viaShow.size).toBeGreaterThanOrEqual(viaParents.size);

    // (a) ⊆ (b)
    for (const f of viaParents) {
      expect(viaShow.has(f)).toBe(true);
    }

    // The known orphan must be in BOTH.
    expect(viaParents.has('hub/test/r532_rest_parameter_layer.test.ts')).toBe(true);
    expect(viaShow.has('hub/test/r532_rest_parameter_layer.test.ts')).toBe(true);

    // Every file in (b) but NOT in (a) is a TRACKED-and-reverted file:
    // it has commits (so it was in git), i.e. it is not an orphan.
    for (const f of viaShow) {
      if (viaParents.has(f)) continue;
      expect(commitCountFor(f)).toBeGreaterThan(0);
    }
  });

  it('1c. CONTROL — the rounds that ARE at HEAD are unaffected (the census is not a blanket)', () => {
    // R553/R554/R555/R556/R557 suites are all at HEAD with commits.
    for (const [rid, path] of [
      [553, 'hub/test/r553_revocation_plane.test.ts'],
      [554, 'hub/test/r554_credential_transport_plane.test.ts'],
      [555, 'hub/test/r555_federation_dispatch_plane.test.ts'],
      [556, 'hub/test/r556_roster_plane_census.test.ts'],
      [557, 'hub/test/r557_route_offset_plane.test.ts'],
    ] as const) {
      expect(headFiles()).toContain(path);
      expect(commitCountFor(path)).toBeGreaterThan(0);
      expect(headRoundIds().has(rid)).toBe(true);
    }
  });

  /* ── 2: THE COLLISION ──────────────────────────────────────────────── */

  it('2. HEADLINE — the round ID collided ACROSS REPOS: llm-benchmark owns R532', () => {
    // ⚠️ CI-SAFETY: `../llm-benchmark` is a SIBLING REPO, not part of this
    // checkout. In CI it does not exist. The arm therefore asserts only what
    // this repository can see, and the cross-repo half lives in arm 4b.
    //
    // What this repository CAN see, unconditionally: **the round ID 532 is
    // used by woclaw for a suite that was never committed**, while the
    // plan's `#### 532.` header is a DIFFERENT round. That is the
    // collision, stated in terms this repo owns.
    const plan = readWorkspaceFile('LEARNING_PLAN.md');
    if (plan === null) return; // narrative not observable here (CI)

    // The plan's `#### 532.` header names the MULTI-TURN CONSISTENCY plane
    // — i.e. the plan's own "R532" is the llm-benchmark round.
    expect(plan).toMatch(/####\s+532\.\s*多轮一致性平面/);
    // And the woclaw R532 is a DIFFERENT round, cited elsewhere in the same
    // plan as a REST-parameter measurement.
    expect(plan).toMatch(/R532 量过 REST 查询参数面/);
    // ⇒ ONE plan, ONE number, TWO different rounds.
  });

  it('2b. THE CLAIM — the narrative treats the woclaw R532 as an established, shipped measurement', () => {
    const plan = readWorkspaceFile('LEARNING_PLAN.md');
    if (plan === null) return; // narrative not observable here (CI)

    // LEARNING_PLAN.md:16773 — R553.2 names R532 as a NEIGHBOUR that has
    // already measured the credential plane.
    //
    // ⚠️ The regex is ANCHORED on the actual wording. A loose `/R532|PLAN/`
    // alternative matches 117 lines of the plan (the literal word "PLAN"
    // appears in "LEARNING_PLAN.md" itself) — it would pass on a plan that
    // never mentioned R532 at all. Measured: the previous version of this
    // arm was a VACUOUS assertion.
    expect(plan).toMatch(/R532 量过 REST 查询参数面/);
    expect(plan).toMatch(/gracePeriodMs=abc/);

    // R557's own plan entries treat R532's write-up and its shipped
    // assertion as real objects that a decision could be taken about.
    expect(plan).toMatch(/R532 的 `expect\(misaligned\.length\)\.toBe\(2\)`/);
    expect(plan).toMatch(/R532 write-up/);

    // ⇒ The narrative's claim is not a hypothesis about what might exist;
    // it is the premise of a father-gated decision list.
  });

  /* ── 3: THE ORPHAN'S FINDING IS UNCLAIMED ──────────────────────────── */

  it('3. — there is NO woclaw R532 write-up anywhere in memory/', () => {
    const memDir = workspaceFile('memory');
    if (memDir === null) return; // narrative not observable here (CI)

    const files = execSync(`ls -1 ${JSON.stringify(memDir)}`, { encoding: 'utf8' })
      .split('\n')
      .filter(f => f.endsWith('.md'));

    // Every memory file that mentions R532 must be about llm-benchmark's
    // R532, NOT about a woclaw R532. The discriminator: llm-benchmark's
    // R532 is the MULTI-TURN CONSISTENCY plane, filed under 2026-11-06.
    const mentions = files.filter(f => {
      const txt = readFileSync(join(memDir, f), 'utf8');
      return /\bR532\b/.test(txt);
    });
    expect(mentions.length).toBeGreaterThan(0);

    const woclawR532 = mentions.filter(f => {
      const txt = readFileSync(join(memDir, f), 'utf8');
      // A woclaw R532 write-up would have to be about the REST parameter
      // layer / the rest_server route surface / gracePeriodMs.
      //
      // ⚠️ SELF-REFERENCE GUARD: this round's OWN write-up
      // (`2026-11-28-round558-round-identity-plane.md`) mentions
      // `gracePeriodMs=abc` AND says "woclaw" — so the naive predicate
      // matches the file this round just produced, and the arm fails on
      // itself. Measured (2026-11-28): `expected [ '2026-11-28.md',
      // '2026-11-28-round558-round-identity-plane.md' ] to deeply equal []`.
      //
      // ⇒ The subject set must EXCLUDE this round's own artefacts. That is
      // the R557-P2 shape: a count bound to a subject set that includes the
      // observer.
      if (/2026-11-28/.test(f)) return false;
      return (
        /REST parameter layer|rest_parameter_layer|gracePeriodMs=abc/.test(txt) &&
        /woclaw/i.test(txt)
      );
    });
    expect(woclawR532).toEqual([]);

    // And the llm-benchmark R532 IS filed — proving the search works
    // (a non-empty subject set on the OTHER side of the discriminator).
    expect(mentions).toContain('2026-11-06-round532-multi-turn-consistency-plane.md');
  });

  /* ── 4–6: THE CROSS-REPO COLLISION IS NOT A ONE-OFF ────────────────── */

  /**
   * llm-benchmark's HEAD round IDs, derived the same way.
   *
   * ⚠️ CI-SAFETY: the checkout is SINGLE-REPO (`actions/checkout@v4` with no
   * `path:`/`submodules`), so `../llm-benchmark` does NOT exist in CI. This
   * function therefore returns an EMPTY set when the sibling is absent, and
   * the arms below DEGRADE to a woclaw-only census instead of throwing.
   *
   * Why that matters: a suite that hard-fails on a missing sibling would be
   * RED in CI for every commit — and a suite that is RED in CI gets
   * deleted or ignored, which is worse than the finding it carries. The
   * collision census is therefore SPLIT:
   *
   *   - arm 4 (woclaw-only): the woclaw side of the overlap, derived from
   *     the woclaw tree ALONE. Always runs. This is the load-bearing arm.
   *   - arm 4b (cross-repo): the FULL overlap, asserted only when the
   *     sibling is present. Skipped (not failed) when it is not.
   *
   * Measured (2026-11-28, both repos present): overlap = 7
   * ⇒ R459 R487 R488 R497 R501 R553 R556.
   */
  function lbRoundIds(): Set<number> | null {
    const lb = resolve(REPO, '..', 'llm-benchmark');
    if (!existsSync(join(lb, '.git'))) return null; // sibling absent (CI)
    let files: string[];
    try {
      files = execSync(`git -C ${JSON.stringify(lb)} ls-tree -r --name-only HEAD`, {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean);
    } catch {
      return null; // sibling present but not a git repo
    }
    const s = new Set<number>();
    for (const f of files) {
      const r = roundIdOf(f);
      if (r !== null) s.add(r);
    }
    return s;
  }

  it('4. HEADLINE — the collision census is non-vacuous, and the woclaw side of the overlap is pinned', () => {
    // Derived mechanically from `git ls-tree` on the woclaw tree ALONE —
    // no hand-listing, and no dependency on a sibling checkout.
    const ours = headRoundIds();
    expect(ours.size).toBeGreaterThan(80);

    // The seven IDs that MEASURED as live in both repos. Each of them is
    // pinned to a real woclaw file at HEAD, so the claim is about the
    // woclaw tree and does not need the sibling to be checked out.
    const KNOWN_COLLISIONS = [459, 487, 488, 497, 501, 553, 556];
    for (const r of KNOWN_COLLISIONS) {
      expect(ours.has(r)).toBe(true);
    }

    // And the relation is a genuine OVERLAP, not containment: both sides
    // have ids the other lacks. (The lb side is asserted in arm 4b when
    // the sibling is available.)
    expect(ours.size - KNOWN_COLLISIONS.length).toBeGreaterThan(80);
  });

  it('4b. THE FULL OVERLAP — seven round IDs are live in BOTH repos: bare `RNNN` is ambiguous', () => {
    const lbIds = lbRoundIds();
    if (lbIds === null) {
      // The sibling checkout is absent (CI). The cross-repo half of the
      // claim is NOT measurable here — and the honest thing is to SAY SO,
      // not to assert a number this environment cannot see.
      //
      // ⚠️ This is the "derive the subject set from what is actually
      // observable" rule (R557-P1): the alternative — hard-coding 7 and
      // asserting it — would be a true statement about a set this
      // environment never computed.
      return;
    }

    const ours = headRoundIds();
    const collisions = [...ours].filter(r => lbIds.has(r)).sort();

    // The census is not a blanket: the two namespaces are large and mostly
    // disjoint.
    expect(lbIds.size).toBeGreaterThan(15);
    expect(collisions.length).toBeLessThan(ours.size);

    // The measured overlap. Seven numbers mean two different rounds each.
    expect(collisions).toEqual([459, 487, 488, 497, 501, 553, 556]);
  });

  it('5. THE NARRATIVE CITES THE COLLIDING IDS WITHOUT QUALIFYING THE REPO', () => {
    const plan = readWorkspaceFile('LEARNING_PLAN.md');
    if (plan === null) return; // narrative not observable here (CI)

    // R553 is in the collision set. The plan's own R553 section cites R532
    // as a woclaw neighbour WITHOUT saying "woclaw's R532" — and
    // llm-benchmark ALSO has an R553 and an R532. So the reader cannot
    // resolve the reference from the number alone.
    const r553Section = plan.slice(plan.indexOf('553.'), plan.indexOf('553.') + 40000);
    expect(r553Section).toMatch(/R532 量过 REST 查询参数面/);

    // The disambiguation convention DOES exist for the one case where the
    // author noticed the clash: the llm-benchmark sibling round is written
    // `R556-b`. That is the convention the woclaw R532 would need — and it
    // was never applied, because the woclaw R532 has no section at all.
    expect(plan).toMatch(/R556-b/);

    // ⇒ The collision is real, the convention for resolving it exists, and
    // it was applied to exactly ONE of the overlapping IDs.
  });

  it('6. CONTROL — the collision census is not vacuous in either direction', () => {
    const lbIds = lbRoundIds();
    const ours = headRoundIds();

    // (a) Most of OUR ids are NOT in the collision set — so "collision" is
    //     not the norm.
    expect(ours.size - 7).toBeGreaterThan(80);

    // (b) The lb side, when the sibling is available: most of ITS ids are
    //     not in ours — the namespaces are genuinely separate, not one a
    //     subset of the other.
    if (lbIds !== null) {
      expect(lbIds.size - 7).toBeGreaterThan(15);
      // (c) Both sides have ids the other lacks — the relation is a
      //     genuine OVERLAP, not a containment in one direction.
      expect([...ours].filter(r => !lbIds.has(r)).length).toBeGreaterThan(0);
      expect([...lbIds].filter(r => !ours.has(r)).length).toBeGreaterThan(0);
    }
  });

  /* ── 7–12: THE LIVE DEFECT (measured on the real classes) ──────────── */

  it('7. HEADLINE — the defect the orphaned round measured is LIVE at HEAD: the old token never expires', async () => {
    const { server, cfg, db } = await fx();
    live.push({ server, db });

    let threw: string | null = null;
    try {
      // `parseIntParam(url, 'gracePeriodMs', 300000)` returns NaN for 'abc'.
      server.rotateToken('NEW-TOKEN-BBB', NaN as any);
    } catch (e: any) {
      threw = `${e.constructor.name}: ${e.message}`;
    }

    // The route throws while formatting the status — but the STATE was
    // already mutated before the throw.
    expect(threw).toMatch(/RangeError: Invalid time value/);

    // The hub is now running on the NEW token ...
    expect(cfg.authToken).toBe('NEW-TOKEN-BBB');
    // ... while the OLD token is STILL AUTHORISED.
    expect(server.isTokenAuthorized('OLD-TOKEN-AAA')).toBe(true);

    // `gracePeriodEnd` is NaN ⇒ `Date.now() >= NaN` is false FOREVER ⇒
    // the grace period never expires and `nextAuthToken` is never cleared.
    const st: any = server.getTokenStatus();
    expect(Number.isNaN(st.gracePeriodEnd)).toBe(true);
    expect(Date.now() >= st.gracePeriodEnd).toBe(false);
    expect(cfg.nextAuthToken).toBe('OLD-TOKEN-AAA');
  });

  it('7b. THE POISON — the NaN is STORED as the hub\'s default grace period', async () => {
    const { server, cfg, db } = await fx();
    live.push({ server, db });

    expect((server as any).gracePeriodMs).toBe(300000); // the default

    try {
      server.rotateToken('NEW-TOKEN-BBB', NaN as any);
    } catch {
      /* measured in arm 7 */
    }

    // ws_server.ts:983 — `this.gracePeriodMs = grace` — the DEFAULT is now
    // NaN, permanently. This is a POISON, not a per-request fault.
    expect((server as any).gracePeriodMs).toBeNaN();
  });

  it('7c. THE POISON PROPAGATES — every SUBSEQUENT rotation also throws', async () => {
    const { server, cfg, db } = await fx();
    live.push({ server, db });

    try {
      server.rotateToken('NEW-TOKEN-BBB', NaN as any);
    } catch {
      /* measured in arm 7 */
    }

    // A rotation that OMITS the grace argument must fall back to the
    // configured default. But the default is now NaN ⇒ this throws too.
    let threw: string | null = null;
    try {
      server.rotateToken('THIRD-TOKEN-CCC');
    } catch (e: any) {
      threw = `${e.constructor.name}: ${e.message}`;
    }
    expect(threw).toMatch(/RangeError: Invalid time value/);

    // ⇒ ONE malformed request permanently disables token rotation, until
    //   an operator explicitly passes a finite grace period.
    //
    // And the credential chain DRIFTED: `nextAuthToken` now points at the
    // token from the FIRST rotation, while `authToken` points at the
    // second — the hub is in a state no caller asked for.
    expect(cfg.authToken).toBe('THIRD-TOKEN-CCC');
    expect(cfg.nextAuthToken).toBe('NEW-TOKEN-BBB');
  });

  it('7d. CONTROL — an EXPLICIT finite grace recovers the hub (the poison is not self-healing but it is escapable)', async () => {
    const { server, cfg, db } = await fx();
    live.push({ server, db });

    try {
      server.rotateToken('NEW-TOKEN-BBB', NaN as any);
    } catch {
      /* measured in arm 7 */
    }
    expect((server as any).gracePeriodMs).toBeNaN();

    // Passing an explicit finite value overwrites the poisoned default.
    const r = server.rotateToken('THIRD-TOKEN-CCC', 60000);
    expect(Number.isNaN(r.gracePeriodEnd)).toBe(false);
    expect((server as any).gracePeriodMs).toBe(60000);

    // And now the OLD token is properly scheduled for expiry.
    expect(server.isTokenAuthorized('OLD-TOKEN-AAA')).toBe(false);
    expect(cfg.nextAuthToken).toBe('NEW-TOKEN-BBB');
  });

  it('8. THE LIE — the status endpoint reports the grace as OVER while the old credential still works', async () => {
    const { server, db } = await fx();
    live.push({ server, db });
    try {
      server.rotateToken('NEW-TOKEN-BBB', NaN as any);
    } catch {
      /* the route's own throw — measured in arm 4 */
    }

    const st: any = server.getTokenStatus();
    // `inGracePeriod` is false: `Date.now() < NaN` is false.
    expect(st.inGracePeriod).toBe(false);
    // And the old credential IS still authorised — the two disagree.
    expect(server.isTokenAuthorized('OLD-TOKEN-AAA')).toBe(true);

    // ⇒ The operator is told "the grace period is over" and, in the same
    // breath, the credential that was supposed to be dead is alive.
  });

  it('8b. THE SILENT NaN — JSON serialises NaN as null, so the status endpoint reports "no grace period"', async () => {
    const { server, db } = await fx();
    live.push({ server, db });
    try {
      server.rotateToken('NEW-TOKEN-BBB', NaN as any);
    } catch {
      /* measured in arm 4 */
    }

    const st: any = server.getTokenStatus();
    // The raw value is NaN ...
    expect(Number.isNaN(st.gracePeriodEnd)).toBe(true);
    // ... but on the wire it becomes null, because JSON has no NaN.
    expect(JSON.stringify(st)).toContain('"gracePeriodEnd":null');
    // ⇒ A null grace period is INDISTINGUISHABLE from "there was never a
    // grace period" — the wire shape cannot express the failure.
  });

  it('9. END-TO-END — the REST route really reaches it: HTTP 500, no new token, old token live', async () => {
    const { WSServer } = await import('../src/ws_server.js');
    const { ClawDB } = await import('../src/db.js');
    const { RestServer } = await import('../src/rest_server.js');
    const { GraphStore } = await import('../src/graph/store.js');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'r558-rest-'));
    const cfg: any = {
      authToken: 'OLD-TOKEN-AAA',
      host: '127.0.0.1',
      port: 0,
      restPort: 0,
      dataDir: dir,
      logLevel: 'info',
    };
    const db = new ClawDB(dir);
    const wsServer = new WSServer(cfg, db);
    const graph = new GraphStore();
    const mem = wsServer.getMemoryPool();
    mem.graphStore = graph;
    const rest = new RestServer(cfg, db, wsServer.getTopicsManager(), mem, graph, wsServer);
    rest.start();
    const port = await rest.whenListening();
    live.push({ server: wsServer, db, rest });

    // The real production route: `POST /admin/token/rotate`.
    const res = await fetch(
      `http://127.0.0.1:${port}/admin/token/rotate?gracePeriodMs=abc`,
      { method: 'POST', headers: { authorization: 'Bearer OLD-TOKEN-AAA' } }
    );
    const body = await res.text();

    // The operator gets a 500 and the error text names the symptom
    // ("Invalid time value") rather than the cause ("gracePeriodMs=abc").
    expect(res.status).toBe(500);
    expect(body).toContain('Invalid time value');

    // The operator NEVER RECEIVES the new token — the response is an error.
    expect(body).not.toContain('newToken');

    // But the state was ALREADY mutated: the hub is now on a token nobody
    // has, and the token that was supposed to be rotated OUT is still
    // authorised — forever.
    expect(cfg.authToken).not.toBe('OLD-TOKEN-AAA');
    expect(cfg.nextAuthToken).toBe('OLD-TOKEN-AAA');
    expect(wsServer.isTokenAuthorized('OLD-TOKEN-AAA')).toBe(true);

    // ⇒ The request is REACHABLE end-to-end over HTTP, with a credential.
    //   This is not a unit-level artefact of calling rotateToken directly.
  });

  it('10. THE AT-HEAD COVER IS A DIFFERENT ATTACK — R553 drives only literal numbers', () => {
    const r553 = readFileSync(join(REPO, 'hub', 'test', 'r553_revocation_plane.test.ts'), 'utf8');

    // R553 IS the at-HEAD suite that covers token rotation and grace expiry.
    expect(r553).toMatch(/rotateToken/);
    expect(r553).toMatch(/gracePeriodEnd/);

    // Every single rotation in it passes a LITERAL NUMBER.
    // NOTE: the regex must match only REAL CALL SITES. `rotateToken()` (the
    // method declaration in the quoted source) and
    // `rotateToken(newToken: string')` (a source-text excerpt) also match
    // `/rotateToken\(/` — so the grace argument is REQUIRED for a match.
    // Without that requirement the arm sees a bare `()` and fails for the
    // wrong reason (measured: my first version reported "" where a number
    // was expected — a probe bug, not a finding).
    const rotations = [...r553.matchAll(/rotateToken\(([^,)]+),\s*([^)]+)\)/g)].map(m => m[2].trim());
    expect(rotations.length).toBeGreaterThanOrEqual(5);
    for (const graceArg of rotations) {
      expect(graceArg).toMatch(/^\d[\d_]*$/);
    }

    // ⇒ R553 is "covered" (it drives the route, it asserts about grace
    // expiry) and "not caught" — and the reason is that the only suite
    // that drove a NON-NUMERIC grace was the one that never landed.
    expect(r553).not.toMatch(/NaN/);
  });

  it('11. THE EXTRACTION IS THE ROOT — parseIntParam\'s NaN is documented and intended; the CALLER is the defect', () => {
    // The helper's NaN is DOCUMENTED: two suites pin it explicitly.
    const runtime = readFileSync(join(REPO, 'hub', 'test', 'parse_int_param_runtime.test.ts'), 'utf8');
    expect(runtime).toMatch(/returns NaN for an unparseable value/);

    // So the defect is NOT in the parser. It is that this ONE caller
    // treats the parsed number as a duration without validating it.
    const rest = readFileSync(join(HUB_SRC, 'rest_server.ts'), 'utf8');
    const ws = readFileSync(join(HUB_SRC, 'ws_server.ts'), 'utf8');

    // The REST route hands the raw parse straight to rotateToken.
    expect(rest).toMatch(/parseIntParam\(url2, 'gracePeriodMs', 300000\)/);
    expect(rest).toMatch(/rotateToken\(newToken, graceMs\)/);

    // And the WS side adds it to a timestamp with no validation.
    expect(ws).toMatch(/this\.gracePeriodEnd = Date\.now\(\) \+ grace/);

    // ⇒ "The parser returns NaN" is a DOCUMENTED, INTENDED behaviour.
    //   "This caller uses it as a duration" is the defect.
  });

  it('12. CONTROL — a VALID grace period behaves correctly (the defect is the malformed value, not rotation)', async () => {
    const { server, cfg, db } = await fx();
    live.push({ server, db });

    // The happy path must be intact — otherwise the arms above would be
    // measuring "rotation is broken" rather than "rotation with a malformed
    // grace period is broken".
    const r = server.rotateToken('NEW-TOKEN-BBB', 60000);
    expect(Number.isNaN(r.gracePeriodEnd)).toBe(false);
    expect(r.gracePeriodEnd).toBeGreaterThan(Date.now());

    // The old token IS still authorised during the grace period — correct.
    expect(server.isTokenAuthorized('OLD-TOKEN-AAA')).toBe(true);
    expect((server as any).gracePeriodMs).toBe(60000);

    // And the status agrees with reality.
    const st: any = server.getTokenStatus();
    expect(st.inGracePeriod).toBe(true);
    expect(st.gracePeriodEnd).toBe(r.gracePeriodEnd);
  });
});
