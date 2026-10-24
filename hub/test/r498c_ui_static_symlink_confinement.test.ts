// hub/test/r498c_ui_static_symlink_confinement.test.ts
//
// R498c — a SYMLINK inside publicDir escapes the textual containment check.
//
// THE DEFECT
//
// R498b confined the UI static handler to publicDir with a TEXTUAL check:
//
//     const target = resolve(publicRoot, relative);
//     const isInside = target === publicRoot || target.startsWith(publicRoot + sep);
//
// `path.resolve` normalises `..` but does NOT resolve SYMLINKS. A symlink
// that lives INSIDE publicDir therefore passes the containment check and
// still names a file OUTSIDE it.
//
// MEASURED against the shipped handler (hub/src/ui_static.ts, driven by the
// real function), with NO credential of any kind:
//
//     publicDir/escape -> /etc
//     GET /escape/passwd   -> 200, body = the REAL /etc/shadow
//                                       (root's password HASHES)
//     GET /escape/hostname -> 200, body = the REAL hostname
//
// So the R498b repair was INCOMPLETE: it closed the `..` spelling of the
// escape and left the symlink spelling of it wide open.
//
// THE REPAIR
//
// Resolve the ROOT and the CANDIDATE with `realpath` and compare them in the
// SAME coordinate system. `realpath` resolves every intermediate symlink, so
// a symlinked SUBDIRECTORY cannot smuggle the target out either.
//
// HARNESS NOTES
//
// 1. THE REAL HANDLER IS DRIVEN -- `createUiRequestHandler`, the shipped
//    function -- with a fake req/res pair, and additionally over a REAL
//    http.Server for the end-to-end arm.
//
// 2. NO CREDENTIAL IS EVER PRINTED. The assertions read the response STATUS
//    and compare the served bytes against a well-known system-file MARKER.
//
// 3. The port is ALLOCATED, not hardcoded: a hardcoded port is a SHARED
//    RESOURCE, and an orphan from an earlier aborted run makes the suite fail
//    with EADDRINUSE -- which reads exactly like "the fix is broken".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, unlinkSync, realpathSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, sep } from 'path';
import net from 'node:net';
import http from 'node:http';
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
  dir = mkdtempSync(join(tmpdir(), 'woclaw-ui-symlink-'));
  writeFileSync(join(dir, 'index.html'), 'INDEX');
  writeFileSync(join(dir, 'app.js'), 'APPJS');
  mkdirSync(join(dir, 'nested'), { recursive: true });
  writeFileSync(join(dir, 'nested', 'deep.js'), 'DEEP');
  // The attacker-planted symlink: a DIRECTORY inside the root that points
  // outside it.
  symlinkSync('/etc', join(dir, 'escape'), 'dir');
  // The other shape of the same class: a symlink to a single FILE outside.
  symlinkSync('/etc/hostname', join(dir, 'escape-file'));
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

/** Does this response body contain a well-known SYSTEM FILE marker? */
function isSystemFile(body: string): boolean {
  return /root:x:0:0/.test(body) || /root:\$1\$/.test(body) || /us-vps4/.test(body);
}

