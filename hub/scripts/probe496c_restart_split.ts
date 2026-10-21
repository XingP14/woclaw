/**
 * R496 probe v3 — the durable-plane split: SQL store survives restart, graph store does not.
 *
 * Uses the REAL production classes: ClawDB + MemoryPool + GraphStore.
 * Two processes: writer (writes memory, exits) then reader (fresh GraphStore, reads graph).
 */
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ClawDB } from '../src/db.js';
import { MemoryPool } from '../src/memory.js';
import { GraphStore } from '../src/graph/store.js';

const DIR = '/tmp/r496probe3';
const MODE = process.argv[2];

async function main() {
  if (MODE === 'write') {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    const db = new ClawDB({ dataDir: DIR, storage: { type: 'sqlite', sqlitePath: join(DIR, 'woclaw.sqlite') } } as any);
    await (db as any).ensureReady?.();
    const pool = new MemoryPool(db);
    const graph = new GraphStore();
    pool.graphStore = graph;

    await pool.write('r496:key', 'persisted-value', 'agent-writer', ['topic:r496'], 0);
    await pool.write('r496:key2', 'second-value', 'agent-writer', [], 0);

    console.log('--- WRITER PROCESS ---');
    console.log('  sql memory rows :', JSON.stringify((await db.getAllMemory()).map(m => m.key)));
    console.log('  graph nodes     :', JSON.stringify(graph.getNodes().map(n => `${n.type}:${n.label}`)));
    console.log('  graph stats     :', JSON.stringify(graph.getStats()));
    await db.close();
    console.log('  writer exits (clean)');
    return;
  }

  if (MODE === 'read') {
    console.log('--- READER PROCESS (fresh hub boot) ---');
    const db = new ClawDB({ dataDir: DIR, storage: { type: 'sqlite', sqlitePath: join(DIR, 'woclaw.sqlite') } } as any);
    await (db as any).ensureReady?.();
    const pool = new MemoryPool(db);
    const graph = new GraphStore();          // exactly what index.ts:58 does
    pool.graphStore = graph;

    console.log('  sql memory rows :', JSON.stringify((await db.getAllMemory()).map(m => m.key)));
    console.log('  sql memory value:', JSON.stringify((await db.getMemory('r496:key'))?.value));
    console.log('  graph nodes     :', JSON.stringify(graph.getNodes().map(n => `${n.type}:${n.label}`)));
    console.log('  graph stats     :', JSON.stringify(graph.getStats()));
    console.log('  graph memory nodes (what GET /graph/nodes?type=memory returns):',
      JSON.stringify(graph.getNodes('memory').map(n => ({ label: n.label, value: n.metadata?.value }))));
    console.log('  => SQL store survived restart:',
      JSON.stringify((await db.getAllMemory()).map(m => m.key)));
    console.log('  => graph store survived restart:', JSON.stringify(graph.getNodes('memory').map(n => n.label)));
    await db.close();
    return;
  }
}
main().catch(e => { console.error(e); process.exit(1); });
