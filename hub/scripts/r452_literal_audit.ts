// R452 audit part 2 — the classifier's LITERAL EXTRACTOR, not its clauses.
//
// R446-4's shape: a regex that failed to see subjects that were really there,
// so the matcher set was empty and the probe reported "nothing found".
// R427's extractor is /['"`]([A-Za-z0-9_./-]+\.ts)['"`]/g — a string LITERAL.
// A subject named by string interpolation (`${name}.ts`, `${dir}/${n}.ts`)
// is NOT a literal, so it is invisible. But "the suite names no production
// file" and "the suite names production files in a spelling the extractor
// cannot see" are different claims, and the classifier cannot tell them apart.
//
// This reports, per suite, whether a `.ts`-bearing string exists OUTSIDE the
// extractor's alphabet, and what it resolves to. Those suites are the residue.
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
const PROD_BASE = new Set(PROD.map((f) => basename(f)));

const EXTRACTOR = /['"`]([A-Za-z0-9_./-]+\.ts)['"`]/g;
// A `.ts`-bearing string of ANY kind, including interpolation.
const ANY_TS_STRING = /['"`]([^'"`]*\.ts)['"`]/g;
// `${...}` appearing inside a quoted/backticked string that ends in .ts
const INTERPOLATED = /['"`][^'"`]*\$\{[^}]*\}[^'"`]*\.ts['"`]/g;

const files = readdirSync(TEST).filter((f) => f.endsWith('.test.ts'));
const rows: { f: string; lits: number; anyTs: string[]; interp: string[]; resolves: string[] }[] = [];
for (const f of files) {
  const src = readFileSync(join(TEST, f), 'utf8');
  const lits = [...src.matchAll(EXTRACTOR)].map((m) => m[1]);
  const anyTs = [...new Set([...src.matchAll(ANY_TS_STRING)].map((m) => m[1]))];
  const interp = [...new Set([...src.matchAll(INTERPOLATED)].map((m) => m[1]))];
  // of the anyTs set, which name a real production file (by path or basename)?
  const resolves = anyTs.filter((s) => {
    const norm = s.replace(/^\.\//, '').replace(/^\.\.\/src\//, '').replace(/^src\//, '');
    if (norm.includes('/')) return PROD.includes(norm);
    return PROD_BASE.has(norm);
  });
  rows.push({ f, lits: lits.length, anyTs, interp, resolves });
}

const missed = rows.filter((r) => r.lits === 0 && r.resolves.length > 0);
console.log(`suites: ${files.length}`);
console.log(`extractor sees 0 literals: ${rows.filter((r) => r.lits === 0).length}`);
console.log(`  ...of which name a REAL production file outside the alphabet: ${missed.length}\n`);
for (const r of missed) {
  console.log(`  ${r.f}`);
  console.log(`      resolves: ${r.resolves.join('  ')}`);
}