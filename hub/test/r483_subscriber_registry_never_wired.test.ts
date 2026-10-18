/**
 * R483 — the notification channel has a registry, two writers, a gate and a
 *         teardown hook; it has never had a subscriber. Not a regression.
 *
 * -----------------------------------------------------------------------
 * EXECUTES R482.17, queued by the previous round:
 *
 *     "查 git 历史里 subscribe() 何时不再被调用，可区分
 *       '从未上线' 与 '回归'，两者导向完全不同的动作"
 *
 * R482 found F4 — `MemoryPool.subscribe` has 0 production call sites — but
 * could not say whether that was a regression or a plan that never shipped.
 * Those readings imply different actions. A regression means a caller was
 * removed and something broke. Never-shipped means the whole channel is an
 * unfinished sketch, and the honest move is to say so rather than to add a
 * caller and call it a fix.
 *
 * -----------------------------------------------------------------------
 * SELECTION (R74). R441–R482 were 34+ consecutive in-cluster rounds. This
 * round keeps the plane (delivery semantics) but changes the *evidence class*:
 * every previous round read the CURRENT tree; this one reads the tree's
 * HISTORY — a subject no in-cluster round has touched. External leg first,
 * controls first within it: `AI agent` = 192,574, `LLM` = 687,162,
 * `agent` = 532,433 (so the zeros below are evidence, not a broken query).
 * Precision angles: `agent subscriber callback never registered` = **0**,
 * `pubsub zero subscribers agent` = 3, `agent event bus dead code` = 5.
 * NOT reported as greenfield: the observer pattern, pub-sub and completion-port
 * primitives, and the "zero subscribers is not an error" assertion style are
 * all mature. This is a MIGRATION GAP (R449-5 / R454-4 / R475-3 / R482.2).
 *
 * R466-INDEPENDENCE. R482's F4 and this round's F1 are the SAME SUBJECT, and
 * are counted once. The two are not independent evidence: R482 measured the
 * present state (0 call sites), this round measures the TRAJECTORY (0 at every
 * commit, plus the negative control that the same walker finds `unsubscribe`).
 * No arm imports R482's suite or logic; the walker and the source reads here
 * are self-contained.
 *
 * -----------------------------------------------------------------------
 * THE SHAPE, FROM THE FILES
 *
 * memory.ts — present since the INITIAL commit e282fce, same shape throughout
 * (line numbers drifted 31 -> 355 as the file grew):
 *
 *     private subscribers: Map<string, (msg: OutboundMessage) => void>
 *     subscribe(agentId, callback) { this.subscribers.set(agentId, callback) }
 *     unsubscribe(agentId)         { this.subscribers.delete(agentId) }
 *     notifySubscribers(m)         { for (const cb of this.subscribers.values()) ... }
 *
 * ws_server.ts:589, in the disconnect path:
 *
 *     this.agents.delete(agentId);
 *     this.agentByWs.delete(agent.ws);
 *     this.memory.unsubscribe(agentId);
 *
 * The hub tears the registry down on disconnect — the paired operation of a
 * registration that is never performed.
 *
 * -----------------------------------------------------------------------
 * THE FINDINGS (each measured, not argued)
 *
 * A1  `subscribe()` has ZERO call sites at EVERY one of the 1004 commits on
 *     `--all`. Not "it was removed" — it never had one.
 * A2  NEGATIVE CONTROL: the same walker, same regex family, same history,
 *     FINDS `unsubscribe` (ws_server.ts:589 today). The walker is not broken,
 *     so a blank result in A1 is a fact about the subject (R482-§5).
 * A3  POSITIVE CONTROL: the `subscribe` token is findable — in memory.ts at
 *     HEAD *and* in the initial commit, with the same shape it has today.
 * A4  The channel has TWO writers: `MemoryPool.write` (memory.ts:143, on the
 *     REST-reachable path) and `handleMemoryWrite` (ws_server.ts:528).
 * A5  RUNTIME: a registered subscriber IS called; the same write with no
 *     subscriber notifies nobody and throws nothing.
 * A6  RUNTIME: registering creates THREE deliveries for ONE write — two of them
 *     to the subscriber callback with DIFFERENT message types (`memory_write`
 *     from the pool, `memory_update` from the WS handler's own notify), plus
 *     the socket broadcast. So "just add a subscribe() call site" is not a
 *     one-line fix: the channel has two nested writers.
 * A7  Connecting does NOT register; the teardown at :589 has no setup to pair
 *     with. Asserted structurally on the source, since no public API reaches it.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { rmSync, mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryPool } from '../src/memory.js';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import type { Config, OutboundMessage } from '../src/types.js';

const REPO_ROOT = join(__dirname, '..', '..');

/** git that treats "no match" (exit 1) as an empty result, not a throw. */
function git(args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function srcAt(ref: string): { memory: string; ws_server: string } {
  return {
    memory: git(['show', `${ref}:hub/src/memory.ts`]),
    ws_server: git(['show', `${ref}:hub/src/ws_server.ts`]),
  };
}

const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'r483-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CFG = { port: 0, token: 'test-token' } as unknown as Config;

const SRC_DIRS = ['hub/src', 'plugin/src'];

/**
 * Read the LIVE working tree (not a commit), skipping build output.
 * `git grep --no-index` would ignore .gitignore rules and walk node_modules,
 * so this walks the source dirs explicitly and filters the same set CI compiles.
 */
function grepTree(dirs: string[]): { subscribe: string[]; unsubscribe: string[] } {
  const out = { subscribe: [] as string[], unsubscribe: [] as string[] };
  const walk = (rel: string): void => {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        walk(child);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        const text = readFileSync(join(REPO_ROOT, child), 'utf8');
        text.split('\n').forEach((line, i) => {
          // Keep the matched TEXT, not just its position: a control assertion
          // that the hit is real teardown code has to see the code.
          const at = `${child}:${i + 1}: ${line.trim()}`;
          if (/\.subscribe\(/.test(line)) out.subscribe.push(at);
          if (/\.unsubscribe\(/.test(line)) out.unsubscribe.push(at);
        });
      }
    }
  };
  dirs.forEach(walk);
  return out;
}

function makePool(): { pool: MemoryPool; db: ClawDB } {
  const db = new ClawDB(tmpDir());
  return { pool: new MemoryPool(db), db };
}

describe('R483 — the notification channel was never wired to a subscriber', () => {
  it(
    'A1 — `subscribe()` has no call site at ANY commit in the repo history',
    () => {
      const commits = git(['rev-list', '--all']).trim().split('\n').filter(Boolean);
      // Precondition: without a non-empty walk the zeros below are vacuous.
      expect(commits.length).toBeGreaterThan(100);

      const callSites: string[] = [];
      for (const c of commits) {
        const out = git(['grep', '-lE', '\\.subscribe\\(', c, '--', 'hub/src', 'plugin/src']);
        for (const line of out.split('\n')) {
          const file = line.split(':')[1];
          if (file) callSites.push(`${c.slice(0, 7)} ${file}`);
        }
      }
      expect(callSites).toEqual([]);
    },
    600_000,
  );

  it('A2 — NEGATIVE CONTROL: the same walker over the same history FINDS `unsubscribe`', () => {
    const hits = git(['grep', '-nE', '\\.unsubscribe\\(', 'HEAD', '--', 'hub/src', 'plugin/src']);
    // If the walker were broken this is empty and A1 proves nothing.
    expect(hits.trim()).not.toBe('');
    expect(hits).toMatch(/ws_server\.ts:\d+/);
    // And it is real teardown code in the disconnect path, not a comment.
    expect(hits).toMatch(/this\.memory\.unsubscribe\(agentId\)/);
  });

  it('A3 — POSITIVE CONTROL: the `subscribe` token IS findable, HEAD and initial commit', () => {
    const head = srcAt('HEAD');
    expect(head.memory).toMatch(/subscribe\(agentId: string/);
    expect(head.memory).toMatch(/private subscribers: Map</);

    const initial = srcAt('e282fce');
    expect(initial.memory).toMatch(/subscribe\(agentId: string/);
    expect(initial.memory).toMatch(/private subscribers: Map</);
  });

  it('A4 — the channel has TWO writers, one of them on the REST-reachable path', () => {
    const { memory, ws_server } = srcAt('HEAD');
    expect((memory.match(/this\.notifySubscribers\(/g) ?? []).length).toBe(1);
    expect((ws_server.match(/this\.memory\.notifySubscribers\(/g) ?? []).length).toBe(1);
    // The pool's writer sits behind the dedup gate R482 measured; the subject
    // of THIS round is the registry, not the gate.
    expect(memory).toMatch(
      /if \(!duplicate\) \{\s*this\.notifySubscribers\(\{ type: 'memory_write'/,
    );
  });

  it('A5 — RUNTIME: a registered subscriber IS called; no subscriber means no error', async () => {
    const { pool } = makePool();
    const got: OutboundMessage[] = [];
    pool.subscribe('sub-1', (m: OutboundMessage) => got.push(m));
    await pool.write('k1', 'v1', 'writer-a');
    expect(got.map((m) => m.type)).toEqual(['memory_write']);

    // Control: an un-subscribed pool completes the same write, stores it, and
    // reports nothing — the channel is QUIET, not broken.
    const bare = makePool();
    await bare.pool.write('k1', 'v1', 'writer-a');
    const res = await bare.pool.read('k1');
    expect(res).toBeDefined();
    expect(res!.value).toBe('v1');
  });

  it('A6 — RUNTIME: registering causes DUPLICATE delivery, so adding a caller is not a fix', async () => {
    const ws = new WSServer(CFG, new ClawDB(tmpDir()));
    const internals = ws as unknown as {
      agents: Map<string, { ws: { readyState: number; send: (d: unknown) => void } }>;
      memory: MemoryPool;
      handleMemoryWrite: (
        fromAgent: string,
        key: string,
        value: unknown,
        tags: string[],
        ttl: number,
      ) => Promise<void>;
    };

    const frames: { via: 'socket' | 'subscriber'; type?: string }[] = [];
    internals.agents.set('dup-agent', {
      ws: {
        readyState: 1,
        // WSServer.send() JSON-stringifies (ws_server.ts:596), so the SOCKET leg
        // delivers a serialized string while the SUBSCRIBER leg delivers the
        // live object. Parsing here pins what actually reaches each consumer,
        // rather than trusting the call-site argument shape.
        send: (d: unknown) =>
          frames.push({
            via: 'socket',
            type: (JSON.parse(d as string) as { type?: string }).type,
          }),
      },
    });
    internals.memory.subscribe('dup-agent', (m: OutboundMessage) => {
      frames.push({ via: 'subscriber', type: m.type });
    });

    await internals.handleMemoryWrite('writer-a', 'k1', 'v1', [], 0);

    // ONE logical write, THREE deliveries to the same agent:
    //   1. subscriber <- MemoryPool.write's own notifySubscribers ('memory_write')
    //   2. subscriber <- handleMemoryWrite's notifySubscribers  ('memory_update')
    //   3. socket   <- handleMemoryWrite's broadcast loop      ('memory_update')
    // So "just call subscribe() somewhere" would double-deliver every write.
    expect(frames.filter((f) => f.via === 'subscriber').map((f) => f.type)).toEqual([
      'memory_write',
      'memory_update',
    ]);
    expect(frames.filter((f) => f.via === 'socket').map((f) => f.type)).toEqual([
      'memory_update',
    ]);
    expect(frames.length).toBe(3);

    // CONTROL: same write, same agent, NO subscriber registered — exactly ONE
    // frame survives (the socket broadcast). Proves the two extra subscriber
    // frames above are CAUSED by the registration and are not ambient traffic.
    const bare = new WSServer(CFG, new ClawDB(tmpDir()));
    const bareInternals = bare as unknown as {
      agents: Map<string, { ws: { readyState: number; send: (d: unknown) => void } }>;
      handleMemoryWrite: (
        fromAgent: string,
        key: string,
        value: unknown,
        tags: string[],
        ttl: number,
      ) => Promise<void>;
    };
    const bareFrames: unknown[] = [];
    bareInternals.agents.set('dup-agent', {
      ws: { readyState: 1, send: (d: unknown) => bareFrames.push(d) },
    });
    await bareInternals.handleMemoryWrite('writer-a', 'k1', 'v1', [], 0);
    expect(bareFrames).toHaveLength(1);
  });

  it('A8 — the LIVE working tree has zero `subscribe()` call sites, not just committed history', () => {
    // A1/A2/A7 read COMMITTED history (`git show HEAD`, `git grep <commit>`).
    // That makes them structurally blind to an UNCOMMITTED wiring: adding
    // subscribe() to the working tree without committing left all 7 arms green
    // in a live mutation check. A suite whose headline claim is "the channel
    // was never wired" must pin the tree it is actually running against, or the
    // finding is unfalsifiable at exactly the moment someone starts fixing it.
    //
    // Negative control inside the same arm: the same regex DOES find
    // unsubscribe(), so a blank result here is a fact, not a broken probe.
    const live = grepTree(SRC_DIRS);
    expect(live.subscribe).toEqual([]);
    expect(live.unsubscribe.length).toBeGreaterThan(0);
    expect(live.unsubscribe.join('\n')).toMatch(/memory\.unsubscribe\(agentId\)/);

    // And it agrees with the committed view — no drift between what is on disk
    // and what HEAD claims.
    expect(live.subscribe).toEqual(
      git(['grep', '-lE', '\\.subscribe\\(', 'HEAD', '--', ...SRC_DIRS])
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split(':').slice(1).join(':')),
    );
  });

  it('A7 — connecting does NOT register: the teardown at :589 has no setup', () => {
    const { ws_server, memory } = srcAt('HEAD');
    expect(ws_server).toMatch(/this\.memory\.unsubscribe\(agentId\)/);
    // No call shape anywhere in the WS server — the paired operation exists
    // only on the teardown side.
    expect(ws_server).not.toMatch(/\.subscribe\(/);
    // The registry itself only ever inserts its own parameter names.
    expect(memory).not.toMatch(/this\.subscribers\.set\((?!agentId, callback)/);
  });
});
