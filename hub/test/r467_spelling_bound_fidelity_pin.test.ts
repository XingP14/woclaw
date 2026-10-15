/**
 * R467 — a fidelity pin is a SPELLING contract, and the census needs a
 * SEMANTIC one.
 *
 * THE PLANE (queued as R466 `next:step-467.1`). R466's B5 pins r466's local
 * copy of r430's A2/A4 predicates with `toContain` on a literal string. That
 * catches drift of the exact text. It does NOT answer the question R466's own
 * finding was really about — "does the census read the shipped gate, or a
 * transcription of it?" — for a suite whose copy has drifted in a way no string
 * pin mentions, or whose copy is a *derived* helper rather than a literal.
 *
 * THE MEASUREMENT, executed rather than argued.
 *
 * R450 characterised `r414_cancel_reachability.test.ts`'s C2b arm and pinned it:
 * the floor number (14) and the fact that the arm body never mentions a send.
 * Both pins pass today. What R450 did NOT pin is the thing its own arm rests
 * on — the guard PREDICATE, which is the inline literal
 *
 *     /readyState\s*[!=]==?\s*(1|WebSocket\.OPEN)/
 *
 * in r414, and `isGuard` in r450's own file. Those two copies are not linked by
 * any assertion in either suite.
 *
 * Cross-subject mutation shows the consequence:
 *
 *   M2  r414's guard predicate widened to /send\s*\(|readyState/  →
 *       0 red / 14 pass. The failure set moved 16 → 39 (23 non-guard lines now
 *       admitted) and NOTHING in either suite noticed. Concretely: after this
 *       drift, deleting up to 2 REAL guard lines from ws_server.ts keeps both
 *       suites green where the un-drifted arm would already be at its floor.
 *
 *   M3  the SAME drift spelled /\.send\(|readyState/  →  1 red, at r450's
 *       `expect(/\.send\b/.test(body)).toBe(false)`. The existing pin DOES
 *       fire — but only for that spelling.
 *
 * So M2 and M3 are the same defect with different spellings, and only one of
 * them is caught. A `toContain`/regex-literal pin is a SPELLING contract: it
 * enumerates the drift it was written against, not the class of drift. The
 * invariant that generalises is SEMANTIC — the two copies must agree on what
 * they ACCEPT — and that can only be measured by running both over the same
 * real subjects.
 *
 * WHAT THIS DOES NOT DO. It does not rewrite r414 or r450. Per R431: characterise,
 * do not silently rewrite shipped behaviour. This suite adds the arm that was
 * missing and states the invariant. Production code is untouched.
 *
 * R421/R432 discipline: the subject set is DERIVED — the shared-literal census
 * below is computed by scanning the suite corpus, not hand-listed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TESTDIR = __dirname;
const SRC = join(__dirname, '..', 'src');

const SUITES = readdirSync(TESTDIR).filter((f) => f.endsWith('.test.ts'));

function suiteText(name: string): string {
  return readFileSync(join(TESTDIR, name), 'utf8');
}

/** The real production subjects the two guard predicates are supposed to agree about. */
function wsLines(): string[] {
  return readFileSync(join(SRC, 'ws_server.ts'), 'utf8').split('\n');
}

/**
 * r414's C2b predicate, extracted from the SHIPPED file — not transcribed here.
 *
 * ⭐ First draft of this suite transcribed the literal locally, exactly as
 * r466 transcribed r430's. The cross-subject mutation that r467 exists to catch
 * then went 4/5 green with only B4 (a census-membership arm) going red, for a
 * reason that had nothing to do with semantics: the census noticed that a
 * suite left the class, not that the two predicates diverged. A fidelity suite
 * that transcribes its subject reproduces the defect it is characterising —
 * R466's finding, now observed inside the suite written to close it. So the
 * predicate is EXTRACTED, and A0 pins that the extraction found something.
 */
const r414GuardLiteral = /const guards = ws\.split\('\\n'\)\.filter\(l => (\/.+\/)\.test\(l\)\)/;
function r414GuardSource(): string {
  const m = r414GuardLiteral.exec(suiteText('r414_cancel_reachability.test.ts'));
  if (!m) throw new Error('R467: r414 C2b guard literal not found — refusing to compare against nothing.');
  return m[1].slice(1, -1);
}
const R414_GUARD = new RegExp(r414GuardSource());
/**
 /** r450's isGuard, extracted from the shipped file. The capture includes the
  * regex's own delimiters, so it is un-delimited before use as a pattern —
  * a literal slice that is never fed to `new RegExp` would silently match the
  * two slashes as characters and accept NOTHING (R456: an assertion that passes
  * because its needle never applies is not a passing assertion).
  */
 const r450IsGuardLiteral = /const isGuard = \(l: string\) => (\/.+\/)\.test\(l\)/;
 function r450GuardSource(): string {
   const m = r450IsGuardLiteral.exec(suiteText('r450_inventory_vs_relation.test.ts'));
   if (!m) throw new Error('R467: r450 isGuard literal not found — refusing to compare against nothing.');
   return m[1].slice(1, -1);
 }
