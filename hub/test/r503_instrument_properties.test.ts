/**
 * R503 — the INSTRUMENT's properties, and the two things this round found.
 *
 * WHERE THIS COMES FROM
 * ---------------------
 * R501 replaced the first scanner for "a request-derived string reaches a
 * filesystem sink" and MEASURED it (13/14 spellings, 0/3 controls).  R502
 * productised that corpus into a permanent, versioned, detector-independent
 * fixture corpus -- R501-12's queued item -- and R502's own measurements
 * found two defects in the detector the corpus could not see:
 *
 *   F1  the CONTAINMENT verdict was decided over the WHOLE FILE, so a guard
 *       in another function / another root / a later line "confirmed" a site
 *       that had no guard at all;
 *   F2  the SOURCE list was TRANSPORT-shaped (`req.*` only), so a path built
 *       from a peer MESSAGE or a REQUEST BODY was invisible -- and WoClaw's
 *       dominant untrusted input is a peer message, not an HTTP request.
 *
 * R502's detector (r502_detector.py) fixes both, and R502's matrix shows
 * 8/8 mutations KILLED.
 *
 * R503's question is the one R502 left open: DOES A CORPUS DISTINGUISH A
 * SCANNER THAT KNOWS THE CLASS FROM ONE THAT HAS MEMORISED THE CORPUS?
 *
 * The measured answer is NO for a LIST: `r503_memorizer.py` -- a scanner
 * with no notion of taint, sites, roots or sinks, carrying only a lookup
 * table from a case's identity to its verdict -- PASSES the fixed corpus
 * 31/31.
 *
 * So the corpus's unit of truth has to become a GENERATOR, not a list.
 * This suite pins the properties of that instrument, and it pins the two
 * findings this round produced about the obvious repair.
 *
 * WHAT THIS SUITE IS ABOUT
 * -----------------------
 *   1. INSTRUMENT   -- a memoriser must PASS the fixed list corpus and
 *                      FAIL the generated one.  A corpus both pass is not
 *                      a measuring instrument.
 *   2. CORPUS TRUTH -- the corpus's ground truth must be DERIVED from the
 *                      emitted code, and the ORDER rule must be scoped to
 *                      the sink KIND (R503-C: a RESOLVING sink does not
 *                      open content, so resolve-then-compare is correct).
 *   3. THE OVER-TAINT -- the obvious repair for the source enumeration
 *                      ("every field of every parameter is a source") must
 *                      be shown to OVER-TAIN: it fixes the sensitivity and
 *                      it also reports the MODEL'S API BASE URL as an SSRF.
 *
 * Point 3 is the round's actual finding, and it is a NEGATIVE result: the
 * obvious repair is a WIDENING, not a fix.  The next step is a TRUST
 * distinction -- a value that crossed a REQUEST BOUNDARY -- not a wider
 * vocabulary.
 *
 * The subject of every arm is the OUTPUT of the scripts under test, so an
 * equivalently-spelled but differently-implemented instrument still passes
 * (R500's rule 3).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..', 'scripts');

const CORPUS = join(SCRIPTS, 'r502_corpus.py');
const GENERATOR = join(SCRIPTS, 'r503_generator.py');
const MEMORIZER = join(SCRIPTS, 'r503_memorizer.py');
const SCORER = join(SCRIPTS, 'r502_score_corpus.py');
const OVERFIT = join(SCRIPTS, 'r503_overfit_probe.py');
const AUDIT = join(SCRIPTS, 'r503_audit_truth.py');

function py(args: string[], timeout = 600000): { code: number; out: string; err: string } {
  try {
    const out = execFileSync('python3', args, { encoding: 'utf-8', timeout });
    return { code: 0, out, err: '' };
  } catch (e: any) {
    return {
      code: e.status ?? 1,
      out: (e.stdout ?? '') + '',
      err: (e.stderr ?? '') + '',
    };
  }
}

describe('R503 — the corpus must be an INSTRUMENT, not a list', () => {
  let fixedOut = '';
  let genOut = '';
  let probeOut = '';

  beforeAll(() => {
    // The overfit probe measures all four facts at once and prints a
    // table; its exit code is 0 iff every fact holds.
    const r = py([OVERFIT], 900000);
    probeOut = r.out + r.err;
    fixedOut = probeOut;
    genOut = probeOut;
  }, 900000);

  it('the memoriser PASSES the FIXED list corpus (a list cannot tell memorisation from capability)', () => {
    // FACT 1 -- this is the finding that motivates the whole round.
    expect(probeOut).toMatch(/PASS\s+FACT 1/);
    const row = probeOut.split('\n').find((l) => l.includes('r503_memorizer'));
    expect(row).toBeTruthy();
    expect(row).toMatch(/SENSITIVITY 16\/16/);
    expect(row).toMatch(/SPECIFICITY 4\/4/);
    expect(row).toMatch(/SUBJECT 11\/11 PASS/);
  });

  it('the memoriser FAILS the GENERATED corpus (a generator outruns any finite table)', () => {
    // FACT 2 -- the generated corpus is the instrument.
    expect(probeOut).toMatch(/PASS\s+FACT 2/);
    const row = probeOut.split('\n').find((l) => l.includes('r503_memorizer'));
    expect(row).toMatch(/SUBJECT 0\/60 FAIL/);
  });

  it('the OLD detector still FAILS the generated corpus (it still discriminates)', () => {
    // FACT 4 -- the new corpus did not accidentally stop discriminating.
    expect(probeOut).toMatch(/PASS\s+FACT 4/);
    const row = probeOut.split('\n').find((l) => l.includes('r501_detector'));
    expect(row).toMatch(/SUBJECT 6\/60 FAIL/);
  });

  it('FACT 3 is RED and stays recorded as RED (the real detector does not yet pass the generated corpus)', () => {
    // FACT 3 is the OPEN item: the generated corpus exposes a source
    // enumeration the fixed corpus cannot see, and the obvious repair
    // over-taints (see the last describe block).  This arm asserts the
    // truth as it stands -- the suite must not quietly rewrite a RED fact
    // into a PASS, and must not fail the build over it either: the point
    // is that the fact is ON THE RECORD and VISIBLE.
    expect(probeOut).toMatch(/FAIL\s+FACT 3/);
    const row = probeOut.split('\n').find((l) => l.includes('r502_detector'));
    expect(row).toBeTruthy();
    // and it is a partial, not a zero: the detector passes SOME of the
    // generated corpus, so the instrument is usable as a measuring stick.
    const m = row!.match(/SUBJECT (\d+)\/60 FAIL/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![1])).toBeLessThan(60);
  });
});

describe('R503-C — the corpus ground truth is DERIVED, and the ORDER rule is scoped to the sink kind', () => {
  let auditOut = '';
  let auditErr = '';

  beforeAll(() => {
    const r = py([AUDIT], 900000);
    auditOut = r.out;
    auditErr = r.err;
  }, 900000);

  it('the generated corpus ground truth is CONSISTENT with the code it emits (0 mismatches)', () => {
    // The corpus's verdict must come from the emitted code, never from the
    // label.  `r503_audit_truth.py` re-derives every verdict from the file
    // on disk and compares.
    expect(auditErr).not.toMatch(/Traceback/);
    expect(auditOut).toMatch(/MISMATCHES:\s*0\s*\/\s*200/);
  });

  it('a RESOLVING sink is confined by a guard that FOLLOWS it (resolve-then-compare is the correct shape)', () => {
    // The R503-C defect: the corpus applied the ORDER rule to EVERY sink
    // kind, so it graded 15/200 cases against a rule that is wrong for a
    // resolving sink.  A resolving sink (realpathSync / statSync /
    // existsSync) produces a VALUE; it does not OPEN CONTENT, so the guard
    // that compares the value legitimately comes after it.
    const body = [
      "export function handler(req: any) {",
      "  const p = path.resolve(ROOT, req.url);",
      "  const real = fs.realpathSync(p);",
      "  if (!real.startsWith(ROOT + path.sep)) return null;",
      "  return real;",
      "}",
    ].join('\n');
    const pySrc = [
      'import sys',
      `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
      'import r503_generator as G',
      `body = ${JSON.stringify(body)}`,
      'marker = "fs.realpathSync(p)"',
      'print(G.derive_containment(body, marker))',
    ].join('\n');
    const tmp = mkdtempSync(join(tmpdir(), 'r503c-'));
    const f = join(tmp, 'probe.py');
    writeFileSync(f, pySrc, 'utf-8');
    const r = py([f]);
    expect(r.err).not.toMatch(/Traceback/);
    expect(r.out.trim()).toBe('YES');
  });

  it('a SERVING sink is NOT confined by a guard that FOLLOWS it (the order rule still binds there)', () => {
    // The other half of the scoping: the rule must not be weakened for
    // serving sinks.  A read that happens before the check is a read that
    // already happened.
    const body = [
      "export function handler(req: any) {",
      "  const p = path.join('/var/other', req.url);",
      "  const data = fs.readFileSync(p);",
      "  if (!p.startsWith(ROOT + path.sep)) return null;",
      "  return data;",
      "}",
    ].join('\n');
    const pySrc = [
      'import sys',
      `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`,
      'import r503_generator as G',
      `body = ${JSON.stringify(body)}`,
      'marker = "readFileSync(p)"',
      'print(G.derive_containment(body, marker))',
    ].join('\n');
    const tmp = mkdtempSync(join(tmpdir(), 'r503c2-'));
    const f = join(tmp, 'probe.py');
    writeFileSync(f, pySrc, 'utf-8');
    const r = py([f]);
    expect(r.err).not.toMatch(/Traceback/);
    expect(r.out.trim()).toBe('NO');
  });
});

describe('R503-B — the obvious repair OVER-TAINS (this round\'s negative result)', () => {
  let out = '';
  let err = '';

  beforeAll(() => {
    const r = py([join(SCRIPTS, 'r503_role_overtain.py')], 900000);
    out = r.out;
    err = r.err;
  }, 900000);

  it('the ROLE variant fixes the SENSITIVITY gap (the generated corpus score rises)', () => {
    expect(err).not.toMatch(/Traceback/);
    expect(out).toMatch(/GENERATED \(generator\)/);
    const base = out.split('\n').find((l) => l.trim().startsWith('baseline'));
    const role = out.split('\n').find((l) => l.trim().startsWith('role'));
    expect(base).toBeTruthy();
    expect(role).toBeTruthy();
    // The row carries BOTH corpora: "FIXED (list)" then "GENERATED
    // (generator)".  The row's SHAPE is "<fixed> <fixed-fail?> <generated>
    // <generated-fail?> <production>", so the GENERATED score is the
    // second number in the pair -- taking the first would read the FIXED
    // corpus's score.
    const genScore = (line: string) => {
      const m = line!.match(/(\d+)\/(\d+)\s+(?:PASS|FAIL)\s+(\d+)\/(\d+)/);
      if (!m) return -1;
      return Number(m[3]);
    };
    expect(genScore(base!)).toBeGreaterThan(-1);
    expect(genScore(role!)).toBeGreaterThan(genScore(base!));
  });

  it('the ROLE variant does NOT regress the FIXED corpus (the specificity arm is what a widening eats first)', () => {
    const role = out.split('\n').find((l) => l.trim().startsWith('role'));
    expect(role).toMatch(/31\/31 PASS/);
  });

  it('the ROLE variant OVER-TAINS on production: it reports a CONFIG-DERIVED value as an SSRF', () => {
    // This is the finding.  The role rule ("every field of every parameter
    // is a source") cannot tell an ATTACKER-CONTROLLED value from a
    // TRUSTED CONFIGURATION value, so the model's API base URL -- read
    // from the configs table -- is reported as an untrusted network sink.
    //
    // The arm asserts the OVER-TAINING happens (the count rises), and
    // that the extra hits name CONFIGURATION, not request input.  If a
    // future repair makes the role rule both sensitive AND trust-aware,
    // this arm will FAIL and must be re-adjudicated by a human.
    const base = out.split('\n').find((l) => l.trim().startsWith('baseline'));
    const role = out.split('\n').find((l) => l.trim().startsWith('role'));
    const hits = (line: string) => {
      const m = line!.match(/(\d+) hits \/ (\d+) files/);
      return m ? Number(m[1]) : -1;
    };
    expect(hits(role!)).toBeGreaterThan(hits(base!));

    const newHits = out
      .split('\n')
      .filter((l) => l.includes('apiBase') || l.includes('legacyPath')
                  || l.includes('otlp_sink') || l.includes('providers/ollama'));
    expect(newHits.length).toBeGreaterThan(0);
  });
});
