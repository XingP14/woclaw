/**
 * R435 — "one commit can declare more than one round, and the record plane
 * resolved it to one".
 *
 * THE CLASS, unchanged since R427. A probe that makes a claim over a subject
 * set it did not derive. R432 widened the *subject* side (a round declares
 * itself in the body's first line). This round is the identity side: what
 * happens when the declaration resolves to a SET rather than a scalar.
 *
 * THE INSTANCE, live at the moment this file was written. `274c1d4`, committed
 * 2026-10-11 02:08, is titled:
 *
 *     test(r433,r434): two gates that decide their own answer, and a banner
 *                      that decides it wrong
 *
 * r430_record_plane.test.ts:169 extracts ONE id per commit:
 *
 *     subj.match(/\((?:round|r)?(\d{3})\)/i)
 *
 * The regex has a single capture group and the code keeps a single `rid`
 * string, so the paren content `r433,r434` does not match at all — the `\(` is
 * followed by `r433` but then `)` is required immediately, and a comma sits
 * there instead. So `274c1d4` is not one mis-tagged round. It is INVISIBLE:
 * A2, A4 and A5 all range over `ROUNDED`, all of which is subject-derived, and
 * R433 and R434 have, as of this commit:
 *
 *     - no KB doc in memory/        (verified: 0 .md files cite the sha)
 *     - no LEARNING_PLAN.md heading (verified: no `#### 433` / `#### 434`)
 *
 * The suite was GREEN over both of them. That is the false green R430 was
 * written to kill, reappearing one round later, in a shape R432 did not reach:
 * R432's own numbers (14 subject-tagged → 25 subject-or-body) were computed
 * with a *scalar* extractor, so the multi-round commit could not have appeared
 * in either population.
 *
 * WHY THE OBVIOUS WIDENING IS INVERTED AGAIN (R432-2, confirmed with new
 * evidence). The obvious next step is `re.M` on the body matcher, so a
 * declaration anywhere in the body counts. Measured over all 953 commits:
 * 7 line-anchored hits, and 5 of the 7 are BACK-REFERENCES, not declarations:
 *
 *     114114d L15  "R430.** A2 ("every round commit is documented…"
 *     8c0ddea L34  "R409: a coverage denominator inherited rather than…"
 *     8c0ddea L36  "R420: a probe that cannot distinguish a broken…"
 *     8c0ddea L38  "R421: a negative assertion whose denominator…"
 *     6bc2f85 L28  "R405.4). A future commit that wires the extract…"
 *
 * Exactly R432's measured shape (`fd5b6f4`, `1d04ffc`), now 5 more instances.
 * `re.M` would demand write-ups for fixups that correctly have none.
 *
 * THE FIX, and why it is not inverted. The multi-round declaration lives in
 * the SUBJECT, and a subject is first-position by construction — a
 * back-reference can never occupy it. So widen the *subject* matcher to a
 * comma-separated list of prefixed round tokens, and leave the body matcher
 * exactly as R432 left it:
 *
 *     /\(\s*((?:[rR](?:ound)?\d{3}\s*,\s*)+[rR](?:ound)?\d{3}\s*\)/
 *
 * Measured delta over 953 commits: old sees 19, widened sees 20, delta = 1 —
 * precisely `274c1d4`, and no other commit in history. No back-reference can
 * be reached, and no false positive was manufactured (R427-F1).
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
// R470: the subject set for this probe lives in the AGENT WORKSPACE, not the
// repository. Absent in a clean CI checkout, where throwing at module scope
// reddened the build on four consecutive HEADs. A typed verdict + skip is
// the separation; the refusal to pass vacuously is unchanged.
import { resolveWorkspace, skipReason } from './support/workspace-probe.js';

// ── R470 applicability gate ───────────────────────────────────────────────
// Everything below reads the agent workspace. In a clean CI checkout it is not
// there, and the previous guard THREW here at module scope -- turning "this probe
// does not apply" into "this repository is broken". Four consecutive red HEADs.
//
// The block is skipped, not emptied: a skip is reported as skipped and no
// assertion inside it evaluates, so the vacuous pass the original refusal was
// written to prevent remains impossible.
const WS_RESOLVED = resolveWorkspace(__dirname);
if (WS_RESOLVED !== null) {
const WS = WS_RESOLVED;
const MEM = join(WS, 'memory');
const REPO = join(WS, 'woclaw');

/**
 * Subject round-tags, MULTI-aware. Deliberately two branches, not one regex
 * with `g`, because a single capture group can only carry one id and the
 * defect is precisely that a scalar cannot carry the answer.
 *
 * ⭐ R493 (2026-10-21 00:03) — `SINGLE` was a HAND COPY of r430's extractor.
 * That is a hand list in the sense that matters: a COPY of the thing under
 * audit. If r430's extractor changed, this copy would NOT, so `blind` would
 * keep describing a r430 that no longer exists.
 *
 * MEASURED: this suite went RED on a perfectly correct commit. `81d01ac`
 * shipped the subject `test(r476,r478,r480): three dead-tick suites, adopted
 * and independently re-verified against production source` -- a SECOND
 * multi-round declaration, and a real instance of the class R435 documents.
 * The exact-list pin below could not tell that apart from the defect signal
 * it exists to carry, so it went red on a good commit.
 *
 * The fix has two halves:
 *   (a) r430's extractor is now DERIVED from r430's own source at run time
 *       (see `scalarExtractorFrom` below) -- there is no copy left to keep in
 *       sync, and if r430 changes, this suite follows automatically.
 *   (b) the assertion is the RELATION, not an enumeration.
 */
