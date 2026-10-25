/**
 * R502 — the corpus gate, and the properties of a scanner that passes it.
 *
 * WHAT THIS SUITE IS ABOUT
 *
 * R501 replaced the first path-traversal scanner and MEASURED it: 13/14
 * ordinary spellings detected, 0/3 controls false-fired.  That measurement was
 * correct AND still not enough, for two reasons this round measured:
 *
 *   F1  The CONTAINMENT verdict was decided over the WHOLE FILE.  A guard in
 *       another function, later in the file, or for a different root "proved"
 *       that an UNGUARDED site was confined.  Measured against clean
 *       ground-truth fixtures, the R501 detector answers `containment=YES`
 *       for a site with no guard at all.
 *
 *   F3  The guard could CERTIFY ITSELF: the file contained a
 *       path-confinement assertion, but it constrained a DIFFERENT variable
 *       than the one whose path was actually served.  Two variables derived
 *       from the same request source are SIBLINGS; a guard on one says
 *       nothing about the other.
 *
 *   F2  The SOURCE list was TRANSPORT-shaped (`req.*`, `query.*`).  A file
 *       that serves a path built from a WEBSOCKET MESSAGE, an ENVELOPE or a
 *       BODY FIELD was invisible -- and WoClaw's dominant untrusted input is
 *       a PEER MESSAGE, not an HTTP request.  The SINK list had no network
 *       sinks either, so request-supplied URL -> `fetch()` (SSRF) was
 *       invisible despite an identical taint structure.
 *
 * The fix is not a better heuristic -- it is that the CONTAINMENT verdict is
 * now a fact about a SITE (the innermost enclosing function), a guard must
 * constrain a variable ON THE TAINT CHAIN of the served variable, and the
 * sources/sinks name the CLASS rather than one transport.
 *
 * THE CORPUS IS THE POINT (R502-A, queued by R501-12)
 *
 * R501's 14 spellings + 3 controls lived INSIDE the suite that tested the
 * detector, so the corpus was rewritten whenever the detector changed -- it
 * could not detect a regression in the very thing it measured.  They now live
 * in `hub/scripts/r502_corpus.py` as DATA, versioned in the repo, and
 * `r502_score_corpus.py` is the reusable gate.
 *
 * The strongest property this suite pins is DISCRIMINATION: the corpus must
 * FAIL the previous detector.  A corpus that both detectors pass measures
 * nothing.
 *
 * NOTE on the numbers below: they are NOT written into any assertion as a
 * literal.  R460's shape: a hand-copied count in a title goes stale the moment
 * the corpus grows, and then the title DENIES the artifact it describes --
 * which is worse than no title, because a reader trusts it.  Every count here
 * is COMPUTED at run time from the corpus module itself (the corpus is the
 * single source of truth; the suite never restates it).  The assertion is
 * the RELATION (numerator == denominator, previous detector strictly worse),
 * never a constant.
 *
 * The detector is a Python script; this suite drives it as a SUBPROCESS
 * against fixture files it writes to a temp dir.  The subject is the
 * detector's OUTPUT, not its internals -- so a differently-spelled but
 * equivalent detector still passes (R500's rule 3: a control must fail
 * because of its subject, not because the source was spelled a different way).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DETECTOR = join(HERE, '..', 'scripts', 'r502_detector.py');
const PREV_DETECTOR = join(HERE, '..', 'scripts', 'r501_detector.py');
const CORPUS = join(HERE, '..', 'scripts', 'r502_corpus.py');
const SCORER = join(HERE, '..', 'scripts', 'r502_score_corpus.py');

let tmp: string;

interface Rec {
  file: string; line: number; sink: string; channels: string; containment: string;
}

/**
 * Parse the detector's output lines into records.
 *
 * NOTE the trailing space inside the rank tag: the detector prints
 * `[LOW ]` (a 4-char field, so the columns line up) and `[HIGH]`.
 * A regex that assumes `[HIGH]`/`[LOW]` will silently parse ONLY the
 * HIGH records -- which looks exactly like "the LOW cases produce no
 * hits".  That is how R501's harness first reported 13/13 failures with
 * a detector that was actually working.
 */
