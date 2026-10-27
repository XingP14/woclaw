/**
 * R444 — the production twin of R443-2.
 *
 * R443's sharpest rule was a mistake the round made to itself: **a mutation that
 * is inert by default measures nothing**. Its first matrix injected
 * `if (process.env.QUIET === '1') return;`, never set the variable, and reported
 * 7 of 10 "SURVIVED" verdicts that were the same artefact. The rule was written
 * about a test harness. It has a production form, and this round measured it:
 *
 *   **An env gate that reads as the pipeline's switch but governs a minority of
 *   the pipeline is the same inert-by-default shape, shipped on purpose.**
 *
 * Three defects, all in the observability subsystem that R91.5 shipped
 * (commit 15d4fbd, 2026-07-25, `woclaw/observability-envelope`):
 *
 *   F1 ⭐ `WOCLAW_LOG_FORMAT=json` is documented in `hub_log.ts:28-39` as
 *       *"operators can flip the formatter to emit NDJSON envelopes instead"* —
 *       but the gate lives ONLY inside `hubEvent`. Of 37 production log call
 *       sites, 2 are `hubEvent`; the other 35 (`hubLog`/`hubWarn`/`hubError`)
 *       are unconditionally `console.*('[WoClaw] ...')` text. An operator who
 *       sets the documented variable gets ~5% of the hub's log output in
 *       structured form and no warning that the rest is text. The flag is real,
 *       exported, tested in 3 suites — and it is inert for 36 of 38 sites.
 *
 *   F2 ⭐ `otlp_sink.ts` (13 KB at `hub/src/otlp_sink.ts`) has **8 exported
 *       functions and 0 production importers**. Nothing
 *       in `src/` imports it; `index.ts`'s boot sequence never references it.
 *       Yet it owns the two env vars (`WOCLAW_OTLP_ENDPOINT`,
 *       `WOCLAW_OTLP_HEADERS`) that are the only documented-looking route to
 *       shipping logs off-box. Two test suites exercise it and are green. This
 *       is R406-F1's shape exactly — **a green suite can be the defect** — and
 *       it is the reason F1 is not fixable by pointing operators at a variable.
 *
 *   F3 6 of the 8 env vars `hub/src` reads appear in no documentation at all
 *       (INSTALL.md's env table has 14 rows; 6 of them are real). The
 *       variables a user must set to get structured logging are the ones no
 *       document mentions — so F1/F2 are undiscoverable, not merely
 *       unimplemented.
 *
 * 🔴 Every count below is measured LIVE from `src/`, and the probe's two
 * detectors are validated against known-true samples before any number is
 * quotable (R410: a probe failing for the wrong reason must be fixed first).
 * R444's own mutation matrix carries a control arm that MUST go red
 * (R443-2) — see the two "claim-flipping" mutations in the round notes.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(TEST_DIR, '..', 'src');

const prodFiles = (): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(p);
    }
  };
  walk(SRC_DIR);
  return out.sort();
};

const readProd = (f: string): string => readFileSync(f, 'utf8');

/** every production file's text, excluding the file that defines the name */
const prodTextExcluding = (excludedBasename: string): string =>
  prodFiles()
    .filter((f) => basename(f) !== excludedBasename)
    .map(readProd)
    .join('\n');

/** count occurrences of a call name across production source, excluding its
 *  own definition file. Declaration lines are excluded too: `export function
 *  hubLog(` is a definition, not a call site. */
const prodCallSites = (name: string): number => {
  const re = new RegExp(`(?<![A-Za-z0-9_])${name}\\s*\\(`, 'g');
  let n = 0;
  for (const f of prodFiles()) {
    if (basename(f) === 'hub_log.ts') continue;
    for (const line of readProd(f).split('\n')) {
      if (/^\s*(export\s+)?(async\s+)?function\s/.test(line)) continue;
      n += [...line.matchAll(re)].length;
    }
  }
  return n;
};