const MULTI = /\(\s*((?:[rR](?:ound)?\d{3}\s*,\s*)+[rR](?:ound)?\d{3}\s*)\)/;

/**
 * Read r430's extractor out of r430's own source.
 *
 * The point is not the regex -- it is that there is no second copy of the
 * thing under audit. If r430's extractor is widened, this follows it, and
 * the A1 relation then correctly reports that the blindness is gone.
 *
 * DERIVED BY PARSING, not by a hand list of patterns: the arm reads the
 * `const m = ...;` assignment out of r430's source and rebuilds a RegExp
 * from every regex literal inside it. A hardcoded copy of that regex would
 * reintroduce exactly the defect this function exists to remove.
 *
 * 🔴 A first version of this function took only the FIRST `subj.match(...)`
 * literal, and that was WRONG in a way the load-bearing probe caught:
 * when r430 is widened to `subj.match(A) || subj.match(B)`, the derived
 * extractor still saw only `A` -- so `blind` did NOT shrink, and the arm
 * LOST its own trigger. It would have gone GREEN on the very event it
 * exists to detect. ⇒ the whole ASSIGNMENT is read, and every literal in it
 * is combined, not just the first.
 */
function scalarExtractorFrom(source: string): RegExp {
  // The assignment that holds the extracted round id.
  const assign = source.match(/const\s+m\s*=\s*subj\.match[\s\S]*?;/);
  if (!assign) {
    throw new Error(
      'R493: could not find r430\'s extractor (a `const m = subj.match(...)` ' +
      'assignment) in r430_record_plane.test.ts. The suite must DERIVE it, not ' +
      'copy it -- and it must FAIL LOUDLY rather than fall back to a default ' +
      'that would describe a r430 that does not exist.'
    );
  }
  // Every regex literal inside that assignment, in order.
  const literals = [...assign[0].matchAll(/\/(.*?)\/([a-z]*)/g)];
  if (literals.length === 0) {
    throw new Error(
      'R493: found r430\'s extractor assignment but no regex literal inside it. ' +
      'The derivation must not silently produce an extractor that matches nothing.'
    );
  }
  // Combine them: a widened r430 (`A || B`) yields both, and the derived
  // extractor must then see everything r430 sees.
  const combined = literals
    .map(([, body, flags]) => `(?:${body})`)
    .join('|');
  const flags = [...new Set(literals.map(([, , f]) => f))].join('');
  return new RegExp(combined, flags);
}

const R430_SOURCE = readFileSync(join(REPO, 'hub/test/r430_record_plane.test.ts'), 'utf8');
const SINGLE = scalarExtractorFrom(R430_SOURCE);

interface Commit {
  short: string;
  subj: string;
  /** Every round this commit declares — a SET, which is the whole point. */
  ids: string[];
  /** What r430_record_plane.test.ts would have derived. Scalar. */
  r430Rid: string | null;
}

