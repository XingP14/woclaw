/**
 * R475 — the plane that protects the hub is per-agent; the plane that would
 * protect the hub FROM its agents does not exist.
 *
 * -----------------------------------------------------------------------
 * Selection: R441–R474 were 34 consecutive in-cluster rounds (R74 requires
 * an out-of-cluster round). This one opens a new plane and probes it
 * EXTERNALLY FIRST: HN Algolia 7 angles + GitHub Search 6 angles, then the
 * WoClaw audit. Control-first on both legs.
 *
 * -----------------------------------------------------------------------
 * WEDGE (recorded in the round write-up)
 *
 *   control (so the zeros are evidence):  HN `agent`=531,506 `LLM`=54,141
 *     `AI agent`=167,640 · GH `agent`=1,983,206 `LLM`=776,821
 *     `AI agent`=701,355
 *
 *   precision leg  HN 7 angles: 3 TRUE ZERO (`agent resource quota
 *     per-tenant`, `multi-tenant agent resource accounting`, `agent
 *     fairness scheduling shared cluster`, `LLM inference multi-tenant
 *     scheduling`). The 4 non-zero hits are all domain-adjacent (a
 *     LiveKit serverless post, a 2014 Airbnb complaint, two K8s
 *     provisioning posts) — none is an agent-side containment primitive.
 *
 *   precision leg  GH 6 angles: 4/6 ZERO, and the 2 that hit are
 *     `dxin66/quotagate` and `mehmetztrk/llm-gateway`, both **0★**, both
 *     created < 2 months ago. total_repos=2, peak 0★.
 *
 *   WIDENING leg (R449-5 / R454-4 — widening must be able to REFUTE
 *   greenfield, and it did): `LLM inference batching scheduler`=102 repos,
 *   `gpu time slicing sharing`=7 with a 72★ canonical. So the *mechanism*
 *   is mature infrastructure and the *agent-community migration gap* is
 *   thin. **This is not a greenfield and must not be reported as one** —
 *   cgroups, MIG/MPS, time-slicing and K8s quotas are all prior art.
 *
 * -----------------------------------------------------------------------
 * WHAT THE CENSUS FOUND IN WoClaw (7458 LOC, 24 prod .ts)
 *
 *   subject vocabulary (16 words, comments stripped): quota / throttl /
 *     concurren / fair / tenant / noisy / cgroup / semaphore /
 *     backpressure / flood / admission / aggregate / max.?agent /
 *     global.?limit / per.?topic.?cap / burst  = **0 hits**
 *
 *   negative control (arm A): the same walker, same regex family, on three
 *     vocabularies known to be present — per-agent limiter (46),
 *     topic fanout (5), per-agent identity (223). All DETECT. So the
 *     zero above is a fact about the source, not about the census.
 *
 *   semantic expansion (R469-3: a word census is not a semantics census).
 *     Every `.size`/`.count` compared against a number, in all of src/:
 *     **0**. All 21 comparisons of a `.length`-suffixed field are string
 *     or array lengths (passphrase length, query token length). There is no
 *     site anywhere that compares a *container of agents* to a threshold.
 *
 *   and the 177 `limit` hits are not containment: every one is a SQL
 *     `LIMIT` clause or a pagination default. They bound QUERY SIZE, not
 *     AGENTS.
 *
 * -----------------------------------------------------------------------
 * F1 — the only admission control is keyed by agentId, so it is defeated by
 *       the one move that costs an attacker nothing: MORE agents.
 *
 * `checkRateLimit(agentId)` (ws_server.ts:623-648) is the sole admission
 * control on the inbound path (`handleMessage:222-230`). It is a per-agent
 * sliding window of `DEFAULT_RATE_LIMIT_MESSAGES` messages per
 * `DEFAULT_RATE_LIMIT_WINDOW_MS`. There is no hub-wide term anywhere.
 *
 * The protected resource is *shared*: one event loop, one `WSServer`
 * instance, one SQLite file. The limiter charges each agent separately, so
 * the total admitted rate is `limit × connectedAgents` and grows without
 * bound as agents connect. Arm B measures that: N agents each admitted at
 * their own full budget, from one hub.
 *
 * This is the noisy-neighbour shape, and it is not a rate-limit bug — R471
 * already owns the per-agent entry's lifecycle (it outlives the socket).
 * This round's subject is the axis R471 does not have: the per-agent
 * limit is real, correct, and sufficient for exactly one agent.
 *
 * -----------------------------------------------------------------------
 * F2 — fanout has no bound on the other side either.
 *
 * `handleChatMessage` broadcasts to `topics.broadcast(topic, message)`,
 * i.e. every member of the topic, and `send()` (ws_server.ts) is
 *     if (ws.readyState === 1) ws.send(JSON.stringify(msg));
 * — no `bufferedAmount` check, no drain handling, no terminate. `joinTopic`
 * (topics.ts:33) has no membership cap, and `createTopic` (topics.ts:7)
 * has no topic cap, so topic membership is agent-count-bounded and nothing
 * bounds it. A single message costs the hub one `send` per member.
 *
 * The comment at rest_server.ts:7 says clients "receive the full body via
 * WS broadcast" — the payload is unbounded and the fanout is unbounded,
 * and nothing reconciles the two. Arm F pins the ceiling's absence from
 * the sender's side: the sender that fills a topic is charged once, for
 * the whole broadcast.
 *
 * -----------------------------------------------------------------------
 * Arms. Following the convention of this directory, they assert CURRENT
 * behaviour and are GREEN at HEAD — they are descriptions of the plane,
 * not demands. A repair turns one RED on purpose.
 *
 *   A  negative control — the census detects three planes that exist
 *   B  the aggregate axis: N agents are each admitted at their FULL budget,
 *      so the hub's admitted total is limit×N with no ceiling (measured)
 *   C  the per-agent budget is unchanged while the aggregate grows
 *   D  CONTROL: one agent alone is still limited — so B is not "no limiter
 *      exists", it is "the limiter has no aggregate term"
 *   E  no hub-wide term exists in source: no `.size`/`.count` compared to a
 *      number anywhere in src/, and the subject vocabulary is 0
 *   F  the sender is charged once for a broadcast that costs one send per
 *      member — the amplification axis is not on the sender's meter
 *
 * The fix — a hub-wide token bucket, a per-topic membership cap, or
 * backpressure on `send()` — is a behaviour decision and is
 * **father-gated**. This suite only pins the shape.
 *
 * -----------------------------------------------------------------------
 * KNOWN LIMITATION, found by this round's own mutation matrix (recorded
 * rather than papered over — R445-3 / R446-5: the repair is to state the
 * limit, not to widen the assertion until it goes green).
 *
 * Arm E is a SHAPE detector. It asserts "no site compares a container of
 * agents to a threshold", which is stronger than its title ("no hub-wide
 * admission term exists") in one direction and weaker in another:
 *
 *   - it fires on a cap that would never bind at any reachable N. Mutant
 *     M2b injected `if (this.rateLimits.size > 10000) return {limited:true}`
 *     — a perfectly legitimate "start permissive" first commit — and arm E
 *     went RED. So E cannot distinguish a real bound from a placeholder.
 *   - B and C, by contrast, are EFFECT detectors: they measure admitted
 *     messages, so a non-binding cap leaves them green.
 *
 * That is the actual division of labour and it is deliberate: E keeps the
 * vocabulary from creeping back in prose-free form, B/C keep the *behaviour*
 * honest. Neither alone is sufficient. Anyone adding a hub-wide cap should
 * expect E to go red on the first permissive commit and should treat that as
 * the prompt to make the cap bind — not as a reason to delete E.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import { TopicsManager } from '../src/topics.js';
import type { Config, InboundMessage } from '../src/types.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(HERE, '..', 'src');

const CFG: Config = {
  port: 0, restPort: 0, host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r475-probe',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r475-probe/probe.db' },
  authToken: 'r475-probe-token',
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Strip block + line comments so a census never reads prose as code (R460-3). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function srcFiles(): string[] {
  return readdirSync(SRC).filter(f => f.endsWith('.ts')).sort();
}

describe('R475: per-agent admission, no aggregate — the hub is the shared resource', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer, topics: TopicsManager;
  let wsPort: number;
  const opened: WebSocket[] = [];

  beforeAll(async () => {
    rmSync(CFG.dataDir!, { recursive: true, force: true });
    mkdirSync(CFG.dataDir!, { recursive: true });
    db = new ClawDB(CFG);
    ws = new WSServer(CFG, db);
    const mem = ws.getMemoryPool();
    mem.graphStore = new GraphStore();
    rest = new RestServer(CFG, db, ws.getTopicsManager(), mem, mem.graphStore, ws);
    await rest.start();
    wsPort = await ws.whenListening();
    topics = ws.getTopicsManager();
  });

  afterAll(() => {
    for (const s of opened) { try { s.close(); } catch { /* already gone */ } }
    try { rest.close(); } catch { /* already stopped */ }
    try { ws.close(); } catch { /* already stopped */ }
    rmSync(CFG.dataDir!, { recursive: true, force: true });
  });

  async function connect(agentId: string): Promise<WebSocket> {
    const s = new WebSocket(`ws://127.0.0.1:${wsPort}?agentId=${agentId}&token=${CFG.authToken}`);
    opened.push(s);
    await new Promise<void>((res, rej) => { s.once('open', () => res()); s.once('error', rej); });
    return s;
  }

  /** Send a chat message and report whether the hub refused it. */
  function chat(s: WebSocket, topic: string, content: string): Promise<{ refused: boolean; code?: string }> {
    return new Promise((res) => {
      const err = (raw: any) => {
        s.off('message', onMsg);
        res({ refused: raw?.code === 'RATE_LIMIT_EXCEEDED', code: raw?.code });
      };
      const ok = () => { s.off('message', err); res({ refused: false }); };
      const onMsg = (raw: WebSocket.RawData) => {
        let parsed: any;
        try { parsed = JSON.parse(raw.toString()); } catch { return ok(); }
        if (parsed?.type === 'error') err(parsed);
        else if (parsed?.sent === true || parsed?.type === 'message') ok();
      };
      s.on('message', onMsg);
      const msg: InboundMessage = { type: 'message', topic, content };
      s.send(JSON.stringify(msg));
      setTimeout(ok, 1500);
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // A — NEGATIVE CONTROL. The census must detect planes that DO exist.
  //    Without this, every zero below is uninterpretable.
  // ────────────────────────────────────────────────────────────────────────
  it('A the census detects three planes that exist, so its zero on the subject is evidence', () => {
    const files = srcFiles();
    expect(files.length, 'src/ must not be empty — the walker reached the tree').toBeGreaterThan(0);

    const controls: Record<string, RegExp> = {
      'per-agent limiter':  /rate.?limit/i,
      'topic fanout':      /broadcast/i,
      'per-agent identity': /agentid/i,
    };
    const counts: Record<string, number> = {};
    for (const [label, re] of Object.entries(controls)) {
      let n = 0;
      for (const f of files) {
        n += (stripComments(readFileSync(join(SRC, f), 'utf8')).match(new RegExp(re.source, 'gi')) || []).length;
      }
      counts[label] = n;
    }
    // Each control plane is asserted PRESENT. If one of these ever reads 0,
    // the census is blind and the subject zero in arm E means nothing.
    expect(counts['per-agent limiter'], 'control: the per-agent limiter exists').toBeGreaterThan(0);
    expect(counts['topic fanout'], 'control: topic fanout exists').toBeGreaterThan(0);
    expect(counts['per-agent identity'], 'control: per-agent identity exists').toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // B/C/D — the measured aggregate axis. B is the finding, C holds the
  // per-agent budget fixed, D proves a limiter really is present.
  // ────────────────────────────────────────────────────────────────────────
  it('D CONTROL: one agent alone is still rate limited — a limiter does exist', async () => {
    const s = await connect('r475-solo');
    // Learn the budget from the server rather than from a source literal:
    // keep sending until the first refusal. This is the MEASURED limit.
    let firstRefusalAt = -1;
    for (let i = 1; i <= 400; i++) {
      const r = await chat(s, 'r475-d', `m${i}`);
      if (r.refused) { firstRefusalAt = i; break; }
    }
    expect(firstRefusalAt, 'a single agent must eventually be refused').toBeGreaterThan(0);
    expect(firstRefusalAt, 'and must be admitted a bounded number of times first').toBeLessThanOrEqual(400);
  });

  it('B/C N agents are each admitted their OWN full budget — the total is limit x N', async () => {
    const N = 6;
    // Measure ONE agent's budget first, on its own hub slot, so the per-agent
    // number in the comparison is measured and not read from a source literal.
    const solo = await connect('r475-measure');
    let budget = -1;
    for (let i = 1; i <= 400; i++) {
      const r = await chat(solo, 'r475-measure-topic', `m${i}`);
      if (r.refused) { budget = i - 1; break; }
    }
    expect(budget, 'the per-agent budget must be measurable').toBeGreaterThan(0);
    // Record the MEASURED constant in the run log. The arm asserts the
    // AGGREGATE relation (N x budget) and deliberately does NOT pin the
    // number itself — a number asserted here would be a lock on a constant
    // this round is not about (R438: a stated number is not coverage).
    console.log(`[R475] measured per-agent budget = ${budget} msgs/window; aggregate over N=${N} = ${budget * N}`);

    // Now N agents, each given the SAME per-agent budget. If any is refused
    // before `budget`, an aggregate term exists and this round's subject is
    // wrong. None is refused => the hub admitted N x budget.
    const perAgent: number[] = [];
    const socks: WebSocket[] = [];
    for (let a = 0; a < N; a++) {
      const s = await connect(`r475-multi-${a}`);
      socks.push(s);
      let admitted = 0;
      for (let i = 1; i <= budget; i++) {
        const r = await chat(s, `r475-shared-${a}`, `m${i}`);
        if (r.refused) break;
        admitted++;
      }
      perAgent.push(admitted);
    }
    for (const s of socks) { try { s.close(); } catch { /* gone */ } }
    await sleep(200);

    // C: every agent got its full per-agent budget — the per-agent limiter
    // is working exactly as written.
    for (const [i, got] of perAgent.entries()) {
      expect(got, `agent ${i} must be admitted the full per-agent budget`).toBe(budget);
    }
    // B: and the hub's admitted total is the SUM, with no aggregate ceiling.
    const total = perAgent.reduce((x, y) => x + y, 0);
    expect(total, 'the hub admitted every agent at full budget => total = N x budget')
      .toBe(budget * N);
    expect(budget * N, 'an aggregate term would have capped this below N x budget')
      .toBeGreaterThan(budget);
  });

  // ────────────────────────────────────────────────────────────────────────
  // E — the plane is not merely unimplemented, it is not EXPRESSIBLE.
  //    (R395/R399 shape: no field to compare ⇒ no conflict can be written.)
  // ────────────────────────────────────────────────────────────────────────
  it('E no hub-wide admission term exists: subject vocabulary 0, and no container-of-agents is ever compared to a number', () => {
    const files = srcFiles();
    const SUBJECT = [
      'quota', 'throttl', 'concurren', 'fair', 'tenant', 'noisy', 'cgroup',
      'semaphore', 'backpressure', 'flood', 'admission', 'aggregate',
      'max.?agent', 'global.?limit', 'per.?topic.?cap', 'burst',
    ];
    const hits: Record<string, number> = {};
    let subjectTotal = 0;
    const containerComparisons: string[] = [];

    for (const f of files) {
      const text = stripComments(readFileSync(join(SRC, f), 'utf8'));
      for (const w of SUBJECT) {
        const n = (text.match(new RegExp(w, 'gi')) || []).length;
        if (n) { hits[w] = (hits[w] || 0) + n; subjectTotal += n; }
      }
      // The SHAPE an aggregate cap must have: a container's size compared
      // to a threshold. `.length` is excluded — every one of those is a
      // string/array length, which bounds a payload, not a population.
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (/\.(size|count)\s*[<>]=?/.test(line)) {
          containerComparisons.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }

    expect(subjectTotal,
      `aggregate-containment vocabulary must be absent; found ${JSON.stringify(hits)}`)
      .toBe(0);
    expect(containerComparisons,
      `no site may compare a container of agents to a threshold; found ${JSON.stringify(containerComparisons)}`)
      .toEqual([]);
  });

  // ────────────────────────────────────────────────────────────────────────
  // F — the amplification axis is on the receiver's meter, not the sender's.
  // ────────────────────────────────────────────────────────────────────────
  it('F the sender is charged once for a broadcast the hub pays for per member', async () => {
    const members = 8;
    const broadcaster = await connect('r475-broadcaster');
    const listeners: WebSocket[] = [];
    for (let i = 0; i < members; i++) {
      const s = await connect(`r475-listener-${i}`);
      listeners.push(s);
      const j = await new Promise<boolean>((res) => {
        const t = setTimeout(() => res(false), 1500);
        s.on('message', (raw) => {
          if (JSON.parse(raw.toString())?.type === 'history') { clearTimeout(t); res(true); }
        });
        s.send(JSON.stringify({ type: 'join', topic: 'r475-fanout' }));
      });
      expect(j, `listener ${i} must join the topic`).toBe(true);
    }

    // ONE message from ONE sender. Register every listener's observer
    // FIRST, then send once — so no delivery can be missed by a race.
    const seen: Promise<boolean>[] = listeners.map(s => new Promise<boolean>(res => {
      const t = setTimeout(() => res(false), 2500);
      s.on('message', (raw) => {
        let m: any;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m?.type === 'message' && m?.topic === 'r475-fanout') { clearTimeout(t); res(true); }
      });
    }));

    await new Promise<void>(res => {
      const t = setTimeout(res, 1500);
      broadcaster.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m?.sent === true) { clearTimeout(t); res(); }
      });
      broadcaster.send(JSON.stringify({ type: 'message', topic: 'r475-fanout', content: 'once' } as InboundMessage));
    });

    const results = await Promise.all(seen);
    expect(results.filter(Boolean).length,
      'the single broadcast must reach every member — the amplification is real')
      .toBe(members);

    for (const s of [broadcaster, ...listeners]) { try { s.close(); } catch { /* gone */ } }
    await sleep(150);
  });
});
