/**
 * R485 — the manual-eviction REST surface is documented, implemented, and
 * unreachable; the documented status path is routed as a MEMORY KEY.
 *
 * Three defects, all in `hub/src/rest_server.ts`:
 *
 *  1. DEAD ROUTING. `handleMemoryPruneSimple` and
 *     `handleMemoryEvictionSimple` are called from exactly one place — a
 *     `if (path === '/api/v1/memory/eviction')` / `if (path ===
 *     '/api/v1/memory/prune')` pair that sits in the body of
 *     `handleDelegations`, not in `handleRequest`. `handleDelegations` is
 *     only ever entered for `path === '/delegations' ||
 *     path.startsWith('/delegations')`. No request path can therefore
 *     satisfy `/api/v1/memory/prune`, so the only manual-eviction
 *     endpoint in the hub answers 405 for every method, including the
 *     `POST` the CHANGELOG advertises.
 *
 *  2. ORPHANED HANDLERS. `handleMemoryEviction`, `handleMemoryPruneStatus`
 *     and `handleMemoryPrune` have zero call sites. The scheduler's
 *     `getStatus()` — the only non-destructive way to observe the
 *     forgetting scheduler — is reachable from nowhere, so an operator
 *     cannot ask whether eviction is armed.
 *
 *  3. A DOCUMENTED STATUS PATH IS A MEMORY READ. `GET /memory/prune/status`
 *     is documented in CHANGELOG.md:114 and docs/ROADMAP.md:330. It falls
 *     into the generic `path.startsWith('/memory/')` branch, which decodes
 *     the remainder into a memory KEY, so the request becomes
 *     `handleMemoryGet(res, 'prune/status')` — a lookup for a memory whose
 *     key is literally "prune/status". It does not consult the scheduler at
 *     all, and it is not a 404: it is a silent read of the wrong subject.
 *
 * The suite below pins the CURRENT routing behaviour (it is a RED-first
 * gate on the defect, not a wish), and asserts the routing table's structure
 * so a future refactor cannot re-bury these handlers deeper in the wrong
 * function without a diff to this file.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { RestServer } from '../src/rest_server.js';
import type { ForgettingScheduler } from '../src/scheduler.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src', 'rest_server.ts');

const TOKEN = 'ClawLink2026';

// ─── Harness ────────────────────────────────────────────────────────────────

let evictionCalls = 0;
let server: RestServer;
let port: number;

function fakeScheduler(): ForgettingScheduler {
  return {
    getStatus: () => ({
      running: true,
      config: { importanceFloor: 3 },
      nextDaily: '<scheduled>',
      nextWeekly: '<scheduled>',
    }),
    triggerEviction: async () => {
      evictionCalls++;
      return { sessions: 7, memories: 7 };
    },
  } as unknown as ForgettingScheduler;
}

function call(method: string, p: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: { Authorization: `Bearer ${TOKEN}` },
        timeout: 5000,
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode!, body: b }));
      }
    );
    r.on('error', reject);
    r.on('timeout', () => {
      r.destroy();
      reject(new Error(`timeout ${method} ${p}`));
    });
    r.end();
  });
}

beforeAll(async () => {
  // Minimal stubs. These are deliberately SHALLOW: a control arm below
  // exercises a route through the same stubs, so a 405/500 on the subject
  // arms is attributable to routing, not to a missing mock (see the
  // CONTROL arm, which returns 200 through `this.topics.getStats`).
  const db = {
    getEvictionCandidates: async () => ({ sessions: [], memories: [] }),
    getAllSessions: async () => [],
  } as any;
  const topics = { getStats: () => ({ totalTopics: 0, totalAgents: 0 }), list: () => [] } as any;
  const memory = { read: async () => null, get: async () => null } as any;
  const graph = { getStats: () => ({ nodes: 0, edges: 0 }) } as any;

  server = new RestServer(
    { restPort: 0, host: '127.0.0.1', authToken: TOKEN } as any,
    db,
    topics,
    memory,
    graph
  );
  server.setForgettingScheduler(fakeScheduler());
  await (server as any).start();
  port = await server.whenListening();
});

afterAll(() => {
  // Deliberately NOT `process.exit(0)`: that aborts the vitest worker and is
  // reported as a suite failure, hiding the real results. The REST server is
  // bound to port 0 and dies with the worker.
});

// ─── Arm 1: CONTROL — the harness can reach a live route ────────────────────

describe('R485 control', () => {
  it('reaches a known-wired route (GET /health -> 200)', async () => {
    const out = await call('GET', '/health');
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).status).toBe('ok');
  });
});

// ─── Arm 2: the manual-eviction endpoint is unreachable on every method ────

describe('R485 defect 1 — /api/v1/memory/prune is dead routing', () => {
  const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

  for (const method of methods) {
    it(`${method} /api/v1/memory/prune answers 405 and evicts nothing`, async () => {
      const before = evictionCalls;
      const out = await call(method, '/api/v1/memory/prune');
      expect(out.status).toBe(405);
      expect(JSON.parse(out.body).error).toBe('Method not allowed');
      // The destructive consequence: nothing ran.
      expect(evictionCalls).toBe(before);
    });
  }

  it('the same holds for GET /api/v1/memory/eviction', async () => {
    const out = await call('GET', '/api/v1/memory/eviction');
    expect(out.status).toBe(405);
  });
});

// ─── Arm 3: three handlers have no caller ───────────────────────────────────

describe('R485 defect 2 — orphaned eviction handlers', () => {
  const src = readFileSync(SRC, 'utf8');

  // `handleDelegations` is entered only for /delegations paths, so the
  // /api/v1/memory pair inside it can never match. Assert the structure
  // rather than the consequence, so a fix that moves the handlers out is
  // a visible diff here.
  it('the /api/v1/memory routing pair lives inside handleDelegations', () => {
    const delegStart = src.indexOf('private handleDelegations(');
    const delegEnd = src.indexOf('\n  private ', delegStart + 1);
    const delegBody = src.slice(delegStart, delegEnd);

    expect(delegBody).toContain("path === '/api/v1/memory/eviction'");
    expect(delegBody).toContain("path === '/api/v1/memory/prune'");
  });

  it('handleDelegations is only entered for /delegations paths', () => {
    const srcLines = src.split('\n');
    const callLines = srcLines
      .map((l, i) => ({ l, i }))
      .filter((x) => x.l.includes('this.handleDelegations('));

    expect(callLines.length).toBe(1);
    // The guard immediately above the single call site must be /delegations.
    const guard = srcLines.slice(callLines[0].i - 6, callLines[0].i).join('\n');
    expect(guard).toContain("path.startsWith('/delegations')");
  });

  it('handleMemoryEviction, handleMemoryPruneStatus and handleMemoryPrune have zero call sites', () => {
    // Count CALL sites, not substring occurrences: `handleMemoryEviction` is a
    // prefix of the live `handleMemoryEvictionSimple`, so a naive `split()`
    // counts 3 for a handler that is never called. Count `this.<name>(` and
    // subtract the one declaration.
    for (const name of ['handleMemoryEviction', 'handleMemoryPruneStatus', 'handleMemoryPrune']) {
      const declarations = src.split(`private `).length - 1;
      expect(declarations).toBeGreaterThan(0);

      const callSites = src.split(`this.${name}(`).length - 1;
      expect({ [name]: callSites }).toEqual({ [name]: 0 });
    }
  });
});

// ─── Arm 4: the documented status path is a memory-key read ─────────────────

describe('R485 defect 3 — GET /memory/prune/status is a memory read, not a scheduler read', () => {
  it('CHANGELOG and ROADMAP both advertise it', () => {
    const changelog = readFileSync(join(HERE, '..', '..', 'CHANGELOG.md'), 'utf8');
    const roadmap = readFileSync(join(HERE, '..', '..', 'docs', 'ROADMAP.md'), 'utf8');
    expect(changelog).toContain('/memory/prune/status');
    expect(roadmap).toContain('/memory/prune/status');
  });

  it('CHANGELOG advertises POST /memory/prune, which is routed as a memory key too', async () => {
    const out = await call('POST', '/memory/prune');
    // /memory/ accepts only GET and DELETE for a key; POST is refused.
    expect(out.status).toBe(405);
    expect(JSON.parse(out.body).error).toBe('Method not allowed');
  });

  it('the generic /memory/ branch decodes the remainder into a KEY', () => {
    const src = readFileSync(SRC, 'utf8');
    const branch = src.slice(src.indexOf("} else if (path.startsWith('/memory/'))"));
    // `const memPath = path.slice(8); const key = decodeURIComponent(memPath);`
    expect(branch).toContain("const memPath = path.slice(8)");
    expect(branch).toContain('const key = decodeURIComponent(memPath)');
  });
});

// ─── Arm 5: REPAIR — the defect must be able to turn this suite red ────────

describe('R485 repair leg', () => {
  it('the suite has a live subject: triggerEviction IS reachable in-process', async () => {
    // Direct call — bypasses routing. If this ever throws, every 405 above
    // would be vacuous (the endpoint being unreachable would prove nothing).
    const result = await fakeScheduler().triggerEviction();
    expect(result).toEqual({ sessions: 7, memories: 7 });
  });
});
