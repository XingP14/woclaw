/**
 * R553 — THE REVOCATION PLANE: rotating the credential does not revoke the
 * sessions it was supposed to revoke.
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * R551 asked "does the operator's setting do anything" (llm-benchmark).
 * R552 asked "what happens when the operator hands it the wrong TYPE"
 * (woclaw's numeric config). Both are about the CONFIG plane.
 *
 * This round asks about the **SESSION plane**, and it is the question the
 * token-rotation feature exists to answer:
 *
 *     **An operator rotates the hub token because they believe a credential
 *      has leaked. Does the credential stop working?**
 *
 * ── What is actually in the code ──────────────────────────────────────────
 *
 * `hub/src/ws_server.ts` has exactly TWO call sites of `isTokenAuthorized`:
 *
 *     L165  handleConnection()  ->  the WebSocket HANDSHAKE
 *     L237  rest_server.ts      ->  the REST REQUEST (per request)
 *
 * The WebSocket plane therefore evaluates the credential **once**, at
 * handshake, and never again. `handleMessage()` — the per-frame path, which
 * is where `join`, `memory_write`, `message` and every delegation op are
 * dispatched — contains no authorization check at all.
 *
 * `rotateToken()` (ws_server.ts:977) swaps `config.authToken` and sets
 * `gracePeriodEnd`. It touches **no socket**. Nothing in the class iterates
 * `this.agents` on rotation.
 *
 * ⇒ The grace period, which the ROADMAP (S22, docs/ROADMAP.md:1045) defines
 *   as "旧 token 在宽限期内仍有效 / 宽限期结束后自动失效" ("the old token is
 *   still valid during the grace period / automatically expires when the
 *   grace period ends"), expires **the credential** but not the **session**
 *   that credential opened.
 *
 * ── The asymmetry that makes it a finding, not a curiosity ────────────────
 *
 * The SAME revocation, on the REST plane, IS enforced:
 *
 *     POST /admin/token/rotate  with the dead credential  ->  HTTP 401
 *     GET  /admin/token/status  with the dead credential  ->  HTTP 401
 *     GET  /admin/token/status  with the new credential   ->  HTTP 200
 *
 * So the hub enforces "this credential is dead" on the request plane and
 * does not enforce it on the session plane. An operator who tested the
 * revocation with `curl` would conclude it works.
 *
 * This is CWE-613 (Insufficient Session Expiration). It is not exotic: it is
 * exactly CVE-2026-42421 (CWE-613) in OpenClaw — "existing WebSocket
 * sessions survive shared gateway token rotation" — and CVE-2026-34503.
 *
 * ── What is pinned here ───────────────────────────────────────────────────
 *
 * This is a DISCLOSURE suite (defect-presence gate): green today, RED when
 * a revocation repair lands. It does NOT assert what the repair should be
 * (close the socket? re-check per frame? close only the old-token sockets?)
 * — that is a product decision (father-gated).
 *
 * Every arm carries an explicit ROLE, because the mutation matrix reads
 * roles to decide what a flip MEANS:
 *
 *   DEFECT-PIN     a revocation repair SHOULD flip it RED
 *   CONTROL        a repair MUST NOT flip it      (a stable fact)
 *   DISCRIMINATOR  separates a full repair from a partial one
 *   NO-REPAIR-YET  measures "the repair has not landed"
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import { RestServer } from '../src/rest_server.js';
import { GraphStore } from '../src/graph/store.js';
import { SessionStore } from '../src/session_store.js';
import type { Config } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

const OLD_TOKEN = 'r553-old-token-abc123';
const NEW_TOKEN = 'r553-new-token-xyz789';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Fixture {
  server: WSServer;
  db: ClawDB;
  port: number;
  dir: string;
  /** Every socket this fixture opened. They MUST be closed before the
   *  server: `WSServer.close()` walks `this.agents` and calls
   *  `agent.ws.close(1001, ...)`, and an open client socket keeps the
   *  server's `close` from settling — which hangs the afterEach and
   *  poisons the NEXT arm (measured: a hung teardown made F4b/F4c fail
   *  in a run where they had already passed). */
  sockets: WebSocket[];
  /** The REST server, if the arm started one. */
  rest?: RestServer;
}

