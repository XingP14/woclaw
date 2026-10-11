/**
 * R443 — "text coverage is not a weaker runtime test" generalised from one
 * module (R442) to the class.
 *
 * R442 found that `scheduler_log.test.ts` asserted its subject by reading the
 * subject's SOURCE TEXT, so nothing ever loaded the module into the JS runtime.
 * Its write-up queued R443: mechanically enumerate every hub/test suite whose
 * subject is read as text, and count how many have zero runtime load of it.
 *
 * 🔴 The answer, measured: the alarm does NOT generalise, and the round's
 * result is a negative one. Recorded here as a regression guard because the
 * *shape* of the finding is easy to re-derive wrongly (it was, three times --
 * see the rules at the bottom).
 *
 * Method notes that are load-bearing for the numbers below:
 *   - The unit of analysis is the (suite, module) PAIR. "This suite reads
 *     rest_server's text" is true and unremarkable; it is only a defect if no
 *     OTHER suite loads rest_server.
 *   - Static `import { X } from '../src/x.js'` loads the module just as
 *     thoroughly as `await import(...)`. v1 of the probe counted only dynamic
 *     imports and reported fully runtime-covered suites as text-only.
 *   - Every count below is measured LIVE, not hard-coded, and the probe's
 *     detector is validated on known-true samples first.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const HUB_DIR = join(TEST_DIR, '..');
const SRC_DIR = join(HUB_DIR, 'src');

const prodModules = (): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(basename(p, '.ts'));
    }
  };
  walk(SRC_DIR);
  return [...new Set(out)].sort();
};

const testSuites = (): string[] =>
  readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.ts')).sort();

const STATIONARY = /\bfrom\s+['"]([^'"]+)['"]/g;
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
const READ_FILE = /readFileSync\((.{0,200}?)\)/gs;
const PATH_CONST = /=\s*join\([^;]{0,160}?['"]([^'"]+\.(?:ts|js|md))['"]/g;

const stemOf = (spec: string): string =>
  basename(spec).replace(/\.(js|ts|mjs|md)$/, '');

const readSuite = (n: string): string => readFileSync(join(TEST_DIR, n), 'utf8');

/** modules a suite LOADS into the runtime — static or dynamic, both count */
const loadedBy = (src: string): Set<string> => {
  const s = new Set<string>();
  for (const m of src.matchAll(STATIONARY)) s.add(stemOf(m[1]!));
  for (const m of src.matchAll(DYNAMIC)) s.add(stemOf(m[1]!));
  return s;
};

/** modules a suite READS AS SOURCE TEXT — the R442 subject-channel */
const textReadBy = (src: string): Set<string> => {
  const s = new Set<string>();
  for (const m of src.matchAll(READ_FILE))
    for (const lit of m[1]!.matchAll(/['"]([^'"]+\.(?:ts|js|md))['"]/g))
      s.add(stemOf(lit[1]!));
  for (const m of src.matchAll(PATH_CONST)) s.add(stemOf(m[1]!));
  return s;
};