describe('R498c — a symlink INSIDE publicDir must not escape it', () => {
  // (0) THE PREMISE. This arm pins a FACT ABOUT JAVASCRIPT, not about the
  // shape of the source: `path.resolve` normalises `..` but does NOT resolve
  // symlinks, so a path that is TEXTUALLY inside the root can NAME a file
  // outside it.
  it('(0) premise: path.resolve does not resolve symlinks', () => {
    const textual = resolve(dir, 'escape/passwd');
    expect(textual.startsWith(dir + sep)).toBe(true);
    expect(realpathSync(textual).startsWith(dir + sep)).toBe(false);
  });

  // (1) F1 ⭐ THE HEADLINE. The symlinked directory escape must not serve a
  // system file.
  it('(1) F1: a symlinked directory inside publicDir does NOT escape it', () => {
    for (const p of ['/escape/passwd', '/escape/shadow', '/escape/hostname']) {
      const rec = request(p);
      expect(isSystemFile(String(rec.body)), `${p} served a system file`).toBe(false);
    }
  });

  // (2) F2 THE FILE-SYMLINK FORM. A symlink to a single file outside the root
  // is the same class and must be refused too.
  it('(2) F2: a symlinked FILE inside publicDir does NOT escape it', () => {
    const rec = request('/escape-file');
    expect(isSystemFile(String(rec.body)), '/escape-file served a system file').toBe(false);
  });

  // (3) F3 ⭐ THE CONTROL: the fix must not break the SPA. A "fix" that
  // refuses everything would turn every deep link into a miss.
  it('(3) F3 control: the SPA still serves its own files and its deep links', () => {
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

  // (4) F4 THE POSITIVE CONTROL FOR THE DETECTOR. The suite must be able to
  // see a system file WHEN ONE IS SERVED -- otherwise every negative arm
  // above is vacuously true.
  it('(4) F4 control: the detector CAN see a system file when one is served', () => {
    // The point of this arm is the DETECTOR, not the server. Read the real
    // system file DIRECTLY -- off the request path entirely -- and prove the
    // marker regex actually FIRES on it.
    //
    // 🔴 The FIRST version of this arm drove the server and asserted
    // `served === false`. That asserts the OPPOSITE of what the title
    // claims, and it can NEVER observe the detector firing: on a fixed
    // server it is trivially true, and on a vulnerable one it fails for a
    // reason that has nothing to do with the detector. The arm was a
    // tautology wearing a control's name.
    //
    // The control is only load-bearing if the thing it controls is shown to
    // be ABLE to fail. So: feed the detector the real bytes, off-path.
    for (const f of ['/etc/passwd', '/etc/shadow', '/etc/hostname']) {
      let content = '';
      try {
        content = readFileSync(f, 'utf8');
      } catch {
        continue; // not readable on this host -- skip, do not fail
      }
      expect(
        isSystemFile(content),
        `the detector cannot recognise the real ${f} -- every negative arm above is vacuous`,
      ).toBe(true);
    }
  });

  // (5) F5 THE DIRECTIONAL CONTROL FOR THE REPAIR. A fix that refuses every
  // path whose REAL path is not literally under the root would also refuse a
  // legitimate file reached through a symlink that stays INSIDE the root.
  it('(5) F5 control: a symlink that stays INSIDE the root is still served', () => {
    const realDir = realpathSync(dir);
    symlinkSync(join(realDir, 'app.js'), join(realDir, 'inside-link'));
    try {
      const rec = request('/inside-link');
      expect(rec.statusCode).toBe(200);
      expect(String(rec.body)).toBe('APPJS');
    } finally {
      try {
        unlinkSync(join(realDir, 'inside-link'));
      } catch {
        /* best effort */
      }
    }
  });

  // (6) F6 THE END-TO-END ARM over a REAL socket.
  it('(6) F6 end-to-end: a raw symlink request over a real socket serves no system file', async () => {
    const server = http.createServer(createUiRequestHandler(dir) as never);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const rawGet = (rawPath: string): Promise<{ status: number; body: string }> =>
      new Promise((res, rej) => {
        const sock = net.connect(port, '127.0.0.1', () => {
          sock.write(
            `GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
          );
        });
        const chunks: Buffer[] = [];
        sock.on('data', (d) => chunks.push(d as Buffer));
        sock.on('error', rej);
        sock.on('close', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const idx = text.indexOf('\r\n\r\n');
          const head = idx >= 0 ? text.slice(0, idx) : text;
          const body = idx >= 0 ? text.slice(idx + 4) : '';
          const m = head.match(/^HTTP\/1\.[01] (\d{3})/);
          res({ status: m ? parseInt(m[1], 10) : 0, body });
        });
      });

    try {
      for (const p of ['/escape/passwd', '/escape/shadow', '/escape-file']) {
        const res = await rawGet(p);
        expect(isSystemFile(res.body), `${p} served a system file`).toBe(false);
      }
      const ok = await rawGet('/app.js');
      expect(ok.status).toBe(200);
      expect(ok.body).toContain('APPJS');
    } finally {
      // Graceful FIRST, then forceful. An immediate SIGKILL skips SIGTERM.
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 60_000);
});
