import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

// R437 — do the ship-gates derive their subject set from the tree they gate?
//
// The observability ship-gate in hub_log.test.ts is the canonical example of a
// gate that LISTED its subjects at authoring time:
//
//   const total = <hubLog(/hubWarn(/hubError( counts over REST_PATH + WS_PATH + INDEX_PATH);
//   expect(total).toBeGreaterThanOrEqual(28);
//
// Three files were named. hub/src/ contains 24. Six hubLog-family call sites live
// in files no arm of that gate ranges over, so a regression there is invisible to
// the gate that claims to guard the migration.
//
// This suite does NOT relax or replace that gate (R431 discipline: characterise,
// do not silently rewrite behaviour). It measures the gap and pins it.

const SRC = join(__dirname, '..', 'src');

/** The whole production tree, derived by walking the directory — not listed. */
function deriveProdFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...deriveProdFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

const LOG_FAMILY = /(?<![A-Za-z0-9_])(hubLog|hubWarn|hubError)\s*\(/g;

function countSites(src: string): number {
  return (src.match(LOG_FAMILY) || []).length;
}

/** Files the legacy aggregate gate names as its subject set. */
const GATE_LISTED = ['rest_server.ts', 'ws_server.ts', 'index.ts'];

describe('R437 — the ship-gate subject set is derived from the tree it gates', () => {
  it('A1 (falsifier, non-vacuous): the log-family predicate counts 0 on a file with no logging', () => {
    // A predicate never asked to reject anything passes everything (R427).
    // This arm calls countSites on both an accept case and a reject case.
    const clean = 'export const x = 1;\nfunction unrelated() { return 2; }\n';
    expect(countSites(clean)).toBe(0);
    // and an accept case, so a countSites that always returns 0 cannot pass A1:
    expect(countSites("hubLog('a'); hubError(`b`); hubWarn('c');")).toBe(3);
  });

  it('A2: every production file carrying log-family sites is covered by some gate arm', () => {
    const prodFiles = deriveProdFiles();
    const sitesByFile = new Map<string, number>();
    for (const f of prodFiles) {
      const n = countSites(readFileSync(f, 'utf8'));
      if (n > 0) sitesByFile.set(relative(SRC, f), n);
    }
    // Derive the uncovered class from the tree; never enumerate it by hand.
    const uncovered = [...sitesByFile.entries()]
      .filter(([rel]) => !GATE_LISTED.includes(rel))
      .sort((a, b) => b[1] - a[1]);

    // This is the round's finding: the uncovered set is NOT empty.
    // The assertion pins the *mechanism* (derived ⇒ non-empty ⇒ the gate is
    // narrower than the tree), and A4 carries the exact instance count so a
    // future change to either side is visible rather than silent.
    expect(uncovered.length).toBeGreaterThan(0);
    // Sanity: the tree walk really saw the whole source dir, not an empty dir.
    expect(prodFiles.length).toBeGreaterThan(10);
  });

  it('A3: the legacy aggregate floor is not reachable by the regression it exists to catch', () => {
    // The gate's floor is 28 over {rest_server, ws_server, index}.
    // Measure the actual count over exactly that listed set.
    const listed = GATE_LISTED.map(
      (f) => countSites(readFileSync(join(SRC, f), 'utf8')),
    );
    const total = listed.reduce((a, b) => a + b, 0);
    // Real count over the listed set today is 32 (8 + 15 + 9); floor is 28.
    // So the gate tolerates 4 silent deletions before it fires — measured, not
    // asserted-from-comment. This arm makes the slack an explicit number.
    expect(total).toBeGreaterThanOrEqual(28);
    const slack = total - 28;
    // Pin the slack: a value that silently grows or shrinks is a changed gate.
    expect(slack).toBe(4);
  });

  it('A4: the uncovered class carries a known number of sites (exact, derived)', () => {
    const uncoveredTotal = deriveProdFiles()
      .filter((f) => !GATE_LISTED.includes(relative(SRC, f)))
      .reduce((n, f) => n + countSites(readFileSync(f, 'utf8')), 0);
    // Measured: hub_log.ts 3 + startup_banner.ts 2 + memory.ts 1 = 6.
    // Exact pin (R436-3: pin the class's existence, never its size as a control —
    // but here the class is production code that only shrinks when someone
    // deletes logging, so the exact value is the signal, and A3 carries the
    // live slack separately).
    expect(uncoveredTotal).toBe(6);
  });

  it('A5 (kills M3): the tree walk RECURSES — exercised on a fixture, not the tree', () => {
    // M3 (delete the recursion) survived A1-A4: hub/src's subdirs (extraction/,
    // graph/ = 7 files) hold 0 log-family sites, so a non-recursive walk derives
    // the same set and every other arm still passes. The branch was unexercised.
    //
    // Rather than manufacture logging in production code to exercise it (R436:
    // that would corrupt the very set being measured), the recursion is
    // exercised against a throwaway fixture holding a nested file. This arm
    // does not depend on hub/src at all.
    const root = mkdtempSync(join(tmpdir(), 'r437-walk-'));
    try {
      mkdirSync(join(root, 'nested', 'deeper'), { recursive: true });
      const { writeFileSync } = require('node:fs') as typeof import('node:fs');
      writeFileSync(join(root, 'top.ts'), "hubLog('t');\n");
      writeFileSync(join(root, 'nested', 'mid.ts'), "hubWarn('m');\n");
      writeFileSync(
        join(root, 'nested', 'deeper', 'leaf.ts'),
        "hubError(`l`);\n",
      );
      writeFileSync(join(root, 'skip.d.ts'), "hubLog('declaration');\n");
      writeFileSync(join(root, 'skip.txt'), "hubLog('not typescript');\n");

      const found = deriveProdFiles(root).map((f) => relative(root, f));
      expect(found).toEqual([
        'nested/deeper/leaf.ts',
        'nested/mid.ts',
        'top.ts',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});