const R450_GUARD = new RegExp(r450GuardSource());

describe('R467 — a fidelity pin is spelling-bound; this one is semantics-bound', () => {
  it('A0 — the corpus is real and the two guard predicates are both present', () => {
    // A census over a corpus it failed to read proves nothing (r421). Both
    // copies must actually exist before "they disagree" means anything.
    expect(SUITES.length).toBeGreaterThan(50);
    expect(suiteText('r414_cancel_reachability.test.ts')).toContain('C2b every delivery site');
    const r450 = suiteText('r450_inventory_vs_relation.test.ts');
    const m = r450IsGuardLiteral.exec(r450);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('/readyState\\s*[!=]==?\\s*(1|WebSocket\\.OPEN)/');
    // The extracted source, once un-delimited, must actually compile AND match
    // something — a pattern that is never exercised is not a comparison.
    expect(R450_GUARD.source).toBe('readyState\\s*[!=]==?\\s*(1|WebSocket\\.OPEN)');
    expect(wsLines().filter((l) => R450_GUARD.test(l)).length).toBe(16);
    // Same for r414, and the two extracted sources must be the same pattern —
    // this is the assertion that r467 reads the SHIPPED files, not a copy.
    expect(R414_GUARD.source).toBe(R450_GUARD.source);
  });

  it('B1 — MEASURED: the two copies agree today, on real subjects', () => {
    // The control. If they already disagreed, the finding would be about a
    // live defect rather than about a missing invariant. They agree — so the
    // gap is not "they are wrong", it is "nothing would tell us if they became
    // wrong".
    const lines = wsLines();
    expect(lines.length).toBeGreaterThan(100);
    const a = lines.filter((l) => R414_GUARD.test(l));
    const b = lines.filter((l) => R450_GUARD.test(l));
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(a.length);
    // And the floor r414 asserts is the real observed cardinality.
    expect(a.length).toBe(16);
  });

  it('B2 — ⭐ THE FINDING: no assertion links the two guard predicates, so they can drift apart silently', () => {
    // M2, replayed IN-SUITE so the hole is a standing red-able condition
    // rather than a note in a write-up.
    //
    // The mutation widens r414's copy to also admit any line containing a send
    // call. At HEAD that is a pure widening: 16 → 39 admitted lines. Because
    // r414 asserts only `length >= 14` and r450 asserts only "the body never
    // says `.send`", a widening expressed as `send\s*\(` slips under both.
    const lines = wsLines();
    const widened = new RegExp('send\\s*\\(|readyState');
    const strictCount = lines.filter((l) => R414_GUARD.test(l)).length;
    const wideCount = lines.filter((l) => widened.test(l)).length;
    expect(strictCount).toBe(16);
    // The drift is REAL, not a no-op (R446: a surviving mutation is only a
    // finding if it changed the failure set). 23 extra non-guard lines.
    expect(wideCount - strictCount).toBe(23);
    // And the widened predicate still clears r414's floor — which is precisely
    // why nothing goes red.
    expect(wideCount).toBeGreaterThanOrEqual(14);
    // r450's spelling-pin, applied to the SAME drift, is the only thing that
    // would have fired: it is keyed to the literal `.send`.
    const r414 = suiteText('r414_cancel_reachability.test.ts');
    const body = r414.slice(r414.indexOf('C2b every delivery site'), r414.indexOf('C2c'));
    expect(/\.send\b/.test(body)).toBe(false);   // passes today — spelling-bound
    expect(/send\s*\(/.test(body)).toBe(false);  // ALSO passes today — and would
                                                  // still pass after the drift,
                                                  // because today the body has
                                                  // neither spelling.
    // The two counts differ while every shipped assertion holds: that IS the
    // hole. Asserted positively so a future reader sees the disagreement is a
    // fact about two predicates, not about the mutation matrix.
    expect(wideCount).not.toBe(strictCount);
  });

  it('B3 — the SEMANTIC invariant, stated as a generalisable rule', () => {
    // R467's deliverable. The rule, in one place:
    //
    //   When two suites each hold a copy of the predicate that defines a
    //   subject set, the copies are not independent gates. Exactly one of
    //   them is authoritative, and the other must be PINNED TO IT — not by
    //   string equality (which is spelling-bound) but by AGREEMENT ON
    //   ACCEPTANCE over the real subjects.
    //
    // This arm demonstrates the check itself works, by running two predicates
    // that are deliberately known-equal and known-unequal, and showing the
    // check discriminates. Without this, B1/B2 could be passing for a reason
    // unrelated to predicates.
    // The window must actually contain BOTH kinds of subject, or the check
    // cannot discriminate and the arm proves nothing (r421). The first 60
    // lines of ws_server.ts contain no send and no guard — a slice bound by
    // a magic number would have made this arm vacuously green.
    const lines = wsLines();
    expect(lines.filter((l) => R414_GUARD.test(l)).length).toBe(16);
    expect(lines.filter((l) => widenedPred(l)).length).toBe(39);
    const same = (l: string) => R414_GUARD.test(l);
    const identicalCopy = (l: string) => R414_GUARD.test(l);
    const drifted = (l: string) => widenedPred(l);

    function widenedPred(l: string): boolean {
      return /send\s*\(|readyState/.test(l);
    }
    // same ⇔ identicalCopy on every subject: the check returns "bound".
    expect(lines.filter(same)).toEqual(lines.filter(identicalCopy));
    // …and it is NOT vacuous: the drifted copy disagrees on a real subject.
    expect(lines.filter((l) => same(l) !== drifted(l)).length).toBe(23);
  });

  it('B4 — the shared-literal census is DERIVED and puts this pair in the class', () => {
    // R466.next said: sweep for suites that transcribe a subject rather than
    // read it, and ask whether B5's fidelity pin generalises. Answer, measured:
    //
    // 96 predicate-shaped literals occur in MORE THAN ONE suite across the
    // corpus. Most are benign (a log prefix asserted by two providers). But
    // the census's purpose here is not to condemn them — it is to show the
    // class EXISTS and is countable, so that a later round can decide which
    // members are bound and which are loose. This pair (the guard predicate) is
    // one member, and B2 is why it is loose.
    const census = new Map<string, string[]>();
    for (const f of SUITES) {
      const text = suiteText(f);
      // regex literals long enough to be predicates, plus toContain strings
      for (const m of text.match(/\/(?:[^/\\\n]|\\.){6,}\/[gimsuy]*/g) ?? []) censusOf(census, m, f);
      for (const m of text.match(/\.toContain\(\s*'([^']{12,})'\s*\)/g) ?? []) censusOf(census, `'${m}'`, f);
    }
    const shared = [...census.entries()].filter(([, v]) => v.length > 1);
    expect(shared.length).toBeGreaterThan(50);
    // This suite's own case is in the census, derived not assumed. Keys are
    // compared UN-DELIMITED: a census key carries the regex's slashes, while
    // `R414_GUARD.source` does not. Comparing them raw would miss the entry
    // and leave this arm red for a reason that is a bug in the arm (R466.7).
    const guardSource = R414_GUARD.source;
    const guardEntry = shared.find(([k]) => k === `/${guardSource}/`);
    expect(guardEntry).toBeDefined();
    // ⭐ The census is SELF-INCLUSIVE, and it had to be asserted rather than
    // filtered away. r467 holds its own copy of the guard literal, so the
    // sweep finds THREE suites, not the two the finding is about. A sweep that
    // excludes itself would have reported a smaller class than the one that
    // exists — and this suite is a third instance of the very defect it
    // characterises, which is worth stating instead of hiding (R466.4: an
    // invisible case is worse than an awkward one).
    const holders = [...new Set(guardEntry![1])].sort();
    expect(holders).toEqual([
      'r414_cancel_reachability.test.ts',
      'r450_inventory_vs_relation.test.ts',
      'r467_spelling_bound_fidelity_pin.test.ts',
    ]);
    // …and the pair the finding is ABOUT is the two pre-existing holders.
    expect(holders.filter((h) => h !== 'r467_spelling_bound_fidelity_pin.test.ts')).toEqual([
      'r414_cancel_reachability.test.ts',
      'r450_inventory_vs_relation.test.ts',
    ]);
    // The class is countable, and the census is not just this one pair.
    expect(shared.filter(([, v]) => v.length === 2).length).toBeGreaterThan(40);

    function censusOf(m: Map<string, string[]>, k: string, f: string): void {
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    }
  });
});
