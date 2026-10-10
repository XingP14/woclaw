/**
 * R436 — a write-up written BEFORE its commit cannot cite that commit's sha.
 *
 * Two probes on the record plane disagreed, and the disagreement was not a bug
 * in either. `r430_record_plane.test.ts` A2 asks "is this commit's sha cited by
 * a hand-authored narrative?"; `multi_round_declaration_r435.test.ts` asks
 * "does a narrative declare this round's id?" Over the same 80-commit window
 * the two definitions agreed on 15 of 16 round commits and disagreed on ONE:
 * `2ce4e3e` (R435), whose write-up existed and declared R435 correctly but
 * carried a self-reference placeholder — `**Commit**: (this file's commit)`.
 *
 * The finding is not "someone forgot seven characters". The R435 write-up was
 * authored 114 minutes BEFORE the commit it documents (commit `%ct` 06:09,
 * doc `mtimeMs` 04:14), so at write time the sha did not exist. A document
 * written before the act cannot cite the act's identifier by construction, and
 * a probe that requires the citation reports that round as UNDOCUMENTED — the
 * exact opposite of the truth.
 *
 * 🔴 TWO SELF-BUGS found by RUNNING this suite before trusting it, both mine:
 *
 *   1. **A2 linked a doc to the wrong commit.** It took the first standalone
 *      hex token in the doc's body — for the R430 write-up that is `435469e`,
 *      a commit it merely *mentions* — and concluded it was written 116 min
 *      after "its" commit. Measured by linking properly instead (the round id
 *      the doc's TITLE declares → the oldest commit declaring that id):
 *      `4527d3b`, delta **−9 min**. The arm was measuring a back-reference,
 *      which is R432-2 in a new costume. Fixed by deriving the linkage from the
 *      declaration, never from prose.
 *   2. **A1's pin deleted its own control.** It required ≥2 placeholder docs so
 *      the class could not be a one-off — the same reasoning as R427's count
 *      floor. Then I fixed R435's placeholder, and the class fell to 1 and the
 *      arm went RED. This is **R428-F3 exactly**: a membership pin aimed at an
 *      instance is mutually exclusive with that instance's existence. Fixed the
 *      way R428 fixed it — pin the CLASS's non-emptiness, never its size, and
 *      get the non-vacuity from A4's falsifier instead of from a count.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT DECIDE: whether "documented" should
 * mean declaration-or-sha rather than sha. That changes what A2 in
 * `r430_record_plane.test.ts` ranges over and is father-gated (R432.6, R435 §7).
 * This suite pins the shape so the decision cannot be made by accident, and
 * asserts the honest consequence: a doc authored before its commit CANNOT cite
 * that sha, so a suite demanding the citation reports an ordering artefact.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** R430's derivation, reused verbatim — never re-list it (R427/R429). */
