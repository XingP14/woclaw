/**
 * R496 probe — durability / crash-consistency plane.
 * Measures the ACTUAL runtime posture of the production SQLite store.
 */
import Database from 'better-sqlite3';
import { existsSync, copyFileSync, mkdirSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] || '/tmp/r496probe';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const DB = join(DIR, 'woclaw.sqlite');

const db = new Database(DB);

console.log('=== PRAGMA posture (fresh db, first connection) ===');
for (const p of ['journal_mode', 'synchronous', 'foreign_keys', 'busy_timeout', 'page_size', 'auto_vacuum', 'wal_autocheckpoint']) {
  const v = db.pragma(p, { simple: true });
  console.log(`  ${p} = ${JSON.stringify(v)}`);
}

console.log('\n=== does the DDL declare ANY foreign key? ===');
db.exec(`CREATE TABLE parent (id TEXT PRIMARY KEY);
         CREATE TABLE child (id TEXT PRIMARY KEY, pid TEXT);`);
for (const t of ['parent', 'child']) {
  const fks = db.pragma(`foreign_key_list(${t})`);
  console.log(`  ${t}: ${JSON.stringify(fks)}`);
}
console.log('  => foreign_keys=ON with 0 declared constraints means the pragma has NO subject.');

console.log('\n=== setMemory-like transaction shape: memory + memory_versions in one tx ===');
db.exec(`
  CREATE TABLE memory (key TEXT PRIMARY KEY, value TEXT NOT NULL, tags TEXT NOT NULL, ttl INTEGER NOT NULL,
    expire_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL);
  CREATE TABLE memory_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value TEXT NOT NULL,
    version INTEGER NOT NULL, tags TEXT NOT NULL, ttl INTEGER NOT NULL, expire_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL);
`);
const tx = db.transaction((p: any) => {
  const existing = db.prepare('SELECT key,value,tags,ttl,expire_at,updated_at,updated_by FROM memory WHERE key=?').get(p.key) as any;
  if (existing) {
    const mv = db.prepare('SELECT COALESCE(MAX(version),0) AS m FROM memory_versions WHERE key=?').get(p.key) as any;
    db.prepare('INSERT INTO memory_versions (key,value,version,tags,ttl,expire_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(p.key, existing.value, mv.m + 1, existing.tags, existing.ttl, existing.expire_at, existing.updated_at, existing.updated_by);
    db.prepare('UPDATE memory SET value=?,tags=?,ttl=?,expire_at=?,updated_at=?,updated_by=? WHERE key=?')
      .run(p.value, p.tags, p.ttl, p.expireAt, p.now, p.updatedBy, p.key);
  } else {
    db.prepare('INSERT INTO memory (key,value,tags,ttl,expire_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)')
      .run(p.key, p.value, p.tags, p.ttl, p.expireAt, p.now, p.updatedBy);
  }
});
tx({ key: 'k1', value: 'v1', tags: '[]', ttl: 0, expireAt: 0, now: 1000, updatedBy: 'a' });
tx({ key: 'k1', value: 'v2', tags: '[]', ttl: 0, expireAt: 0, now: 2000, updatedBy: 'a' });

const rows = db.prepare('SELECT key,value,updated_at FROM memory').all();
const vers = db.prepare('SELECT key,value,version FROM memory_versions').all();
console.log('  memory rows:', JSON.stringify(rows));
console.log('  memory_versions rows:', JSON.stringify(vers));

console.log('\n=== WAL sidecars after committed writes ===');
console.log('  files:', readdirSync(DIR).map(f => `${f}(${statSync(join(DIR, f)).size}b)`).join(' '));
const ck = db.pragma('wal_checkpoint(PASSIVE)');
console.log('  wal_checkpoint(PASSIVE) =', JSON.stringify(ck));
console.log('  files after checkpoint:', readdirSync(DIR).map(f => `${f}(${statSync(join(DIR, f)).size}b)`).join(' '));

console.log('\n=== BACKUP TRAP: copy only the .sqlite file while a write sits in the WAL ===');
db.prepare('INSERT INTO memory (key,value,tags,ttl,expire_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?)')
  .run('k2', 'v-after-copy', '[]', 0, 0, 3000, 'a');
console.log('  files now:', readdirSync(DIR).map(f => `${f}(${statSync(join(DIR, f)).size}b)`).join(' '));

const COPY = join(DIR, 'backup');
mkdirSync(COPY);
copyFileSync(DB, join(COPY, 'woclaw.sqlite'));           // the obvious backup: copy the main file
console.log('  copied ONLY woclaw.sqlite ->', readdirSync(COPY).join(' '));
const b = new Database(join(COPY, 'woclaw.sqlite'));
const bRows = b.prepare('SELECT key,value FROM memory ORDER BY key').all();
console.log('  backup content:', JSON.stringify(bRows));
const liveRows = db.prepare('SELECT key,value FROM memory ORDER BY key').all();
console.log('  live  content:', JSON.stringify(liveRows));
const missing = liveRows.filter((r: any) => !bRows.some((x: any) => x.key === r.key && x.value === r.value));
console.log('  => committed rows MISSING from the file-only backup:', JSON.stringify(missing));
b.close();

console.log('\n=== restoring a WAL-less backup INTO a live dir: is the missing row recoverable? ===');
const COPY2 = join(DIR, 'backup2');
mkdirSync(COPY2);
copyFileSync(DB, join(COPY2, 'woclaw.sqlite'));
copyFileSync(join(DIR, 'woclaw.sqlite-wal'), join(COPY2, 'woclaw.sqlite-wal'));
const b2 = new Database(join(COPY2, 'woclaw.sqlite'));
console.log('  backup2 (with -wal) content:', JSON.stringify(b2.prepare('SELECT key,value FROM memory ORDER BY key').all()));
b2.close();

console.log('\n=== is there a checkpoint call in the production code? ===');
console.log('  (grep is done by the shell driver)');
db.close();
console.log('\nPROBE_DONE');
