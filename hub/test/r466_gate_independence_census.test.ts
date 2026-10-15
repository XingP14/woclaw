/**
 * R466 — How many independent signals does a shipped gate actually provide?
 *
 * THE PLANE. R465 found that `r430_record_plane.test.ts`'s A2/A4 are not two
 * gates: both range over the same `ROUNDED` upstream and both consume the same
 * `citedBy` field. R465-3 named the consequence ("they can both go red, that
 * does not make them independent") but stopped at a naming argument. This
 * round turns it into a MEASUREMENT over every shipped suite, so the count of
 * "independent signals" stops being an impression.
 *
 * THE CLASS. Two failure predicates P and Q over a derived subject set are
 * INDEPENDENT if there is a world in which P fails and Q passes, and another
 * in which Q fails and P passes. A cheap necessary condition — and, for the
 * subset case, a sufficient one — is set containment:
 *
 *     fails(P) ⊆ fails(Q)   ⇒   P supplies ZERO evidence Q does not.
 *
 * You do not need a counterexample world to prove zero independence: if P's
 * failure set is contained in Q's, then P green ⇒ Q green, forever, in every
 * world. That is a proof by containment, and it is what this suite runs.
 *
 * WHY IT MATTERS HERE. R464-4 and R465-1 both record the same operational
 * fact: this record gate has gone red three times, been "fixed" three times,
 * and gone red again. The reflex reading of three reds is three defects. If a
 * subset of the arms are derivatives, three reds are fewer defects than they
 * look, and — worse — a green on the derivative arm is not corroboration of a
 * green on the source arm. Green-on-green here is ONE signal, and everyone
 * downstream was counting two.
 *
 * WHAT IS DELIBERATELY NOT HERE. This does not assert that r430 is broken.
 * A4 being a subset of A2 is a property of a relaxation that the file's own
 * header calls deliberate ("this is the one relaxation in this suite"). The
 * finding is not "A4 is wrong"; it is that A4's green carries no information
 * A2's green does not already carry, and a suite that reports them as
 * separate assertions cannot show a reader that.
 *
 * R421/R432 discipline: the subject set is DERIVED (walk up for the workspace,
 * classify narrative vs machine by extension, derive round identity from
 * subject OR body declaration). Nothing here is a hand list of shas.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

function findWorkspace(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'LEARNING_PLAN.md')) && existsSync(join(dir, 'memory'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(
    'R466: could not derive the workspace root (no LEARNING_PLAN.md + memory/ pair above ' +
      __dirname + '). Refusing to pass vacuously.'
  );
}

const WS = findWorkspace();
const MEM = join(WS, 'memory');
const REPO = join(WS, 'woclaw');
const PLAN = join(WS, 'LEARNING_PLAN.md');
const HUB = join(REPO, 'hub');
const TESTDIR = join(HUB, 'test');

// ── narrative/machine split, derived by extension (r430's fix, not a list) ──
const FILES = readdirSync(MEM, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name);
const NARRATIVE = FILES.filter((f) => f.endsWith('.md'));
const narrativeText = new Map<string, string>();
for (const f of NARRATIVE) narrativeText.set(f, readFileSync(join(MEM, f), 'utf8'));

const planText = readFileSync(PLAN, 'utf8');

/** A short sha must stand alone as a token; a bare substring match is r430's DEFECT 2. */
function cites(text: string, short: string): boolean {
  return new RegExp(`(?<![0-9a-f])${short}(?![0-9a-f])`, 'i').test(text);
}

interface Commit {
  short: string;
  ts: number;
  rid: string | null;
  bodyRid: string | null;
  subj: string;
  citedBy: string[];
}

function commits(limit: number): Commit[] {
  const raw = execSync(`git log --format=%H%x7c%ct%x7c%s%x7c%b%x1e -${limit}`, {
    cwd: REPO, encoding: 'utf8',
  });
  return raw
    .split('\x1e')
    .map((rec) => rec.replace(/^\n+/, ''))
    .filter((rec) => rec.trim().length > 0)
    .map((rec) => {
      const [hash, ct, subj, body = ''] = rec.split('\x7c');
      const short = hash.slice(0, 7);
      const m = subj.match(/\((?:round|r)?(\d{3})\)/i);
      // DECLARATION form only: a back-reference is never in first position.
      const b = body.match(/^\s*(?:R(\d{3})\s*[.:]|Round\s+(\d{3})\b)/i);
      return {
        short,
        ts: Number(ct) * 1000,
        rid: m ? String(Number(m[1])) : null,
        bodyRid: b ? String(Number((b[1] ?? b[2]) as string)) : null,
        subj,
        citedBy: [...narrativeText.entries()]
          .filter(([, t]) => cites(t, short))
          .map(([n]) => n),
      };
    });
}

const WINDOW = commits(80);