function findWorkspace(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'LEARNING_PLAN.md')) && existsSync(join(dir, 'memory'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('R436: could not derive the workspace root. Refusing to pass vacuously.');
}

const WS = findWorkspace();
const MEM = join(WS, 'memory');
const REPO = join(WS, 'woclaw');

const NARRATIVE: { name: string; text: string; mtimeMs: number }[] = readdirSync(MEM, {
  withFileTypes: true,
})
  .filter((e) => e.isFile() && e.name.endsWith('.md'))
  .map((e) => {
    const p = join(MEM, e.name);
    return { name: e.name, text: readFileSync(p, 'utf8'), mtimeMs: statSync(p).mtimeMs };
  });

interface RawCommit {
  short: string;
  ts: number;
  subj: string;
  body: string;
}

/**
 * ONE git call for the whole history. R435's self-bug 2 was a probe too slow to
 * run (96 s → budget blowout); a probe that gets skipped is a vacuous pass
 * wearing a different hat. Everything below reads from this array.
 */
const HISTORY: RawCommit[] = execSync(`git log --format=%H%x7c%ct%x7c%s%x7c%b%x1e`, {
  cwd: REPO,
  encoding: 'utf8',
})
  .split('\x1e')
  .map((r) => r.replace(/^\n+/, ''))
  .filter((r) => r.trim().length > 0)
  .map((rec) => {
    const [hash, ct, subj, body = ''] = rec.split('\x7c');
    return { short: hash.slice(0, 7), ts: Number(ct) * 1000, subj, body };
  });

const bySha = new Map(HISTORY.map((c) => [c.short, c]));

/**
 * The commit a doc is the write-up OF, derived from the doc's own TITLE
 * declaration — the only position a back-reference cannot occupy (R432-2,
 * R435-2). Linking from a hex token in the prose is what made self-bug 1.
 */
function declaresRound(text: string, rid: string): boolean {
  const t = text.match(/^\s*#\s*(?:R(\d{3})\s*[—–-]|Round\s+(\d{3})\b)/);
  if (!t) return false;
  return String(Number(t[1] ?? t[2])) === String(Number(rid));
}

/**
 * A commit declares a round when its SUBJECT carries the tag, or its BODY
 * opens with the round in declaration form.
 *
 * 🔴 SELF-BUG 3, found by running this: the first version reused one predicate
 * for docs and commits, anchored on `^\s*#`, which a commit message never
 * begins with — so `ownCommit` returned null for every doc and A2 measured an
 * empty set. `expected 0 to be greater than 0` is the vacuous-pass guard (R421)
 * doing exactly its job on an arm that had silently stopped measuring anything.
 *
 * The two positions are deliberately DIFFERENT and not merged into one regex:
 * a doc declares in its title, a commit declares in its subject or in the first
 * line of its body (R432-2 — a back-reference later in the body is not a
 * declaration, and 5 measured back-references prove the distinction is load
 * bearing).
 */
function commitDeclares(c: RawCommit, rid: string): boolean {
  const subjTag = new RegExp(`\\(\\s*(?:round|r)?0*${rid}\\s*\\)`, 'i');
  const bodyDecl = new RegExp(`^\\s*(?:R0*${rid}\\s*[.:]|Round\\s+0*${rid}\\b)`, 'i');
  return subjTag.test(c.subj) || bodyDecl.test(c.body);
}

function ownCommit(doc: { name: string; text: string }): RawCommit | null {
  const rid = doc.text.match(/^\s*#\s*(?:R(\d{3})\s*[—–-]|Round\s+(\d{3})\b)/);
  if (!rid) return null;
  const id = String(Number(rid[1] ?? rid[2]));
  // OLDEST commit declaring that round. Oldest, because a round may be
  // re-declared by a later fix commit (R435 shipped its own round this way).
  for (const c of [...HISTORY].reverse()) {
    if (commitDeclares(c, id)) return c;
  }
  return null;
}

/**
 * A narrative that self-references its commit by placeholder instead of a sha.
 * Derived by SHAPE across all narratives — R427: a hand list is a known-wrong
 * list, so the three known instances are never named in the predicate.
 */
const PLACEHOLDER = /(?:\*\*Commit\*\*\s*:\s*)\(?\s*(?:this round|this file's commit)/i;

const placeholderDocs = NARRATIVE.filter((n) => PLACEHOLDER.test(n.text));

/** Minutes between a doc's write time and the commit it documents. */
const deltaMin = (doc: { name: string; text: string; mtimeMs: number }): number | null => {
  const own = ownCommit(doc);
  return own === null ? null : (doc.mtimeMs - own.ts) / 60000;
};

/**
 * The predicate A2 asserts, factored so A4 can call it on a case it MUST reject.
 * R427's mutation lesson: a predicate never asked to reject anything passes
 * everything (that was one of R427's two surviving arms).
 */
function forcedByOrdering(delta: number | null): boolean {
  // Same-minute counts as unknowable: git's %ct has 1-second granularity and the
  // commit may not have happened yet.
  return delta !== null && delta <= 1;
}

describe('R436 — the write-up cannot cite a sha that did not exist when it was written', () => {
  it('A0 — the subject sets are derived and non-empty on both sides', () => {
    // Guards the guard. An empty placeholder set would make A2 vacuously true,
    // which is the defect class this round is about (R421: refuse to continue on
    // a missing subject).
    expect(HISTORY.length).toBeGreaterThan(100);
    expect(NARRATIVE.length).toBeGreaterThan(20);
    expect(placeholderDocs.length).toBeGreaterThan(0);
  });

  it('A1 — the class is derived and non-empty; its SIZE is not asserted', () => {
    // R428-F3, learned the hard way in this very file: the first version
    // required >= 2 members so the class could not be a one-off, and then fixing
    // R435's placeholder made the arm RED. Fix-and-control are mutually
    // exclusive when the control is a count. Pin the class's existence; get
    // non-vacuity from A4.
    expect(placeholderDocs.length).toBeGreaterThan(0);
    for (const d of placeholderDocs) {
      expect(
        PLACEHOLDER.test(d.text),
        `${d.name} is in the derived placeholder set but the predicate does not match it`
      ).toBe(true);
      // And the set must be exactly what the predicate finds, not a subset.
      expect(NARRATIVE.filter((n) => PLACEHOLDER.test(n.text)).map((n) => n.name)).toEqual(
        placeholderDocs.map((d) => d.name)
      );
    }
  });

  it('A2 — every placeholder doc was authored no later than the commit it documents', () => {
    // The claim, over the derived class. A placeholder on a doc written well
    // AFTER its commit would be negligence, and would falsify the structural
    // reading in favour of "someone forgot to type 7 characters".
    const measured = placeholderDocs
      .map((d) => ({ name: d.name, delta: deltaMin(d) }))
      .filter((x) => x.delta !== null);
    expect(measured.length).toBeGreaterThan(0);
    for (const m of measured) {
      expect(
        forcedByOrdering(m.delta),
        `${m.name} carries a placeholder but was authored ${m.delta!.toFixed(1)} min AFTER ` +
          `the commit it documents — the sha was knowable, so this is an omission, ` +
          `not an ordering artefact`
      ).toBe(true);
    }
  });

  it('A3 — no narrative cites a commit it predates', () => {
    // The loophole A2's tolerance would otherwise open. Measured over the
    // sha-citing set, not the placeholder set: backdating is the anomaly
    // regardless of whether the doc also carries a placeholder.
    //
    // One known instance EXISTS and is deliberately reported, not asserted away:
    // `f147d2a` / the R424 doc are the same minute. A strict `<` would fire on a
    // 1-second granularity artefact, so the bound is 60s.
    const backdated: string[] = [];
    for (const n of NARRATIVE) {
      const shas = [...n.text.matchAll(/(?<![0-9a-f])([0-9a-f]{7})(?![0-9a-f])/g)].map((m) => m[1]);
      for (const s of shas) {
        const c = bySha.get(s);
        if (c && n.mtimeMs < c.ts - 60_000) backdated.push(`${n.name} cites ${s}`);
      }
    }
    expect(
      backdated,
      'narratives citing a commit they predate by more than a minute — the direction ' +
        'A3 in r430_record_plane.test.ts exists to catch'
    ).toEqual([]);
  });

  it('A4 — the A2 predicate is not vacuous: it rejects a placeholder written after its commit', () => {
    // THE CONTROL THAT DECIDES THE ROUND. A2 passes if `forcedByOrdering` always
    // returns true — including for a doc written the day AFTER its commit, which
    // is the case A2 exists to catch. A dead predicate and a correct one are
    // identical green (R428-F1); only the pair separates them.
    //
    // R427's lesson applied: the SAME function is called on a case it must accept
    // and one it must reject. Without the accept-side call this arm proves
    // nothing about the predicate at all.
    expect(forcedByOrdering(-9)).toBe(true); // forced — written before the commit
    expect(forcedByOrdering(0.5)).toBe(true); // same minute — unknowable either way
    expect(forcedByOrdering(116.2)).toBe(false); // the self-bug-1 measurement — an omission
    expect(forcedByOrdering(null)).toBe(false); // unlinkable — not this class, and NOT excused
  });
});