describe('R443 · text coverage vs runtime load, measured across the whole class', () => {
  it('the detector fires on known-true samples (db is imported by many suites)', () => {
    // Control first. A detector that cannot see a load cannot report a
    // text-only module -- the failure mode is a false ZERO (R442's own bug).
    // `memory.test.ts` is a verified importer; the probe must see it. (First
    // draft asserted `db_memory_select_typed.test.ts`, which I had wrongly
    // assumed was an importer -- it is one of the four TEXT-ONLY db readers.
    // The control caught the assumption.)
    const importers = testSuites().filter((n) => loadedBy(readSuite(n)).has('db'));
    expect(importers.length).toBeGreaterThan(5);
    expect(importers).toContain('memory.test.ts');
  });

  it('the detector sees BOTH static and dynamic relative imports', () => {
    // v1 of this probe accepted only '/name.js' and missed `from './name.js'`,
    // reporting 21 false text-only modules. Both spellings must resolve.
    expect(stemOf('./db.js')).toBe('db');
    expect(stemOf('../src/crypto')).toBe('crypto');
    expect(loadedBy(`import { X } from '../src/foo.js';`)).toContain('foo');
    expect(loadedBy(`const m = await import('../src/foo.js');`)).toContain('foo');
  });

  it('the detector does not fabricate modules that no suite names', () => {
    expect(loadedBy(`import x from './not_a_real_module_zzz.js';`)).toEqual(
      new Set(['not_a_real_module_zzz']),
    );
  });

  it('every prod module is reached by at least one suite, by some channel', () => {
    const reached = new Set<string>();
    for (const n of testSuites()) {
      const src = readSuite(n);
      for (const m of [...loadedBy(src), ...textReadBy(src)]) reached.add(m);
    }
    const orphans = prodModules().filter((m) => !reached.has(m));
    expect(orphans).toEqual([]);
  });

  it('⭐ every text-read module is ALSO runtime-loaded, except index.ts', () => {
    // This is the load-bearing assertion. It is the generalisation of R442's
    // finding, and the measured answer is that R442 was the ONLY instance.
    const loaded = new Set<string>();
    const texted = new Set<string>();
    for (const n of testSuites()) {
      const src = readSuite(n);
      for (const m of loadedBy(src)) loaded.add(m);
      for (const m of textReadBy(src)) texted.add(m);
    }
    const textOnly = prodModules()
      .filter((m) => texted.has(m) && !loaded.has(m))
      .sort();
    expect(textOnly).toEqual(['index']);
  });

  it('index.ts is text-only BY CONSTRUCTION — it exports nothing and self-boots', () => {
    // The single exception is not a gap to close. `index.ts` has zero exports
    // and ends in a top-level main().catch(...): loading it in a test would
    // start a hub. Its behaviour is deliberately unreachable from a suite, and
    // its own source records why parseEnvInt/DEFAULT_CONFIG were extracted out
    // of it on 2026-10-04 for exactly this reason.
    const indexSrc = readFileSync(join(SRC_DIR, 'index.ts'), 'utf8');
    expect(indexSrc).not.toMatch(/^export /m);
    expect(indexSrc).toContain('main()');
    expect(indexSrc).toMatch(/unreachable from a test/i);
  });

  it('a suite name asserting "runtime" really does load its subject', () => {
    // `env_helpers_runtime.test.ts` reads default_config's text but imports
    // env_helpers at runtime. The failure mode this guards is a suite whose
    // name promises runtime coverage and delivers only text.
    const src = readSuite('env_helpers_runtime.test.ts');
    expect(loadedBy(src).has('env_helpers')).toBe(true);
    expect(textReadBy(src).has('default_config')).toBe(true);
    // ...and default_config is runtime-loaded elsewhere, so the class claim holds
    const otherLoads = testSuites().some(
      (n) => n !== 'env_helpers_runtime.test.ts' && loadedBy(readSuite(n)).has('default_config'),
    );
    expect(otherLoads).toBe(true);
  });
});

/**
 * R443 rules — each one is a mistake this round actually made.
 *
 * R443-1  The unit of a coverage claim is the (suite, module) PAIR. "Suite S
 *   reads M's text" is true for 37 pairs and is not a defect for 36 of them.
 *   The defect shape is a module whose EVERY channel is text.
 *
 * R443-2  🔴 A mutation that is inert by default measures nothing. The first
 *   matrix run reported scheduler_log SURVIVING — the exact mutation R442
 *   shipped a runtime suite to kill. The gate was `if (env.QUIET) return` and
 *   the env was never set, so the mutation was a no-op comment. 7 of 10
 *   "SURVIVED" verdicts were that same artefact. Set the variable, or mutate
 *   something that cannot be configuration-disabled. A control mutation MUST
 *   be known to go red before the matrix is believable (R442's own M2/M3).
 *
 * R443-3  🔴 A probe leg that fails for the WRONG reason must be fixed before
 *   any count is quoted. v1 of the injection matrix could only mutate
 *   `export function`; 6 of 12 targets read "MUTATION NOT INJECTED" and two
 *   more (v0) never even ran. `types.ts` still cannot be mutated — recorded,
 *   not counted. A matrix row that says NOT-INJECTED is not a green row.
 *
 * R443-4  🔴 Read your own hits. v1 classified `extraction_engine.test.ts` as
 *   text-only; it opens with a top-level `import { ExtractionEngine } from
 *   '../src/extraction/engine.js'`. The classification was wrong, not the
 *   suite. (R424-5 / R442 "read the hits".)
 *
 * R443-5  The negative result IS the finding. R442's defect was real and is
 *   fixed; it does not generalise to a class of 13 modules. Shipping the guard
 *   that keeps it a singleton is the round's deliverable — not a new alarm.
 */
describe('R443 · the negative result is itself the guard', () => {
  it('asserts the count that could have been wrong, rather than a restatement', () => {
    const textReadSuites = testSuites().filter((n) =>
      textReadBy(readSuite(n)).has('rest_server'),
    );
    // 10 suites read rest_server's source text. Every one of them is an
    // ORTHOGONAL extra on top of real runtime coverage (R442-1), and this
    // assertion fails loudly if that ever stops being true.
    expect(textReadSuites.length).toBeGreaterThanOrEqual(8);
    const runtimeLoaders = testSuites().filter((n) => loadedBy(readSuite(n)).has('rest_server'));
    expect(runtimeLoaders.length).toBeGreaterThan(0);
  });

  it('R442 subject files are both present — the fix is still in place', () => {
    expect(existsSync(join(TEST_DIR, 'scheduler_log.test.ts'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'scheduler_log_runtime.test.ts'))).toBe(true);
    // the runtime suite must actually reach for the module
    expect(readSuite('scheduler_log_runtime.test.ts')).toMatch(/import\('\.\.\/src\/scheduler_log\.js'\)/);
  });
});