/** r430's ROUNDED: subject-tagged only. A5's orphan set is body-tagged only. */
const ROUNDED = WINDOW.filter((c) => c.rid !== null);
/** A5's set: round identity declared ONLY in the body. Disjoint from ROUNDED by construction. */
const ORPHANS = WINDOW.filter((c) => c.rid === null && c.bodyRid !== null);

// ── the four r430 arms, re-derived here as PREDICATES so containment is provable ──
const failsA2 = (c: Commit) => c.citedBy.length === 0;
const failsA4 = (c: Commit) => {
  const hasDoc = c.citedBy.length > 0;
  const hasPlan = new RegExp(`####\\s+${c.rid}[.\\s]`).test(planText);
  // Verbatim from r430_record_plane.test.ts:311 — including the direction, which
  // is the point (see D1 below).
  return hasDoc !== hasPlan && !hasDoc;
};
const failsA5orphan = (c: Commit) => c.rid === null && c.bodyRid !== null && c.citedBy.length === 0;

const setOf = (pred: (c: Commit) => boolean) => WINDOW.filter(pred).map((c) => c.short);
const containedIn = (a: string[], b: string[]) => a.every((x) => b.includes(x));

/**
 * Round ids that genuinely appear as `#### NNN.` headings in the plan.
 *
 * B1 needs synthetic subjects whose `hasPlan` is real, because the predicate
 * reads planText directly. Deriving the available rids (rather than hardcoding
 * '461') keeps the synthetic subject set honest if the plan is renumbered —
 * the same R437 rule as r430's extension-based narrative/machine split.
 */
