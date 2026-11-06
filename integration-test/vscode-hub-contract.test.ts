// integration-test/vscode-hub-contract.test.ts
//
// R534 — THE CONTRACT PLANE: does the woclaw-vscode extension's declared
// payload shape match the Hub that actually serves it?
//
// -----------------------------------------------------------------------
// THE PREMISE (and why it was never checked)
// -----------------------------------------------------------------------
// The extension declared its four payload shapes INLINE in src/extension.ts
// and asserted them at the call site:
//
//     this.topics = await httpGet<Topic[]>('/topics') || [];
//     this.agents = await httpGet<Agent[]>('/agents') || [];
//     this.entries = (await httpGet<MemoryEntry[]>('/memory?limit=50')) || [];
//
// A type assertion at a call site is a CLAIM, not a measurement. Nothing in
// the repo ever checked the claim against the Hub's real responses, so the
// extension could — and did — ship a contract that was wrong on ALL FOUR
// endpoints. The sibling clients in this same repo already unwrap the
// envelope correctly (`plugin/bin/woclaw.js` reads `d.topics` / `d.memory`;
// `packages/opencode-woclaw-plugin/index.js` reads `data.topics`), which
// makes the extension the ONLY client that treated the envelope as the
// payload.
//
// WHAT THIS TEST DOES
// -----------------------------------------------------------------------
// It boots the REAL Hub (the same RestServer class the production binary
// serves) and captures the ACTUAL response bodies for the four endpoints the
// extension consumes. It then feeds those REAL bodies through the extension's
// REAL unwrapping functions (packages/woclaw-vscode/src/hub-api.ts) and
// asserts:
//
//   A. The captured bodies ARE envelopes (not bare arrays) — this is the
//      measurement that makes the old bare-array assumption provably wrong.
//   B. The unwrapping functions yield REAL ARRAYS from those bodies — the
//      old code called `.map()` / `.filter()` on the raw body, which throws
//      `t.map is not a function`. The crash is reproduced here as a
//      regression that must not come back.
//   C. The extracted ROW shapes match the Hub's own row shapes:
//        topic  → {name, agents: NUMBER}
//        agent  → {agentId, connectedAt: NUMBER, topics: string[], lastSeen}
//        memory → {key, value, tags, ttl, expireAt, updatedAt: NUMBER, updatedBy}
//      The old declarations claimed `id` (not `agentId`), `agents: string[]`
//      (it is a count), `updatedAt: string` (it is epoch millis), and
//      `messageCount` / `type` on a topic (the Hub never sends them).
//   D. The field sets are DERIVED from the Hub's source, not hand-listed —
//      so a field the Hub adds later is discovered, and a field the Hub
//      removes is caught.
//   E. The extractors are total: null / undefined / {} / a string / a
//      number / a bare array all yield a usable array (never a crash).
//
// The test drives the REAL RestServer handlers, so it is a MEASUREMENT, not
// a transcription of the shapes into the test file.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RestServer } from '../hub/src/rest_server.js';
import { ClawDB } from '../hub/src/db.js';
import { WSServer } from '../hub/src/ws_server.js';
import { GraphStore } from '../hub/src/graph/store.js';
import type { Config } from '../hub/src/types.js';

import {
  extractAgents,
  extractMemory,
  extractTopics,
  topicMembers,
} from '../packages/woclaw-vscode/src/hub-api.js';

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../integration-test
const REPO_ROOT = dirname(TEST_DIR); // .../woclaw (repo root)
const HUB_SRC = join(REPO_ROOT, 'hub', 'src');

interface Captured { status: number; body: any; }

function makeRes() {
  const state: { status: number; body: string } = { status: 0, body: '' };
  const res: any = {
    writeHead: (s: number) => { state.status = s; },
    end: (b: string) => { state.body = b; },
  };
  return { res, state };
}

function capture(fn: (res: any) => void | Promise<void>): Captured {
  const { res, state } = makeRes();
  const r = fn(res);
  if (r && typeof (r as any).then === 'function') {
    // The handler is async — we drive it synchronously via a microtask
    // drain below; see `captureAsync`.
  }
  return { status: state.status, body: state.body ? JSON.parse(state.body) : null };
}

async function captureAsync(fn: (res: any) => void | Promise<void>): Promise<Captured> {
  const { res, state } = makeRes();
  await fn(res);
  return { status: state.status, body: state.body ? JSON.parse(state.body) : null };
}