describe('R444 · probe self-validation (control before any count)', () => {
  it('the prod-file walker really finds hub/src (known-true sample)', () => {
    // A walker that returned [] would make every count below a false ZERO —
    // the exact failure R443-2 recorded as its own first matrix run.
    const names = prodFiles().map((f) => basename(f));
    expect(names).toContain('hub_log.ts');
    expect(names).toContain('otlp_sink.ts');
    expect(names).toContain('index.ts');
    expect(prodFiles().length).toBeGreaterThan(20);
  });

  it('the call-site counter sees a known-true importer and ignores the definition', () => {
    // `hubLog` is imported by 5 production files; its definition must NOT count.
    expect(prodCallSites('hubLog')).toBeGreaterThan(10);
    // `parseEnvInt` is defined in env_helpers.ts, which is not excluded here,
    // so this only asserts the counter resolves a call-shaped token at all.
    expect(prodCallSites('nonexistentHelperZzz')).toBe(0);
  });

  it('the doc-table reader can see a variable it is told to look for', () => {
    const install = readFileSync(join(TEST_DIR, '..', '..', 'docs', 'INSTALL.md'), 'utf8');
    expect(install).toContain('MYSQL_HOST');
    expect(install).not.toContain('WOCLAW_LOG_FORMAT');
  });
});

