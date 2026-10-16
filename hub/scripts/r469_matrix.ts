// R469 mutation matrix. Pins every needle inside the program (argv->shell->python
// mangling pitfall) and reports HARNESS separately from VERDICT.
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const SRC = 'src/db.ts';
const BACKUP = '/tmp/r469_db.ts.orig';
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');

copyFileSync(SRC, BACKUP);
const orig = readFileSync(SRC, 'utf8');
const origMd5 = md5(SRC);
console.log('baseline md5', origMd5, 'lines', orig.split('\n').length);

const D = '$' + '{'; // build template-literal holes without this file interpolating

const MUTS = [
  {
    id: 'M1', expect: 'kill',
    note: 'THE REPAIR: add the expiry filter getMemoryVersions lacks',
    needle: `      FROM memory_versions\n      WHERE key = ?\n      ORDER BY version DESC\n    \`).all(key)`,
    repl: `      FROM memory_versions\n      WHERE key = ? AND (expire_at = 0 OR expire_at > ` + D + `now})\n      ORDER BY version DESC\n    \`).all(key)`,
  },
  {
    id: 'M2', expect: 'kill',
    note: 'stop archiving the EXISTING row on overwrite',
    needle: `      if (existing) {\n        const versionRow = this.db.prepare(\``,
    repl: `      if (existing && false) {\n        const versionRow = this.db.prepare(\``,
  },
  {
    id: 'M3', expect: 'kill',
    note: 'archive the overwrite with a NEVER-expiring expire_at (zeroing history TTL)',
    needle: `          asNumber(existing.ttl, 0),\n          asNumber(existing.expire_at, 0),\n          asNumber(existing.updated_at, 0),`,
    repl: `          asNumber(existing.ttl, 0),\n          0,\n          asNumber(existing.updated_at, 0),`,
  },
  {
    id: 'M4', expect: 'kill',
    note: 'make getMemory READ-ONLY: stop deleting the expired live row',
    needle: `      await this.deleteMemory(key);\n      return undefined;`,
    repl: `      return undefined;`,
  },
  {
    id: 'M5', expect: 'kill',
    note: 'over-broad sweep: drop the expiry predicate entirely',
    needle: `      DELETE FROM memory\n      WHERE expire_at > 0 AND expire_at < ?\n    \`).run(now);`,
    repl: `      DELETE FROM memory\n    \`).run(now);`,
  },
  {
    id: 'M6', expect: 'survive',
    note: 'CONTROL: flip the history ORDER BY. Every arm writes ONE version row, so this is unobservable',
    needle: `      FROM memory_versions\n      WHERE key = ?\n      ORDER BY version DESC`,
    repl: `      FROM memory_versions\n      WHERE key = ?\n      ORDER BY version ASC`,
  },
];

let killed = 0, survivors = [], harness = 0;
const rows = [];
for (const m of MUTS) {
  if (!orig.includes(m.needle)) {
    harness++;
    rows.push(`${m.id}: HARNESS (ANCHOR MISS — needle not in source)`);
    continue;
  }
  const out = orig.replace(m.needle, m.repl);
  if (out === orig) {
    harness++;
    rows.push(`${m.id}: HARNESS (NO-OP — replace returned self)`);
    continue;
  }
  writeFileSync(SRC, out);
  if (md5(SRC) === origMd5) {
    harness++;
    rows.push(`${m.id}: HARNESS (write did not change bytes)`);
    writeFileSync(SRC, orig);
    continue;
  }
  let log;
  try {
    log = execSync('npx vitest run test/r469_expiry_reach.test.ts 2>&1', { encoding: 'utf8', timeout: 300000 });
  } catch (e) {
    log = (e.stdout || '') + (e.stderr || '');
  }
  writeFileSync(SRC, orig);
  const red = /Tests\s+\d+ failed|❯ test\/r469|FAIL\s+test\/r469/.test(log);
  if (m.expect === 'survive') {
    if (red) { harness++; rows.push(`${m.id}: HARNESS (control went RED — suite pins more than claimed)`); }
    else { survivors.push(m.id); rows.push(`${m.id}: SURVIVED (expected control) — ${m.note}`); }
  } else if (red) {
    killed++;
    const arm = (log.match(/arm ([A-E])[^\n]*/) || [])[1] || '?';
    rows.push(`${m.id}: KILLED at arm ${arm} — ${m.note}`);
  } else {
    survivors.push(m.id);
    rows.push(`${m.id}: SURVIVED (FINDING — zero reach) — ${m.note}`);
  }
}

writeFileSync(SRC, orig);
console.log('\n--- MATRIX ---');
rows.forEach(r => console.log(r));
console.log('\nMATRIX killed=%d survivors=%d harness=%d', killed, survivors.length, harness);
console.log('CONTROL_SURVIVED=%s (%s)', survivors.includes('M6'), survivors.join(','));
console.log('src/ md5 before=%s after=%s IDENTICAL=%s', origMd5, md5(SRC), origMd5 === md5(SRC));
