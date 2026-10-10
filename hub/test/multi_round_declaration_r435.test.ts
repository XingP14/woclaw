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

function findWorkspace(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'LEARNING_PLAN.md')) && existsSync(join(dir, 'memory'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(
    'R435: could not derive the workspace root. Refusing to pass vacuously — a probe ' +
      'that cannot find its subject set is indistinguishable from one that found nothing.'
  );
}

const WS = findWorkspace();
const MEM = join(WS, 'memory');
const REPO = join(WS, 'woclaw');

/**
 * Subject round-tags, MULTI-aware. Deliberately two branches, not one regex
 * with `g`, because a single capture group can only carry one id and the
 * defect is precisely that a scalar cannot carry the answer.
 */
const SINGLE = /\((?:round|r)?(\d{3})\)/i;
const MULTI = /\(\s*((?:[rR](?:ound)?\d{3}\s*,\s*)+[rR](?:ound)?\d{3}\s*)\)/;

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
      return { short, subj, ids, r430Rid: m ? String(Number(m[1])) : null };
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
    expect(
      blind.map((c) => `${c.short}:${c.ids.join('+')}`).sort(),
      'commits invisible to r430\'s scalar extractor. If this list SHRINKS, r430 was ' +
        'fixed and this characterisation is stale — delete it rather than relax it.'
    ).toEqual(['274c1d4:433+434']);
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
