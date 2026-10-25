/**
 * R504 -- TRUST as a DECIDABLE property: the origin is a per-request binding.
 *
 * WHAT THIS SUITE IS ABOUT
 *
 * R503 left one question open and named it:
 *
 *   "the next step is a TRUST distinction (a value that crossed a request
 *    boundary), not a wider vocabulary -- and the generated corpus is the
 *    instrument that will tell us when that distinction is right, because
 *    it is the only corpus a memoriser cannot pass."
 *
 * R503 had measured the OBVIOUS repair and rejected it: "every field of
 * every function parameter is a source" (the ROLE rule) fixed the generated
 * corpus (29/60 -> 60/60) but exploded PRODUCTION from 6 hits to 25, and
 * every one of the 19 new hits was a CONFIG-DERIVED value.  ROLE has no
 * ORIGIN and no DELIVERY, so it cannot tell a per-request value from a
 * factory-time capture.
 *
 * The canonical answer, taken from CodeQL
 * (`javascript/ql/lib/semmle/javascript/security/dataflow/RemoteFlowSources.qll`):
 *
 *   TRUST is a property of the ORIGIN ACCESS PATH and of the ENTRY POINT
 *   that delivers it -- not of the variable's name, and not of its role.
 *
 * So this suite pins the TRUST rule on the axis a role rule CANNOT score:
 *
 *   ORIGIN corpus 60 cases, each a PAIR of files (a handler factory and a
 *   registration).  A case is ATTACKER-CONTROLLED iff the value's origin is
 *   the PER-REQUEST parameter AND that closure is DELIVERED to a boundary
 *   registration.  Both halves are STRUCTURAL, not nominal -- the corpus's
 *   request pool and config pool produce the SAME `X.field` syntax, so a
 *   name-based rule cannot score the axis.
 *
 * THE ARMS, AND WHY EACH ONE IS HERE
 *
 *   A  the trust detector PASSES the origin corpus (every case, computed)
 *   B  the ROLE rule FAILS the origin corpus (the corpus discriminates)
 *   C  the trust detector does NOT lose a production site the baseline finds
 *   D  the trust detector does NOT add the ROLE rule's 19 config sites
 *   E  the trust detector reports UNKNOWN, not silence, when it cannot decide
 *   F  the resolver attributes a binding to the file where the CLOSURE BODY
 *      lives, not the file that registers it
 *   G  a config-derived origin is TRUSTED even when its name looks like a
 *      request -- the axis is provenance, not vocabulary
 *
 * NOTE on the numbers below: they are NOT written into any assertion as a
 * literal.  R460's shape: a hand-copied count in a title goes stale the
 * moment the corpus grows, and then the title DENIES the artifact it
 * describes.  Every count is COMPUTED at run time from the corpus module
 * itself.  The assertion is the RELATION, never a constant.
 *
 * The detector is a Python script; this suite drives it as a SUBPROCESS
 * against fixture files it writes to a temp dir.  The subject is the
 * detector's OUTPUT, not its internals -- so a differently-spelled but
 * equivalent detector still passes (R500's rule 3).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, '..', 'scripts');
const BASELINE = join(SCRIPTS, 'r502_detector.py');
const TRUST = join(SCRIPTS, 'r504_detector_trust.py');
const RESOLVER = join(SCRIPTS, 'r504_trust.py');
const ORIGIN_GEN = join(SCRIPTS, 'r504_origin_generator.py');
const ROLE_OVERTAIN = join(SCRIPTS, 'r503_role_overtain.py');

const REPO = join(HERE, '..', '..');
const HUB_SRC = join(REPO, 'hub', 'src');
const SIBLING_SRC = join(REPO, '..', 'llm-benchmark', 'src');

let tmp: string;

interface Rec {
  file: string; line: number; sink: string; channels: string;
  containment: string; trust?: string;
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
 *
 * The trailing `trust=` field is OPTIONAL: the baseline does not print it
 * and the trust detector does.  A regex that REQUIRES it would silently
 * drop every baseline record and make the baseline read as "0 hits" --
 * which is the R482-10(2) shape (a parser that cannot read the output is
 * an absent measurement, not a green one).
 */
function parseRecords(out: string): Rec[] {
  const records: Rec[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(
      /^\[(HIGH|LOW\s*)\]\s*(\[[A-Z]+\]\s*)?(\S+):(\d+)\s+sink=(\S+)\s+(\S+)\s+containment=(\w+)(?:\s+trust=(\w+))?/);
    if (m) {
      records.push({
        file: m[3], line: Number(m[4]), sink: m[5], channels: m[6],
        containment: m[7].toUpperCase(), trust: m[8],
      });
    }
  }
  return records;
}

