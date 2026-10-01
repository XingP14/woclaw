/**
 * woclaw hub/src/ws_server.ts — the TLS transport path and the
 * unauthenticated-connection path.
 *
 * Dark-arm map rebuilt from a fresh root-level
 * `npx vitest run --coverage --coverage.reporter=json` at 0cd307b
 * (85 suites / 1040 tests, branches 1044/1086 = 96.13%) put
 * hub/src/ws_server.ts at 5 dark arms out of 22. All five are here:
 *
 *   L80  const useTLS = !!(config.tlsKey && config.tlsCert)
 *   L83  if (useTLS) { https.createServer(tlsOptions) }
 *   L111 useTLS ? 'wss' : 'ws'   in the startup log line
 *   L122 if (!token) return false   inside isTokenAuthorized()
 *   L948 for (const [_, agent] of this.agents)   in close()
 *
 * Why these five matter more than their count suggests:
 *
 * 1. L80/L83/L111 are the ENTIRE wss:// transport. Every hub in CI, every
 *    integration test, and every test in this repo constructs the server
 *    with tlsKey/tlsCert undefined, so `useTLS` has only ever been false.
 *    The https branch has never executed even once in the project's
 *    history: no test proves the server comes up under TLS, that a real
 *    client can complete a wss:// handshake against it, or that a
 *    readFileSync of a missing key file is caught and rethrown rather than
 *    taking the process down. A deploy with TLS_KEY/TLS_CERT set is
 *    currently the single least-exercised configuration the product ships.
 *
 * 2. L122 is the actual unauthenticated-connection guard. Every existing
 *    call to isTokenAuthorized() passes a string (token_rotation.test.ts
 *    calls it 4x, all with a defined token). The `!token` arm — reached in
 *    production by handleConnection() L135 whenever a client connects with
 *    no `token` query param at all, i.e. an anonymous socket — has zero
 *    executions. handleConnection closes with 4001 'Unauthorized', so the
 *    risk is not that the guard is wrong but that a regression making it
 *    return true would hand an anonymous socket a welcome frame and the
 *    suite would stay green.
 *
 * 3. L948 is close()'s loop over live agents. No test ever calls close()
 *    while an agent is connected, so the "1001 Server shutting down" close
 *    frame has never been sent by any test. A hub restarted under a live
 *    agent fleet exercises it; no test does.
 *
 * All assertions are on real runtime behaviour over a real socket — no
 * source-text mirroring, no re-implementation of the guard in the test.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import net from 'net';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import { Config } from '../src/types.js';

/** Reserve an ephemeral port, then release it for the server to bind.
 *  The WSServer constructor calls `server.listen(config.port, ...)` with no
 *  way to read the bound address back out, so the port has to be chosen
 *  up front rather than discovered afterwards. */
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

/** Generate a throwaway self-signed cert. A wss:// client verifies the
 *  chain by default, so the test client has to opt out of verification for
 *  the handshake to complete — which is fine, because what is under test is
 *  that the SERVER comes up and speaks TLS, not the trust chain.
 *
 *  The output directory has to exist first: openssl writes key.pem/cert.pem
 *  with plain file I/O and fails with status 1 (rather than creating the
 *  parent) if it is not there. */
function selfSigned(dir: string): { key: string; cert: string } {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
  ], { stdio: 'ignore' });
  return { key, cert };
}

