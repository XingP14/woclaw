/**
 * R550 — the IDENTITY-BINDING plane: what is being authenticated?
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * R549 measured the REST GET boundary: the credential is "decorative" on the
 * read path (a wrong Bearer token yields a byte-identical response), so the
 * request path cannot carry a principal. R549 left open item 3: "REST 面要不要
 * 带 principal?" -- and R404's `agentId`↔token binding has been open since.
 *
 * This round asks a different question. Not "is the gate closed" but:
 *
 *     **WHAT IS BEING AUTHENTICATED?**
 *
 * Measured facts (each one has an arm below):
 *
 *   1. There is exactly ONE secret for the whole fleet: `config.authToken`
 *      (plus one rotation-grace token). `isTokenAuthorized()` compares the
 *      presented token against it. It says nothing about WHO is presenting.
 *   2. The caller's NAME arrives separately, in the query string:
 *        WS:      `?agentId=<name>&token=<secret>`
 *        FED:     `?hubId=<name>&token=<secret>`
 *      The name is ASSERTED alongside the credential, never DERIVED from it.
 *   3. A second socket that claims an occupied name evicts the holder
 *      (close 4002) -- and, measured over 6 trials, leaves the registry
 *      EMPTY rather than handing the name over.
 *   4. `federation.ts` connects with `?hubId=` while `ws_server.ts` reads
 *      `?agentId=` and REJECTS a missing one -- so a peer hub is closed
 *      4001 on connect. Federation cannot form between two real hubs.
 *
 * ⇒ The token authenticates THE HUB. The name identifies THE CALLER. They
 * are two independent facts glued together by a convention no code enforces.
 *
 * ── What is pinned here ───────────────────────────────────────────────────
 *
 * This is a DISCLOSURE suite (defect-presence gate): green today, RED when
 * the binding lands. It is NOT a regression gate, and it does not assert what
 * the repair should be -- the repair is a product decision (father-gated).
 *
 * Every arm carries an explicit ROLE, because the mutation matrix reads
 * roles to decide what a flip MEANS:
 *
 *   DEFECT-PIN     a binding repair SHOULD flip it RED
 *   CONTROL        a repair MUST NOT flip it      (a stable fact)
 *   DISCRIMINATOR  separates a full repair from a partial one
 *   NO-REPAIR-YET  measures "the repair has not landed"
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import net from 'net';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import type { Config } from '../src/types.js';

const TOKEN = 'r550-shared-hub-token';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

type Frame = { type: string; [k: string]: unknown };

function openConn(url: string) {
  const frames: Frame[] = [];
  const client = new WebSocket(url);
  client.on('message', (data: Buffer) => {
    try {
      frames.push(JSON.parse(data.toString()) as Frame);
    } catch {
      /* non-JSON frame */
    }
  });
  const opened = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`open timeout: ${url}`)), 8000);
    client.once('open', () => { clearTimeout(t); resolve(); });
    client.once('error', (e: unknown) => { clearTimeout(t); reject(e); });
  });
  // The close promise NEVER rejects: a socket still open when the test ends
  // would otherwise surface as an unhandled rejection that vitest reports as
  // a test error and that masks the real assertion outcomes. A timeout
  // resolves with code -1 ("never closed") instead.
  const closed = new Promise<{ code: number; frames: Frame[] }>((resolve) => {
    const t = setTimeout(() => { client.terminate(); resolve({ code: -1, frames }); }, 4000);
    client.once('close', (code: number) => { clearTimeout(t); resolve({ code, frames }); });
  });
  return { client, frames, opened, closed };
}