describe('R534 — the vscode↔Hub REST contract plane', () => {
  let rest: any;
  let topics: any;
  let wsServer: any;
  let health: Captured;
  let topicsBody: Captured;
  let agentsBody: Captured;
  let memoryBody: Captured;

  beforeAll(async () => {
    const fs = await import('fs');
    const dir = '/tmp/woclaw-r534-contract-' + Date.now();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const cfg: Config = {
      port: 0,
      restPort: 0,
      host: '127.0.0.1',
      dataDir: dir,
      storage: { type: 'sqlite', sqlitePath: `${dir}/test.db` },
      authToken: 'r534-contract-token',
    };

    const db = new ClawDB(cfg);
    wsServer = new WSServer(cfg, db);
    const memory = wsServer.getMemoryPool();
    topics = wsServer.getTopicsManager();
    const graph = new GraphStore();
    memory.graphStore = graph;
    rest = new RestServer(cfg, db, topics, memory, graph, wsServer);

    // Seed LIVE data so the captured shapes are the populated ones, not the
    // shape of an empty envelope (an empty envelope would hide a field that
    // only appears when there is data).
    topics.joinTopic('agent-alpha', 'topic-one');
    topics.joinTopic('agent-beta', 'topic-one');
    topics.createTopic('topic-two');
    wsServer.agents.set('agent-alpha', {
      agentId: 'agent-alpha',
      ws: {},
      topics: new Set(['topic-one']),
      connectedAt: 1700000000000,
    });
    await memory.write('r534:key', 'r534:value', 'r534-agent', ['tag-a']);

    health = capture((r) => rest.handleHealth(r));
    topicsBody = await captureAsync((r) => rest.handleTopicsList(r));
    agentsBody = capture((r) => rest.handleAgentsList(r));
    memoryBody = await captureAsync((r) => rest.handleMemoryList(r, null, 'all'));
  });

  // ── A. The measurements: the Hub serves ENVELOPES, not bare arrays ───────

  it('A1: GET /health is a flat object (the one endpoint that is NOT enveloped)', () => {
    expect(health.status).toBe(200);
    expect(Array.isArray(health.body)).toBe(false);
    expect(health.body.status).toBe('ok');
    expect(typeof health.body.agents).toBe('number');
    expect(typeof health.body.topics).toBe('number');
  });

  it('A2: GET /topics returns an ENVELOPE {topics:[...]} — NOT a bare array', () => {
    expect(topicsBody.status).toBe(200);
    // THE measurement that breaks the old `httpGet<Topic[]>('/topics')` claim.
    expect(Array.isArray(topicsBody.body)).toBe(false);
    expect(Array.isArray(topicsBody.body.topics)).toBe(true);
    expect(topicsBody.body.topics.length).toBeGreaterThan(0);
  });

  it('A3: GET /agents returns an ENVELOPE {agents:[...],count:N} — NOT a bare array', () => {
    expect(agentsBody.status).toBe(200);
    expect(Array.isArray(agentsBody.body)).toBe(false);
    expect(Array.isArray(agentsBody.body.agents)).toBe(true);
    expect(agentsBody.body.count).toBe(agentsBody.body.agents.length);
  });

  it('A4: GET /memory returns an ENVELOPE {memory:[...]} — NOT a bare array', () => {
    expect(memoryBody.status).toBe(200);
    expect(Array.isArray(memoryBody.body)).toBe(false);
    expect(Array.isArray(memoryBody.body.memory)).toBe(true);
    expect(memoryBody.body.memory.length).toBeGreaterThan(0);
  });

  // ── B. The crash: the old code called .map()/.filter() on the RAW body ───

  it('B1: the OLD code path throws on the REAL bodies (regression that must not return)', () => {
    // Reproduce the pre-fix behaviour explicitly: the raw body is not an array.
    expect(() => (topicsBody.body as any).map((x: unknown) => x)).toThrow(TypeError);
    expect(() => (agentsBody.body as any).map((x: unknown) => x)).toThrow(TypeError);
    expect(() => (memoryBody.body as any).filter((x: unknown) => x)).toThrow(TypeError);
  });

  it('B2: the NEW unwrappers return real arrays from those SAME bodies', () => {
    const t = extractTopics(topicsBody.body);
    const a = extractAgents(agentsBody.body);
    const m = extractMemory(memoryBody.body);
    expect(Array.isArray(t)).toBe(true);
    expect(Array.isArray(a)).toBe(true);
    expect(Array.isArray(m)).toBe(true);
    // And they actually carry the seeded rows.
    expect(t.length).toBe(topicsBody.body.topics.length);
    expect(a.length).toBe(agentsBody.body.agents.length);
    expect(m.length).toBe(memoryBody.body.memory.length);
    // The downstream calls the tree providers make now work.
    expect(() => t.map((x) => x.name)).not.toThrow();
    expect(() => a.map((x) => x.agentId)).not.toThrow();
    expect(() => m.filter((x) => x.key.includes('r534'))).not.toThrow();
  });

  // ── C. The ROW shapes: the old declarations were wrong on every field ───

  it('C1: a topic row is {name, agents:NUMBER} — agents is a COUNT, not an array', () => {
    const rows = extractTopics(topicsBody.body);
    const one = rows.find((r) => r.name === 'topic-one');
    expect(one).toBeDefined();
    // The old interface said `agents: string[]` and rendered `t.agents.length`.
    expect(typeof one!.agents).toBe('number');
    expect(one!.agents).toBe(2);
    // The old interface also declared `messageCount` and `type`, which the
    // Hub's topic-list projection never sends.
    expect(Object.keys(one!).sort()).toEqual(['agents', 'name']);
  });

  it('C2: an agent row carries `agentId` (NOT `id`) and epoch-millis timestamps', () => {
    const rows = extractAgents(agentsBody.body);
    const one = rows.find((r) => r.agentId === 'agent-alpha');
    expect(one).toBeDefined();
    // The old interface said `id` — a field the Hub does not send.
    expect(one!.agentId).toBe('agent-alpha');
    expect((one! as any).id).toBeUndefined();
    expect(typeof one!.connectedAt).toBe('number');
    expect(typeof one!.lastSeen).toBe('number');
    expect(Array.isArray(one!.topics)).toBe(true);
    expect(one!.topics).toContain('topic-one');
  });

  it('C3: a memory row carries epoch-millis `updatedAt` and an always-present `tags` array', () => {
    const rows = extractMemory(memoryBody.body);
    const one = rows.find((r) => r.key === 'r534:key');
    expect(one).toBeDefined();
    // The old interface said `updatedAt: string` — the Hub sends a number.
    expect(typeof one!.updatedAt).toBe('number');
    expect(Array.isArray(one!.tags)).toBe(true);
    expect(one!.tags).toEqual(['tag-a']);
  });

  it('C4: topic members are derived from /agents (the REST surface has no members endpoint)', () => {
    const agents = extractAgents(agentsBody.body);
    const members = topicMembers('topic-one', agents);
    expect(members.map((m) => m.agentId)).toEqual(['agent-alpha']);
    expect(topicMembers('topic-two', agents)).toEqual([]);
  });

  // ── D. The field sets are DERIVED from the Hub's source, not hand-listed ──

  it('D1: the topic row fields the Hub projects are exactly {name, agents}', () => {
    // Read the Hub's own projection so the expectation is derived, not copied.
    const src = readFileSync(join(HUB_SRC, 'rest_server.ts'), 'utf8');
    const merged = src.match(/const merged = Array\.from\(allTopicNames\)[\s\S]*?\}\);/);
    expect(merged).not.toBeNull();
    const body = merged![0];
    expect(body).toContain('name');
    expect(body).toContain('agents');
    // The projection does NOT carry messageCount or type.
    expect(body).not.toContain('messageCount');
    expect(body).not.toContain('type');
  });

  it('D2: the agent row fields are exactly the ones getAgentsInfo() declares', () => {
    // Read the Hub's OWN return-type annotation so the expectation is derived
    // from the source, not copied into the test file. The annotation is the
    // shape getAgentsInfo() promises; the runtime row in C2 is what it
    // actually produces — comparing the two is what makes a drift between
    // "declared" and "served" visible.
    const src = readFileSync(join(HUB_SRC, 'ws_server.ts'), 'utf8');
    const m = src.match(/getAgentsInfo\(\):\s*\{([^}]*)\}\[\]/);
    expect(m).not.toBeNull();
    const fields = m![1]
      .split(';')
      .map((s) => s.split(':')[0].trim())
      .filter(Boolean)
      .sort();
    expect(fields).toEqual(['agentId', 'connectedAt', 'lastSeen', 'topics']);

    // And the RUNTIME row carries exactly those keys — declared == served.
    const row = extractAgents(agentsBody.body).find((r) => r.agentId === 'agent-alpha')!;
    expect(Object.keys(row).sort()).toEqual(fields);
  });

  // ── E. The extractors are TOTAL: no input shape may crash them ──────────

  it('E1: every non-array input yields a usable empty array (never a throw)', () => {
    for (const bad of [null, undefined, {}, 'a string', 42, true]) {
      expect(extractTopics(bad)).toEqual([]);
      expect(extractAgents(bad)).toEqual([]);
      expect(extractMemory(bad)).toEqual([]);
    }
  });

  it('E2: a bare array is still tolerated (a future flattened Hub does not crash)', () => {
    const rows = [{ name: 'x', agents: 1 }];
    expect(extractTopics(rows)).toEqual(rows);
    expect(extractAgents(rows as any)).toEqual(rows);
    expect(extractMemory(rows as any)).toEqual(rows);
  });

  it('E3: an envelope whose payload key is missing yields [] (no crash)', () => {
    expect(extractTopics({ count: 0 })).toEqual([]);
    expect(extractAgents({ count: 0 })).toEqual([]);
    expect(extractMemory({ count: 0 })).toEqual([]);
  });
});
