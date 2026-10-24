// hub/test/r500_directory_target_dos.test.ts
//
// R500 — a request for a DIRECTORY inside publicDir takes the whole hub
// process down.
//
// THE DEFECT
//
// The UI static handler does:
//
//     let filePath = realTarget ?? indexPath;
//     if (!existsSync(filePath)) filePath = indexPath;
//     res.end(readFileSync(filePath));
//
// `existsSync` is TRUE for a DIRECTORY. A directory target therefore
// survives the existence check and reaches `readFileSync`, which throws
// EISDIR on a directory.
//
// The throw happens INSIDE the http request handler. `src/index.ts` registers
// NO `uncaughtException` and NO `unhandledRejection` handler (verified by
// grep over hub/src/), so the exception is unhandled and Node terminates the
// process. The blast radius is the WHOLE HUB -- the REST API, the
// WebSocket hub and the Web UI all die because an anonymous caller asked
// for a directory.
//
// MEASURED (scripts/probe498c_directory_target.ts, a CHILD PROCESS with the
// hub's own error configuration -- no uncaughtException handler):
//
//     GET /        -> status=200 bodyLen=15
//     GET /nested  -> status=0  body=""      <-- the directory request
//     GET / (after)-> status=0  bodyLen=0     <-- the process is DEAD
//     child exit code = 9 (PROCESS DIED)
//     EXIT=uncaughtException code=EISDIR syscall=read
//
// The R498c confinement fix does NOT help here: a directory is legitimately
// INSIDE the root, so it passes every containment check. This is a
// different defect on the same surface.
//
// THE REPAIR
//
// The served target must be a FILE, not merely an existing path: a
// directory is a MISS and falls back to index.html, exactly like a missing
// file.
//
// HARNESS NOTES
//
// 1. The REAL shipped handler (`createUiRequestHandler`) is driven, with a
//    fake req/res pair AND over a REAL http.Server on an ALLOCATED port.
//
// 2. NO CREDENTIAL IS EVER PRINTED. The assertions read the response STATUS
//    and the response BODY.
//
// 3. A PROCESS-LEVEL arm boots the handler in a CHILD PROCESS with the
//    hub's own error configuration and asserts the child is STILL ALIVE
//    after the directory request. A suite that only checks the response of
//    the in-process handler would MISS the crash entirely, because the
//    exception is thrown asynchronously by the http machinery.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createUiRequestHandler } from '../src/ui_static.js';

type Rec = { statusCode?: number; headers?: Record<string, string>; body?: Buffer | string };

function makeRes() {
  const rec: Rec = {};
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      rec.statusCode = status;
      rec.headers = headers;
      return res;
    },
    end(body?: Buffer | string) {
      rec.body = body;
      return res;
    },
  };
  return { res: res as never, rec };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'woclaw-ui-dir-'));
  writeFileSync(join(dir, 'index.html'), 'INDEX');
  writeFileSync(join(dir, 'app.js'), 'APPJS');
  mkdirSync(join(dir, 'nested'), { recursive: true });
  writeFileSync(join(dir, 'nested', 'deep.js'), 'DEEP');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Drive the shipped handler with a fake req/res pair. */
function request(url: string): Rec {
  const { res, rec } = makeRes();
  createUiRequestHandler(dir)({ url } as never, res);
  return rec;
}

/** A raw HTTP/1.1 GET over a socket, so no client normalises the path. */
function rawGet(port: number, rawPath: string, timeoutMs = 10_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (v: { status: number; body: string }) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    const chunks: Buffer[] = [];
    sock.on('data', (d) => chunks.push(d as Buffer));
    sock.on('error', () => finish({ status: 0, body: '' }));
    sock.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const idx = text.indexOf('\r\n\r\n');
      const head = idx >= 0 ? text.slice(0, idx) : text;
      const body = idx >= 0 ? text.slice(idx + 4) : '';
      const m = head.match(/^HTTP\/1\.[01] (\d{3})/);
      finish({ status: m ? parseInt(m[1], 10) : 0, body });
    });
    setTimeout(() => {
      sock.destroy();
      finish({ status: -1, body: 'TIMEOUT' });
    }, timeoutMs).unref();
  });
}