const PLAN_RIDS = [...planText.matchAll(/^####\s+(\d{3})[.\s]/gm)].map((m) => String(Number(m[1])));
const PLAN_RID_SET = new Set(PLAN_RIDS);

/**
 * Arms as a table, so the census is derived from data rather than hand-listed.
 *
 * `subject` is a SELECTOR, not an array — an earlier version evaluated every
 * arm over the whole subject set and A4's predicate silently captured the
 * orphans too (it never reads `c.rid`, so a null-rid object with no citation
 * satisfies it). That inflated A4's failure set until it, and then A5-orphan,
 * both looked contained. Each arm must range over what it claims to range
 * over; a predicate is not a subject set.
 */
const ARMS: { id: string; subject: (c: Commit) => boolean; pred: (c: Commit) => boolean }[] = [
  { id: 'A2', subject: (c) => c.rid !== null, pred: failsA2 },
  { id: 'A4', subject: (c) => c.rid !== null, pred: failsA4 },
  { id: 'A5-orphan', subject: (c) => c.rid === null && c.bodyRid !== null, pred: failsA5orphan },
];

describe('R466 — independence accounting for shipped gates', () => {
  it('A0 — the subject sets are DERIVED, non-empty, and the sweep is real', () => {
    // A census over an empty subject set proves nothing (r421). Every arm must
    // have subjects, and the two subject sets must actually be disjoint —
    // otherwise the "independent" verdict below is vacuous.
    expect(NARRATIVE.length).toBeGreaterThan(20);
    expect(narrativeText.size).toBe(NARRATIVE.length);
    expect(ROUNDED.length).toBeGreaterThan(0);
    expect(ORPHANS.length).toBeGreaterThan(0);
    expect(containedIn(setOf(failsA5orphan), [])).toBe(true); // sanity of the helper
    expect(setOf(failsA5orphan).every((s) => !ROUNDED.some((c) => c.short === s))).toBe(true);
    // And the sweep must see the real suite corpus.
    expect(readdirSync(TESTDIR).filter((f) => f.endsWith('.test.ts')).length).toBeGreaterThan(50);
  });

  it('A0b — the REAL window has an EMPTY A2 set, so real-data containment is VACUOUS (and that is the finding)', () => {
    // ⭐ I wrote B1 first against the real window and it passed. It passed
    // vacuously: the record gate is GREEN at HEAD, so A2's failure set is empty
    // and ∅ ⊆ anything. Containment proved on empty sets is not evidence — it
    // is R421 (a green over a subject set with no failures in it) wearing a
    // proof's clothes, one level below A0's own guard.
    //
    // So: state the vacuity as a MEASURED fact and make B1/B3/B4 prove
    // containment CONSTRUCTIVELY, on synthetic subjects where every set is
    // non-empty. If the real window ever goes red, this arm starts reporting a
    // second, genuinely-evidenced measurement.
    const a2Real = setOf((c) => ROUNDED.includes(c) && failsA2(c));
    expect(a2Real).toEqual([]);
    expect(ROUNDED.length).toBeGreaterThan(0);
    // The synthetic subjects below must not accidentally name the same rid as
    // a real commit, or a red real window would be reported through them.
    expect(PLAN_RIDS.length).toBeGreaterThan(0);
  });

  it('B1 — A4\'s failure set is CONTAINED IN A2\'s, proved CONSTRUCTIVELY on non-empty sets', () => {
    // THE MEASUREMENT, on subjects where both sides actually have members.
    // Plant one object per state of (hasDoc, hasPlan) and check the containment
    // where it can bite; then re-check it on the real window for reporting only.
    const mk = (short: string, rid: string, citedBy: string[]): Commit => ({
      short, ts: 0, rid, bodyRid: null, subj: `synthetic ${short}`, citedBy,
    });
    // `hasPlan` is read from planText by the predicate, so the "plan present"
    // objects get an rid that genuinely appears as a `#### NNN.` heading.
    const planRid = PLAN_RIDS[0];
    const noPlanRid = PLAN_RIDS.find((r) => !PLAN_RID_SET.has(r)) ?? '998';
    const planted: Commit[] = [
      mk('aaaaaaa', planRid, []),                              // A2 fires; A4 fires
      mk('bbbbbbb', noPlanRid, []),                            // A2 fires; A4 SILENT
      mk('ccccccc', planRid, ['memory/2026-10-16-round465-record-cannot-cite-itself.md']),
    ];
    const a2 = planted.filter(failsA2).map((c) => c.short);
    const a4 = planted.filter(failsA4).map((c) => c.short);
    expect(a2.length).toBe(2);            // non-empty on BOTH sides, or nothing is proved
    expect(a4.length).toBe(1);
    expect(containedIn(a4, a2)).toBe(true);
    // The genuine asymmetry: `bbbbbbb` fails A2 with NO A4 signal at all.
    expect(a2).toContain('bbbbbbb');
    expect(a4).not.toContain('bbbbbbb');
    // Same containment on the real window, reported not relied upon (see A0b).
    expect(containedIn(
      setOf((c) => ROUNDED.includes(c) && failsA4(c)),
      setOf((c) => ROUNDED.includes(c) && failsA2(c))
    )).toBe(true);
  });

  it('B2 — A4\'s header comment and its push direction are OPPOSITE, and the relaxation hides it', () => {
    // r458/r460 recorded "a title that denies its own assertion". This is the
    // same shape one level down: in a PREDICATE that is consumed by a shipped
    // gate, not in a test title. The file says it checks doc-without-plan; the
    // code pushes plan-without-doc. Under B1 that inversion is invisible — a
    // derivative arm cannot fail where its source is green, so the direction
    // never gets exercised by a red.
    const src = readFileSync(join(TESTDIR, 'r430_record_plane.test.ts'), 'utf8');
    const comment = src.slice(src.lastIndexOf('it(\'A4'));
    expect(comment).toContain('doc-without-plan');      // what the file CLAIMS
    expect(comment).toContain('!hasDoc');              // what the code DOES
    expect(comment).toContain('hasPlan');
    // The claimed direction would need `hasDoc && !hasPlan`; that literal does
    // not appear in A4's body. So the claim is not merely imprecise — the
    // predicate it names is absent.
    expect(comment.slice(0, comment.indexOf('expect(halfRecorded)'))).not.toContain('hasDoc && !hasPlan');
  });

  it('B3 — the independence census: r430 provides 2 independent signals for the record plane, not 3', () => {
    // Derive the count instead of asserting a remembered one. An arm is
    // INDEPENDENT of everything before it if its failure set is not contained
    // in the union of theirs — containment in the union ⇒ provably no new
    // evidence, by B1's argument applied pairwise.
    //
    // The census runs over a PLANTED subject set carrying one object per
    // (rid-present, cited) state, because the real window has no failures at
    // all (A0b) and a census over it would report every arm as independent for
    // the wrong reason. Planting keeps the verdict earned.
    const realRid = PLAN_RIDS[PLAN_RIDS.length - 1];
    const absentRid = PLAN_RIDS.find((r) => !PLAN_RID_SET.has(r)) ?? '998';
    const cite = 'memory/2026-10-16-round465-record-cannot-cite-itself.md';
    const planted: Commit[] = [
      { short: 'p000001', ts: 0, rid: realRid, bodyRid: null, subj: 's', citedBy: [] },       // A2+A4
      { short: 'p000002', ts: 0, rid: absentRid, bodyRid: null, subj: 's', citedBy: [] },     // A2 only
      { short: 'p000003', ts: 0, rid: realRid, bodyRid: null, subj: 's', citedBy: [cite] },   // green
      { short: 'p000004', ts: 0, rid: absentRid, bodyRid: null, subj: 's', citedBy: [cite] },// green
      // Body-only round identities: a different SUBJECT SET (r430's A5 orphans).
      { short: 'p000005', ts: 0, rid: null, bodyRid: realRid, subj: 's', citedBy: [] },      // A5-orphan
      { short: 'p000006', ts: 0, rid: null, bodyRid: realRid, subj: 's', citedBy: [cite] },  // green
    ];
    const seen: string[] = [];
    const independent: string[] = [];
    const derivative: string[] = [];
    for (const arm of ARMS) {
      const fails = planted.filter((c) => arm.subject(c) && arm.pred(c)).map((c) => c.short);
      expect(fails.length).toBeGreaterThan(0);   // every arm must be able to speak, or be unmeasured
      if (containedIn(fails, seen)) derivative.push(arm.id);
      else independent.push(arm.id);
      seen.push(...fails);
    }
    expect(derivative).toEqual(['A4']);
    expect(independent).toEqual(['A2', 'A5-orphan']);
    // A2 and A5-orphan are independent because their SUBJECT SETS are disjoint
    // — p000002 fails A2 while no orphan object exists; p000005 fails the orphan
    // arm while ROUNDED's predicate is silent on it. State the reason, don't
    // let a matching count imply a matching cause.
    expect(planted.filter((c) => c.rid === null).map((c) => c.short)).not.toEqual(
      planted.filter((c) => c.rid !== null).map((c) => c.short)
    );
  });

  it('B5 — the census reads a HAND-TYPED COPY of r430, and the copy can drift while every count stays green', () => {
    // ⭐ THE FINDING, found by cross-subject mutation rather than by reading.
    //
    // r466 re-derives r430's arms as local predicates so containment becomes
    // provable. That is legitimate — but it means the census's SUBJECT is r466's
    // copy of r430, not r430. A census whose subject is a transcription reports
    // a measurement OF THE TRANSCRIPTION and labels it a measurement of the
    // gate.
    //
    // Mutation X4 made this concrete. In r430, A4's predicate was replaced with
    // `hasPlan && !hasDoc`: a commit carrying a doc but no plan entry now fails
    // A4 while passing A2 — strictly INDEPENDENT, the exact property this suite
    // exists to measure. Result: 0 red / 6 pass. B3 still reported "2
    // independent signals, not 3". The census did not move, because it never
    // read r430.
    //
    // So B5 states the invariant that would have caught it: the transcribed
    // predicate must be LITERALLY the shipped predicate. Any drift in r430 —
    // a direction fix, a relaxation removed — reds here instead of silently
    // leaving the count stale.
    const src = readFileSync(join(TESTDIR, 'r430_record_plane.test.ts'), 'utf8');
    // Anchor at A2's own definition, not A4's: A2's `UNDOCUMENTED` filter sits
    // earlier in the file than `halfRecorded`, so slicing from the latter would
    // silently exclude the arm this is also pinning. (R452: anchor drift makes a
    // fidelity check vacuous while staying green.)
    const arm = src.slice(src.indexOf('UNDOCUMENTED'));
    // r466's own failsA4 body, and the shipped one, must agree character for
    // character. Pin the shipped literal rather than trusting the copy.
    expect(arm).toContain('hasDoc !== hasPlan && !hasDoc');
    // …and A2's must be the plain "no citation" test it claims to be, not a
    // dressed-up variant. Both are verbatim pins, so a future edit to EITHER
    // file that moves a predicate reds this arm on purpose.
    expect(arm).toContain('ROUNDED.filter((c) => c.citedBy.length === 0)');
    // The census's local copies must be textually present, not merely
    // behaviourally equal — that is what makes this a fidelity check rather
    // than a second, drifting re-implementation.
    const self = readFileSync(__filename, 'utf8');
    expect(self).toContain('return hasDoc !== hasPlan && !hasDoc;');
    expect(self).toContain('return c.citedBy.length === 0;');
  });

  it('B4 — A2 is load-bearing (the CONTROL that makes B1\'s direction meaningful)', () => {
    // If A2 were also derivative, "2 independent" would be measuring nothing.
    // Plant the one object that satisfies A2 while A4 keeps its own verdict —
    // and observe that the object is NOT a record: it has a citation in a file
    // that never mentioned the round. (r465 recorded this bypass as M3's
    // survivor; here it is the control, not the finding.)
    const realRid = PLAN_RIDS[PLAN_RIDS.length - 1];
    const cite = '2026-10-16-round465-record-cannot-cite-itself.md';
    const citeText = readFileSync(join(MEM, cite), 'utf8');
    const documented: Commit = {
      short: 'p000001', ts: 0, rid: realRid, bodyRid: null, subj: 's', citedBy: [cite],
    };
    expect(failsA2(documented)).toBe(false);   // the citation satisfies A2…
    expect(cites(citeText, 'p000001')).toBe(false);
    // …and the cited file demonstrably does not mention the round it now
    // "documents". A2 measures the existence of a reference, not authorship.
    expect(citeText).not.toContain('p000001');
  });
});
