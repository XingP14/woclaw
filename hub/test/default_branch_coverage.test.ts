/**
 * Default/short-circuit branch coverage for the two remaining uncovered
 * branches in hub/src (v8 branch map as of the 2026-09-29 05:03 tick):
 *
 *   1. hub/src/rest_server.ts:132  `this.wsServer = wsServer || null;`
 *      The existing suites ALL construct RestServer with a live WSServer, so
 *      the `wsServer === undefined` -> `null` short-circuit arm was dark.
 *      Pin it: a RestServer built with no WSServer must report
 *      checks.wsServer.ok === false and answer /ready with 503, never a
 *      throw and never a bogus "ready".
 *
 *   2. hub/src/startup_banner.ts:81
 *      `MySQL Host: ${config.storage.mysql.host}:${config.storage.mysql.port || 3306}`
 *      The existing banner suite always passes an explicit port: 3306, so the
 *      `port` undefined -> 3306 default arm was dark. Pin it: a MySQL storage
 *      config with no port must still print the canonical 3306.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const DATA_DIR = '/tmp/woclaw-default-branch-test';
const TEST_CONFIG: Config = {
  port: 0,
  restPort: 0,
  host: '127.0.0.1',
  dataDir: DATA_DIR,
  storage: { type: 'sqlite', sqlitePath: `${DATA_DIR}/test.db` },
  authToken: 'test-token-12345'
};

describe('RestServer constructor wsServer || null short-circuit', () => {
  let db: ClawDB;

  beforeEach(async () => {
    const fs = await import('fs');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new ClawDB(TEST_CONFIG);
  });

  it('omitting wsServer stores null instead of undefined', () => {
    const wsServer = new WSServer(TEST_CONFIG, db);
    const memory = wsServer.getMemoryPool();
    const topics = wsServer.getTopicsManager();
    const graph = new GraphStore();
    memory.graphStore = graph;

    // 6th arg omitted -> wsServer === undefined -> `|| null` arm.
    const restServer = new RestServer(TEST_CONFIG, db, topics, memory, graph);
    expect((restServer as any).wsServer).toBeNull();
  });

  it('omitting both wsServer and sessionStore still wires a fresh SessionStore', () => {
    const wsServer = new WSServer(TEST_CONFIG, db);
    const memory = wsServer.getMemoryPool();
    const topics = wsServer.getTopicsManager();
    const graph = new GraphStore();
    memory.graphStore = graph;

    const restServer = new RestServer(TEST_CONFIG, db, topics, memory, graph);
    expect((restServer as any).sessionStore).toBeTruthy();
  });

  it('omitting wsServer makes /ready report 503 not-ready on that check', () => {
    const wsServer = new WSServer(TEST_CONFIG, db);
    const memory = wsServer.getMemoryPool();
    const topics = wsServer.getTopicsManager();
    const graph = new GraphStore();
    memory.graphStore = graph;

    const restServer = new RestServer(TEST_CONFIG, db, topics, memory, graph);

    let status = 0;
    let body = '';
    const mockRes = {
      writeHead: (s: number) => { status = s; },
      end: (b: string) => { body = b; }
    };
    (restServer as any).handleReady(mockRes);

    const result = JSON.parse(body);
    expect(status).toBe(503);
    expect(result.status).toBe('not-ready');
    expect(result.checks.wsServer.ok).toBe(false);
    // The other three components are still wired and unaffected.
    expect(result.checks.db.ok).toBe(true);
    expect(result.checks.topics.ok).toBe(true);
    expect(result.checks.memoryPool.ok).toBe(true);
  });
});

describe('printConfigDump MySQL port || 3306 default', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('mysql config with no port prints the canonical 3306 default', async () => {
    const mod = await import('../src/startup_banner.js');
    const cfg = {
      port: 8765,
      restPort: 8766,
      host: '127.0.0.1',
      dataDir: '/tmp/woclaw-data',
      storage: {
        type: 'mysql',
        mysql: { host: 'db.local', user: 'woclaw', database: 'woclaw' }
      },
      authToken: 'secret-token-1234567890',
      tlsKey: undefined,
      tlsCert: undefined
    } as any;
    mod.printConfigDump(cfg);

    const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(flat).toContain('MySQL Host: db.local:3306');
    expect(flat).toContain('MySQL Database: woclaw');
    // Same call count as the explicit-port mysql case: 5 base + 2 mysql + token + tls + blank.
    expect(logSpy).toHaveBeenCalledTimes(10);
    expect(flat).not.toContain('undefined');
  });

  it('mysql config with an explicit port is not overridden by the default', async () => {
    const mod = await import('../src/startup_banner.js');
    const cfg = {
      port: 8765,
      restPort: 8766,
      host: '127.0.0.1',
      dataDir: '/tmp/woclaw-data',
      storage: {
        type: 'mysql',
        mysql: { host: 'db.local', port: 3307, user: 'woclaw', database: 'woclaw' }
      },
      authToken: 'secret-token-1234567890',
      tlsKey: undefined,
      tlsCert: undefined
    } as any;
    mod.printConfigDump(cfg);

    const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(flat).toContain('MySQL Host: db.local:3307');
    expect(flat).not.toContain('db.local:3306');
  });
});