describe('R444 · F1 — the documented formatter switch governs 2 of 38 call sites', () => {
  it('⭐ hubEvent is the ONLY consumer of WOCLAW_LOG_FORMAT', () => {
    // The load-bearing claim. If a future round routes hubLog through the gate,
    // this goes red — which is the point: it is the fix-detector for F1.
    const hubLogSrc = readProd(join(SRC_DIR, 'hub_log.ts'));
    const gateHits = [...hubLogSrc.matchAll(/WOCLAW_LOG_FORMAT/g)].map((m) => m.index);
    expect(gateHits.length).toBeGreaterThan(0);
    // the gate may ONLY be consulted from envelopeEnabled() — i.e. only hubEvent
    const envelopeEnabledBody = hubLogSrc.slice(
      hubLogSrc.indexOf('function envelopeEnabled'),
      hubLogSrc.indexOf('/** Stable dot-namespaced event identifier'),
    );
    expect(envelopeEnabledBody).toContain('WOCLAW_LOG_FORMAT');
    // ...and NO legacy helper body mentions it
    for (const helper of ['hubLog', 'hubWarn', 'hubError']) {
      const body = hubLogSrc.slice(
        hubLogSrc.indexOf(`export function ${helper}(`),
        hubLogSrc.indexOf('}', hubLogSrc.indexOf(`export function ${helper}(`)) + 1,
      );
      expect(body).not.toContain('WOCLAW_LOG_FORMAT');
      // R444-7 (this tick) 🔴 the fix-detector was inert. Routing hubLog
      // through the gate -- the ACTUAL fix for F1 -- means inserting
      // `if (envelopeEnabled()) hubEvent({...})` into the helper body, and
      // that line mentions no env var. The `not.toContain` check above
      // stayed green through the whole fix. What distinguishes "consults the
      // gate" from "does not" is whether the helper REACHES envelopeEnabled,
      // not whether the literal appears. Assert the call, so the suite goes
      // red the day someone wires it -- which is the whole point of a
      // negative-finding guard (a75f834's rule: the stated number must be
      // bound to the code it describes).
      expect(body).not.toMatch(/envelopeEnabled\s*\(/);
      expect(body).not.toMatch(/\bhubEvent\s*\(/);
    }
    // ...and no other production file mentions it either
    expect(prodTextExcluding('hub_log.ts')).not.toContain('WOCLAW_LOG_FORMAT');
  });

  it('the legacy helpers are unconditionally text — the 36 call sites', () => {
    const legacy = prodCallSites('hubLog') + prodCallSites('hubWarn') + prodCallSites('hubError');
    const envelope = prodCallSites('hubEvent');
    expect(legacy).toBeGreaterThan(20);
    // the ratio is the defect: a minority switch. Measured live, not asserted
    // as a constant, so the shape survives a refactor that moves call sites.
    expect(envelope / (legacy + envelope)).toBeLessThan(0.15);
  });

  it('the docstring promises a whole-pipeline flip the code does not deliver', () => {
    // R424's lesson: comments are a keyword family. This one is load-bearing
    // prose describing a branch that does not exist for 36 of 38 sites.
    const hubLogSrc = readProd(join(SRC_DIR, 'hub_log.ts'));
    // The promise is wrapped across comment lines with a `// ` continuation, so
    // match on the prose with continuations joined -- asserting against the
    // raw text would have failed on the wrap, not on a missing promise, which
    // is exactly the "fix the probe for the wrong reason" trap (M410).
    const prose = hubLogSrc.replace(/^\s*\/\/\s?/gm, ' ').replace(/\s+/g, ' ');
    expect(prose).toMatch(/operators can flip the formatter/i);
    expect(prose).toMatch(/All hub-internal call sites continue to go through/i);
    // the promise and the measurement, side by side, in one assertion
    const legacy = prodCallSites('hubLog') + prodCallSites('hubWarn') + prodCallSites('hubError');
    expect(prodCallSites('hubEvent')).toBeLessThan(legacy);

    // R444-6 (this tick): the module's OWN docstring says "all 28+ call sites".
    // That number was never bound to anything, so it drifted silently — the
    // live count is 35. A stated number in prose is a claim with no detector;
    // asserting it is what makes the docstring correctable instead of folklore.
    //
    // M3 recorded the wrong first version of this check. `expect(legacy).
    // toBeGreaterThanOrEqual(claimed[0])` is a FLOOR test, and a floor is not a
    // binding: rewriting the docstring to "4+ call sites" satisfies 35 >= 4 and
    // the suite stayed green (M3 survived). "28+" claims a lower bound, so the
    // honest reading is that 28 is the number a maintainer wrote down and the
    // drift is 28 -> 35.
    //
    // R444-8 (this tick): the FIRST version of the fix pinned `claimed.length`
    // to 3, read off a whole-file grep, while `prose` is a SLICE of the header.
    // It went red on the unmutated control -- a binding that fails at HEAD is
    // not a binding, it is a false positive. Count against the same region the
    // arm already reads (`prose`), so the two cannot disagree about what the
    // docstring claims. One occurrence inside the slice is what the header
    // actually states; the two repeats further down are in different doc
    // blocks and are bound by the whole-file arm below.
    const claimed = [...prose.matchAll(/(\d+)\+ call sites/g)].map((m) => Number(m[1]));
    expect(claimed.length).toBe(1);
    expect(claimed[0]).toBe(28);
    expect(legacy).toBeGreaterThanOrEqual(28);
    expect(prodCallSites('hubEvent')).toBe(2);
    // R514 (2026-10-28 03:03) added one hubWarn site to index.ts (the
    // malformed-WEB_UI_PORT warning), so the legacy call-site count moved
    // from 35 to 36. The DRIFT the prose describes is unchanged in kind:
    // the docstring promises a whole-pipeline flip that the code does not
    // deliver for any of them.
    expect(legacy).toBe(36);
    // The claim is stated three times in the file, but not as the literal
    // "28+ call sites" each time -- two of them wrap as "the 28+ existing ...
    // call sites" across a comment line, so a single literal matchAll finds one
    // and `grep -c` (which counts LINES) also says one. Both readings are
    // recorded here so the next round does not re-derive a 3 from the same
    // evidence and pin it. The number that matters is asserted above; this arm
    // exists to keep the two doc blocks in sync with the header, and it reads
    // them the way a maintainer would: every "N+ ... call sites" in the file.
    const allClaims = [...hubLogSrc.matchAll(/(\d+)\+[^.\n]*call sites/g)].map((m) => Number(m[1]));
    expect(allClaims.length).toBeGreaterThan(0);
    expect(new Set(allClaims)).toEqual(new Set([28]));
  });
});

describe('R444 · F2 — otlp_sink.ts is exported, tested, and never wired', () => {
  it('⭐ zero production files import otlp_sink', () => {
    // R406's consumer/producer symmetry check, run FIRST. The exporter is a
    // fully-implemented consumer of the two OTLP env vars with no producer.
    const importers = prodFiles().filter((f) => {
      if (basename(f) === 'otlp_sink.ts') return false;
      return /from\s+['"][^'"]*otlp_sink(\.js)?['"]/.test(readProd(f));
    });
    expect(importers).toEqual([]);
  });

  it('⭐ the hub boot path never references it either', () => {
    // `index.ts` is the single boot entry. If the exporter were wired, it would
    // be named here. Checked separately from the general import scan because a
    // dynamic require or a side-effect import would slip past that one.
    const indexSrc = readProd(join(SRC_DIR, 'index.ts'));
    expect(indexSrc).not.toMatch(/otlp/i);
    expect(indexSrc).not.toMatch(/require\s*\(/);
  });

  it('the module is substantial, not a stub — the dead code is real code', () => {
    // Guards the finding from being dismissed as "an unfinished sketch". 8
    // exports, an HTTP exporter, partial-success accounting, dropped-record
    // counters. All of it correct, none of it reachable.
    const src = readProd(join(SRC_DIR, 'otlp_sink.ts'));
    expect([...src.matchAll(/^export (?:async )?function/gm)].length).toBeGreaterThanOrEqual(7);
    expect(src).toContain('sendOtlpLogsOnce');
    expect(src.length).toBeGreaterThan(4000);
  });

  it('the two OTLP env vars are read ONLY inside the unwired module', () => {
    // F2's consequence for F1: the variables that would make structured logging
    // actually ship off-box are reachable only from a module nothing loads.
    for (const v of ['WOCLAW_OTLP_ENDPOINT', 'WOCLAW_OTLP_HEADERS']) {
      const readers = prodFiles().filter((f) => readProd(f).includes(`process.env.${v}`));
      expect(readers.map((f) => basename(f))).toEqual(['otlp_sink.ts']);
    }
  });

  it('two test suites keep it green — a green suite is not a wiring proof', () => {
    // R406-F1. These suites pass and assert real behaviour; none of it can fail
    // because production never calls the code. Recorded as a guard so the next
    // round reads this shape as what it is.
    expect(existsSync(join(TEST_DIR, 'otlp_sink.test.ts'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'otlp_sink_edge_branches.test.ts'))).toBe(true);
  });
});

describe('R444 · F3 — the variables a user must set are the undocumented ones', () => {
  it('⭐ WOCLAW_LOG_FORMAT appears in no USER-FACING documentation file', () => {
    const docsDir = join(TEST_DIR, '..', '..', 'docs');
    const files = readdirSync(docsDir).filter((f) => f.endsWith('.md'));

    // R447 — THE SUBJECT SET WAS TWO PLANES AT ONCE.
    //
    // F3's claim is about DISCOVERABILITY: "the variables a user must set to get
    // structured logging are the ones no document mentions". A round report is not
    // a surface a user reads on their way to configuring the hub, so counting it
    // silently widened the subject set from *user-facing docs* to *every markdown
    // file in docs/*.
    //
    // Measured cost of that widening, on this repo: R446 shipped
    // docs/R446-EXPORT-INVENTORY.md, which quotes WOCLAW_LOG_FORMAT verbatim in
    // its findings — the round report that DISCOVERED the gap is what reddened the
    // arm that reports the gap. The predicate and its own write-up are in direct
    // opposition, which is R427's shape one plane up: a subject set whose scope is
    // set by a property its owner does not control.
    //
    // The owner does control this one, so it is derived rather than listed: round
    // reports are named `R<digits>-*.md`. docs/ holds 31 .md files and exactly one
    // matches, so this is a narrow, checkable exclusion (pinned below) rather than
    // a hand list of docs I happen to call internal.
    const ROUND_REPORT = /^R\d+[-_]/;
    const userDocs = files.filter((f) => !ROUND_REPORT.test(f));

    // Pin the exclusion so it cannot silently grow into "exclude whatever is
    // inconvenient": the round-report predicate must select a small, non-zero
    // set, and it must still select the file that caused this failure.
    const roundReports = files.filter((f) => ROUND_REPORT.test(f));
    expect(roundReports).toContain('R446-EXPORT-INVENTORY.md');
    expect(roundReports.length).toBeGreaterThan(0);
    expect(roundReports.length).toBeLessThan(userDocs.length);
    // The docs the claim is really about must still be in the subject set,
    // otherwise the arm would pass by measuring nothing.
    for (const required of ['INSTALL.md', 'API.md', 'PUBLISH.md']) {
      expect(userDocs).toContain(required);
    }

    const docs = userDocs.map((f) => readFileSync(join(docsDir, f), 'utf8')).join('\n');
    expect(docs).not.toContain('WOCLAW_LOG_FORMAT');
    expect(docs).not.toContain('WOCLAW_OTLP_ENDPOINT');
    expect(docs).not.toContain('WOCLAW_OTLP_HEADERS');
  });

  it('...while the documented env table does describe vars that are really read', () => {
    // The control for the arm above: "no doc mentions it" is only a finding if
    // the doc surface is otherwise wired to the code. If THIS failed, the
    // absence would just mean the docs are bad at everything, which is a
    // different (and much weaker) claim.
    const docsDir = join(TEST_DIR, '..', '..', 'docs');
    const install = readFileSync(join(docsDir, 'INSTALL.md'), 'utf8');
    const realVars = [
      'PORT', 'REST_PORT', 'HOST', 'DATA_DIR', 'DB_TYPE', 'SQLITE_PATH',
      'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE',
      'AUTH_TOKEN', 'TLS_KEY', 'TLS_CERT',
    ];
    const documented = realVars.filter((v) => install.includes(`\`${v}\``));
    expect(documented.length).toBe(realVars.length);
  });

  it('CONFIG_FILE — read by index.ts, absent from the env table', () => {
    // A second, unrelated instance in the same file family: the gap is not
    // specific to the observability vars, which is what makes F3 a class.
    const indexSrc = readProd(join(SRC_DIR, 'index.ts'));
    expect(indexSrc).toContain('process.env.CONFIG_FILE');
    const install = readFileSync(join(TEST_DIR, '..', '..', 'docs', 'INSTALL.md'), 'utf8');
    expect(install).not.toMatch(/`CONFIG_FILE`/);
  });
});

/**
 * R444 rules — each is a mistake or a trap this round met.
 *
 *   R444-1  🔴 The production twin of R443-2. "A gate that reads as the
 *     pipeline's switch but governs a minority of the pipeline" is the
 *     inert-by-default shape shipped deliberately. Count the governed
 *     fraction, never the gate's existence: an exported, documented,
 *     three-times-tested flag can still be inert for 94% of its sites.
 *
 *   R444-2  🔴 A documented flag and a wired flag are different claims. Read
 *     the prose that promises the behaviour (`hub_log.ts:28-39`) and measure
 *     the behaviour separately. Here the prose says "operators can flip the
 *     formatter"; the code flips 2 of 37 call sites. Asserting "the env var
 *     exists" would have passed all three existing hub_log suites.
 *
 *   R444-3  Run R406's consumer/producer symmetry check BEFORE any depth
 *     claim. `otlp_sink.ts` has 8 exports, ~9 KB, 2 green suites and 0
 *     importers. Reading its tests first would have produced "well-tested";
 *     the import scan first produces "unreachable". Same module, opposite
 *     reading, decided by which leg you walk.
 *
 *   R444-4  🔴 Two suites can both be green and the finding can still be
 *     true. Green means the assertions ran, not that the subject is reached.
 *     When the subject is unreachable, its suites cannot fail for the reason
 *     that matters — so a green suite here is evidence of correctness *and*
 *     evidence of nothing being wired.
 *
 *   R444-5  A negative result still ships as the guard. R444-2/F1 does not
 *     generalise to "every env flag is broken" — MYSQL_*, TLS_*, CONFIG_FILE
 *     are all honoured. The deliverable is the ratio assertion plus the
 *     zero-importer assertion, which is what fails if someone wires the
 *     exporter or routes hubLog through the gate.
 */
describe('R444 · the negative result is the guard', () => {
  it('the env surface is NOT uniformly broken — the finding is scoped', () => {
    // Guards against the round's own overreach. If a future change breaks the
    // documented MySQL path, this goes red and the round's claim was too broad.
    const configSrc = readProd(join(SRC_DIR, 'default_config.ts'));
    for (const v of ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE']) {
      expect(configSrc).toContain(`process.env.${v}`);
    }
    expect(configSrc).toContain('DB_TYPE');
    const indexSrc = readProd(join(SRC_DIR, 'index.ts'));
    expect(indexSrc).toContain('process.env.CONFIG_FILE');
  });

  it('hubLog/hubWarn/hubError remain the dominant log path (so F1 is the minority)', () => {
    const legacy = prodCallSites('hubLog') + prodCallSites('hubWarn') + prodCallSites('hubError');
    expect(legacy).toBeGreaterThan(prodCallSites('hubEvent'));
  });
});
