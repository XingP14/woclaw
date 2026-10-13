// R452 audit — reuse R427's own classifier (copied verbatim from
// test/r427_subject_set_coverage.test.ts) and report, per test file, WHICH
// clause excluded it. The question R452 asks is not "is the class correct" but
// "what does the classifier discard, and does any discarded file look like the
// thing the class exists to catch?"
//
// Every clause is labelled so a miss is attributable:
//   NEGATIVE   no absence-assertion form          -> not a negative probe
//   ITERATES   no loop/iterator over subjects     -> a focused read, by design
//   DERIVES    set comes from readdirSync         -> derived, R426's fix
//   MIN2       names < 2 production literals      -> threshold, R427's choice
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const TEST = '/root/.hermes/workspace/woclaw/hub/test';
const SRC = '/root/.hermes/workspace/woclaw/hub/src';

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

const NEGATIVE = /toEqual\(\[\]\)|toHaveLength\(0\)|not\.toMatch|not\.toContain|toBe\(false\)|\.length\)\.toBe\(0\)/;
const ITERATES = /for \(const \w+ of |\.forEach\(|\.map\(/;
const DERIVES = /readdirSync/;

function classify(src: string) {
  const lits = [...new Set(
    [...src.matchAll(/['"`]([A-Za-z0-9_./-]+\.ts)['"`]/g)].map((m) => m[1]),
  )];
  const resolved = new Set<string>();
  const ambiguous = new Set<string>();
  for (const lit of lits) {
    const writtenAsPath = lit.includes('/');
    const norm = lit.replace(/^\.\//, '').replace(/^src\//, '');
    if (writtenAsPath) {
      if (PROD.includes(norm)) resolved.add(norm);
      continue;
    }
    const holders = PROD.filter((f) => basename(f) === norm);
    if (holders.length === 1) resolved.add(holders[0]);
    else if (holders.length > 1) ambiguous.add(norm);
  }
  const n = resolved.size + ambiguous.size;
  const fail: string[] = [];
  if (!NEGATIVE.test(src)) fail.push('NEGATIVE');
  if (!ITERATES.test(src)) fail.push('ITERATES');
  if (DERIVES.test(src)) fail.push('DERIVES');
  if (n < 2) fail.push('MIN2');
  return { fail, resolved: [...resolved].sort(), ambiguous: [...ambiguous].sort(), n };
}

const files = readdirSync(TEST).filter((f) => f.endsWith('.test.ts'));
const rows = files.map((f) => ({ f, ...classify(readFileSync(join(TEST, f), 'utf8')) }));

console.log(`PROD files: ${PROD.length}   test suites: ${files.length}`);
console.log(`IN CLASS (no failing clause): ${rows.filter((r) => r.fail.length === 0).length}`);
console.log('\n=== exclusion tally (a suite can fail several clauses) ===');
const tally: Record<string, number> = {};
for (const r of rows) for (const c of r.fail) tally[c] = (tally[c] || 0) + 1;
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

console.log('\n=== suites whose ONLY failing clause is DERIVES ===');
for (const r of rows) {
  if (r.fail.length === 1 && r.fail[0] === 'DERIVES' && r.n >= 2) {
    console.log(`  ${r.f}  (names ${r.n})`);
  }
}

console.log('\n=== suites whose ONLY failing clause is MIN2 (>=1 literal, not >=2) ===');
for (const r of rows) {
  if (r.fail.length === 1 && r.fail[0] === 'MIN2') console.log(`  ${r.f}  names=${r.n} lits=[${r.resolved.join(',')}${r.ambiguous.length ? ' AMBIG:' + r.ambiguous.join(',') : ''}]`);
}

console.log('\n=== suites failing MIN2 AND ITERATES AND NEGATIVE (one-literal hand lists) ===');
for (const r of rows) {
  if (r.fail.includes('MIN2') && r.fail.includes('ITERATES') && r.fail.includes('NEGATIVE') && !r.fail.includes('DERIVES')) {
    console.log(`  ${r.f}  names=${r.n}`);
  }
}