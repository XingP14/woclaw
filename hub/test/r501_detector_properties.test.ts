/**
 * R501 — the detector's own properties.
 *
 * WHAT THIS SUITE IS ABOUT
 *
 * R497 (llm-benchmark) and R498b (woclaw) were the same defect class found by
 * hand in two repos in one tick: a request path joined onto a base directory,
 * then read -- an unauthenticated arbitrary file read that served the real
 * /etc/shadow.  LEARNING_PLAN.md 497b.11 queued the machine scan.
 *
 * A machine scan that finds nothing is only EVIDENCE if the scanner can find
 * the thing.  So this suite pins the scanner's two load-bearing properties:
 *
 *   1. SENSITIVITY     -- it must fire on the class in its ORDINARY spellings,
 *                         including the INLINE one that the previous scanner
 *                         (r498c_sweep.py) was blind to.
 *   2. SUBJECT-SENSITIVITY of the CONTAINMENT CLASSIFIER -- it must not
 *                         mistake a ROUTE PREFIX TEST for a path confinement.
 *
 * Property 2 is not hypothetical: measured, llm-benchmark's PRE-FIX (live,
 * exploited) src/web/server.ts was classified "confined" by the old
 * classifier, because `req.path.startsWith('/api/')` matched `startsWith(`.
 *
 * The detector is a Python script; this suite drives it as a SUBPROCESS
 * against fixture files it writes to a temp dir.  The subject is the
 * detector's OUTPUT, not its internals -- so a differently-spelled but
 * equivalent detector still passes (R500's rule 3: a control must fail
 * because of its subject, not because the source was spelled a different way).
 *
 * PERFORMANCE NOTE: the detector is invoked ONCE per describe block over a
 * directory containing ALL of that block's fixtures, and the results are
 * indexed by fixture filename.  The first version invoked it once per `it`,
 * which cost ~42s because each invocation is a fresh Python process.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DETECTOR = join(HERE, '..', 'scripts', 'r501_detector.py');

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
 * hits".  That is how this harness first reported 13/13 failures with
 * a detector that was actually working.
 */
function parseRecords(out: string): Rec[] {
  const records: Rec[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\[(HIGH|LOW)\s*\]\s*(\[[A-Z]+\]\s*)?(\S+):(\d+)\s+sink=(\S+)\s+(\S+)\s+containment=(\w+)/);
    if (m) {
      records.push({
        file: m[3], line: Number(m[4]), sink: m[5], channels: m[6],
        containment: m[7],
      });
    }
  }
  return records;
}

/** Run the detector once over `dir` and index the records by fixture name. */
function detectAll(dir: string): Map<string, Rec[]> {
  let out = '';
  try {
    out = execFileSync('python3', [DETECTOR, dir], { encoding: 'utf-8' });
  } catch (e: any) {
    out = (e.stdout ?? '') + (e.stderr ?? '');
  }
  const byName = new Map<string, Rec[]>();
  for (const r of parseRecords(out)) {
    const key = basename(r.file).replace(/\.ts$/, '');
    const arr = byName.get(key) ?? [];
    arr.push(r);
    byName.set(key, arr);
  }
  return byName;
}

/** The common preamble every fixture shares. */
const PREAMBLE = `import fs from 'fs';
import path from 'path';
import url from 'url';
const join = path.join, resolve = path.resolve;
const readFileSync = fs.readFileSync;
const PUBLIC_DIR = '/srv/public';
`;

beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'r501-fixtures-')); });
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('R501 — detector SENSITIVITY (it must see the class)', () => {
  // Each case is an ORDINARY spelling of "a request value reaches a file
  // read".  The previous scanner (r498c_sweep.py) fired on 2/14 of these.
  const SPELLINGS: Array<{ name: string; body: string; note: string }> = [
    { name: 'inline', body: `readFileSync(join(PUBLIC_DIR, req.url));`,
      note: 'the single most natural spelling; the old scanner was BLIND to it' },
    { name: 'inline-decode', body: `readFileSync(join(PUBLIC_DIR, decodeURIComponent(req.url)));`,
      note: 'old scanner blind' },
    { name: 'template-literal', body: 'readFileSync(`${PUBLIC_DIR}/${req.url}`);',
      note: 'old scanner blind (no join call at all)' },
    { name: 'query-member', body: `readFileSync(join(PUBLIC_DIR, req.query.file));`,
      note: 'old scanner blind' },
    { name: 'express-param', body: `readFileSync(join(PUBLIC_DIR, req.params.file));`,
      note: 'old scanner blind' },
    { name: 'resolve-not-join', body: `readFileSync(resolve(PUBLIC_DIR, req.url));`,
      note: 'old scanner blind (resolve instead of join)' },
    { name: 'named-var', body: `const p = join(PUBLIC_DIR, req.url); readFileSync(p);`,
      note: 'the one spelling the old scanner saw reliably' },
    { name: 'destructured', body: `const { url } = req; readFileSync(join(PUBLIC_DIR, url));`,
      note: 'old scanner blind' },
    { name: 'request-alias', body: `const s = req; readFileSync(join(PUBLIC_DIR, s.url));`,
      note: 'old scanner blind' },
    { name: 'pathname', body: `readFileSync(join(PUBLIC_DIR, url.parse(req.url).pathname));`,
      note: 'old scanner blind' },
  ];

  let byName: Map<string, Rec[]>;

  beforeAll(() => {
    const dir = join(tmp, 'sens');
    mkdirSync(dir, { recursive: true });
    for (const s of SPELLINGS) {
      writeFileSync(
        join(dir, `case_${s.name}.ts`),
        PREAMBLE + `export function handle(req) {\n  ${s.body}\n}\n`,
        'utf-8',
      );
    }
    byName = detectAll(dir);
  });

  for (const s of SPELLINGS) {
    it(`fires on the "${s.name}" spelling — ${s.note}`, () => {
      const hits = byName.get(`case_${s.name}`) ?? [];
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h) => h.sink === 'readFileSync')).toBe(true);
    });
  }
});

describe('R501 — detector SPECIFICITY (it must not cry wolf)', () => {
  const CONTROLS: Array<{ name: string; body: string; why: string }> = [
    { name: 'literal', body: `readFileSync(join(PUBLIC_DIR, 'index.html'));`,
      why: 'a constant path is not attacker-controlled' },
    { name: 'plain', body: `readFileSync('./config.json');`,
      why: 'a constant path is not attacker-controlled' },
    { name: 'non-fs-sink', body: `const v = req.url; console.log(v);`,
      why: 'a request value in a non-filesystem sink is not this class' },
    { name: 'string-prefix', body: `if (name.startsWith('pre')) { readFileSync(join(PUBLIC_DIR, name)); }`,
      why: 'a string prefix test is not a path containment guard' },
  ];

  let byName: Map<string, Rec[]>;

  beforeAll(() => {
    const dir = join(tmp, 'ctrl');
    mkdirSync(dir, { recursive: true });
    for (const c of CONTROLS) {
      writeFileSync(
        join(dir, `case_${c.name}.ts`),
        PREAMBLE + `export function handle(req, name) {\n  ${c.body}\n}\n`,
        'utf-8',
      );
    }
    byName = detectAll(dir);
  });

  for (const c of CONTROLS) {
    it(`stays silent on the "${c.name}" control — ${c.why}`, () => {
      const hits = byName.get(`case_${c.name}`) ?? [];
      expect(hits.length).toBe(0);
    });
  }
});

