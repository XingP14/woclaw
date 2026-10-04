/**
 * Regression: a failed bind must be LOUD (2026-10-05 01:03 tick).
 *
 * The R401 suite (hub/test/r401_abandoned_delegation.test.ts) went red on a
 * clean tree and the failure pointed at the delegation state machine, which is
 * the part of the hub that is actually correct. The real cause was upstream of
 * every assertion in that file:
 *
 *   `server.listen(port, host)` does NOT throw on a port conflict. It emits an
 *   'error' EVENT on the http.Server. Neither RestServer.start() nor the
 *   WSServer constructor had an 'error' listener, so EADDRINUSE was swallowed:
 *   the constructor returned normally, the caller believed the hub was up, and
 *   every subsequent fetch() reached whichever OTHER process already owned the
 *   port. The test then faithfully reported that foreign server's state.
 *
 *   The tell was a record whose `createdAt === updatedAt` and which had no
 *   `acceptedAt`: the test had sent `accepted` to its own server, but it was
 *   reading a delegation created by a different process.
 *
 * This file pins the fix as behaviour rather than as source text:
 *   (A) whenListening() resolves with the port actually bound
 *   (B) two WSServers/RestServers on the SAME fixed port: the second's
 *       whenListening() REJECTS, rather than resolving or hanging forever
 *   (C) port 0 yields two DIFFERENT bound ports (the property that makes the
 *       R401 fix correct)
 */

import { describe, it, expect, afterEach } from 'vitest';
import net from 'net';

import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { RestServer } from '../src/rest_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

function cfg(port: number, restPort: number, dataDir: string): Config {
  return {
    port,
    restPort,
    host: '127.0.0.1',
    dataDir,
    storage: { type: 'sqlite', sqlitePath: `${dataDir}/probe.db` },
    authToken: 'bind-probe-token',
  };
}

/** Grab a genuinely free port by binding and releasing one, so the tests
 *  below never guess a number another process might already hold. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p = addr && typeof addr === 'object' ? addr.port : 0;
      s.close(() => resolve(p));
    });
  });
}

const opened: Array<{ close(): void }> = [];

afterEach(() => {
  for (const o of opened.splice(0)) {
    try { o.close(); } catch { /* already closed */ }
  }
});

describe('hub bind failure must be observable, not swallowed', () => {
  // (A) + (C): port 0 → the OS assigns, and each instance reports its OWN port.
  it('whenListening() resolves with the port actually bound, and two instances never collide', async () => {
    const ws1 = new WSServer(cfg(0, 0, '/tmp/woclaw-bind-1'), new ClawDB(cfg(0, 0, '/tmp/woclaw-bind-1')));
    const ws2 = new WSServer(cfg(0, 0, '/tmp/woclaw-bind-2'), new ClawDB(cfg(0, 0, '/tmp/woclaw-bind-2')));
    const p1 = await ws1.whenListening();
    const p2 = await ws2.whenListening();

    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(0);
    // The whole point of port 0: two hubs coexist instead of colliding.
    expect(p1).not.toBe(p2);

    ws1.close();
    ws2.close();
  });

  it('RestServer.whenListening() resolves with the port actually bound', async () => {
    const c = cfg(0, 0, '/tmp/woclaw-bind-3');
    const db = new ClawDB(c);
    const ws = new WSServer(c, db);
    const rest = new RestServer(c, db, ws.getTopicsManager(), ws.getMemoryPool(), new GraphStore(), ws);
    await rest.start();
    const p = await rest.whenListening();
    expect(p).toBeGreaterThan(0);

    rest.close();
    ws.close();
  });

  // (B) The regression itself: a conflict must REJECT, not resolve and not hang.
  it('a second WSServer on an occupied port REJECTS with the BIND error, not a generic one', async () => {
    const port = await freePort();
    const first = new WSServer(cfg(port, 0, '/tmp/woclaw-bind-4'), new ClawDB(cfg(port, 0, '/tmp/woclaw-bind-4')));
    expect(await first.whenListening()).toBe(port);

    const second = new WSServer(cfg(port, 0, '/tmp/woclaw-bind-5'), new ClawDB(cfg(port, 0, '/tmp/woclaw-bind-5')));
    // Before the fix this promise did not exist at all; with a bare listen()
    // the failure was an unhandled event and every fetch hit `first`.
    //
    // The assertion pins the ERROR IDENTITY, not merely "it threw". A variant
    // that swallows the rejection and then fails on a later `boundPort === null`
    // check also rejects — and that variant is exactly the bug: the caller is
    // told "something went wrong" instead of "the port was taken", which is the
    // information that makes the failure diagnosable.
    await expect(second.whenListening()).rejects.toThrow(/EADDRINUSE/);

    first.close();
  });

  it('a second RestServer on an occupied port REJECTS from whenListening()', async () => {
    const port = await freePort();
    const c1 = cfg(0, port, '/tmp/woclaw-bind-6');
    const db1 = new ClawDB(c1);
    const ws1 = new WSServer(c1, db1);
    const rest1 = new RestServer(c1, db1, ws1.getTopicsManager(), ws1.getMemoryPool(), undefined, ws1);
    await rest1.start();
    expect(await rest1.whenListening()).toBe(port);

    const c2 = cfg(0, port, '/tmp/woclaw-bind-7');
    const db2 = new ClawDB(c2);
    const ws2 = new WSServer(c2, db2);
    const rest2 = new RestServer(c2, db2, ws2.getTopicsManager(), ws2.getMemoryPool(), undefined, ws2);
    await rest2.start();
    await expect(rest2.whenListening()).rejects.toThrow(/EADDRINUSE/);

    rest1.close();
    rest2.close();
    ws1.close();
    ws2.close();
  });
});
