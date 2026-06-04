import { describe, it, expect, beforeEach } from 'vitest';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { SessionStore } from '../src/session_store.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const TEST_CONFIG: Config = {
  port: 0, // unused by REST
  restPort: 0,
  host: '127.0.0.1',
  dataDir: '/tmp/woclaw-ready-test',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-ready-test/test.db' },
  authToken: 'test-token-12345'
};

describe('RestServer /ready endpoint', () => {
  let db: ClawDB;
  let wsServer: WSServer;
  let restServer: RestServer;

  beforeEach(async () => {
    // Clean up any prior test db
    try {
      const fs = await import('fs');
      fs.rmSync(TEST_CONFIG.dataDir!, { recursive: true, force: true });
      fs.mkdirSync(TEST_CONFIG.dataDir!, { recursive: true });
    } catch (e) {
      // ignore
    }

    db = new ClawDB(TEST_CONFIG);
    wsServer = new WSServer(TEST_CONFIG, db);
    const memory = wsServer.getMemoryPool();
    const topics = wsServer.getTopicsManager();
    const graph = new GraphStore();
    memory.graphStore = graph;
    restServer = new RestServer(TEST_CONFIG, db, topics, memory, graph, wsServer);
  });

  it('returns 200 ready when all components are wired', () => {
    let writtenStatus = 0;
    let writtenBody = '';
    const mockRes = {
      writeHead: (s: number) => { writtenStatus = s; },
      end: (body: string) => { writtenBody = body; }
    };
    (restServer as any).handleReady(mockRes);
    const result = JSON.parse(writtenBody);
    expect(writtenStatus).toBe(200);
    expect(result.status).toBe('ready');
    expect(result.checks.db.ok).toBe(true);
    expect(result.checks.topics.ok).toBe(true);
    expect(result.checks.memoryPool.ok).toBe(true);
    expect(result.checks.wsServer.ok).toBe(true);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('returns not-ready when db is null', () => {
    let writtenStatus = 0;
    const broken = Object.create(RestServer.prototype);
    broken.db = null;
    broken.topics = { dummy: true } as any;
    broken.memory = { dummy: true } as any;
    broken.wsServer = { dummy: true } as any;

    const mockRes = {
      writeHead: (s: number) => { writtenStatus = s; },
      end: () => {}
    };
    (broken as any).handleReady(mockRes);
    expect(writtenStatus).toBe(503);
  });

  it('handleReady writes 503 status when not ready', () => {
    const broken = Object.create(RestServer.prototype);
    broken.db = null;
    broken.topics = null;
    broken.memory = null;
    broken.wsServer = null;

    let writtenStatus = 0;
    const mockRes = {
      writeHead: (s: number) => { writtenStatus = s; },
      end: () => {}
    };
    (broken as any).handleReady(mockRes);
    expect(writtenStatus).toBe(503);
  });

  it('handleReady writes 200 status when ready', () => {
    const broken = Object.create(RestServer.prototype);
    broken.db = { dummy: true };
    broken.topics = { dummy: true };
    broken.memory = { dummy: true };
    broken.wsServer = { dummy: true };

    let writtenStatus = 0;
    const mockRes = {
      writeHead: (s: number) => { writtenStatus = s; },
      end: () => {}
    };
    (broken as any).handleReady(mockRes);
    expect(writtenStatus).toBe(200);
  });
});
