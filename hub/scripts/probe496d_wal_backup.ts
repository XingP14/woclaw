/**
 * R496 probe v4 — the WAL file-copy backup trap, with the PRODUCTION pragma posture.
 *
 * The trap: SQLite in WAL mode keeps committed-but-not-checkpointed pages in
 * `woclaw.sqlite-wal`. An operator who "backs up the database" by copying
 * `woclaw.sqlite` gets a file that does NOT contain the latest committed data.
 *
 * The production code sets `journal_mode = WAL` and NEVER calls
 * `wal_checkpoint()`, so the WAL is only drained by SQLite's own
 * `wal_autocheckpoint` (1000 pages) — which needs the WAL to reach ~4 MB.
 */
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '/tmp/r496probe4';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const DB = join(DIR, 'woclaw.sqlite');

const db = new Database(DB);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// no synchronous pragma -> SQLite default FULL

db.exec(`CREATE TABLE memory (key TEXT PRIMARY KEY, value TEXT NOT NULL, tags TEXT NOT NULL,
  ttl INTEGER NOT NULL, expire_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL);`);

const ins = db.prepare('INSERT INTO memory (key,value,tags,ttl,expire_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)');
const tx = db.transaction((p: any) => ins.run(p.k, p.v, '[]', 0, 0, p.t, 'agent'));
tx({ k: 'early', v: 'written-before-backup', t: 1000 });

const list = (d: string) => readdirSync(d).map(f => `${f}(${statSync(join(d, f)).size}b)`).join(' ');
console.log('files after 1 tx:', list(DIR));

// Write MORE than the autocheckpoint threshold (1000 pages * 4096 = ~4 MB)
// so the WAL grows and autocheckpoint does NOT drain it.
const big = 'x'.repeat(8000);
let n = 0;
for (let i = 0; i < 900; i++) {
  tx({ k: `bulk-${i}`, v: `${big}-${i}`, t: 2000 + i });
  n++;
}
console.log(`wrote ${n} bulk rows; files:`, list(DIR));
console.log('wal_autocheckpoint =', db.pragma('wal_autocheckpoint', { simple: true }), '(pages)');

console.log('\n--- operator copies ONLY woclaw.sqlite ---');
const B = join(DIR, 'backup'); mkdirSync(B);
copyFileSync(DB, join(B, 'woclaw.sqlite'));
console.log('backup dir:', readdirSync(B).join(' '), `(${statSync(join(B, 'woclaw.sqlite')).size}b)`);
console.log('live  main :', `${statSync(DB).size}b`);

const b = new Database(join(B, 'woclaw.sqlite'));
const bRows = b.prepare('SELECT COUNT(*) c FROM memory').get() as any;
const lRows = db.prepare('SELECT COUNT(*) c FROM memory').get() as any;
console.log('backup row count:', bRows.c, ' live row count:', lRows.c);
const early = b.prepare('SELECT value FROM memory WHERE key=?').get('early') as any;
console.log('backup contains the earliest row?', early ? 'YES' : 'NO  <-- committed data LOST');
b.close();

console.log('\n--- the copy that DOES work: copy main + wal + shm together ---');
const B2 = join(DIR, 'backup2'); mkdirSync(B2);
for (const f of readdirSync(DIR)) if (f.startsWith('woclaw.sqlite')) copyFileSync(join(DIR, f), join(B2, f));
console.log('backup2 dir:', readdirSync(B2).join(' '));
const b2 = new Database(join(B2, 'woclaw.sqlite'));
console.log('backup2 row count:', (b2.prepare('SELECT COUNT(*) c FROM memory').get() as any).c);
b2.close();

console.log('\n--- the copy that works BEST: db.backup() online backup API ---');
const OUT = join(DIR, 'online.sqlite');
db.backup(OUT).then(() => {
  const o = new Database(OUT);
  console.log('online backup row count:', (o.prepare('SELECT COUNT(*) c FROM memory').get() as any).c);
  o.close(); db.close();
  console.log('\nPROBE_DONE');
}).catch((e: any) => { console.log('err', e); db.close(); console.log('\nPROBE_DONE'); });