let live: Fixture[] = [];

async function mkHub(overrides: Partial<Config> = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'r553-'));
  const config: Config = {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: dir,
    authToken: OLD_TOKEN,
    ...overrides,
  };
  const db = new ClawDB(dir);
  const server = new WSServer(config, db);
  const port = await server.whenListening();
  const fx: Fixture = { server, db, port, dir, sockets: [] };
  live.push(fx);
  return fx;
}

/** Open a WS connection and wait for it to open. The socket is registered
 *  with the current fixture so the teardown can close it — an unclosed
 *  client socket hangs `WSServer.close()` and poisons the next arm. */
function connect(port: number, agentId: string, token: string, fx?: Fixture): Promise<WebSocket> {
  const c = new WebSocket(`ws://127.0.0.1:${port}/?agentId=${agentId}&token=${token}`);
  (fx ?? live[live.length - 1])?.sockets.push(c);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
    c.on('open', () => { clearTimeout(t); resolve(c); });
    c.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

/** Resolve with the close code if the socket closes, else 'OPEN' after `ms`. */
function closeOutcome(sock: WebSocket, ms: number): Promise<string> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('OPEN'), ms);
    sock.on('close', (code) => { clearTimeout(t); resolve(`CLOSE ${code}`); });
  });
}

/** Collect frames from a socket. */
function collect(sock: WebSocket): any[] {
  const frames: any[] = [];
  sock.on('message', (d) => { try { frames.push(JSON.parse(d.toString())); } catch { /* ignore */ } });
  return frames;
}

afterEach(async () => {
  for (const fx of live) {
    // Close the CLIENT sockets FIRST. `WSServer.close()` walks `this.agents`
    // and calls `agent.ws.close(1001, ...)`; with a client socket still
    // open, that close never settles and the afterEach hangs — which then
    // fails the NEXT arm for the wrong reason (measured: F4b/F4c went red
    // in a run where they had already passed).
    for (const s of fx.sockets) {
      try { s.terminate(); } catch { /* ignore */ }
    }
    try { fx.rest?.close?.(); } catch { /* ignore */ }
    try { fx.server.close(); } catch { /* ignore */ }
    try { await fx.db.close(); } catch { /* ignore */ }
  }
  live = [];
});