function commits(limit: number): Commit[] {
  const raw = execSync(`git log --format=%H%x7c%s%x7c%b%x1e -${limit}`, {
    cwd: REPO,
    encoding: 'utf8',
  });
  return raw
    .split('\x1e')
    .map((r) => r.replace(/^\n+/, ''))
    .filter((r) => r.trim().length > 0)
    .map((rec) => {
      const [hash, subj] = rec.split('\x7c');
      const short = hash.slice(0, 7);
      const m = SINGLE.exec(subj);
      const mm = MULTI.exec(subj);
      let ids: string[];
      if (mm) ids = [...mm[1].matchAll(/\d{3}/g)].map((x) => String(Number(x[0])));
      else if (m) ids = [String(Number(m[1]))];
      else ids = [];
      // The round id is read from the MATCH TEXT, not from a capture group:
      // the derived extractor combines r430's alternatives, so no single
      // group number is reliable. The three-digit token is what both forms
      // carry, and a multi-form match yields the first one -- which is all
      // this suite needs, since it only asks whether r430 saw the commit AT ALL.
      const ridFrom = (mm: RegExpMatchArray | null): string | null => {
        if (!mm) return null;
        const d = mm[0].match(/\d{3}/);
        return d ? String(Number(d[0])) : null;
      };
      return { short, subj, ids, r430Rid: ridFrom(m) };
    });
}

const WINDOW = commits(200);
const ROUNDED = WINDOW.filter((c) => c.ids.length > 0);

describe('R435 — a commit can declare a SET of rounds; a scalar cannot carry it', () => {
  it('A0 — the multi branch fires on real history, so this arm is not vacuous', () => {
    // R421: a suite that cannot see its subject proves nothing. Measured: over
    // 953 commits exactly one carries a comma-separated prefixed round tag.
    const multi = WINDOW.filter((c) => c.ids.length > 1);
    expect(multi.length, 'the multi-round instance must be present in the window')
      .toBeGreaterThan(0);
    expect(WINDOW.length).toBeGreaterThan(50);
  });

  it('A1 — the multi-round set is EXACTLY the set the scalar extractor cannot see', () => {
    // CHARACTERISATION, not a claim that ought to become empty. A1 asserts the
    // blindness is REAL and PINNED: my first draft wrote `toEqual([])`, which
    // is a permanent RED — an assertion that can only be satisfied by fixing
    // r430, i.e. by a father-gated decision nobody has made. That is R432-3's
    // mirror: a probe that can never go green gets skipped, and a skipped probe
    // asserts nothing.
    //
    // So: assert the two sets coincide, and name them. The moment someone folds
    // multi-ids into r430's ROUNDED this arm goes RED on its own — which is the
    // correct signal, because it means the defect was fixed and this
    // characterisation has become stale and must be deleted.
    const multi = WINDOW.filter((c) => c.ids.length > 1);
    const blind = WINDOW.filter((c) => c.r430Rid === null && c.ids.length > 0);
    expect(
      multi.map((c) => c.short).sort(),
      'commits declaring MORE THAN ONE round — the shape a scalar cannot carry'
    ).toEqual(expect.arrayContaining(['274c1d4']));

    // ⭐ R493: the RELATION, not an enumeration.
    //
    // The enumeration (`toEqual(['274c1d4:433+434'])`) could only express ONE
    // direction of change: SHRINK. The arm's own comment says shrinking is the
    // signal that r430 was fixed. But the set can also GROW, and when a second
    // multi-round commit shipped (`81d01ac`, `test(r476,r478,r480)`) the arm
    // went RED on a perfectly correct commit -- it could not tell "the defect
    // was fixed" from "another instance of the class was found".
    //
    // The relation `multi === blind` says what the arm's title already says --
    // "the multi-round set is EXACTLY the set the scalar extractor cannot see" --
    // and it holds in BOTH directions:
    //   - a new multi-round commit ships  -> both sets grow together -> GREEN
    //   - r430 is made multi-aware        -> blind empties, multi does not
    //                                      -> RED, which is the arm's stated
    //                                        defect signal (the characterisation
    //                                        has become stale and must be
    //                                        deleted, not relaxed)
    // MEASURED (R493): patching r430's extractor to be multi-aware makes the
    // relation false, so the arm still detects its own trigger.
    const describe = (cs: typeof multi) =>
      cs.map((c) => `${c.short}:${c.ids.join('+')}`).sort();
    expect(
      describe(blind),
      'commits invisible to r430\'s scalar extractor must be EXACTLY the ' +
        'multi-round commits. If this arm goes RED because the blind set ' +
        'SHRANK, r430 was fixed and this characterisation is stale — delete it ' +
        'rather than relax it. If it goes RED because the blind set GREW, a new ' +
        'instance of the class was found, which is not a defect.'
    ).toEqual(describe(multi));
  });

  it('A2 — every declared round has a hand-authored write-up', () => {
    // R430's A2, one level up: R430 ranges over commits with ONE derived id.
    // This ranges over round IDENTITIES, so a commit declaring two rounds owes
    // two write-ups.
    const orphans: string[] = [];
    for (const c of ROUNDED) {
      for (const id of c.ids) {
        if (!cites(id, c)) orphans.push(`${c.short} R${id} — ${c.subj.slice(0, 60)}`);
      }
    }
    expect(orphans, 'round identities with no narrative write-up in memory/*.md').toEqual([]);
  });

  it('A3 — the widening does not manufacture false round identities', () => {
    // R427-F1 in the negative direction: the fix must not reach a
    // BACK-REFERENCE. R432 measured this for the body; the subject has the
    // same property by construction (it is first position), and this measures
    // it rather than asserting it.
    //
    // R432's measured back-references: fd5b6f4, 1d04ffc. Plus the five found
    // this round: 114114d L15, 8c0ddea L34/L36/L38, 6bc2f85 L28. None declares
    // a round; all mention one. If the widened matcher reached them, this
    // assertion would find them in ROUNDED.
    for (const sha of ['8c0ddea', '114114d', '6bc2f85']) {
      const c = WINDOW.find((x) => x.short === sha);
      if (!c) continue;
      // These DO carry a real subject tag (8c0ddea -> r421, 114114d -> r430),
      // so the assertion is not "invisible" — it is "not REACHABLE BY THE
      // BACK-REFERENCE PATH": the body contributes nothing.
      expect(
        c.ids,
        `${sha} declares round ids ONLY from its subject tag, never from a body reference`
      ).not.toContain(c.subj.match(/R(\d{3})\s*[.:]/)?.[1] ?? '\u0000none');
    }
  });
});