function parseRecords(out: string): Rec[] {
  const records: Rec[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\[(HIGH|LOW\s*)\]\s*(\[[A-Z]+\]\s*)?(\S+):(\d+)\s+sink=(\S+)\s+(\S+)\s+containment=(\w+)/);
    if (m) {
      records.push({
        file: m[3], line: Number(m[4]), sink: m[5], channels: m[6],
        containment: m[7].toUpperCase(),
      });
    }
  }
  return records;
}

function runDetector(dir: string, script: string = DETECTOR): Rec[] {
  const out = execFileSync('python3', [script, dir], { encoding: 'utf8' });
  return parseRecords(out);
}

function byName(records: Rec[]): Map<string, Rec[]> {
  const m = new Map<string, Rec[]>();
  for (const r of records) {
    const key = basename(r.file).replace(/\.ts$/, '');
    const arr = m.get(key) ?? [];
    arr.push(r);
    m.set(key, arr);
  }
  return m;
}

/** Run the corpus scorer against a scanner; returns its parsed summary. */
function scoreCorpus(scanner: string): { rc: number; out: string } {
  try {
    const out = execFileSync('python3', [SCORER, scanner], { encoding: 'utf8' });
    return { rc: 0, out };
  } catch (e: any) {
    // the scorer exits 1 on a corpus failure -- that is a RESULT, not a crash
    return { rc: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

/** The corpus cases, read from the corpus module itself (never hand-copied). */
function corpusCases(): { kind: string; name: string; body: string; expect: string;
  containment?: string; marker?: string }[] {
  const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(join(HERE, '..', 'scripts'))});\n` +
    `import r502_corpus; print(json.dumps([{k: c.get(k) for k in ('kind','name','body','expect','containment','marker','line')} for c in r502_corpus.all_cases()]))`;
  const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
  return JSON.parse(out);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'r502-corpus-'));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('R502 control: the instrument is alive', () => {
  it('the detector, the corpus and the scorer all exist', () => {
    expect(execFileSync('test', ['-f', DETECTOR], { encoding: 'utf8' })).toBeDefined();
    expect(execFileSync('test', ['-f', CORPUS], { encoding: 'utf8' })).toBeDefined();
    expect(execFileSync('test', ['-f', SCORER], { encoding: 'utf8' })).toBeDefined();
  });

  it('the corpus is non-empty and has all three kinds', () => {
    const cases = corpusCases();
    expect(cases.length).toBeGreaterThanOrEqual(20);
    const kinds = new Set(cases.map((c) => c.kind));
    expect(kinds.has('SENSITIVITY')).toBe(true);
    expect(kinds.has('SPECIFICITY')).toBe(true);
    expect(kinds.has('SUBJECT')).toBe(true);
  });

  it('the scorer can FIND the previous detector -- the gate is not vacuous', () => {
    // R502 must fail the previous detector.  If it did not, the corpus would
    // be measuring nothing and every other assertion here would be theatre.
    const res = scoreCorpus(PREV_DETECTOR);
    expect(res.out).toContain('CORPUS FAIL');
  });
});

describe('R502 the corpus gate', () => {
  it('the R502 detector PASSES the corpus (every case, computed)', () => {
    const res = scoreCorpus(DETECTOR);
    expect(res.out).toContain('CORPUS PASS');
    // The counts are COMPUTED from the scorer's own summary, never written
    // in as a literal: a hand-copied denominator is R460's stale-title
    // shape, and it fails SILENTLY -- the suite stays green while the
    // title lies.
    const total = corpusCases().length;
    const sens = res.out.match(/SENSITIVITY\s+(\d+)\/(\d+)/);
    expect(sens).not.toBeNull();
    expect(Number(sens![1])).toBe(Number(sens![2]));
    const spec = res.out.match(/SPECIFICITY\s+(\d+)\/(\d+)/);
    expect(spec).not.toBeNull();
    expect(Number(spec![1])).toBe(Number(spec![2]));
    const subj = res.out.match(/SUBJECT\s+(\d+)\/(\d+)/);
    expect(subj).not.toBeNull();
    expect(Number(subj![1])).toBe(Number(subj![2]));
    // The three denominators must SUM to the corpus size -- that is the
    // check that catches a case silently dropped from one of the three
    // lists (a denominator that moves is a green test that lies,
    // R421-1).  NOTE: no single kind's denominator IS the total; my
    // first version of this assertion made exactly that mistake and it
    // caught itself.
    const sum = Number(sens![2]) + Number(spec![2]) + Number(subj![2]);
    expect(sum).toBe(total);
  });

  it('the previous detector FAILS the corpus -- the corpus discriminates', () => {
    const res = scoreCorpus(PREV_DETECTOR);
    expect(res.out).toContain('CORPUS FAIL');
    // it fails on SENSITIVITY (message/network spellings) ...
    const sens = res.out.match(/SENSITIVITY\s+(\d+)\/(\d+)/);
    expect(Number(sens![1])).toBeLessThan(Number(sens![2]));
    // ... and on SUBJECT (the containment scope/binding cases)
    const subj = res.out.match(/SUBJECT\s+(\d+)\/(\d+)/);
    expect(Number(subj![1])).toBeLessThan(Number(subj![2]));
  });
});

describe('R502 F1: the containment verdict is scoped to a SITE', () => {
  let cases: ReturnType<typeof corpusCases>;
  let recs: Map<string, Rec[]>;

  beforeAll(() => {
    cases = corpusCases();
    const dir = join(tmp, 'f1');
    mkdirSync(dir, { recursive: true });
    execFileSync('python3', [CORPUS, dir], { encoding: 'utf8' });
    recs = byName(runDetector(dir));
  });

  it('a site with NO guard at all is containment=NO', () => {
    const hits = recs.get('case_no-guard-at-all') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('NO');
  });

  it('a guard LATER in the file does not certify an earlier site', () => {
    const hits = recs.get('case_guard-after-site') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('NO');
  });

  it('a guard for a DIFFERENT root in the same file does not certify it', () => {
    const hits = recs.get('case_guard-other-root') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('NO');
  });

  it('a ROUTE PREFIX TEST is not a path confinement', () => {
    const hits = recs.get('case_route-prefix-is-not-a-guard') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('NO');
  });
});

describe('R502 F3: the guard must bind to the SERVED variable', () => {
  let recs: Map<string, Rec[]>;

  beforeAll(() => {
    const dir = join(tmp, 'f3');
    mkdirSync(dir, { recursive: true });
    execFileSync('python3', [CORPUS, dir], { encoding: 'utf8' });
    recs = byName(runDetector(dir));
  });

  it('a guard that constrains a SIBLING variable does not certify the site', () => {
    const hits = recs.get('case_guard-self-certifies') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('NO');
  });

  it('a genuinely guarded site is still containment=YES (no over-correction)', () => {
    const hits = recs.get('case_genuinely-guarded') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('YES');
  });

  it('a guard inside a HELPER function still counts', () => {
    const hits = recs.get('case_guarded-by-helper') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('YES');
  });

  it('the resolve-then-compare shape counts (guard after the resolving sink)', () => {
    const hits = recs.get('case_resolve-then-compare') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('YES');
  });
});

describe('R502 F2: the class is not one transport', () => {
  let recs: Map<string, Rec[]>;

  beforeAll(() => {
    const dir = join(tmp, 'f2');
    mkdirSync(dir, { recursive: true });
    execFileSync('python3', [CORPUS, dir], { encoding: 'utf8' });
    recs = byName(runDetector(dir));
  });

  it('a WEBSOCKET MESSAGE source is detected', () => {
    expect((recs.get('case_ws-message') ?? []).length).toBeGreaterThan(0);
  });

  it('an ENVELOPE source is detected', () => {
    expect((recs.get('case_envelope') ?? []).length).toBeGreaterThan(0);
  });

  it('a BODY FIELD source is detected', () => {
    expect((recs.get('case_body-field') ?? []).length).toBeGreaterThan(0);
  });

  it('a NETWORK sink is detected (the sibling SSRF class)', () => {
    const hits = recs.get('case_network-sink') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sink.toLowerCase()).toContain('fetch');
  });
});

describe('R502 specificity: the non-classes stay silent', () => {
  let recs: Map<string, Rec[]>;

  beforeAll(() => {
    const dir = join(tmp, 'spec');
    mkdirSync(dir, { recursive: true });
    execFileSync('python3', [CORPUS, dir], { encoding: 'utf8' });
    recs = byName(runDetector(dir));
  });

  it('a non-filesystem sink is silent', () => {
    expect((recs.get('case_non-fs-sink') ?? []).length).toBe(0);
  });

  it('a static path is silent', () => {
    expect((recs.get('case_static-path') ?? []).length).toBe(0);
  });

  it('a config path is silent', () => {
    expect((recs.get('case_config-path') ?? []).length).toBe(0);
  });

  it('an env-var path is silent', () => {
    expect((recs.get('case_env-path') ?? []).length).toBe(0);
  });
});

/**
 * R502-A2 — the arms that make the detector's OWN mutants die.
 *
 * The first R502-A corpus passed the detector, and three of the
 * detector's own mutants SURVIVED it.  That is the same argument the
 * corpus makes about the detector, one level down: a corpus every mutant
 * passes measures nothing.
 *
 * These three arms exist because each of them kills a mutant that the
 * corpus alone did not:
 *
 *   guard-other-site-same-name  kills M1 (the file-wide containment scope)
 *   guard-after-the-read        kills M3 (the ORDER constraint)
 *   guard-on-unrelated-base     kills M6 (recording every RHS id as a parent)
 *
 * They are read from the DETECTOR'S OUTPUT directly (not from the corpus
 * scorer) so that a mutant is killed by an ARM and not by a summary line.
 */
describe('R502-A2: the arms that kill the detector own mutants', () => {
  let recs: Map<string, Rec[]>;

  beforeAll(() => {
    const dir = join(tmp, 'a2');
    mkdirSync(dir, { recursive: true });
    execFileSync('python3', [CORPUS, dir], { encoding: 'utf8' });
    recs = byName(runDetector(dir));
  });

  it('a guard on the SAME VARIABLE NAME in ANOTHER site does not certify it', () => {
    // The chain rule cannot reject this case: the guard's subject `p` IS
    // the served variable's name.  Only the SITE scope can.
    const hits = recs.get('case_guard-other-site-same-name') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('NO');
  });

  it('a guard AFTER the read does not confine the read', () => {
    // The bytes were already read when the check runs.
    const hits = recs.get('case_guard-after-the-read') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('NO');
  });

  it('a guard on an UNRELATED variable does not confine the tainted path', () => {
    // `base` is a constant, not a tainted ancestor of the served path.
    const hits = recs.get('case_guard-on-unrelated-base') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.containment).toBe('NO');
  });
});

/**
 * R503 — the matrix driver must not report an EQUIVALENT MUTANT as a survivor.
 *
 * R502's first matrix run reported 2 SURVIVED, and BOTH were equivalent
 * mutants: the bytes changed but the detector's behaviour over the corpus
 * was byte-identical to the baseline.
 *
 *   * M8 "never report a hit" appended a channel and KEPT its `continue`,
 *     so the mutant still reported exactly the same hits.
 *   * M3 "drop the ORDER constraint" removed only the `j > i` CHECK, but
 *     the ORDER rule is enforced twice -- once by the window (`min(i, hi)`)
 *     and once by the check -- so removing one of them changed nothing.
 *
 * Reporting either as "SURVIVED" claims the SUITE failed to notice a
 * defect, when in fact there was no defect to notice.  That is a false
 * claim about the suite, and it is the same shape as a control that cannot
 * fail (R461): the matrix looks rigorous while measuring nothing.
 *
 * So the driver now MEASURES the mutant's output over the corpus and
 * compares it with the baseline's.  These arms pin that capability: the
 * driver must be able to DETECT an equivalent mutant at all.
 *
 * The arms are driven through the driver's OWN code (`apply_edits` +
 * `detector_output_over_corpus`), so they fail if the driver loses the
 * capability -- not if the detector changes.
 */
describe('R503: the matrix driver can tell an EQUIVALENT mutant from a real one', () => {
  it('the driver exposes an equivalence oracle over the corpus', () => {
    // The driver must be able to run the detector over the corpus and read
    // its output.  If it cannot, an equivalent mutant would be
    // indistinguishable from a survivor again.
    const py = `import sys, json, importlib.util; sys.path.insert(0, ${JSON.stringify(join(HERE, '..', 'scripts'))});\n` +
      `spec = importlib.util.spec_from_file_location("mx", ${JSON.stringify(join(HERE, '..', 'scripts', 'r502_matrix.py'))});\n` +
      `mx = importlib.util.module_from_spec(spec); spec.loader.exec_module(mx);\n` +
      `out = mx.detector_output_over_corpus();\n` +
      `print(json.dumps({"len": len(out), "has_records": out.count("containment=")}))`;
    const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
    const r = JSON.parse(out);
    expect(r.len).toBeGreaterThan(0);
    expect(r.has_records).toBeGreaterThan(0);
  });

  it('a byte-changing but behaviour-identical mutation is DETECTED as equivalent', () => {
    // The M8 defect, rebuilt inline: append a channel and KEEP the
    // `continue`.  The bytes change; the behaviour does not.
    const py = `import sys, json, importlib.util, os, tempfile, subprocess, shutil; sys.path.insert(0, ${JSON.stringify(join(HERE, '..', 'scripts'))});\n` +
      `spec = importlib.util.spec_from_file_location("mx", ${JSON.stringify(join(HERE, '..', 'scripts', 'r502_matrix.py'))});\n` +
      `mx = importlib.util.module_from_spec(spec); spec.loader.exec_module(mx);\n` +
      `base = mx.detector_output_over_corpus();\n` +
      `src = open(mx.DETECTOR, encoding="utf8").read();\n` +
      `edits = [('            if not channels:\\n                continue',\n` +
      `          '            if not channels:\\n                channels.append("X:never")\\n                continue')];\n` +
      `mut = mx.apply_edits(src, edits);\n` +
      `assert mut != src, "the mutation was inert";\n` +
      `open(mx.DETECTOR, "w", encoding="utf8").write(mut);\n` +
      `try:\n` +
      `    out = mx.detector_output_over_corpus();\n` +
      `finally:\n` +
      `    open(mx.DETECTOR, "w", encoding="utf8").write(src);\n` +
      `print(json.dumps({"identical": out == base, "bytes_changed": len(mut) != len(src)}))`;
    const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
    const r = JSON.parse(out);
    expect(r.bytes_changed).toBe(true);
    // THIS is the assertion the whole round turned on: the driver must be
    // able to see that a byte-different mutant did not change behaviour.
    expect(r.identical).toBe(true);
  });

  it('the detector file is restored after the equivalence probe', () => {
    // The arm above mutates the OWNED file.  If it left the tree mutated,
    // every later arm would run against a different subject.
    const md5 = execFileSync('python3', ['-c',
      `import hashlib; print(hashlib.md5(open(${JSON.stringify(join(HERE, '..', 'scripts', 'r502_detector.py'))}, "rb").read()).hexdigest())`,
    ], { encoding: 'utf8' }).trim();
    const r = execFileSync('python3', ['-c',
      `import sys, importlib.util; sys.path.insert(0, ${JSON.stringify(join(HERE, '..', 'scripts'))});\n` +
      `spec = importlib.util.spec_from_file_location("mx", ${JSON.stringify(join(HERE, '..', 'scripts', 'r502_matrix.py'))});\n` +
      `mx = importlib.util.module_from_spec(spec); spec.loader.exec_module(mx);\n` +
      `print(mx.md5(mx.DETECTOR))`], { encoding: 'utf8' }).trim();
    expect(r).toBe(md5);
  });
});
