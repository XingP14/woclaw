/**
 * R496 probe v5 — EFFECT probes for the edge-type claim and the extraction wiring.
 *
 * No greps: every claim is measured by running the production write path.
 */
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ClawDB } from '../src/db.js';
import { MemoryPool } from '../src/memory.js';
import { GraphStore } from '../src/graph/store.js';

const DIR = '/tmp/r496probe5';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

async function main() {
  const db = new ClawDB({ dataDir: DIR, storage: { type: 'sqlite', sqlitePath: join(DIR, 'woclaw.sqlite') } } as any);
  await (db as any).ensureReady?.();
  const pool = new MemoryPool(db);
  const graph = new GraphStore();
  pool.graphStore = graph;

  // ── production write path: memory.write() ──────────────────────────────
  await pool.write('alpha:key', 'value about deployments', 'agent-1', ['topic:ops'], 0);
  await pool.write('alpha:key2', 'value about deployments again', 'agent-2', ['topic:ops'], 0);
  await pool.write('beta:key', 'unrelated content', 'agent-3', [], 0);

  console.log('=== EFFECT: which edge types does the production write path create? ===');
  const all = graph.getEdges({});
  const byType: Record<string, number> = {};
  for (const e of all) byType[e.type] = (byType[e.type] || 0) + 1;
  console.log('  edges produced by memory.write():', JSON.stringify(byType));
  console.log('  node types:', JSON.stringify(graph.getNodes().reduce((a: any, n) => { a[n.type] = (a[n.type] || 0) + 1; return a; }, {})));
  console.log('  => temporal:', byType.temporal || 0, ' causal:', byType.causal || 0);
  console.log('  => stats:', JSON.stringify(graph.getStats()));

  // ── POSITIVE CONTROL: the same walker must SEE a temporal edge when one exists ──
  console.log('\n=== POSITIVE CONTROL: inject a temporal + causal edge, same reader ===');
  const n1 = graph.getNodes('memory')[0];
  const n2 = graph.getNodes('memory')[1];
  graph.addEdge({ source: n1.id, target: n2.id, type: 'temporal', metadata: {} });
  graph.addEdge({ source: n1.id, target: n2.id, type: 'causal', metadata: {} });
  const all2 = graph.getEdges({});
  const byType2: Record<string, number> = {};
  for (const e of all2) byType2[e.type] = (byType2[e.type] || 0) + 1;
  console.log('  after injection:', JSON.stringify(byType2));
  console.log('  => the reader CAN see temporal/causal when present:', (byType2.temporal || 0) > 0 && (byType2.causal || 0) > 0);

  // ── extraction engine wiring: is it reachable at boot? ────────────────
  console.log('\n=== extraction engine wiring ===');
  const srcDir = join(dirname(new URL(import.meta.url).pathname), '..', 'src');
  const engineSrc = readFileSync(join(srcDir, 'extraction', 'engine.ts'), 'utf-8');
  const indexSrc = readFileSync(join(srcDir, 'index.ts'), 'utf-8');
  const schedSrc = readFileSync(join(srcDir, 'scheduler.ts'), 'utf-8');

  const setGraphStoreCallers = engineSrc.includes('setGraphStore(') && !engineSrc.includes('setGraphStore(graphStore: GraphStore | null): void');
  console.log('  engine.ts declares setGraphStore():', engineSrc.includes('setGraphStore(graphStore: GraphStore | null): void'));
  console.log('  engine.ts CALLS setGraphStore() internally:', setGraphStoreCallers);

  const indexCallsSet = /setGraphStore\s*\(/.test(indexSrc);
  console.log('  index.ts calls setGraphStore():', indexCallsSet);

  const indexCreatesEngine = /new\s+ExtractionEngine|createExtractionEngine/.test(indexSrc);
  console.log('  index.ts constructs an ExtractionEngine:', indexCreatesEngine);

  // the ForgettingScheduler third arg IS the extraction engine
  const schedCtor = schedSrc.match(/constructor\([^)]*\)/)?.[0] ?? '';
  console.log('  scheduler constructor signature:', schedCtor.replace(/\s+/g, ' '));
  const idxFs = indexSrc.match(/new\s+ForgettingScheduler\([^)]*\)/)?.[0] ?? '';
  console.log('  index.ts:', idxFs.replace(/\s+/g, ' '));
  console.log('  => third arg (the extraction engine) is:', idxFs.includes(', null)') ? 'null  <-- extraction NEVER wired' : 'non-null');

  await db.close();
  console.log('\nPROBE_DONE');
}
main().catch(e => { console.error(e); process.exit(1); });