function runDetector(dir: string, script: string = TRUST): { recs: Rec[]; out: string } {
  const out = execFileSync('python3', [script, dir], { encoding: 'utf8' });
  return { recs: parseRecords(out), out };
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

/** The origin corpus manifest, read from the generator module itself. */
interface OriginCase {
  svc: string; main: string; origin: string; delivery: string;
  sink_kind: string; guard: string; chain_len: number;
  attacker_controlled: boolean; sink_line: string; var: string;
  reqobj: string; cfgobj: string;
}
function originCases(): OriginCase[] {
  const py =
    `import sys, json; sys.path.insert(0, ${JSON.stringify(SCRIPTS)});` +
    `import r504_origin_generator as g;` +
    `import tempfile; d=tempfile.mkdtemp();` +
    `print(json.dumps(g.generate(d, 60, 20261026)))`;
  const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
  return JSON.parse(out);
}

/** Materialise the origin corpus into `dir`; returns the manifest. */
function writeOriginCorpus(dir: string): OriginCase[] {
  const py =
    `import sys, json; sys.path.insert(0, ${JSON.stringify(SCRIPTS)});` +
    `import r504_origin_generator as g;` +
    `print(json.dumps(g.generate(${JSON.stringify(dir)}, 60, 20261026)))`;
  const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
  return JSON.parse(out);
}

/** Build the ROLE variant (a copy of the baseline with the ROLE source rule). */
function buildRoleVariant(dest: string): string {
  const py =
    `import sys; sys.path.insert(0, ${JSON.stringify(SCRIPTS)});` +
    `import r503_role_overtain as r;` +
    `print(r.build_role_variant(${JSON.stringify(dest)}))`;
  execFileSync('python3', ['-c', py], { encoding: 'utf8' });
  return dest;
}

/** The production roots that actually exist. */
function prodRoots(): string[] {
  return [HUB_SRC, SIBLING_SRC].filter((p) => {
    try { readFileSync(p); return true; } catch { return false; }
  });
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'r504-'));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('R504 control: the instrument is alive', () => {
  it('the resolver, the generator and both detectors exist', () => {
    for (const f of [RESOLVER, ORIGIN_GEN, BASELINE, TRUST]) {
      expect(execFileSync('test', ['-f', f], { encoding: 'utf8' })).toBeDefined();
    }
  });

  it('the origin corpus is non-empty and covers BOTH origins and ALL deliveries', () => {
    const cases = originCases();
    expect(cases.length).toBeGreaterThanOrEqual(40);
    const origins = new Set(cases.map((c) => c.origin));
    expect(origins.has('REQUEST')).toBe(true);
    expect(origins.has('CONFIG')).toBe(true);
    const deliveries = new Set(cases.map((c) => c.delivery));
    expect(deliveries.has('DIRECT')).toBe(true);
    expect(deliveries.has('FACTORY')).toBe(true);
    expect(deliveries.has('NONE')).toBe(true);
  });

  it('the origin corpus has BOTH attacker-controlled and trusted instances', () => {
    const cases = originCases();
    const attacker = cases.filter((c) => c.attacker_controlled).length;
    const trusted = cases.length - attacker;
    // A corpus with only one polarity would be a corpus that cannot fail.
    expect(attacker).toBeGreaterThan(0);
    expect(trusted).toBeGreaterThan(0);
  });

  it('the corpus NAME does not leak the answer: the request pool and the config pool overlap in SYNTAX', () => {
    // Both origins emit `X.field` -- the only difference is WHICH
    // invocation X belongs to.  If the corpus drew the origin from the
    // NAME, a name-based rule would score perfectly on it and the corpus
    // would measure nothing.
    const cases = originCases();
    for (const c of cases) {
      // the source expression must be `<obj>.<field>` in BOTH origins
      expect(c.reqobj).toBeTruthy();
      expect(c.cfgobj).toBeTruthy();
    }
    // and the origin must not be decidable from the object's name alone:
    // the same request-pool name must appear on both sides.
    const reqNames = new Set(cases.map((c) => c.reqobj));
    const cfgNames = new Set(cases.map((c) => c.cfgobj));
    for (const n of reqNames) expect(cfgNames.has(n)).toBe(true);
  });
});