function mkTempDir(tag: string): string {
  const dir = `/tmp/woclaw-tls-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function baseConfig(dir: string, port: number): Config {
  return {
    port,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: dir,
    authToken: 'tls-path-token-abc',
    hubId: 'hub-under-test',
  };
}

type Frame = { type: string; [k: string]: unknown };

/** A socket that is already open, with its frames visible immediately and
 *  its close event exposed as a separate promise.
 *
 *  Splitting "opened" from "closed" matters: these servers stay up until
 *  close() is called, so a helper that only resolved on close() could never
 *  be used to assert on the frames that arrived BEFORE the shutdown. */
function openConn(url: string, opts: { tls: boolean }) {
  const frames: Frame[] = [];
  const client = new WebSocket(url, opts.tls ? { rejectUnauthorized: false } : {});
  client.on('message', (data: Buffer) => {
    try {
      frames.push(JSON.parse(data.toString()) as Frame);
    } catch {
      /* non-JSON frame: not part of this contract */
    }
  });
  const opened = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`open timeout: ${url}`)), 8000);
    client.once('open', () => { clearTimeout(t); resolve(); });
    client.once('error', (e: unknown) => { clearTimeout(t); reject(e); });
  });
  const closed = new Promise<{ code: number; frames: Frame[] }>((resolve, reject) => {
    const t = setTimeout(() => { client.terminate(); reject(new Error(`close timeout: ${url}`)); }, 8000);
    client.once('close', (code: number) => { clearTimeout(t); resolve({ code, frames }); });
  });
  return { client, frames, opened, closed };
}

/** Wait for a client to have received its first frame, so assertions never
 *  race the server's welcome send. */
async function awaitFrames(conn: { opened: Promise<void>; frames: Frame[] }, n: number): Promise<void> {
  await conn.opened;
  const deadline = Date.now() + 5000;
  while (conn.frames.length < n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('WSServer TLS transport (wss://) and unauthenticated connections', () => {
  let tempDir: string;
  let db: ClawDB | undefined;

  afterEach(async () => {
    if (db) await db.close();
  });

  // ---------------------------------------------------------------- TLS on

  it('(1) brings the server up under TLS and completes a real wss:// handshake', async () => {
    tempDir = mkTempDir('on');
    const { key, cert } = selfSigned(path.join(tempDir, 'tls'));
    const port = await freePort();

    // The startup log line is operator-facing: an operator reading the boot
    // output is the only person who can tell a wss:// deploy from a ws:// one
    // without checking the config, so L111 is pinned on the real captured
    // console output rather than left to a coverage count.
    const logged: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(' '));
    });

    const d = (db = new ClawDB(tempDir));
    // tlsKey + tlsCert both set => useTLS true => https.createServer.
    const server = new WSServer({ ...baseConfig(tempDir, port), tlsKey: key, tlsCert: cert }, d);
    logSpy.mockRestore();

    // Both halves of the ternary, not just the one that happens to be live
    // in this test: enabled says wss://, and the readFileSync success path
    // logs that TLS is on.
    expect(logged.some((l) => l.includes('TLS enabled: wss://'))).toBe(true);
    expect(logged.some((l) => l.includes(`WebSocket server running on wss://127.0.0.1:${port}`))).toBe(true);
    expect(logged.some((l) => l.includes('ws://127.0.0.1'))).toBe(false);

    const conn = openConn(
      `wss://127.0.0.1:${port}/?agentId=a1&token=tls-path-token-abc`,
      { tls: true },
    );
    await awaitFrames(conn, 1);

    // The full path ran: TLS handshake -> upgrade -> handleConnection ->
    // auth -> welcome. A plaintext hub could not produce a wss:// connection
    // at all, so this is the L80/L83/L111 discriminator.
    expect(conn.frames).toHaveLength(1);
    expect(conn.frames[0].type).toBe('welcome');
    expect(conn.frames[0].agentId).toBe('a1');

    server.close();
    expect((await conn.closed).code).toBe(1001);
  });

  it('(2) a plaintext client cannot talk to a TLS hub (useTLS is not cosmetic)', async () => {
    tempDir = mkTempDir('mixed');
    const { key, cert } = selfSigned(path.join(tempDir, 'tls'));
    const port = await freePort();

    db = new ClawDB(tempDir);
    const server = new WSServer({ ...baseConfig(tempDir, port), tlsKey: key, tlsCert: cert }, db);

    await expect(
      openConn(`ws://127.0.0.1:${port}/?agentId=a1&token=tls-path-token-abc`, { tls: false }).opened,
    ).rejects.toThrow();

    server.close();
  });

  it('(3) a missing key file is caught and rethrown, not left to crash later', async () => {
    tempDir = mkTempDir('badkey');
    const { cert } = selfSigned(path.join(tempDir, 'tls'));
    const port = await freePort();

    db = new ClawDB(tempDir);
    // tlsKey points at a file that does not exist: readFileSync throws
    // inside the try block, so the catch logs and rethrows rather than
    // silently degrading to plaintext.
    expect(() => new WSServer({
      ...baseConfig(tempDir, port),
      tlsKey: path.join(tempDir, 'tls', 'absent-key.pem'),
      tlsCert: cert,
    }, db)).toThrow();

    // The hub never bound the port, so a plain HTTP request still fails.
    await expect(
      openConn(`ws://127.0.0.1:${port}/?agentId=a1&token=t`, { tls: false }).opened,
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------- TLS off

  it('(4) without tlsKey/tlsCert the hub stays plaintext (the other half of L80)', async () => {
    tempDir = mkTempDir('off');
    const port = await freePort();

    db = new ClawDB(tempDir);
    const server = new WSServer(baseConfig(tempDir, port), db);

    const conn = openConn(
      `ws://127.0.0.1:${port}/?agentId=plain&token=tls-path-token-abc`,
      { tls: false },
    );
    await awaitFrames(conn, 1);

    expect(conn.frames[0].type).toBe('welcome');
    expect(conn.frames[0].agentId).toBe('plain');

    server.close();
    await conn.closed;
  });

  // ------------------------------------------------- unauthenticated (L122)

  it('(5) isTokenAuthorized rejects a missing token outright', () => {
    tempDir = mkTempDir('noauth');
    db = new ClawDB(tempDir);
    const server = new WSServer(baseConfig(tempDir, 0), db);

    // Both call shapes handleConnection() can produce from a query string
    // that simply has no `token` key: token === null (-> undefined) and a
    // genuinely absent argument. Neither may be authorized.
    expect(server.isTokenAuthorized(undefined)).toBe(false);
    expect(server.isTokenAuthorized(null as unknown as string | undefined)).toBe(false);
    // The matching truth, on the same instance, so the false above is the
    // guard and not a broken config.
    expect(server.isTokenAuthorized('tls-path-token-abc')).toBe(true);
    expect(server.isTokenAuthorized('wrong-token')).toBe(false);

    server.close();
  });

  it('(6) an anonymous socket with no token is closed 4001 and gets no frame', async () => {
    tempDir = mkTempDir('anon');
    const port = await freePort();

    db = new ClawDB(tempDir);
    const server = new WSServer(baseConfig(tempDir, port), db);

    const { code, frames } = await openConn(`ws://127.0.0.1:${port}/?agentId=intruder`, { tls: false }).closed;

    // 4001 is the handleConnection rejection path; a regression that let the
    // !token arm through would deliver a welcome frame instead.
    expect(code).toBe(4001);
    expect(frames).toHaveLength(0);

    server.close();
  });

  it('(7) a wrong token is closed 4001 even with an agentId present', async () => {
    tempDir = mkTempDir('wrongtoken');
    const port = await freePort();

    db = new ClawDB(tempDir);
    const server = new WSServer(baseConfig(tempDir, port), db);

    const { code, frames } = await openConn(
      `ws://127.0.0.1:${port}/?agentId=intruder&token=not-the-token`,
      { tls: false },
    ).closed;

    expect(code).toBe(4001);
    expect(frames).toHaveLength(0);

    server.close();
  });

  // ------------------------------------------------------ close() w/ agents

  it('(8) close() sends 1001 to every live agent before shutting down', async () => {
    tempDir = mkTempDir('close');
    const port = await freePort();

    db = new ClawDB(tempDir);
    const server = new WSServer(baseConfig(tempDir, port), db);

    const conns = ['w1', 'w2', 'w3'].map(
      (id) => openConn(`ws://127.0.0.1:${port}/?agentId=${id}&token=tls-path-token-abc`, { tls: false }),
    );
    // Let all three welcome frames land so the agents map is fully populated
    // before close() walks it (L948).
    for (const c of conns) await awaitFrames(c, 1);
    expect(server.getAgentsInfo().map((a) => a.agentId).sort()).toEqual(['w1', 'w2', 'w3']);

    server.close();

    const results = await Promise.all(conns.map((c) => c.closed));
    // Every agent got the same 1001 'Server shutting down' close code.
    expect(results.map((r) => r.code)).toEqual([1001, 1001, 1001]);
    expect(results.every((r) => r.frames.some((f) => f.type === 'welcome'))).toBe(true);

    // The disconnect handlers drain the agents map once the closes land, so
    // the server does not carry a dead fleet into a later close().
    const deadline = Date.now() + 5000;
    while (server.getAgentsInfo().length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(server.getAgentsInfo()).toEqual([]);
  });

  it('(9) close() on a hub with no agents is a no-op over the agent loop', async () => {
    tempDir = mkTempDir('emptyclose');
    const port = await freePort();

    db = new ClawDB(tempDir);
    const server = new WSServer(baseConfig(tempDir, port), db);

    expect(server.getAgentsInfo()).toEqual([]);
    expect(() => server.close()).not.toThrow();
  });
});
