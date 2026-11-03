/**
 * R530 — THE POINTER PLANE: does the hub ship a way to name a large payload
 * WITHOUT carrying it?
 *
 * The plane (external leg: arXiv:2511.22729 "Solving Context Window Overflow in
 * AI Agents", 2025-11-27) is: shift the model's interaction from raw data to
 * MEMORY POINTERS referencing memory-stored results. Truncation and summarization
 * are LOSSY — they destroy part of the tool response. A pointer is LOSSLESS:
 * the payload stays whole in storage; the model carries a reference and can
 * re-fetch it on demand.
 *
 * R345 already covered the LOSSY plane (truncate / prune / summarize / fold /
 * evict — what stays in the provider-visible view). This probe covers the
 * LOSSLESS plane: is there a representation that names a payload without
 * embedding it?
 *
 * WHAT IS PROBED (all measured, none inherited):
 *   P1  The hub stores a large value intact (no truncation on write).
 *   P2  The enumeration reads carry the WHOLE value, with no size bound and no
 *       projection => the consumer's context grows with the stored payload.
 *   P3  A metadata-only projection EXISTS somewhere in the same schema (the
 *       `streams` table has one) => the pattern is known to this codebase.
 *   P4  The pointer shape (a handle you can re-fetch) is absent from the
 *       memory surface.
 *
 * The subject set is DERIVED from the source, not hand-listed (R491-3): the
 * probe asserts on the SQL/projection actually present, so a future column
 * added to the projection is discovered rather than missed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { RestServer } from '../src/rest_server.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');

describe('R530 — the pointer plane: naming a payload without carrying it', () => {
  const testDir = '/tmp/woclaw-r530-' + Date.now();
  let db: ClawDB;
  let mp: MemoryPool;
  let restServer: RestServer;

  const cfg: Config = {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: testDir,
    storage: { type: 'sqlite', sqlitePath: `${testDir}/test.db` },
    authToken: 'test-token-12345',
  };

  // A payload big enough that carrying it is materially different from naming it.
  const BIG = 'X'.repeat(200_000);

  beforeEach(async () => {
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(cfg);
    const wsServer = new WSServer(cfg, db);
    mp = wsServer.getMemoryPool();
    const topics = wsServer.getTopicsManager();
    const graph = new GraphStore();
    mp.graphStore = graph;
    restServer = new RestServer(cfg, db, topics, mp, graph, wsServer);
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  /** Capture the JSON body one of the private handlers writes. */
  async function capture(
    handler: string,
    ...args: unknown[]
  ): Promise<{ status: number; body: any }> {
    let status = 0;
    let body = '';
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) { this.headers[k] = v; },
      writeHead(s: number) { status = s; this.statusCode = s; return this; },
      write(chunk: any) { body += typeof chunk === 'string' ? chunk : String(chunk); return true; },
      end(chunk?: any) { if (chunk) body += typeof chunk === 'string' ? chunk : String(chunk); return this; },
    };
    const fn = (restServer as any)[handler];
    await fn.call(restServer, res, ...args);
    let parsed: any = null;
    try { parsed = JSON.parse(body); } catch { parsed = null; }
    return { status, body: parsed };
  }

  it('P1 — a large value is stored INTACT (no truncation on the write path)', async () => {
    await mp.write('big/key', BIG, 'rest-api', ['bulk'], 0);
    const row = await mp.read('big/key');
    expect(row).toBeDefined();
    expect(row!.value.length).toBe(BIG.length);
  });

  it('P2 — the enumeration read carries the WHOLE value with no size bound', async () => {
    await mp.write('big/key', BIG, 'rest-api', ['bulk'], 0);
    const { body } = await capture('handleMemoryList', null, 'all');
    const row = body.memory.find((m: any) => m.key === 'big/key');
    expect(row).toBeDefined();
    // The consumer's payload grew by the FULL stored size.
    // Optional chaining on purpose: a repair that PROJECTS the value away must
    // fail this as a clean ASSERTION, not as a TypeError crash (R461: a crash
    // is not a kill -- and a crash makes the matrix classify a real kill as
    // HARNESS).
    expect(row.value?.length).toBe(BIG.length);
    // ... and there is no separate small handle alongside it.
    expect(row.handle).toBeUndefined();
    expect(row.ref).toBeUndefined();
    expect(row.pointer).toBeUndefined();
    expect(row.size).toBeUndefined();
  });

  it('P3 — the SAME schema already contains a metadata-only projection (streams)', async () => {
    // Derived from source, not hand-listed: the streams LIST projection must
    // not select the payload column.
    const dbSrc = readFileSync(join(SRC, 'db.ts'), 'utf8');
    const listProj = dbSrc.match(/SELECT run_id, agent_id, schema_version, started_at, exit_code\s*\n?\s*FROM streams WHERE topic/i);
    expect(listProj).not.toBeNull();
    expect(listProj![0]).not.toMatch(/events_json/);
    // ... while the single-run read DOES carry it.
    expect(dbSrc).toMatch(/SELECT \* FROM streams WHERE run_id/);
  });

  it('P4 — the memory surface has NO pointer/handle projection of any kind', async () => {
    const dbSrc = readFileSync(join(SRC, 'db.ts'), 'utf8');
    const memSrc = readFileSync(join(SRC, 'memory.ts'), 'utf8');
    // The enumeration query must select the value column — a projection that
    // omitted it would BE the pointer shape.
    const getAll = dbSrc.match(/SELECT key, value, tags, ttl, expire_at, updated_at, updated_by\s*\n?\s*FROM memory/);
    expect(getAll).not.toBeNull();
    expect(getAll![0]).toMatch(/value/);
    // The SCHEMA must carry no column that names a payload's size -- a
    // `value_size` / `size` / `bytes` column would be the pointer shape at
    // the storage layer, and the probe must be able to SEE it appear.
    const schema = dbSrc.match(/CREATE TABLE IF NOT EXISTS memory \(([\s\S]*?)\n\s*\);/);
    expect(schema).not.toBeNull();
    const cols = schema![1];
    for (const forbidden of ['value_size', 'size', 'bytes', 'content_length', 'handle']) {
      expect(cols).not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'i'));
    }
    // No handle/ref/pointer concept anywhere on the memory surface.
    for (const src of [dbSrc, memSrc]) {
      expect(src).not.toMatch(/\b(handle|pointer|ref_uri|blob_ref)\b\s*[:=]/);
    }
  });

  it('P5 — the CONSUMER hands back the value with no size side-car, so a caller cannot tell a small value from a huge one without carrying it', async () => {
    await mp.write('small/key', 'tiny', 'rest-api', ['bulk'], 0);
    await mp.write('big/key', BIG, 'rest-api', ['bulk'], 0);
    const { body } = await capture('handleMemoryList', null, 'all');
    const small = body.memory.find((m: any) => m.key === 'small/key');
    const big = body.memory.find((m: any) => m.key === 'big/key');
    expect(small).toBeDefined();
    expect(big).toBeDefined();
    // The only size information a caller has is the payload it already
    // received. There is no declared size field on the row.
    for (const key of ['size', 'sizeBytes', 'valueSize', 'bytes', 'length', 'contentLength']) {
      expect(small[key]).toBeUndefined();
      expect(big[key]).toBeUndefined();
    }
    // ... and both rows are structurally identical apart from the payload, so
    // nothing in the SHAPE distinguishes "small" from "huge".
    expect(Object.keys(small).sort().join(',')).toBe(Object.keys(big).sort().join(','));
  });
});
