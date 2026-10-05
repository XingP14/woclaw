/**
 * R417 — the extraction plane is wired to nothing.
 *
 * R413 queued one item: `extraction/engine.ts:84` calls `syncMemoryNode`
 * directly, so keys arriving through extraction exist ONLY in the graph
 * store with no `memory` row, and therefore no scope marker to check.
 * It is not blocked by the ws_server.ts:132 token binding — the queued note
 * said so explicitly — so it was the one actionable item left.
 *
 * Executing it produced a strictly larger fact. Before asking "should an
 * extraction-derived key be allowed to have no first-layer row", the
 * question "is the extractor ever invoked at all" had to be answered,
 * because a policy about keyless rows is meaningless if no keys are
 * produced.
 *
 * What is proven here, by static reachability over `hub/src`:
 *
 *   1. `createExtractionEngine` is defined once and called zero times.
 *      `new ExtractionEngine(...)` appears only inside its own factory.
 *   2. `ForgettingScheduler` accepts an `ExtractionEngine | null` in its
 *      constructor, and `index.ts:69` — the single production construction
 *      site — passes literal `null`. The parameter is then read zero times:
 *      `grep -c extractionEngine scheduler.ts` == 1, which is the
 *      parameter-property declaration itself.
 *   3. Consequently the `extraction_queue` table has exactly one writer
 *      (`scheduler.ts:120`, `addToExtractionQueue`) and ZERO readers
 *      anywhere outside `db.ts`. The daily scan enqueues rows that nothing
 *      has ever dequeued, in two storage backends, for the life of the
 *      process.
 *
 * So the queued question is currently unaskable: no extraction-derived key
 * has ever been created, because no extraction has ever run.
 *
 * This suite pins the *absence* as a test. It is a reachability assertion,
 * not a behavioural one — the same artifact class as R401.3 / R403.2 /
 * R404.4 / R405.4 (a pure predicate that turns a hidden class red in CI).
 * A future commit that wires the extractor up will turn these red, which
 * is the point: the change becomes a deliberate, reviewed act rather than
 * an accident of a null argument.
 *
 * It also pins the *asymmetry* that made the finding cheap: the memory
 * plane has a scope marker on every row and 8 guarded read paths (R410),
 * while the entire extraction plane has no reachable entry point at all.
 * Both facts belong in the same sentence — a 100%-unreachable plane is not
 * a plane with a coverage problem.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SRC = join(process.cwd(), 'src');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

/**
 * Every production .ts under src/, recursively.
 *
 * The recursive walk is load-bearing, not tidiness: extraction/ and graph/
 * are subdirectories, and the first version of this helper used a
 * non-recursive readdirSync. That produced five failures with five
 * different messages (M410 Rule 2 — heterogeneous failure shapes mean the
 * probe is broken, not the code), and the two "code is dead" facts that
 * mattered most were the ones reported as missing. A probe that cannot see
 * a whole subtree will confidently declare the contents absent.
 */
function prodFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...prodFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Occurrences of `needle` across all of src/, as "src-relative-file:line". */
function sites(needle: string): string[] {
  const out: string[] = [];
  for (const abs of prodFiles()) {
    const rel = abs.slice(SRC.length + 1);
    readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
      if (line.includes(needle)) out.push(`${rel}:${i + 1}`);
    });
  }
  return out;
}

