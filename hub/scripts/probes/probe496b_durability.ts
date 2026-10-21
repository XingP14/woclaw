/**
 * R496 probe v2 — durability / crash-consistency plane, PRODUCTION pragma posture.
 * Uses the exact pragma sequence from hub/src/db.ts:437-439.
 */
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, copyFileSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '/tmp/r496probe2';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const DB = join(DIR, 'woclaw.sqlite');

// ── EXACT production posture ────────────────────────────────────────────
const db = new Database(DB);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// production sets NO synchronous pragma

console.log('=== production pragma posture ===');
for (const p of ['journal_mode', 'synchronous', 'foreign_keys', 'busy_timeout', 'wal_autocheckpoint', 'journal_size_limit', 'auto_vacuum']) {
  console.log(`  ${p} = ${JSON.stringify(db.pragma(p, { simple: true }))}`);
}
console.log('  synchronous=2 means FULL. 0=OFF 1=NORMAL 2=FULL.');
console.log('  NOTE: better-sqlite3 does NOT change synchronous when switching to WAL.');
console.log('  => WAL + synchronous=FULL means an fsync per commit.');

db.exec(`
  CREATE TABLE IF NOT EXISTS memory (key TEXT PRIMARY KEY, value TEXT NOT NULL, tags TEXT NOT NULL,
    ttl INTEGER NOT NULL, expire_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL);
`);

const insert = db.prepare('INSERT INTO memory (key,value,tags,ttl,expire_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)');
const tx = db.transaction((p: any) => { insert.run(p.k, p.v, '[]', 0, 0, p.t, 'agent'); });
tx({ k: 'k1', v: 'committed-1', t: 1000 });
tx({ k: 'k2', v: 'committed-2', t: 2000 });

const list = (d: string) => readdirSync(d).map(f => `${f}(${statSync(join(d, f)).size}b)`).join(' ');

console.log('\n=== files on disk (WAL mode) ===');
console.log('  ', list(DIR));

console.log('\n=== SCENARIO A: operator copies ONLY woclaw.sqlite (the "obvious" backup) ===');
const B1 = join(DIR, 'backupA'); mkdirSync(B1);
copyFileSync(DB, join(B1, 'woclaw.sqlite'));
console.log('  copied:', readdirSync(B1).join(' '));
const a = new Database(join(B1, 'woclaw.sqlite'));
console.log('  backupA content:', JSON.stringify(a.prepare('SELECT key,value FROM memory ORDER BY key').all()));
console.log('  live content   :', JSON.stringify(db.prepare('SELECT key,value FROM memory ORDER BY key').all()));
a.close();

console.log('\n=== SCENARIO B: copy the whole directory (main + wal + shm) ===');
const B2 = join(DIR, 'backupB'); mkdirSync(B2);
for (const f of readdirSync(DIR)) {
  if (f.startsWith('woclaw.sqlite')) copyFileSync(join(DIR, f), join(B2, f));
}
console.log('  copied:', readdirSync(B2).join(' '));
const b = new Database(join(B2, 'woclaw.sqlite'));
console.log('  backupB content:', JSON.stringify(b.prepare('SELECT key,value FROM memory ORDER BY key').all()));
b.close();

console.log('\n=== SCENARIO C: restore backupA over a live dir (operator restore) ===');
const B3 = join(DIR, 'restoreC'); mkdirSync(B3);
copyFileSync(join(B1, 'woclaw.sqlite'), join(B3, 'woclaw.sqlite'));
const c = new Database(join(B3, 'woclaw.sqlite'));
console.log('  restored content:', JSON.stringify(c.prepare('SELECT key,value FROM memory ORDER BY key').all()));
c.close();

console.log('\n=== SCENARIO D: does a hard kill (SIGKILL) lose committed WAL data? ===');
// spawn a child that commits and is SIGKILLed without close()
const { spawnSync } = require('node:child_process');
const D = join(DIR, 'killD'); mkdirSync(D);
const child = spawnSync(process.execPath, ['-e', `
  const Database = require('${require.resolve('better-sqlite3')}');
  const db = new Database('${join(D, 'k.sqlite')}');
  db.pragma('journal_mode = WAL');
  db.prepare('CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT)').run();
  db.prepare('INSERT INTO t VALUES (?,?)').run('survives','committed-before-sigkill');
  // no close() -> simulates a killed process
  process.kill(process.pid, 'SIGKILL');
`], { encoding: 'utf-8' });
console.log('  child exit:', child.status, child.signal);
console.log('  files after SIGKILL:', list(D));
const d = new Database(join(D, 'k.sqlite'));
const dRows = d.prepare('SELECT k,v FROM t').all();
console.log('  rows readable after SIGKILL:', JSON.stringify(dRows));
console.log('  => committed row survived a SIGKILL =', dRows.length === 1 ? 'YES (WAL+FULL holds)' : 'NO');
d.close();

console.log('\n=== SCENARIO E: is there any API to get a CONSISTENT snapshot for backup? ===');
console.log('  better-sqlite3 has db.backup(dest) (the online backup API).');
const E = join(DIR, 'online.sqlite');
const e = new Database(join(D, 'k.sqlite'));
try {
  (e as any).backup(E).then(() => {
    const ev = new Database(E);
    console.log('  db.backup() result:', JSON.stringify(ev.prepare('SELECT k,v FROM t').all()));
    ev.close(); e.close(); db.close();
    console.log('\nPROBE_DONE');
  }).catch((err: any) => { console.log('  backup err', err); db.close(); console.log('\nPROBE_DONE'); });
} catch (err: any) {
  console.log('  backup threw:', err?.message);
  db.close();
  console.log('\nPROBE_DONE');
}
