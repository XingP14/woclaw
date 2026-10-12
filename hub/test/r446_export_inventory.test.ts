/**
 * R446 — the export-name gap R445 recorded as an unclosed mutation, EXECUTED.
 *
 * R445 ran M6 ("rename an `otlp_sink` export") against
 * `r444_env_gate_is_not_the_pipeline.test.ts` and recorded it as **SURVIVED**,
 * pinned in that commit's body as an open gap: *the suite proves the module has
 * no production importer, not that its export names are stable.*
 *
 * This round ran the gap instead of describing it — and **the gap was not
 * there**. Both premises the interrupted draft carried were false, and both
 * were falsified by execution rather than by reading:
 *
 *   **Premise 1 (from R445): "the guard cannot see export renames."** FALSE.
 *   Measured: renaming `applyOtlpPartialSuccess` → `applyPartialSuccess` in
 *   `hub/src/otlp_sink.ts` **only** turns **3 arms red** in
 *   `otlp_sink.test.ts` (`source (1)`, `source (4)`, `runtime (8)`) and leaves
 *   R444's 16 arms **entirely green**. R445's SURVIVED came from a repo-wide
 *   `sed` that aliased the new name into the *importing suite as well* — so
 *   the suite under mutation was mutated alongside its subject, and its
 *   ability to notice the rename was deleted along with the name.
 *
 *   **Premise 2 (from the interrupted draft): "the otlp suites import a strict
 *   subset, so 6 of 8 exports are unexercised."** FALSE.
 *   Measured: `otlp_sink.test.ts` imports **all 8**. The draft's `unexercised`
 *   arm was itself broken — its regex required `from '../src/otlp_sink.js'` on
 *   one line, and every import in both files is a **multi-line named import**,
 *   so the match set came back empty and the arm computed "nothing is
 *   imported" (R421-1 in its purest form: a subject set that silently empties).
 *
 * So the real finding is sharper and smaller than the draft claimed:
 *
 *   **R444 sees 0 of 8 renames — and R444 never claimed otherwise.** R444's
 *   single otlp-name pin (line 245, `expect(src).toContain('sendOtlpLogsOnce')`)
 *   sits inside the arm whose stated purpose is *"the module is substantial,
 *   not a stub — the dead code is real code"*. It is a **silhouette** arm. The
 *   renames ARE caught — by the two **behavioural** suites, via their runtime
 *   imports, because they import the whole inventory. What R444 cannot see is
 *   therefore not "renames" but "a rename that is also aliased into both
 *   importing suites" — i.e. the rename R445 accidentally performed.
 *
 * Method notes (R446):
 *
 *   **R446-1  🔴 A `cp` backup taken after a mutation is not a backup.**
 *   Inherited from the interrupted tick's notes, and it nearly cost this round
 *   its control. `git checkout --` restores tracked files from the object
 *   store; `cp` copies whatever bytes are on disk *right now*. After a `sed`,
 *   the second faithfully reproduces the mutation. Every restore in this round
 *   was done with `git checkout --` plus an `md5sum` readback, and the control
 *   was re-measured at **46/46** on the restored tree before any number below
 *   was quoted. A restore is only evidence if the mutated state is provably gone.
 *
 *   **R446-2  🔴 A mutation that edits the probe's own subject is not a
 *   mutation — it is a co-mutation.** `otlp_sink.test.ts` is BOTH a guard
 *   under test AND a file the `sed` was pointed at. Once the rename is aliased
 *   into the importing suite, that suite's 3 source/runtime arms stop referring
 *   to the name at all, so they cannot fail on it. **A repo-wide search-and-
 *   replace is the natural way to run a rename mutation, and it is invalid
 *   whenever the probe imports the subject.** The correct move is to rename in
 *   `src/` only, or to mutate a copy.
 *
 *   **R446-3  Silhouette assertions are satisfiable by shape, not behaviour.**
 *   R444's otlp arm makes exactly three checks — a count of `export function`
 *   occurrences, one pinned name, a byte count — and all three survive any
 *   rename and most stubs. What actually fails a stub is the 43 behavioural
 *   arms in the two otlp suites, none of which live in R444. So R444's
 *   silhouette arm is *correct about its own stated purpose* (the code is
 *   substantial) and **silent about the only thing that matters** (the code is
 *   reachable).
 *
 *   **R446-4  A multi-line named import defeats a single-line regex.** Both
 *   otlp suites write
 *   `import {\n  buildOtlpLogRecord,\n ...\n} from '../src/otlp_sink.js';`.
 *   Any probe requiring the whole `from '...'` clause on one line matches 0
 *   imports and concludes the module is unexercised. The arm that made this
 *   mistake is preserved below **in both forms** — broken and corrected — so
 *   the trap cannot recur silently.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src');
const TEST_DIR = __dirname;
const OTLP = join(SRC, 'otlp_sink.ts');

function readProd(p: string): string {
  return readFileSync(p, 'utf8');
}

/** Every `export`-ed function declaration name, value-level only. */
function exportedNames(src: string): string[] {
  return [...src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
}

/** Every `export`-ed interface/type name. */
function exportedTypes(src: string): string[] {
  return [...src.matchAll(/^export\s+interface\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
}

/**
 * Named imports of `../src/otlp_sink.js` across a set of suite sources.
 *
 * R446-4: the brace body is matched with `[^}]*` — a *negated* character class,
 * which already spans newlines. That is precisely what the interrupted draft
 * got wrong by requiring the whole `from '...'` clause on one line.
 */
function importedNames(suiteSrc: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of suiteSrc) {
    for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/src\/otlp_sink\.js'/g)) {
      for (const n of m[1].split(',')) {
        const t = n.trim();
        if (t) out.add(t);
      }
    }
  }
  return out;
}

/**
 * The body of R444's otlp silhouette arm — sliced from the guard itself.
 *
 * The slice is bounded by the arm's own closing `});`, NOT by end-of-file: R444
 * has 16 arms, so an unbounded slice silently swallows every arm after this one
 * and reports 16 `expect(` calls where the arm has 3. That is R445-3 one level
 * up — a number read off an over-wide window is not a smaller number, it is a
 * different subject — so the window is bounded and the bound is asserted.
 */
function r444SilhouetteArm(): string {
  const r444 = readProd(join(TEST_DIR, 'r444_env_gate_is_not_the_pipeline.test.ts'));
  const start = r444.indexOf('the module is substantial');
  const end = r444.indexOf('});', start);
  return r444.slice(start, end);
}

describe('R446 — the corrected finding: R444 sees 0 of 8, and never claimed otherwise', () => {
  it('⭐ derives the module\'s exported function set from its own source', () => {
    expect(exportedNames(readProd(OTLP))).toEqual([
      'buildOtlpLogRecord',
      'buildOtlpExportRequest',
      'getDroppedRecordsTotal',
      'resetDroppedRecordsTotal',
      'applyOtlpPartialSuccess',
      'otlpEnabled',
      'otlpEndpoint',
      'sendOtlpLogsOnce',
    ]);
  });

  it('⭐ R444 pins exactly ONE of the eight names, inside a silhouette arm', () => {
    // R444:245 — `expect(src).toContain('sendOtlpLogsOnce')` — one literal, and
    // it is the only `toContain` in R444 naming an otlp export. Everything else
    // R444 checks about this module is shape (a count, a length, a file's
    // existence) and is rename-invariant by construction.
    const r444 = readProd(join(TEST_DIR, 'r444_env_gate_is_not_the_pipeline.test.ts'));
    const inventory = exportedNames(readProd(OTLP));
    const pins = [...r444.matchAll(/toContain\('([A-Za-z0-9_$]*)'\)/g)].map((m) => m[1]);
    // `WOCLAW_OTLP_ENDPOINT` etc. are F1's subject, not F2's; only a bare
    // export name counts as a pin on this module's surface.
    expect(pins.filter((n) => inventory.includes(n))).toEqual(['sendOtlpLogsOnce']);
  });

  it('⭐ the two rename modes are caught by DISJOINT guards', () => {
    // The round\'s actual finding, stated as an executable claim.
    //
    // Measured in this session, same tree, same mutation:
    //   rename in `src/` ONLY  → R444 16/16 green · otlp suites 3 arms red
    //   rename in src + suites → R444 16/16 green · otlp suites 43/43 green
    // and the only guard that fires in the second mode is a name-inventory
    // assertion — which is what this file is.
    //
    // R445 recorded the second mode as a flat "the guard cannot see renames".
    // The measurement says the guard was never blind: the *co-mutation*
    // removed the rename from the importing suite's vocabulary, so the suite
    // could not notice it. R444\'s single pin is structural, not accidental —
    // it lives in a silhouette arm ("the dead code is real code") that was
    // never a rename-detection surface by design.
    const arm = r444SilhouetteArm();
    expect(arm).toContain('the module is substantial, not a stub');
    // Count + length + one name: all rename-safe.
    expect([...arm.matchAll(/expect\(/g)].length).toBe(3);
    expect(arm).toMatch(/toBeGreaterThanOrEqual\(7\)/);
    expect(arm).toMatch(/src\.length\)\.toBeGreaterThan\(4000\)/);
  });

  it('the exported type names are pinned too', () => {
    expect(exportedTypes(readProd(OTLP))).toEqual([
      'OtlpLogRecord',
      'OtlpExportRequest',
      'OtlpExportPartialSuccess',
      'OtlpExportResponse',
      'OtlpSendResult',
    ]);
  });
});

describe('R446 — R446-4: a single-line regex reads a multi-line import as absent', () => {
  it('⭐ the corrected probe finds all 8 names; the broken form finds 0', () => {
    const suites = [
      readProd(join(TEST_DIR, 'otlp_sink.test.ts')),
      readProd(join(TEST_DIR, 'otlp_sink_edge_branches.test.ts')),
    ];

    // BROKEN — the interrupted draft\'s form: requires `from \'...\'` on one line.
    const broken = new Set<string>();
    for (const s of suites) {
      for (const m of s.matchAll(/import\s*\{([^\n}]*)\}\s*from\s*\'\.\.\/src\/otlp_sink\.js\'/g)) {
        for (const n of m[1].split(',')) if (n.trim()) broken.add(n.trim());
      }
    }

    // CORRECTED — `[^}]*` spans newlines.
    const corrected = importedNames(suites);

    // The trap, pinned: the broken form concludes *nothing is imported*, which
    // is how the draft produced "6 of 8 unexercised" out of a suite that
    // imports all 8. A zero from a text probe must be distinguished from a zero
    // that is real (R443\'s whole subject: a subject read as text is not thereby
    // absent).
    expect(broken.size).toBe(0);
    expect(corrected.size).toBe(8);
    const real = exportedNames(readProd(OTLP));
    expect([...corrected].filter((n) => !real.includes(n))).toEqual([]);
  });

  it('the edge-branch suite alone exercises 4 of 8 — a real, narrower number', () => {
    const names = importedNames([readProd(join(TEST_DIR, 'otlp_sink_edge_branches.test.ts'))]);
    const real = exportedNames(readProd(OTLP));
    expect(real.filter((n) => !names.has(n)).sort()).toEqual([
      'applyOtlpPartialSuccess',
      'buildOtlpExportRequest',
      'otlpEnabled',
      'otlpEndpoint',
    ]);
  });
});

describe('R446 — R446-3: silhouette arms are satisfied by shape, not behaviour', () => {
  it('⭐ R444\'s otlp arm is a silhouette arm and says so in its own title', () => {
    expect(r444SilhouetteArm()).toContain('the module is substantial, not a stub');
  });

  it('the one thing a stub cannot fake is the real transport call', () => {
    // A same-signature no-op exporter would still declare 8 functions, still
    // contain the pinned name, and could still pad the file past 4000 bytes.
    // What it cannot do without ceasing to be the module under test is call
    // `fetch`. This is the falsifiable half; the honest half is the arm above.
    expect(readProd(OTLP)).toMatch(/await\s+fetch\s*\(/);
  });
});

describe('R446 rules — mistakes and traps this round met', () => {
  it('R446-1 — a restore is only evidence if the mutated state is provably gone', () => {
    // Every mutation in this round was reverted with `git checkout --` (object
    // store) and verified with `md5sum` readback, and the control was
    // re-measured at 46/46 before any number was quoted. `cp` restores were
    // used only for the pre-mutation baseline, never after a `sed`.
    expect(readProd(OTLP)).toMatch(
      /export\s+(?:async\s+)?function\s+applyOtlpPartialSuccess/
    );
    expect(exportedNames(readProd(OTLP))).toHaveLength(8);
  });

  it('R446-2 — a mutation that edits the probe\'s own subject is a co-mutation', () => {
    // The rename mutation must be applied to `hub/src/otlp_sink.ts` only. If a
    // suite that imports the subject is rewritten in the same `sed`, that suite
    // stops referring to the name and can no longer fail on it — the result
    // reads as SURVIVED and is an artefact of the procedure.
    //
    // Asserted structurally: the two suites still name all 8 exports, so any
    // future round running this mutation has an unambiguous precondition.
    const suites = [
      readProd(join(TEST_DIR, 'otlp_sink.test.ts')),
      readProd(join(TEST_DIR, 'otlp_sink_edge_branches.test.ts')),
    ];
    expect(importedNames(suites).size).toBe(8);
  });

  it('R446-4 — a multi-line named import defeats a single-line regex', () => {
    expect(importedNames([readProd(join(TEST_DIR, 'otlp_sink.test.ts'))]).size).toBe(8);
  });
});