describe('R553 — the revocation plane: rotation does not revoke the sessions it revoked', () => {

  // ── F1 ────────────────────────────────────────────────────────────────────
  describe('F1: the credential dies, the session does not', () => {

    it('F1a (DEFECT-PIN) — after the grace period expires, the OLD credential is refused on a FRESH connect', async () => {
      const fx = await mkHub();
      fx.server.rotateToken(NEW_TOKEN, 300);
      await wait(900);

      // The credential is genuinely dead.
      expect(fx.server.isTokenAuthorized(OLD_TOKEN)).toBe(false);
      expect(fx.server.isTokenAuthorized(NEW_TOKEN)).toBe(true);

      // ...and a fresh connect with it is refused.
      const attempt = new WebSocket(`ws://127.0.0.1:${fx.port}/?agentId=fresh&token=${OLD_TOKEN}`);
      fx.sockets.push(attempt);
      const outcome = await closeOutcome(attempt, 2500);
      expect(outcome).toBe('CLOSE 4001');
    }, 20_000);

    it('F1b (DEFECT-PIN) — but the socket opened with that SAME dead credential is still OPEN', async () => {
      const fx = await mkHub();
      const sock = await connect(fx.port, 'agent-1', OLD_TOKEN);
      await wait(150);

      fx.server.rotateToken(NEW_TOKEN, 300);
      await wait(900); // grace expired; the credential is dead

      // The credential is dead ...
      expect(fx.server.isTokenAuthorized(OLD_TOKEN)).toBe(false);
      // ... and the socket that presented it is still OPEN.
      expect(sock.readyState).toBe(WebSocket.OPEN);
    }, 20_000);

    it('F1c (DEFECT-PIN) — the dead session can still JOIN a topic and PUBLISH', async () => {
      const fx = await mkHub();
      const sock = await connect(fx.port, 'agent-1', OLD_TOKEN);
      const frames = collect(sock);
      await wait(150);

      fx.server.rotateToken(NEW_TOKEN, 300);
      await wait(900);
      expect(fx.server.isTokenAuthorized(OLD_TOKEN)).toBe(false);

      sock.send(JSON.stringify({ type: 'join', topic: 'post-revocation-topic' }));
      await wait(300);
      sock.send(JSON.stringify({ type: 'message', topic: 'post-revocation-topic', content: 'published after revocation' }));
      await wait(500);

      const types = frames.map((f) => f.type);
      expect(types).toContain('history');
      const published = frames.find((f) => f.type === 'message' && f.content === 'published after revocation');
      expect(published).toBeDefined();
      expect(published.from).toBe('agent-1');
    }, 20_000);

    it('F1d (DEFECT-PIN) — the dead session can still WRITE to the shared memory store', async () => {
      const fx = await mkHub();
      const sock = await connect(fx.port, 'agent-1', OLD_TOKEN);
      await wait(150);

      fx.server.rotateToken(NEW_TOKEN, 300);
      await wait(900);
      expect(fx.server.isTokenAuthorized(OLD_TOKEN)).toBe(false);

      sock.send(JSON.stringify({ type: 'memory_write', key: 'written-by-dead-credential', value: 'x', tags: [] }));
      await wait(700);

      const mem = await (fx.db as any).getMemory('written-by-dead-credential');
      expect(mem).toBeDefined();
      expect(mem.value).toBe('x');
      expect(mem.updatedBy).toBe('agent-1');
    }, 20_000);

    it('F1e (DEFECT-PIN) — the dead session is still listed as a connected agent', async () => {
      const fx = await mkHub();
      const sock = await connect(fx.port, 'agent-1', OLD_TOKEN);
      await wait(150);

      fx.server.rotateToken(NEW_TOKEN, 300);
      await wait(900);

      const agents = fx.server.getAgentsInfo();
      expect(agents.map((a) => a.agentId)).toContain('agent-1');
      expect(sock.readyState).toBe(WebSocket.OPEN);
    }, 20_000);
  });

  // ── F2: the control that proves the finding is about the SESSION ─────────
  describe('F2: the REST plane DOES enforce the same revocation (the control)', () => {

    it('F2a (CONTROL) — the same dead credential is refused on the REST plane', async () => {
      const fx = await mkHub();
      const rest = new RestServer(
        { ...fx.server['config'], restPort: 0 } as Config,
        fx.db,
        fx.server.getTopicsManager(),
        fx.server.getMemoryPool(),
        new GraphStore(),
        fx.server,
        new SessionStore(fx.db),
      );
      fx.rest = rest;
      rest.start();
      // AWAIT the bind. Sleeping a fixed 400 ms is the R552 lesson: the
      // port may not be up yet, and the fetch then races the listener.
      const restPort = await rest.whenListening();
      expect(restPort).toBeGreaterThan(0);

      fx.server.rotateToken(NEW_TOKEN, 300);
      await wait(900);
      expect(fx.server.isTokenAuthorized(OLD_TOKEN)).toBe(false);

      const call = async (path: string, method: string, token: string) => {
        const r = await fetch(`http://127.0.0.1:${restPort}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}` },
        });
        return r.status;
      };

      expect(await call('/admin/token/status', 'GET', OLD_TOKEN)).toBe(401);
      expect(await call('/admin/token/rotate', 'POST', OLD_TOKEN)).toBe(401);
      expect(await call('/admin/token/status', 'GET', NEW_TOKEN)).toBe(200);
    }, 20_000);
  });

  // ── F3: the census — WHERE the credential is (not) re-checked ────────────
  describe('F3: source census — the credential is evaluated at the handshake and nowhere else', () => {

    /** Strip `//` and block comments so a census never matches its own docs. */
    function stripComments(src: string): string {
      return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    }

    const srcFiles = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
    const srcAll = srcFiles
      .map((f) => stripComments(readFileSync(join(SRC, f), 'utf8')))
      .join('\n');

    it('F3a (CONTROL) — the census finds the symbol when it is present', () => {
      // The sentinel lives in CODE, not in prose: stripComments removes
      // `// ...`, so a sentinel placed in a comment would make this control
      // pass for the wrong reason (R460-9).
      expect(stripComments('const a = 1; // isTokenAuthorized\n/* isTokenAuthorized */'))
        .not.toMatch(/isTokenAuthorized/);
      expect(srcAll).toMatch(/isTokenAuthorized/);    });

    it('F3b (NO-REPAIR-YET) — the WS credential check sits on the HANDSHAKE, not on the per-frame path', () => {
      const wsSrc = stripComments(readFileSync(join(SRC, 'ws_server.ts'), 'utf8'));
      // The authorization call is inside handleConnection (the handshake).
      expect(wsSrc).toMatch(/handleConnection[\s\S]{0,2000}isTokenAuthorized\(token/);
      // The per-frame dispatcher does NOT re-check.
      const handleMessage = wsSrc.slice(wsSrc.indexOf('private async handleMessage'));
      expect(handleMessage.slice(0, 2500)).not.toMatch(/isTokenAuthorized/);
    }, 20_000);

    it('F3c (NO-REPAIR-YET) — rotateToken touches no socket: no agent iteration, no close', () => {
      const wsSrc = stripComments(readFileSync(join(SRC, 'ws_server.ts'), 'utf8'));
      const rotate = wsSrc.slice(wsSrc.indexOf('rotateToken(newToken: string'));
      const body = rotate.slice(0, rotate.indexOf('\n  }'));
      expect(body).toMatch(/this\.config\.nextAuthToken = oldToken/);
      expect(body).toMatch(/this\.gracePeriodEnd = Date\.now\(\) \+ grace/);
      // No socket is touched: the rotation never walks this.agents.
      expect(body).not.toMatch(/this\.agents/);
      expect(body).not.toMatch(/\.close\(/);
      expect(body).not.toMatch(/terminate\(/);
    }, 20_000);

    it('F3d (NO-REPAIR-YET) — no per-frame or per-sweep re-check exists anywhere in src/', () => {
      // The only periodic toucher of live sockets is the 30s ping, which
      // pings and does NOT authorize.
      const wsSrc = stripComments(readFileSync(join(SRC, 'ws_server.ts'), 'utf8'));
      const pingAll = wsSrc.slice(wsSrc.indexOf('private pingAll'));
      expect(pingAll.slice(0, 1200)).not.toMatch(/isTokenAuthorized/);
      expect(pingAll.slice(0, 1200)).toMatch(/\.ping\(\)/);
    }, 20_000);
  });

  // ── F4: the partial repair is not a repair — DISCRIMINATOR arms ──────────
  describe('F4: which repairs are distinguishable (discriminators)', () => {

    it('F4a (DISCRIMINATOR) — the 4002 eviction self-heal only fires on an agentId COLLISION', async () => {
      const fx = await mkHub();
      const dead = await connect(fx.port, 'agent-1', OLD_TOKEN);
      await wait(150);

      fx.server.rotateToken(NEW_TOKEN, 300);
      await wait(900);

      // A legitimate client connecting with the SAME agentId evicts the
      // incumbent with 4002 — the only path that ever closes a rotated-out
      // session, and it fires only on a name collision.
      //
      // The eviction is ASYNCHRONOUS (the server calls `oldAgent.ws.close`
      // and the client observes the close on a later tick), so the
      // assertion AWAITS the close event rather than sampling
      // `readyState` after a fixed sleep — sampling is a race that failed
      // once (measured: readyState was still 2 = CLOSING, not 3).
      const deadClosed = closeOutcome(dead, 3000);
      const legit = await connect(fx.port, 'agent-1', NEW_TOKEN);
      expect(await deadClosed).toBe('CLOSE 4002');

      // But on a DIFFERENT agentId nothing closes it.
      const fx2 = await mkHub();
      const dead2 = await connect(fx2.port, 'attacker-1', OLD_TOKEN);
      await wait(150);
      fx2.server.rotateToken(NEW_TOKEN, 300);
      await wait(900);
      const other = await connect(fx2.port, 'worker-9', NEW_TOKEN);
      await wait(600);
      expect(dead2.readyState).toBe(WebSocket.OPEN);
      expect(other.readyState).toBe(WebSocket.OPEN);
    }, 20_000);

    it('F4b (CONTROL) — an UNAUTHORIZED connection is still refused (the handshake gate works)', async () => {
      const fx = await mkHub();
      const attempt = new WebSocket(`ws://127.0.0.1:${fx.port}/?agentId=x&token=totally-wrong`);
      fx.sockets.push(attempt);
      const outcome = await closeOutcome(attempt, 2500);
      expect(outcome).toBe('CLOSE 4001');    });

    it('F4c (CONTROL) — an anonymous connection (no token at all) is still refused', async () => {
      const fx = await mkHub();
      const attempt = new WebSocket(`ws://127.0.0.1:${fx.port}/?agentId=x`);
      fx.sockets.push(attempt);
      const outcome = await closeOutcome(attempt, 2500);
      expect(outcome).toBe('CLOSE 4001');
    }, 20_000);

    it('F4d (CONTROL) — during the GRACE period the old credential is still accepted (the feature works)', async () => {
      const fx = await mkHub();
      fx.server.rotateToken(NEW_TOKEN, 60_000);
      await wait(200);
      expect(fx.server.isTokenAuthorized(OLD_TOKEN)).toBe(true);
      expect(fx.server.isTokenAuthorized(NEW_TOKEN)).toBe(true);
    }, 20_000);

    it('F4e (DISCRIMINATOR) — during the GRACE period the old-credential SESSION must survive too', async () => {
      // This arm separates two candidate repairs that BOTH close the
      // defect:
      //
      //   (a) "close every socket on rotation"        — breaks the grace
      //       promise the ROADMAP states (S22: the old token stays valid
      //       during the grace period), so it must be RED here;
      //   (b) "close only the sessions the revoked
      //       credential opened, or re-check per frame" — keeps the grace
      //       promise, so it must stay GREEN here.
      //
      // A repair that satisfies F1b-F1e but breaks F4e has traded a
      // revocation bug for a grace-period bug.
      const fx = await mkHub();
      const sock = await connect(fx.port, 'agent-1', OLD_TOKEN);
      await wait(150);

      fx.server.rotateToken(NEW_TOKEN, 60_000);
      await wait(300);

      // The credential is still inside its grace window ...
      expect(fx.server.isTokenAuthorized(OLD_TOKEN)).toBe(true);
      // ... and so is the session it opened.
      expect(sock.readyState).toBe(WebSocket.OPEN);
    }, 20_000);
  });

  // ── F5: the ROADMAP promise ──────────────────────────────────────────────
  describe('F5: the documented promise the code does not keep', () => {

    it('F5a (NO-REPAIR-YET) — getTokenStatus reports the grace as OVER while the old session is still live', async () => {
      const fx = await mkHub();
      const sock = await connect(fx.port, 'agent-1', OLD_TOKEN);
      await wait(150);

      fx.server.rotateToken(NEW_TOKEN, 300);
      await wait(900);

      const status = fx.server.getTokenStatus();
      // The operator's dashboard says: the old credential is gone.
      expect(status.inGracePeriod).toBe(false);
      expect(status.gracePeriodEnd).toBe(null);
      // ...while the session it opened is still running and still privileged.
      expect(sock.readyState).toBe(WebSocket.OPEN);
      expect(fx.server.getAgentsInfo().map((a) => a.agentId)).toContain('agent-1');
    }, 20_000);
  });
});