async function awaitFrames(conn: { opened: Promise<void>; frames: Frame[] }, n: number): Promise<void> {
  await conn.opened;
  const deadline = Date.now() + 5000;
  while (conn.frames.length < n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Poll `probe` until its value stops changing for `quietMs`.
 *
 * R482: a fixed-sleep arm is a coin toss -- a network arm whose verdict
 * moved between runs on identical source was a DRIVER artefact, not a
 * finding. Settle-polling turns "probably settled" into "settled".
 */
async function settle(probe: () => string, quietMs = 400, maxMs = 5000): Promise<string> {
  const deadline = Date.now() + maxMs;
  let last = probe();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    const cur = probe();
    if (cur !== last) { last = cur; stableSince = Date.now(); continue; }
    if (Date.now() - stableSince >= quietMs) break;
  }
  return last;
}

describe('R550 — the identity-binding plane: what is being authenticated?', () => {
  let db: ClawDB | undefined;
  let server: WSServer | undefined;

  afterEach(async () => {
    if (server) server.close();
    if (db) await db.close();
  });

  async function boot(): Promise<{ s: WSServer; port: number }> {
    const dir = `/tmp/woclaw-r550-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const port = await freePort();
    db = new ClawDB(dir);
    const cfg: Config = {
      port,
      restPort: 0,
      host: '127.0.0.1',
      dataDir: dir,
      authToken: TOKEN,
      hubId: 'hub-under-test',
    };
    const s = new WSServer(cfg, db);
    server = s;
    return { s, port };
  }

  // ---------------------------------------------------------------- arm A

  it('(A) DEFECT-PIN — one shared token, ANY caller-chosen agentId: the name is not bound to the credential', async () => {
    const { s, port } = await boot();

    // Two DIFFERENT names, the SAME credential. Both are accepted.
    const alice = openConn(`ws://127.0.0.1:${port}/?agentId=alice&token=${TOKEN}`);
    const mallory = openConn(`ws://127.0.0.1:${port}/?agentId=mallory&token=${TOKEN}`);
    await awaitFrames(alice, 1);
    await awaitFrames(mallory, 1);

    expect(alice.frames[0]).toMatchObject({ type: 'welcome', agentId: 'alice' });
    expect(mallory.frames[0]).toMatchObject({ type: 'welcome', agentId: 'mallory' });

    // The hub tracks BOTH under names the CLIENTS chose. Nothing in the
    // handshake ties a name to the credential that presented it.
    expect(s.getAgentsInfo().map((a) => a.agentId).sort()).toEqual(['alice', 'mallory']);
  });

  // ---------------------------------------------------------------- arm B

  it('(B) DEFECT-PIN — a second socket claiming an occupied name EVICTS the holder (identity takeover)', async () => {
    const { port } = await boot();

    const victim = openConn(`ws://127.0.0.1:${port}/?agentId=alice&token=${TOKEN}`);
    await awaitFrames(victim, 1);
    expect(victim.frames[0]).toMatchObject({ type: 'welcome', agentId: 'alice' });

    // The impostor presents the SAME token and CLAIMS the same name.
    const impostor = openConn(`ws://127.0.0.1:${port}/?agentId=alice&token=${TOKEN}`);
    await awaitFrames(impostor, 1);

    // The legitimate holder is closed out of the hub with 4002
    // 'Replaced by new connection'.
    expect((await victim.closed).code).toBe(4002);
  });

  // ---------------------------------------------------------------- arm C

  it('(C) DEFECT-PIN — the takeover does NOT hand the name over: the registry ends EMPTY (a name is destroyable, not assumable)', async () => {
    const { s, port } = await boot();

    const victim = openConn(`ws://127.0.0.1:${port}/?agentId=alice&token=${TOKEN}`);
    await awaitFrames(victim, 1);
    await settle(() => s.getAgentsInfo().map((a) => a.agentId).join(','));

    const impostor = openConn(`ws://127.0.0.1:${port}/?agentId=alice&token=${TOKEN}`);
    await awaitFrames(impostor, 1);

    // Measured over 6 trials: the settled registry is EMPTY. The impostor's
    // own 'close' handler removes the row that the victim -- a DIFFERENT
    // socket -- had just registered under the SAME name.
    const settled = await settle(() => s.getAgentsInfo().map((a) => a.agentId).join(','));
    expect(settled).toBe('');

    // So the takeover is not a privilege transfer; it is a DELETION. The
    // impostor does not become 'alice' -- 'alice' ceases to exist.
    expect(s.getAgentsInfo()).toEqual([]);
  });

  // ---------------------------------------------------------------- arm D

  it('(D) DEFECT-PIN — a write is attributed to the CALLER-CHOSEN name, so the audit trail is forgeable', async () => {
    const { port } = await boot();

    const writer = openConn(`ws://127.0.0.1:${port}/?agentId=alice&token=${TOKEN}`);
    await awaitFrames(writer, 1);

    writer.client.send(JSON.stringify({
      type: 'memory_write',
      key: 'r550/forged',
      value: 'written by somebody else',
    }));
    await awaitFrames(writer, 2);

    // The memory row says the author is 'alice' -- a name the client picked
    // out of thin air, carrying nothing from the credential.
    const mem = await db!.getMemory('r550/forged');
    expect(mem).toBeTruthy();
    expect(mem!.updatedBy).toBe('alice');
  });

  // ---------------------------------------------------------------- arm E

  it('(E) CONTROL — the credential itself IS enforced: a wrong token is refused, and NO token is refused', async () => {
    const { s, port } = await boot();

    const wrong = await openConn(`ws://127.0.0.1:${port}/?agentId=alice&token=not-the-token`).closed;
    expect(wrong.code).toBe(4001);
    expect(wrong.frames).toHaveLength(0);

    const none = await openConn(`ws://127.0.0.1:${port}/?agentId=alice`).closed;
    expect(none.code).toBe(4001);
    expect(none.frames).toHaveLength(0);

    // So the gate is real -- it is the SHAPE of what it authenticates that
    // is wrong, not whether it authenticates. (R549's finding, restated
    // for the WS plane.)
    expect(s.getAgentsInfo()).toEqual([]);
  });

  // ---------------------------------------------------------------- arm F

  it('(F) CONTROL — a real agent with a DIFFERENT name is still refused on a delegation addressed to someone else', async () => {
    const { port } = await boot();

    const caller = openConn(`ws://127.0.0.1:${port}/?agentId=caller&token=${TOKEN}`);
    const target = openConn(`ws://127.0.0.1:${port}/?agentId=target&token=${TOKEN}`);
    const stranger = openConn(`ws://127.0.0.1:${port}/?agentId=stranger&token=${TOKEN}`);
    await awaitFrames(caller, 1);
    await awaitFrames(target, 1);
    await awaitFrames(stranger, 1);

    caller.client.send(JSON.stringify({
      type: 'delegate_request',
      id: 'd-2',
      toAgent: 'target',
      task: { description: 'do the thing' },
    }));
    await awaitFrames(caller, 2);

    stranger.client.send(JSON.stringify({
      type: 'delegate_response',
      id: 'd-2',
      status: 'accepted',
    }));
    await awaitFrames(stranger, 2);

    // The check DOES work -- against the name the stranger actually
    // presented. This is what makes the identity-binding defect a real
    // defect and not "the delegation check is missing": the check is
    // present, it is name-shaped, and the name is free.
    expect(stranger.frames.some((f) => f.type === 'error' && f.code === 'forbidden')).toBe(true);
  });

  // ---------------------------------------------------------------- arm G

  it('(G) DEFECT-PIN — a peer hub is REFUSED on connect: federation.ts sends ?hubId= and ws_server.ts requires ?agentId=', async () => {
    const { s, port } = await boot();

    // EXACTLY the URL federation.ts:107 builds for a peer connection.
    const peer = await openConn(`ws://127.0.0.1:${port}/?hubId=peer-hub-1&token=${TOKEN}`).closed;
    expect(peer.code).toBe(4001);
    expect(peer.frames).toHaveLength(0);

    // CONTROL (same arm, opposite vocabulary): the very same socket with
    // `agentId` -- the parameter ws_server.ts actually reads -- IS accepted.
    const ok = openConn(`ws://127.0.0.1:${port}/?agentId=peer-hub-1&token=${TOKEN}`);
    await awaitFrames(ok, 1);
    expect(ok.frames[0]).toMatchObject({ type: 'welcome', agentId: 'peer-hub-1' });
    expect(s.getAgentsInfo().map((a) => a.agentId)).toEqual(['peer-hub-1']);
  });

  // ---------------------------------------------------------------- arm H

  it('(H) DEFECT-PIN — two REAL hubs cannot federate: the peer connect is refused, so the peer never reaches "connected"', async () => {
    // Arm G pins ONE SIDE of a two-sided contract: the server refuses
    // ?hubId=. A repair on the CLIENT side alone (federation.ts sending
    // ?agentId= instead) leaves arm G green while the contract as a whole
    // is fixed -- which is exactly what the M7 survivor showed. This arm
    // measures the CONTRACT, end to end, with two real WSServers: the
    // initiator's FederationManager against the responder's WSServer.
    //
    // The responder must be LISTENING before the initiator starts: the
    // FederationManager is constructed inside the WSServer constructor, so
    // a peer that is not up yet gets ECONNREFUSED -- a startup-order race,
    // not the subject of this arm.
    const dirB = `/tmp/woclaw-r550-fed-b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const portB = await freePort();
    const dbB = new ClawDB(dirB);
    const hubB = new WSServer({
      port: portB,
      restPort: 0,
      host: '127.0.0.1',
      dataDir: dirB,
      authToken: TOKEN,
      hubId: 'hub-B',
    } as Config, dbB);
    try {
      await new Promise((r) => setTimeout(r, 400)); // let hub B bind

      const dirA = `/tmp/woclaw-r550-fed-a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const portA = await freePort();
      const dbA = new ClawDB(dirA);
      const hubA = new WSServer({
        port: portA,
        restPort: 0,
        host: '127.0.0.1',
        dataDir: dirA,
        authToken: TOKEN,
        hubId: 'hub-A',
        federationPeers: [{
          hubId: 'hub-B',
          wsUrl: `ws://127.0.0.1:${portB}`,
          federationToken: TOKEN,
          status: 'disconnected',
          lastSeen: 0,
          connectedAgents: 0,
        }],
        federationPingIntervalMs: 60000,
      } as Config, dbA);

      try {
        // The peer connect is REFUSED (4001), so the peer never reaches
        // 'connected' -- the federation plane does not form.
        const settled = await settle(
          () => hubA.getFederationPeersStatus().map((p) => `${p.hubId}:${p.status}`).join(','),
          600,
          6000,
        );
        expect(settled).toBe('hub-B:disconnected');

        // And the responder never registered the peer as an agent.
        expect(hubB.getAgentsInfo()).toEqual([]);
      } finally {
        hubA.close();
        await dbA.close();
      }
    } finally {
      hubB.close();
      await dbB.close();
    }
  });
});
