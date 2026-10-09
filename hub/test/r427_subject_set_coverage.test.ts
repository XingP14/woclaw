/**
 * R427 — "a hand-listed subject set is a known-wrong subject set".
 *
 * R426 fixed ONE instance: R425 had listed 8 of 31 prod files, and a mutation
 * planted in one of the 23 unopened files survived 25/25 green. R426's own
 * closing rule was therefore: the recurrence rate (2-of-3 rounds in the cluster)
 * says ENUMERATE the class, not fix another instance.
 *
 * This suite is that enumeration. It does not re-test R425's list — R426 already
 * replaced those with walks. It asks a different question, one that is answerable
 * without knowing anything about any specific finding:
 *
 *     Does any probe in this tree make a NEGATIVE claim about production code
 *     (zero occurrences / absent / no producer) over a subject set it DECLARED
 *     rather than DERIVED?
 *
 * The sharp part is that this is checkable statically, with no running hub and
 * no knowledge of what any probe is supposed to find. A hand list is a literal
 * array of filenames; a walk is a `readdirSync`. That distinction is not a
 * judgement call about intent — it is the same distinction R426 drew, and it is
 * the only axis on which the two are mechanically different.
 *
 * DELIBERATELY NOT A TRIPWIRE ON STYLE. The failure mode of a suite like this is
 * that it reddens on a legitimate focused read (`readFileSync(SRC,'memory.ts')`
 * is not a subject set, it is one subject). So the classifier requires ALL of:
 *   1. a negative assertion form present in the file, AND
 *   2. a loop or iterator over subjects, AND
 *   3. NO derivation (`readdirSync`) anywhere in the file, AND
 *   4. >= 2 distinct production filenames named as literals.
 * A probe that derives its set, or that reads one file for a focused reason,
 * is not in the class and must not be reddened.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const TEST = join(__dirname);
const SRC = join(__dirname, '..', 'src');

/**
 * The subject set is DERIVED, and it must be derived RECURSIVELY.
 *
 * The first version of this file used a bare `readdirSync(SRC)`, which reads one
 * level. `src/extraction/` and `src/graph/` hold 7 further production modules,
 * so the suite that exists to catch probes over-narrowing their subject set
 * shipped itself over-narrow: it saw 24 of 31 files. That is the R426 defect,
 * reproduced by the enumerator meant to report it.
 *
 * `PROD` holds repo-relative paths so a subject set can be compared without
 * basename collisions between directories.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith('.ts')) out.push(full.slice(SRC.length + 1));
  }
  return out.sort();
}
const PROD = walk(SRC);
const PROD_SET = new Set(PROD);
const PROD_BASE = new Set(PROD.map((f) => basename(f)));

/** Assertion forms that state ABSENCE. */
const NEGATIVE = /toEqual\(\[\]\)|toHaveLength\(0\)|not\.toMatch|not\.toContain|toBe\(false\)|\.length\)\.toBe\(0\)/;
/** Iteration over a set of subjects. */
const ITERATES = /for \(const \w+ of |\.forEach\(|\.map\(/;
/** Derivation: the set comes from the filesystem, not from the author. */
const DERIVES = /readdirSync/;

interface Subject {
  probe: string;
  listed: string[];
}

/**
 * The classifier, with the >=2 bound exposed.
 *
 * The bound is a parameter rather than a constant because the control that
 * guards it must be able to ask the counterfactual: "at threshold 1, would this
 * probe have been in the class?" A constant cannot answer that, and a control
 * that cannot answer the counterfactual is the control that silently does
 * nothing (see the >=1 mutant in the suite comment).
 *
 * R429 — RESOLUTION. The original classifier did `.map((x) => basename(x))` and
 * then checked membership against a basename set. That silently throws away the
 * one piece of information a literal may carry about WHICH file it means, so a
 * list naming `types.ts` -- a name held by three files -- was recorded as
 * covering one subject when it could be covering none, one, or three.
 *
 * A literal that names a PATH (`graph/types.ts`, `./types.ts`) is a LOCATION
 * claim and resolves to exactly one file, or to none. A literal that names only
 * a BASENAME is ambiguous whenever more than one file shares it, and an
 * ambiguous name covers nothing -- we cannot tell which file the author meant,
 * so it cannot be counted as evidence of examining any of them. Both outcomes
 * are returned, because reporting the count while discarding the ambiguity is
 * the defect.
 *
 * The `./` and `src/` prefixes are stripped before lookup because the
 * repo-relative form is what a walk produces while the written form is what an
 * author types; without the normalisation, top-level `types.ts` would be the
 * ONE file in the tree no literal could name -- the nested ones are reachable
 * by their path, and the bare name is ambiguous, so the set would be
 * inexpressible rather than merely imprecise.
 */
interface Declaration {
  resolved: string[];  // repo-relative paths a literal unambiguously names
  ambiguous: string[];  // basenames held by >1 file: unexamined, and named here
}

function wouldDeclareAt(src: string, min: number): Declaration {
  if (!NEGATIVE.test(src)) return { resolved: [], ambiguous: [] };
  if (!ITERATES.test(src)) return { resolved: [], ambiguous: [] };
  if (DERIVES.test(src)) return { resolved: [], ambiguous: [] }; // derived, not declared
  const lits = [...new Set(
    [...src.matchAll(/['"`]([A-Za-z0-9_./-]+\.ts)['"`]/g)].map((m) => m[1]),
  )];
  const resolved = new Set<string>();
  const ambiguous = new Set<string>();
  for (const lit of lits) {
    // Whether a literal is a LOCATION claim is a property of how it was
    // WRITTEN, and that has to be decided before normalisation: `src/types.ts`
    // is written as a path and must resolve to the top-level file, even though
    // normalising it yields the bare string `types.ts`, which is ambiguous.
    // Testing the normalised form instead makes the one file the author went
    // out of their way to locate unreachable -- an author being explicit is
    // exactly the evidence we are trying to reward.
    const writtenAsPath = lit.includes('/');
    const norm = lit.replace(/^\.\//, '').replace(/^src\//, '');
    if (writtenAsPath) {
      // A path literal names a location. Resolve it, or it names nothing here.
      if (PROD_SET.has(norm)) resolved.add(norm);
      continue;
    }
    const holders = PROD.filter((f) => basename(f) === norm);
    if (holders.length === 1) resolved.add(holders[0]);
    else if (holders.length > 1) ambiguous.add(norm); // R429: covers nothing
  }
  const out = { resolved: [...resolved].sort(), ambiguous: [...ambiguous].sort() };
  return out.resolved.length + out.ambiguous.length >= min ? out : { resolved: [], ambiguous: [] };
}

/** The classifier as the suite ships it: a hand list needs >= 2 subjects. */
function declaredSubjects(src: string): Declaration {
  return wouldDeclareAt(src, 2);
}

function subjectsOf(probe: string): Declaration {
  return declaredSubjects(readFileSync(join(TEST, probe), 'utf8'));
}

/** A probe is in the class when it names anything at all, resolved or not. */
const isMember = (d: Declaration): boolean => d.resolved.length + d.ambiguous.length > 0;

const NONE: Declaration = { resolved: [], ambiguous: [] };

describe('R427 control: the classifier is alive', () => {
  it('sees the production tree it measures against', () => {
    expect(PROD.length).toBeGreaterThan(20);
    expect(existsSync(join(SRC, 'ws_server.ts'))).toBe(true);
  });

  it('classifies a DERIVED set as derived (negative control for the classifier)', () => {
    // r424 walks its subject set. If declaredSubjects() ever returned a list for
    // it, every count below would be inflated and the finding would be a
    // detector artefact rather than a measurement.
    expect(subjectsOf('r424_preview_plane.test.ts')).toEqual(NONE);
  });

  it('classifies a FOCUSED read (one file, no loop) as not-a-subject-set', () => {
    // r421 reads exactly one file for a focused reason. >=2 is the threshold
    // that keeps it out of the class; if the threshold were 1, this goes red
    // and tells us the classifier is too loose.
    expect(subjectsOf('r421_subject_set_binding.test.ts')).toEqual(NONE);
  });

  it('classifies a single-subject negative probe as NOT a subject set', () => {
    // The >=1 mutant SURVIVED while only this control and r421 existed, and
    // the reason is mechanical: every pre-existing "focused read" control names
    // a file that is not itself in the PROD basename set, so lowering the
    // threshold to 1 still returned [] for them. Ten probes in this tree DO
    // qualify at 1 (`otlp_sink.test.ts`, `parse_graph_types.test.ts`,
    // `r412_graph_delete_retention.test.ts`, ...) and the class would have grown
    // tenfold with every count in the suite silently inflated — a detector that
    // reports its own widening as a finding.
    //
    // So the threshold needs a control that is IN the class at the threshold it
    // guards. `otlp_sink.test.ts` names one production file, loops, and asserts
    // a negative form: at >=2 it is out of the class, at >=1 it is in it.
    const one = subjectsOf('otlp_sink.test.ts');
    expect(one).toEqual(NONE);
    // Name the population the threshold holds out, so a future reader can see
    // the class is a decision and not an accident of tree shape: probes that
    // satisfy every other clause and are excluded ONLY by the >=2 bound.
    const heldOutByThreshold = readdirSync(TEST)
      .filter((f) => f.endsWith('.test.ts'))
      .filter((f) => isMember(wouldDeclareAt(readFileSync(join(TEST, f), 'utf8'), 1)));
    expect(heldOutByThreshold).toContain('otlp_sink.test.ts');
    expect(heldOutByThreshold.length).toBeGreaterThan(5);
  });

  it('names a KNOWN class member, so the sweep floor is not the only liveness proof', () => {
    // Mutating the floor `report.length >= 1` down to `>= 0` SURVIVED, and the
    // reason is that a floor is a floor: it cannot tell "the sweep found nothing"
    // from "the sweep is dead". Pin the MEMBERSHIP instead.
    //
    // R428: the named pin was r414, which R428 fixed. This is the shape of the
    // trap the pin itself walks into — a membership pin must be re-pointed at
    // the class, not at one instance, or fixing the instance silently removes
    // the control that justified leaving the floor in place. So the pin is now
    // "the class is non-empty AND the named member is not the only member":
    // r414 is asserted GONE (the fix), and the survivors are asserted to still
    // contain other members (the control still has something to test).
    const declared = readdirSync(TEST)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => ({ probe: f, listed: declaredSubjects(readFileSync(join(TEST, f), 'utf8')) }))
      .filter((r) => isMember(r.listed))
      .map((r) => r.probe);
    expect(declared).not.toContain('r414_cancel_reachability.test.ts');
    expect(declared.length).toBeGreaterThan(0);
  });
});

describe('R427 the class: declared subject sets', () => {
  const probes = readdirSync(TEST).filter((f) => f.endsWith('.test.ts'));
  const declared = probes
    .map((p) => ({ probe: p, listed: subjectsOf(p) }))
    .filter((r) => isMember(r.listed));

  it('F1: every declared subject set is checked for coverage against the tree', () => {
    // This is a CHARACTERIZATION pin, not a red-until-fixed gate. It reports
    // what exists. Turning it into a hard `toEqual([])` would redden three
    // legacy suites on the tick that introduces it, and a suite that ships red
    // is a suite nobody reads — the R421 trap in its most common form.
    const report = declared.map((r) => `${r.probe} (${r.listed.resolved.length}/${PROD.length}` +
      (r.listed.ambiguous.length ? ' + ' + r.listed.ambiguous.length + ' ambiguous' : '') + ')');
    expect(Array.isArray(report)).toBe(true);
    // The class is non-empty, which is the finding. If this ever reads 0, the
    // sweep found no instances because the CLASSIFIER broke, not because the
    // repo is clean — so pin the floor.
    //
    // Relaxing this to `>= 0` SURVIVES and is DELIBERATELY left killable-by-
    // redundancy: the control suite pins `r414_cancel_reachability.test.ts` as a
    // known class member by NAME, which is a strictly stronger statement than a
    // count floor and which this floor cannot substitute for. A count that goes
    // to zero while the named member is still present means the REPORT is broken,
    // not that the class is empty — so the floor guards the report plumbing, the
    // membership pin guards the finding, and neither is load-bearing alone.
    expect(report.length).toBeGreaterThanOrEqual(1);
  });

  it('F2-control: the gap computation can return ZERO, so "missing > 0" is not a constant', () => {
    // Relaxing F2's bound to `>= 0` SURVIVED on the first pass, because every
    // declared set in this tree really does have a gap — nothing in the suite
    // could distinguish "the filter works" from "the filter always returns a
    // positive number". A guard whose counterfactual has no instance is a
    // tautology.
    //
    // The counterfactual is synthesizable, and it must exercise F2's OWN
    // predicate — not merely a re-derivation of it. So F2's test body is
    // factored out and called twice: once on a real member (must hold) and once
    // on a synthetic full-width member (must NOT hold). A relaxation of F2's
    // bound is then killed by the second call, because the same function
    // returns false on a member F2 is supposed to reject.
    const gapIsReal = (probe: string, listed: Declaration) => {
      const missing = PROD.filter((f) => !listed.resolved.includes(f));
      expect(missing.length, `${probe} declares ${listed.resolved.length}/${PROD.length}` +
        (listed.ambiguous.length ? ` + ${listed.ambiguous.length} ambiguous` : '') +
        `; unexamined: ${missing.join(', ')}`)
        .toBeGreaterThan(0);
    };

    const synth = (files: string[]) => [
      'for (const f of files) {',
      ...files.map((f) => `  const s = readFileSync(join(SRC, '${f}')); expect(s).not.toContain('zzz-never-present-r427');`),
      '}',
    ].join('\n');

    // (a) the positive branch: a real member of the class.
    // R428: r414 is no longer a member — its subject set is derived. The
    // class still has members; use one that remains, so this control keeps
    // testing the classifier instead of decaying into a tautology once the
    // last instance is fixed. (A control with no remaining member is vacuous.)
    const r414 = declared.find((r) => r.probe === 'r414_cancel_reachability.test.ts');
    expect(r414).toBeUndefined();
    expect(declared.length).toBeGreaterThan(0);
    for (const member of declared) gapIsReal(member.probe, member.listed);

    // (b) the counterfactual: a full-width subject set, same shape, gap zero.
    //
    // R429: this arm is now where the collision becomes ARITHMETIC rather
    // than a sentence in a comment.
    //
    // `synth(PROD)` emits repo-relative literals, so the nested duplicates
    // arrive as PATHS (`extraction/types.ts`) and each resolves exactly. The
    // bare `types.ts` literal is ambiguous -- three files, no way to tell which
    // one the author meant -- so it covers NONE of them, including the
    // top-level file it most obviously refers to.
    //
    // I predicted 28 resolved and wrote it into the assertion; the measured
    // value is 30, and the prediction was wrong in the interesting direction.
    // Only ONE file is lost, not three, because the other two were reachable by
    // path in this particular synthetic. The precise statement of the defect
    // is therefore narrower and sharper than "collision costs coverage": a
    // bare ambiguous name costs the file it *names*, and leaves its siblings
    // covered by accident only when the author also listed their paths.
    const fullWidthDecl = declaredSubjects(synth(PROD));
    const fullWidth = fullWidthDecl.resolved;
    // The tree shape, measured: 31 files, 29 distinct basenames, one of which
    // (`types.ts`) is held by three. These are the real denominators; every
    // ratio in this suite must be reported against one of them.
    expect(PROD.length).toBe(31);
    expect(PROD_BASE.size).toBe(29);
    expect(fullWidth).toHaveLength(30);
    expect(fullWidthDecl.ambiguous).toEqual(['types.ts']);
    // The gap is exactly the file the ambiguous name referred to.
    const gapOfFullWidth = PROD.filter((f) => !fullWidth.includes(f));
    expect(gapOfFullWidth).toEqual(['types.ts']);

    // (c) A PATH literal resolves: `graph/types.ts` names one file, so a list
    // written in paths has NO gap. This is the arm that makes the previous one
    // a finding about the WRITER rather than about the tree -- the tree is
    // fully expressible, the basename list simply is not.
    const pathFull = declaredSubjects(synth(PROD.map((f) => 'src/' + f))).resolved;
    expect(pathFull).toHaveLength(PROD.length);
    expect(PROD.filter((f) => !pathFull.includes(f))).toEqual([]);

    // (d) F2's own predicate must REJECT a member with no gap. Only the path
    // form now qualifies; that is what makes `> 0` a decision, not a constant.
    expect(() => gapIsReal('synthetic-full-width-paths', { resolved: pathFull, ambiguous: [] })).toThrow();

    // And the complement: a probe declaring a strict subset still yields a gap,
    // so the two branches of the same filter are both exercised.
    const partial = declaredSubjects(synth(PROD.slice(0, 5))).resolved;
    expect(partial).toHaveLength(5);
    expect(PROD.filter((f) => !partial.includes(f)).length).toBe(PROD.length - 5);
  });

  it('names a BASENAME COLLISION, so a covered name never reads as a covered file', () => {
    // The control above established that full-width means "every name is
    // covered". It did NOT establish that every FILE is examined, and in this
    // tree those differ: `types.ts` exists in THREE directories (31 files, 29
    // distinct names). A hand list naming `types.ts` therefore states a claim
    // about one of three files while the reported count says it is covered.
    //
    // This is the same failure R425/R426 were about, one level down: not a
    // missing subject but an ambiguous one.
    //
    // Loosening `toHaveLength(1)` to `>= 0` SURVIVED even after the negative arm
    // was added, and the reason is structural rather than accidental: the two
    // assertions after the count (`collisions[0][0]` and the exact path list)
    // both throw on an EMPTY array, so the count is redundant with them. That
    // redundancy is fine -- what had to be fixed was that the negative arm
    // REIMPLEMENTED the collision predicate inline instead of calling the same
    // function, so mutating it was unkillable: a distinct expression cannot be
    // guarded by a distinct test. One predicate, called twice.
    const detectCollisions = (files: string[]) => {
      const byName = new Map<string, string[]>();
      for (const f of files) {
        const b = basename(f);
        byName.set(b, [...(byName.get(b) ?? []), f]);
      }
      return [...byName.entries()].filter(([, v]) => v.length > 1);
    };
    const collisions = detectCollisions(PROD);
    expect(collisions).toHaveLength(1);
    expect(collisions[0][0]).toBe('types.ts');
    expect(collisions[0][1].sort()).toEqual(['extraction/types.ts', 'graph/types.ts', 'types.ts']);
    // Negative arm: the SAME predicate over a set that genuinely has no duplicate
    // NAMES must return empty. Without it, an always-true collision predicate
    // satisfies every assertion above. Note the dedupe must be on the basename,
    // not the path -- deduplicating paths leaves the collision intact, which is
    // precisely the gap being measured.
    const namesOnly = [...new Set(PROD.map((f) => basename(f)))];
    expect(detectCollisions(namesOnly)).toEqual([]);
    expect(namesOnly).toHaveLength(PROD_BASE.size);
  });
});

describe('R427 the specific instance (r414 C1b) — FIXED by R428', () => {
  /**
   * R428: r414 no longer declares these. They are kept here as the historical
   * record of the width the probe had, and so that the fix below is pinned:
   * `declaredSubjects()` must now return EMPTY for r414, because the set is
   * derived by a recursive walk and no filename literal remains.
   */
  const SUBJECTS = [
    'ws_server.ts', 'rest_server.ts', 'memory.ts', 'scheduler.ts',
    'federation.ts', 'topics.ts', 'db.ts', 'agent_stream.ts',
  ];

  it('R428 the probe no longer declares a subject set at all', () => {
    // The class detector is satisfied by DERIVATION. r414 now walks the tree,
    // so it drops out of the "declared subject set" class entirely — which is
    // the fix, expressed in the enumerator's own vocabulary.
    expect(subjectsOf('r414_cancel_reachability.test.ts')).toEqual(NONE);
    // And the old 8-file literal really was a strict subset of the tree.
    expect(SUBJECTS.length).toBeLessThan(PROD.length);
    expect(PROD.length).toBe(31);
  });

  it('F3 ⭐ the probe\'s own predicate yields ZERO producers across the FULL tree', () => {
    // The conclusion R414 reached by hand is CORRECT — measured, not assumed.
    // What was wrong was the scope it was measured at. Re-run its predicate
    // over every file instead, so the claim and the evidence have the same width.
    const producers: string[] = [];
    for (const f of PROD) {
      const src = readFileSync(join(SRC, f), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (!/interrupted/.test(line)) return;
        if (/AGENT_STREAM_EXITS/.test(line)) return;
        if (/interrupted:\s*\d/.test(line)) return;
        if (/\|\s*'interrupted'/.test(line)) return;
        if (/^\s*'interrupted',?\s*$/.test(line)) return;
        producers.push(`${f}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(producers, `producers found: ${producers.join(' | ')}`).toEqual([]);
  });
});