describe('R504 A/B: the ORIGIN corpus grades the TRUST rule and rejects the ROLE rule', () => {
  let cases: OriginCase[];
  let trustRecs: Map<string, Rec[]>;
  let roleRecs: Map<string, Rec[]>;
  let baselineRecs: Map<string, Rec[]>;

  beforeAll(() => {
    const dir = join(tmp, 'origin');
    mkdirSync(dir, { recursive: true });
    cases = writeOriginCorpus(dir);
    trustRecs = byName(runDetector(dir, TRUST).recs);
    roleRecs = byName(runDetector(dir, buildRoleVariant(join(tmp, 'role.py'))).recs);
    baselineRecs = byName(runDetector(dir, BASELINE).recs);
  });

  it('the TRUST rule passes EVERY origin case', () => {
    const failures: string[] = [];
    for (const c of cases) {
      const key = c.svc.replace(/\.ts$/, '');
      const fired = (trustRecs.get(key) ?? []).length > 0;
      if (fired !== c.attacker_controlled) {
        failures.push(`${c.origin}/${c.delivery} fired=${fired} want=${c.attacker_controlled}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('the ROLE rule FAILS the origin corpus -- the corpus discriminates on the TRUST axis', () => {
    const failures: string[] = [];
    for (const c of cases) {
      const key = c.svc.replace(/\.ts$/, '');
      const fired = (roleRecs.get(key) ?? []).length > 0;
      if (fired !== c.attacker_controlled) {
        failures.push(`${c.origin}/${c.delivery} fired=${fired} want=${c.attacker_controlled}`);
      }
    }
    // The corpus must reject the ROLE rule -- otherwise it is measuring
    // something the ROLE rule already gets right.
    expect(failures.length).toBeGreaterThan(0);
  });

  it('the BASELINE (vocabulary) rule also fails the origin corpus', () => {
    const failures: string[] = [];
    for (const c of cases) {
      const key = c.svc.replace(/\.ts$/, '');
      const fired = (baselineRecs.get(key) ?? []).length > 0;
      if (fired !== c.attacker_controlled) {
        failures.push(`${c.origin}/${c.delivery} fired=${fired} want=${c.attacker_controlled}`);
      }
    }
    expect(failures.length).toBeGreaterThan(0);
  });

  it('the ROLE rule over-fires on the CONFIG origins -- the direction of its failure', () => {
    // The ROLE rule's failure is NOT random: it fires on values that are
    // NOT attacker-controlled.  A corpus that only showed "the role rule
    // scores lower" would not say WHICH way it fails, and a rule can
    // fail by missing real vulnerabilities too.
    let configOverFires = 0;
    for (const c of cases) {
      if (c.attacker_controlled) continue;
      const key = c.svc.replace(/\.ts$/, '');
      if ((roleRecs.get(key) ?? []).length > 0) configOverFires += 1;
    }
    expect(configOverFires).toBeGreaterThan(0);
  });
});

describe('R504 C/D: the trust rule neither loses nor adds on PRODUCTION', () => {
  let baseline: Rec[];
  let trust: Rec[];

  beforeAll(() => {
    const roots = prodRoots();
    if (roots.length === 0) return;
    baseline = runDetector(roots[0], BASELINE).recs;
    trust = runDetector(roots[0], TRUST).recs;
  });

  it('the trust rule loses NO production site the baseline finds', () => {
    if (prodRoots().length === 0) return;
    // Compare by (file, line, sink) -- NOT by the raw line, because the
    // trust detector appends a `trust=` field.  A raw-line comparison
    // would report every baseline hit as "lost" and the differential
    // would be vacuously satisfied by "the trust detector finds nothing".
    const key = (r: Rec) => `${basename(r.file)}:${r.line}:${r.sink}`;
    const trustKeys = new Set(trust.map(key));
    const lost = baseline.filter((r) => !trustKeys.has(key(r)));
    expect(lost.map((r) => key(r))).toEqual([]);
  });

  it('the trust rule adds NO production site the baseline does not find', () => {
    if (prodRoots().length === 0) return;
    const key = (r: Rec) => `${basename(r.file)}:${r.line}:${r.sink}`;
    const baseKeys = new Set(baseline.map(key));
    const gained = trust.filter((r) => !baseKeys.has(key(r)));
    expect(gained.map((r) => key(r))).toEqual([]);
  });

  it('every trust hit is marked with a trust verdict', () => {
    if (prodRoots().length === 0) return;
    for (const r of trust) {
      expect(r.trust).toBeTruthy();
      expect(['UNTRUSTED', 'UNKNOWN']).toContain(r.trust);
    }
  });
});

describe('R504 E: UNKNOWN is reported, never rendered as silence', () => {
  it('a project with NO registration yields an UNKNOWN verdict, not "no findings"', () => {
    // A corpus with no boundary registration at all: the resolver has
    // nothing to decide BY.  The instrument must say UNKNOWN and fall back
    // to the vocabulary rule -- NOT report zero findings, which would
    // render "I could not decide" as "everything is fine".  That is
    // R497's lesson in a new place.
    const dir = join(tmp, 'noreg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'),
      `import fs from 'fs';\nconst readFileSync = fs.readFileSync;\n` +
      `export function h(req: any) {\n  const p = req.url;\n  return readFileSync(p);\n}\n`);
    const { recs, out } = runDetector(dir, TRUST);
    expect(out).toContain('UNKNOWN');
    // and it still REPORTS the site -- as UNKNOWN, not as silence
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) expect(r.trust).toBe('UNKNOWN');
  });

  it('a project WITH a registration yields the decisive verdict', () => {
    const dir = join(tmp, 'withreg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'),
      `import http from 'http';\n` +
      `export function makeS(cfg: any) {\n  return (req: any) => {\n    const p = req.url;\n    return p;\n  };\n}\n` +
      `const s = makeS({});\nconst server = http.createServer(s);\n`);
    const { out } = runDetector(dir, TRUST);
    expect(out).toContain('UNTRUSTED');
    expect(out).not.toContain('UNKNOWN (');
  });
});

describe('R504 F: the binding is attributed to the file where the CLOSURE BODY lives', () => {
  it('a factory in ANOTHER file still yields a per-request binding', () => {
    const dir = join(tmp, 'attrib');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'svc.ts'),
      `export function makeS(cfg: any) {\n  return (req: any) => {\n    return req.url;\n  };\n}\n`);
    writeFileSync(join(dir, 'main.ts'),
      `import { makeS } from './svc';\n` +
      `const s = makeS({});\nconst server = http.createServer(s);\n`);
    const out = execFileSync('python3', [RESOLVER, dir], { encoding: 'utf8' });
    // the binding must be attributed to svc.ts (where the closure body is),
    // NOT to main.ts (where the registration is)
    expect(out).toMatch(/svc\.ts -> \['req'\]/);
    expect(out).not.toMatch(/main\.ts -> \[/);
  });

  it('the resolver reports the TRANSITIVE delivery explicitly', () => {
    const dir = join(tmp, 'attrib2');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'svc.ts'),
      `export function makeS(cfg: any) {\n  return (req: any) => {\n    return req.url;\n  };\n}\n`);
    writeFileSync(join(dir, 'main.ts'),
      `import { makeS } from './svc';\n` +
      `const s = makeS({});\nconst server = http.createServer(s);\n`);
    const out = execFileSync('python3', [RESOLVER, dir], { encoding: 'utf8' });
    expect(out).toContain('imported-factory:makeS');
  });
});

describe('R504 G: the axis is provenance, not vocabulary', () => {
  it('a CONFIG-derived value whose NAME looks like a request is TRUSTED', () => {
    // The generator's config pool and request pool are DISJOINT in the
    // first draft; the property under test is that the verdict follows
    // the ORIGIN (which invocation), not the spelling.  So this fixture
    // is written by hand: the config object is NAMED `req`, and it is
    // still trusted.
    const dir = join(tmp, 'namedreq');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'),
      `import fs from 'fs';\nconst readFileSync = fs.readFileSync;\n` +
      `export function makeS(req: any) {\n` +
      `  return (other: any) => {\n` +
      `    const p = req.url;\n` +
      `    return readFileSync(p);\n` +
      `  };\n}\n`);
    writeFileSync(join(dir, 'main.ts'),
      `import { makeS } from './a';\n` +
      `const s = makeS({ url: '/etc/passwd' });\n` +
      `const server = http.createServer(s);\n`);
    const { recs } = runDetector(dir, TRUST);
    // `req.url` here is the FACTORY-TIME capture named `req`.  The trust
    // rule must NOT call it attacker-controlled, because it does not vary
    // per request.
    const svcHits = (recs ?? []).filter((r) => basename(r.file) === 'a.ts');
    expect(svcHits.length).toBe(0);
  });

  it('a REQUEST-derived value whose NAME looks like a config is UNTRUSTED', () => {
    // The mirror image: the per-request parameter is named `cfg`.
    const dir = join(tmp, 'namedcfg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.ts'),
      `import fs from 'fs';\nconst readFileSync = fs.readFileSync;\n` +
      `export function makeS(root: any) {\n` +
      `  return (cfg: any) => {\n` +
      `    const p = cfg.url;\n` +
      `    return readFileSync(p);\n` +
      `  };\n}\n`);
    writeFileSync(join(dir, 'main.ts'),
      `import { makeS } from './a';\n` +
      `const s = makeS({});\n` +
      `const server = http.createServer(s);\n`);
    const { recs } = runDetector(dir, TRUST);
    const svcHits = (recs ?? []).filter((r) => basename(r.file) === 'a.ts');
    expect(svcHits.length).toBeGreaterThan(0);
    for (const h of svcHits) expect(h.trust).toBe('UNTRUSTED');
  });
});