describe('R501 — the CONTAINMENT CLASSIFIER must be subject-sensitive', () => {
  let byName: Map<string, Rec[]>;

  beforeAll(() => {
    const dir = join(tmp, 'conf');
    mkdirSync(dir, { recursive: true });
    // This is the EXACT shape of llm-benchmark's PRE-FIX server.ts: a live,
    // exploited arbitrary file read whose file also contains a route prefix
    // test.  The old classifier called this "confined".
    writeFileSync(
      join(dir, 'route_prefix.ts'),
      PREAMBLE + `export function handle(req) {\n`
      + `  if (req.path.startsWith('/api/')) { return; }\n`
      + `  const filePath = join(PUBLIC_DIR, req.url);\n`
      + `  res.end(readFileSync(filePath));\n`
      + `}\n`,
      'utf-8',
    );
    // A REAL path confinement: realpath + a comparison against the ROOT.
    writeFileSync(
      join(dir, 'real_confinement.ts'),
      PREAMBLE + `export function handle(req) {\n`
      + `  const target = path.resolve(PUBLIC_DIR, req.url);\n`
      + `  const real = fs.realpathSync(target);\n`
      + `  if (!real.startsWith(PUBLIC_ROOT + path.sep)) { return; }\n`
      + `  res.end(readFileSync(real));\n`
      + `}\n`,
      'utf-8',
    );
    byName = detectAll(dir);
  });

  it('does not call a ROUTE PREFIX TEST a path confinement', () => {
    const hits = byName.get('route_prefix') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.containment === 'NO')).toBe(true);
  });

  it('calls a REAL path confinement a path confinement', () => {
    const hits = byName.get('real_confinement') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.containment === 'YES')).toBe(true);
  });
});

describe('R501 — the detector must see the REAL exploited shapes', () => {
  let byName: Map<string, Rec[]>;

  beforeAll(() => {
    const dir = join(tmp, 'real');
    mkdirSync(dir, { recursive: true });
    // The R498b pre-fix ui_static.ts, verbatim in shape.
    writeFileSync(
      join(dir, 'r498b.ts'),
      PREAMBLE + `export function handle(req) {\n`
      + `  let filePath = join(publicDir, req.url === '/' ? 'index.html' : req.url!.split('?')[0]);\n`
      + `  if (!existsSync(filePath)) filePath = join(publicDir, 'index.html');\n`
      + `  res.end(readFileSync(filePath));\n`
      + `}\n`,
      'utf-8',
    );
    // The chain crosses a NON-PATH assignment.
    //
    // This arm exists because the mutation matrix found the hole it pins:
    // M5 ("narrow the taint propagation back to path-calls-only") SURVIVED
    // the first version of this suite.  No arm exercised a chain whose
    // intermediate step is NOT a path call -- every fixture went from the
    // request source straight into a join().
    //
    // The real woclaw chain is exactly this shape:
    //     req.url -> decoded -> relative -> target -> realTarget -> filePath
    // and TWO of those steps are a decode and a string replace, not a path
    // call.  A detector that only follows path-shaped edges follows a
    // DIFFERENT graph than the one the data actually flows through -- which
    // is how the ORIGINAL scanner (r498c_sweep.py) ended up blind to
    // woclaw's own ui_static.ts.
    writeFileSync(
      join(dir, 'non_path_chain.ts'),
      PREAMBLE + `export function handle(req) {\n`
      + `  const raw = req.url;\n`
      + `  const stripped = raw.replace(/^\\/+/, '');\n`
      + `  const filePath = join(PUBLIC_DIR, stripped);\n`
      + `  res.end(readFileSync(filePath));\n`
      + `}\n`,
      'utf-8',
    );
    byName = detectAll(dir);
  });

  it('fires on the R498b shape (request path joined to a base dir, then read)', () => {
    const hits = byName.get('r498b') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.sink === 'readFileSync')).toBe(true);
    expect(hits.every((h) => h.containment === 'NO')).toBe(true);
  });

  it('follows a taint chain that crosses a NON-PATH assignment', () => {
    // Pins M5: if the detector only propagates taint through path.join /
    // path.resolve, this chain stops at `stripped` and the file is missed.
    const hits = byName.get('non_path_chain') ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.sink === 'readFileSync')).toBe(true);
  });
});