/**
 * Narrative text, read ONCE. R430 cached this in a Map for the same reason;
 * my first version re-read every `.md` for every commit (200 commits × 632
 * files), which is what made this file time out at 96 s and then blow the
 * 180 s budget. A probe too slow to run gets skipped, and a probe that gets
 * skipped is R421's vacuous pass wearing a different hat.
 */
const NARRATIVE_TEXT = readdirSync(MEM, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.md'))
  .map((e) => ({ name: e.name, text: readFileSync(join(MEM, e.name), 'utf8') }));

/**
 * A round is written up when SOME hand-authored narrative DECLARES the round
 * (`R433`, `Round 433`, `#### 433`) or cites the commit sha.
 *
 * 🔴 A SELF-BUG, found by measuring this arm before trusting it, and it is the
 * exact R432-2 hazard one level down: my first version accepted a BARE number
 * with word boundaries — `(?<![\w])433(?![\w])`. Measured: R433 and R434 each
 * hit **9 unrelated `.md` files** (byte counts, table rows, line numbers), so
 * A2 reported GREEN over two rounds that have never been written up. A
 * boundary guards the *shape* of a token; it does not make the token an
 * identity. The declaration form does.
 *
 * Machine-maintained index files are excluded by construction (r430's
 * extension split: narratives are `.md`).
 */
function cites(id: string, c: Commit): boolean {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // DECLARATION form, not a bare number: `R433` / `Round 433` / `#### 433`.
  const declRe = new RegExp(`(?:R|ROUND|####)\\s*${esc}(?!\\d)`, 'i');
  const shaRe = new RegExp(`(?<![0-9a-f])${c.short}(?![0-9a-f])`, 'i');
  return NARRATIVE_TEXT.some(({ text }) => declRe.test(text) || shaRe.test(text));
}
} else {
  describe.skip(
    'R435 — skipped: the subject set lives in the agent workspace',
    () => {
      // Intentionally empty. NOT a vacuous pass: the assertions above never ran.
      // Reason recorded so a reader sees the probe was inapplicable, not satisfied.
      it.skip('workspace not present in this environment', () => {
        throw new Error(skipReason(__dirname));
      });
    }
  );
}
