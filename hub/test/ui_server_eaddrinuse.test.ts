/**
 * Regression test for the 06:03 cron tick EADDRINUSE fix.
 *
 * Before the fix, `hub/src/index.ts` created a UI static-file server with
 * `uiServer.listen(uiPort)` but never attached an 'error' listener. When an
 * orphaned hub process already held port 8084, Node emitted an unhandled
 * 'error' event on the server, which surfaced as an `uncaughtException` and
 * crashed the hub within ~2 seconds — silently breaking `startHub()` in the
 * integration-test harness (`integration-test/hub.test.ts`) because
 * `waitForHub()` polls `/health` and times out after 5s.
 *
 * The fix attaches `uiServer.on('error', ...)` BEFORE `listen()`, so a
 * port-conflict becomes a logged warning and the REST/WS servers continue
 * serving. This test file gates both the source-level contract and the
 * runtime behavior of the fix.
 *
 * Gates:
 *   (1) source: hub/src/index.ts attaches `uiServer.on('error', ...)` to the
 *       UI server BEFORE `uiServer.listen(uiPort)` (no unhandled 'error'
 *       events can be emitted)
 *   (2) source: the error handler emits a `hubWarn(...)` call so operators
 *       see the port-bind failure in logs (not silent)
 *   (3) runtime: an http.Server created and listened to with this same
 *       pattern (error listener before listen) emits NO 'uncaughtException'
 *       and the hub-equivalent operation (a generic on('error') handler)
 *       fires when a conflicting listener takes the same port — confirming
 *       the mitigation actually suppresses the unhandled-error pathway
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { once } from 'events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', 'src', 'index.ts');
const HUB_LOG_PATH = join(__dirname, '..', 'src', 'hub_log.ts');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('hub/src/index.ts uiServer EADDRINUSE handler (06:03 cron tick fix)', () => {
  it('(1) attaches uiServer.on(error) BEFORE uiServer.listen() in hub/src/index.ts', () => {
    const src = readSrc(INDEX_PATH);
    const listenIdx = src.indexOf('uiServer.listen(uiPort)');
    const errorIdx = src.indexOf("uiServer.on('error'");
    expect(listenIdx).toBeGreaterThan(0);
    expect(errorIdx).toBeGreaterThan(0);
    expect(errorIdx).toBeLessThan(listenIdx);
  });

  it('(2) the uiServer error handler calls hubWarn so operators see the port-bind failure', () => {
    const indexSrc = readSrc(INDEX_PATH);
    // Find the error-handler block (the .on('error', ...) callback body).
    // We slice from the handler's opening brace and match its closing
    // paren pair rather than grep the whole file — otherwise the file's
    // top-level `process.on('uncaughtException', ... process.exit(1))`
    // handler trips the negative assertion below.
    const errorIdx = indexSrc.indexOf("uiServer.on('error'");
    expect(errorIdx).toBeGreaterThan(0);
    const arrowIdx = indexSrc.indexOf('=>', errorIdx);
    expect(arrowIdx).toBeGreaterThan(0);
    // Extract the arrow function body between '{' after the arrow and its
    // matching '}' (single-line, no nested braces inside our handler).
    const bodyStart = indexSrc.indexOf('{', arrowIdx);
    const bodyEnd = indexSrc.indexOf('});', bodyStart);
    expect(bodyStart).toBeGreaterThan(0);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const body = indexSrc.slice(bodyStart, bodyEnd + 1);
    // The handler body must reference hubWarn — that's how the failure is
    // surfaced to operators (not silently swallowed, not process.exit).
    expect(body).toMatch(/hubWarn\s*\(/);
    // And it must NOT call process.exit — the fix's whole point is to keep
    // the REST/WS hub up even if the Web UI port is occupied.
    expect(body).not.toMatch(/process\.exit\s*\(/);
  });

  it('(3) the hubLog module exports hubWarn (so the new uiServer error handler compiles)', () => {
    const hubLogSrc = readSrc(HUB_LOG_PATH);
    expect(hubLogSrc).toMatch(/export\s+function\s+hubWarn\s*\(/);
  });

  it('(4) runtime: http.Server with error-listener-before-listen does not crash when a port is busy', async () => {
    // Hold a port with a stub server, then try to listen a second server
    // with an 'error' listener attached BEFORE .listen(). The mitigation
    // pattern under test: if the second server emits 'error', the handler
    // catches it; if no handler existed, Node would emit uncaughtException
    // and crash the test process.
    const blocker = http.createServer();
    blocker.listen(0); // ephemeral port
    await once(blocker, 'listening');
    const busyPort = (blocker.address() as { port: number }).port;

    // Attach an uncaughtException listener that would FAIL the test if it
    // ever fired — proving that the error-listener-before-listen pattern
    // prevents the unhandled-error pathway.
    const onUncaught = (err: Error) => {
      throw new Error(`unexpected uncaughtException: ${err.message}`);
    };
    process.once('uncaughtException', onUncaught);

    let errorHandlerFired = false;
    const challenger = http.createServer();
    challenger.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        errorHandlerFired = true;
      }
    });
    challenger.listen(busyPort); // should emit 'error' (EADDRINUSE), caught by our handler above

    // Give Node a tick to emit the error event.
    await new Promise((r) => setTimeout(r, 50));
    process.off('uncaughtException', onUncaught);

    expect(errorHandlerFired).toBe(true);
    blocker.close();
  });
});