describe('R500 — a DIRECTORY request must not take the hub process down', () => {
  // (0) THE PREMISE. This arm pins a FACT ABOUT THE FILESYSTEM, not about
  // the shape of the source: `existsSync` is TRUE for a directory. That is
  // what makes a directory survive the existence check.
  it('(0) premise: existsSync is TRUE for a directory', () => {
    expect(existsSyncDir(join(dir, 'nested'))).toBe(true);
    expect(existsSyncFile(join(dir, 'app.js'))).toBe(true);
  });

  // (1) F1 ⭐ THE HEADLINE, in-process. A directory request must be a MISS
  // (SPA fallback), not an exception.
  it('(1) F1: a directory request is a MISS (SPA fallback), not a crash', () => {
    let thrown: unknown = null;
    try {
      const rec = request('/nested');
      expect(rec.statusCode).toBe(200);
      expect(String(rec.body)).toBe('INDEX');
    } catch (e) {
      thrown = e;
    }
    expect(thrown, 'the handler threw on a directory request').toBe(null);
  });

  // (2) F2 THE POSITIVE CONTROL. The fix must not break the SPA or the real
  // files: a "fix" that refuses everything would turn every deep link into
  // a miss.
  it('(2) F2 control: the SPA still serves its own files and its deep links', () => {
    const index = request('/');
    expect(index.statusCode).toBe(200);
    expect(String(index.body)).toBe('INDEX');

    const asset = request('/app.js');
    expect(String(asset.body)).toBe('APPJS');

    const deep = request('/dashboard');
    expect(deep.statusCode).toBe(200);
    expect(String(deep.body)).toBe('INDEX');

    const nested = request('/nested/deep.js');
    expect(String(nested.body)).toBe('DEEP');
  });

  // (3) F3 ⭐ THE PROCESS-LEVEL ARM. This is the arm the in-process arms
  // CANNOT express: the exception is thrown by the http machinery, so an
  // in-process handler never sees it. The child runs with the hub's own
  // error configuration (NO uncaughtException handler) and must still be
  // ALIVE after the directory request.
  it('(3) F3: the process SURVIVES a directory request (hub error config)', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', childScript(), dir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (out += d.toString()));

    try {
      const port = await new Promise<number>((resolve) => {
        const t = setInterval(() => {
          const m = out.match(/PORT=(\d+)/);
          if (m) {
            clearInterval(t);
            resolve(parseInt(m[1], 10));
          }
        }, 100);
        setTimeout(() => {
          clearInterval(t);
          resolve(0);
        }, 60_000);
      });
      expect(port, `the child never reported a port:\n${out}`).toBeGreaterThan(0);

      const ok = await rawGet(port, '/');
      expect(ok.status).toBe(200);

      // The attack: a directory request.
      const dirRes = await rawGet(port, '/nested');
      expect(dirRes.status).toBe(200);

      // THE LOAD-BEARING ASSERTION: the process is STILL ALIVE and still
      // serving.
      const after = await rawGet(port, '/');
      expect(after.status, `the process died on a directory request:\n${out}`).toBe(200);
      expect(after.body).toContain('INDEX');
      expect(out).not.toContain('uncaughtException');
    } finally {
      child.kill('SIGKILL');
    }
  }, 90_000);

  // (4) F4 THE DETECTOR-LIVENESS CONTROL. Arm (3) asserts that the process
  // is STILL ALIVE after the directory request. That assertion is only
  // meaningful if the detector CAN observe a dead process -- otherwise it is
  // vacuously true.
  //
  // 🔴 The FIRST version of this arm rebuilt the UNFIXED handler by
  // string-replacing the current source shape, and it therefore went RED
  // against M4 and M5 -- two DIFFERENT, equally valid repairs (a try/catch
  // around the read, and an `isDirectory()` spelling of the same decision).
  // The arm was coupled to the SOURCE TEXT, not to the OUTCOME, and the
  // mutation-matrix was reporting that coupling as a defect in the repairs.
  // A control must be able to fail because of the thing it controls, not
  // because the source was spelled a different way.
  //
  // So the subject of this arm is the DETECTOR, and it is driven WITHOUT
  // reference to the shipped source: the child is told to die on the
  // directory request, and the parent must SEE the death. The reachability
  // of the REAL crash is established separately, by the matrix's C0 arm
  // (which runs the COMMITTED, unfixed source and goes RED on arm (3)).
  it('(4) F4 control: the detector CAN observe a dead process', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', childScript(), dir, '--crash-on-directory'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (out += d.toString()));

    try {
      const port = await new Promise<number>((resolve) => {
        const t = setInterval(() => {
          const m = out.match(/PORT=(\d+)/);
          if (m) {
            clearInterval(t);
            resolve(parseInt(m[1], 10));
          }
        }, 100);
        setTimeout(() => {
          clearInterval(t);
          resolve(0);
        }, 60_000);
      });
      expect(port, `the child never reported a port:\n${out}`).toBeGreaterThan(0);

      const ok = await rawGet(port, '/');
      expect(ok.status).toBe(200);

      await rawGet(port, '/nested');

      // THE PROCESS IS DEAD. The detector must SEE it.
      const after = await rawGet(port, '/');
      expect(after.status, `the detector did not observe the dead process:\n${out}`).not.toBe(200);

      const exitCode = await new Promise<number | null>((resolve) => {
        if (child.exitCode !== null) {
          resolve(child.exitCode);
          return;
        }
        child.on('exit', (c) => resolve(c));
        setTimeout(() => resolve(null), 5000);
      });
      expect(exitCode, `the child did not die:\n${out}`).not.toBe(null);
    } finally {
      child.kill('SIGKILL');
    }
  }, 90_000);
});

/** The child script, next to this test file. */
function childScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '../scripts/r500_directory_target_child.ts');
}

// Small helpers so the premise arm pins the filesystem behaviour rather than
// re-implementing `existsSync` semantics in the test body.
import { existsSync, statSync } from 'fs';
function existsSyncDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}
function existsSyncFile(p: string): boolean {
  return existsSync(p) && statSync(p).isFile();
}