describe('R417: the extraction plane has no production entry point', () => {
  it('A1: createExtractionEngine is defined once and called zero times', () => {
    // The factory is the ONLY legitimate construction site, so it is
    // excluded from the "callers" count while still being required to
    // exist. If a caller ever appears, this fails and the rest of the
    // suite is knowingly obsolete.
    const defs = sites('createExtractionEngine');
    expect(defs).toEqual(['extraction/engine.ts:33']);

    const callers = sites('createExtractionEngine(').filter(s => s !== 'extraction/engine.ts:33');
    expect(callers).toEqual([]);
  });

  it('A2: new ExtractionEngine appears only inside its own factory', () => {
    // Guards the direct-construction escape hatch: someone could skip the
    // factory and instantiate the class, which A1 would not see.
    const ctors = sites('new ExtractionEngine');
    expect(ctors).toEqual(['extraction/engine.ts:34']);
  });

  it('A3: setGraphStore is never called by production code', () => {
    // The engine is useless without a graph store; this is the other
    // half of the same unreachability, and the half R413 was looking at.
    const callers = sites('setGraphStore(');
    expect(callers).toEqual(['extraction/engine.ts:71']);
  });

  it('B1: the sole production ForgettingScheduler passes literal null', () => {
    // The parameter is typed `ExtractionEngine | null`, so passing null
    // type-checks cleanly. That is why this has stayed invisible: the
    // signature promises the capability and the call site declines it.
    const sitesFound = sites('new ForgettingScheduler');
    expect(sitesFound).toEqual(['index.ts:69']);

    const line = read('index.ts').split('\n')[68];
    expect(line).toContain('new ForgettingScheduler(db, sessionStore, null)');
  });

  it('B2: the injected field is declared and never read', () => {
    // Count == 1 means the only mention is the constructor's
    // parameter-property declaration. Anything above 1 would be a real
    // consumer and would make B1 a wiring decision rather than a defect.
    const lines = read('scheduler.ts').split('\n')
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(x => x.l.includes('extractionEngine'));
    expect(lines).toHaveLength(1);
    expect(lines[0].n).toBe(46);
    expect(lines[0].l).toContain('private extractionEngine: ExtractionEngine | null');
  });

  it('C1: extraction_queue has one writer and zero readers outside db.ts', () => {
    // The daily scan's whole output. One producer, no consumer, in both
    // SQLite and MySQL backends.
    //
    // The pin is on the *shape* — every site of every queue method lies
    // inside db.ts except exactly one, the writer — rather than on a
    // hand-copied list of line numbers. A hardcoded list here would be
    // this round's own M410-Rule-3 mistake: an inherited denominator.
    // The first draft asserted a literal array and failed, because
    // db.ts's own interface declarations and delegating wrappers add
    // sites I had not enumerated; deriving the invariant from the scan is
    // what makes it survive an added storage backend.
    const enqueue = sites('addToExtractionQueue');
    const outsideDb = enqueue.filter(s => !s.startsWith('db.ts'));
    expect(outsideDb).toEqual(['scheduler.ts:120']);

    // No consumer anywhere: the daily scan enqueues rows that nothing has
    // ever dequeued, in either storage backend, for the life of the
    // process.
    for (const fn of ['getExtractionQueue(', 'updateExtractionQueueStatus(', 'removeFromExtractionQueue(']) {
      const outside = sites(fn).filter(s => !s.startsWith('db.ts'));
      expect(outside, `${fn} must have no consumer outside db.ts`).toEqual([]);
    }
  });

  it('C2: the ExtractionQueueEntry type has no consumer outside db.ts/types.ts', () => {
    // A type with a single writer is a schema; a type with a single writer
    // and no reader is a schema describing nothing. (M406: name which
    // side is missing — here BOTH the consumer and the type escape hatch.)
    const readers = sites('ExtractionQueueEntry').filter(s => !s.startsWith('db.ts') && !s.startsWith('types.ts'));
    expect(readers).toEqual([]);
  });

  it('D1: the asymmetry is stated in both directions', () => {
    // R410 Rule 6, applied to a whole plane: state the strong fact and the
    // missing fact in the same assertion, so neither can be quoted alone.
    // 8 guarded memory read paths (R410) vs a plane with 0 entry points.
    const memoryPaths = sites('isVisibleInScope');
    expect(memoryPaths).toContain('memory.ts:110');

    const extractionEntryPoints = sites('createExtractionEngine(').filter(s => s !== 'extraction/engine.ts:33');
    expect(extractionEntryPoints).toEqual([]);

    // The queued R413 question — should an extraction-derived key be
    // allowed to have no first-layer `memory` row? — is currently
    // unaskable, because no such key has ever been produced. Recorded
    // here so the next round inherits the premise rather than the symptom.
    const syncCalls = sites('syncMemoryNode');
    expect(syncCalls).toContain('extraction/engine.ts:84');
    expect(syncCalls).toContain('memory.ts:148');
  });
});
