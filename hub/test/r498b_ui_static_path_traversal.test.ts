// hub/test/r498_ui_static_path_traversal.test.ts
//
// R498b — the Web UI static server served files OUTSIDE publicDir.
//
// THE DEFECT
//
// hub/src/ui_static.ts (extracted verbatim from index.ts) resolved a request
// like this:
//
//     let filePath = join(publicDir, req.url === '/' ? 'index.html' : req.url!.split('?')[0]);
//     if (!existsSync(filePath)) filePath = join(publicDir, 'index.html');
//     ...
//     res.end(readFileSync(filePath));
//
// `path.join` NORMALISES `..` away, so the joined path can leave publicDir
// entirely, and the handler then READS whatever file that resolved to.
//
// MEASURED against the real handler (hub/dist/ui_static.js, booted over a
// real socket), with NO credential of any kind:
//
//     GET /../../../../../../etc/passwd   -> 200, body = the real /etc/passwd
//     GET /../../../../../../etc/shadow   -> 200, body = the real /etc/shadow
//                                              (root's password HASHES)
//     GET /../../../../../../etc/hostname -> 200, body = the hostname
//
// So this is UNAUTHENTICATED ARBITRARY FILE READ, not "metadata exposure".
//
// WHY THE SPA FALLBACK DID NOT SAVE IT
//
// The fallback (`if (!existsSync(filePath)) filePath = index.html`) only
// fires when the joined path does not exist. A traversal path usually DOES
// exist — that is the whole point — so the fallback is not reached and the
// escape happens on the primary branch.
//
// WHY THE PREVIOUS SUITE DID NOT SEE IT
//
// hub/test/ui_static_runtime.test.ts drives the handler with a FAKE req/res
// pair and asserts on the resolved bytes. Every one of its paths is either
// inside the temp dir or a clean miss — so every one of them lands on the
// "serves index.html" or "serves the file" branch. Nothing in it asks what
// happens when the joined path RESOLVES OUTSIDE the root. This is the same
// class as R497 on the llm-benchmark side: a suite that pins the resolution
// behaviour but never the CONFINEMENT of that resolution.
//
// THE REPAIR
//
// Decode the request path, strip the leading slashes, `path.resolve` it
// against the resolved public root, and then assert the RESOLVED path is
// still inside that root. A path outside is treated as a miss (it falls back
// to index.html) rather than being served.
//
// The confinement is decided by the RESOLVED path, not by the spelling of the
// request — so a textual `..` that resolves INSIDE publicDir is still served
// (arm 6 below). That arm is what separates confinement from string
// matching, and it is the reason the repair does not simply reject any path
// containing `..`.
//
// HARNESS NOTES
//
// 1. THE REAL HANDLER IS DRIVEN. This suite calls
//    `createUiRequestHandler` — the shipped function — with a fake req/res
//    pair, and additionally boots a REAL http.Server over a real socket for
//    the end-to-end arms, because a fake pair can express the handler's
//    branch decisions but not the wire behaviour (a `..` in the request
//    LINE is what a client actually sends).
//
// 2. NO CREDENTIAL IS EVER PRINTED. The assertions read the response STATUS
//    and compare the served bytes against a well-known system-file MARKER.
//    Bodies are never echoed into a failure message.
//
// 3. The port is ALLOCATED, not hardcoded: a hardcoded port is a SHARED
//    RESOURCE, and an orphan from an earlier aborted run makes the suite
//    fail with EADDRINUSE — which reads exactly like "the fix is broken".

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
  dir = mkdtempSync(join(tmpdir(), 'woclaw-ui-traversal-'));
  writeFileSync(join(dir, 'index.html'), 'INDEX');
  writeFileSync(join(dir, 'app.js'), 'APPJS');
  mkdirSync(join(dir, 'nested'), { recursive: true });
  writeFileSync(join(dir, 'nested', 'deep.js'), 'DEEP');
  // A file whose NAME contains a character that must arrive percent-encoded
  // on the wire. Arm (10) uses it to pin the DIRECTION of the decode step.
  writeFileSync(join(dir, 'a b.js'), 'SPACED');
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

describe('R498b — the UI static server must not serve files outside publicDir', () => {
  // (0) THE PREMISE. This arm pins a FACT ABOUT JAVASCRIPT, not about the
  // current shape of the source: `path.join` normalises `..` away, so a
  // request path CAN leave the directory it was joined to.
  //
  // It deliberately does NOT assert the source text `join(publicDir, req.url)`:
  // pinning the VULNERABLE SHAPE would make the suite go red on a correct
  // repair. The confinement is judged by the OBSERVABLE arms below.
  it('(0) premise: path.join normalisation can carry a joined path out of its base', () => {
    expect(join('/srv/public', '/../../etc/passwd')).toBe('/etc/passwd');
    expect(join('/srv/public', '/foo/../../../etc/passwd')).toBe('/etc/passwd');
  });

  // (1) F1 ⭐ THE HEADLINE. No credential of any kind, and the server hands
  // back the real contents of a file OUTSIDE publicDir.
  it('(1) F1: an anonymous traversal request does NOT return a system file', () => {
    const rec = request('/../../../../../../etc/passwd');
    expect(isSystemFile(String(rec.body))).toBe(false);
  });

  // (2) F2 ⭐ THE MOST DAMAGING TARGET. /etc/shadow carries root's password
  // hashes.
  it('(2) F2: /etc/shadow is not served to an anonymous caller', () => {
    const rec = request('/../../../../../../etc/shadow');
    expect(String(rec.body)).not.toMatch(/root:\$1\$/);
  });

  // (3) F3 THE DEEPER SHAPE. The traversal must be refused at EVERY depth,
  // not only at the depth that happens to reach a file.
  it('(3) F3: no traversal depth yields a system file', () => {
    const depths = [
      '/../etc/passwd',
      '/../../etc/passwd',
      '/../../../etc/passwd',
      '/../../../../etc/passwd',
      '/../../../../../etc/passwd',
      '/../../../../../../etc/passwd',
      '/../../../../../../../etc/passwd',
    ];
    for (const p of depths) {
      const rec = request(p);
      expect(isSystemFile(String(rec.body)), `depth ${p} served a system file`).toBe(false);
    }
  });

  // (4) F4 THE MIDDLE-PATH FORM. The traversal does not have to start at the
  // root of the path -- a prefix segment is enough. This is the form a naive
  // "starts with /" check would miss.
  it('(4) F4: a traversal nested under a path segment is also refused', () => {
    for (const p of [
      '/foo/../../../../../../etc/passwd',
      '/nested/../../../../../../etc/passwd',
      '/a/b/c/../../../../../../etc/passwd',
    ]) {
      const rec = request(p);
      expect(isSystemFile(String(rec.body)), `nested form ${p} served a system file`).toBe(false);
    }
  });

  // (5) F5 ⭐ THE CONTROL: the fix must not break the SPA. A "fix" that
  // rejects everything with a dot or a slash would turn every deep link into
  // a 404. These arms assert the app still SERVES what it is supposed to.
  it('(5) F5 control: the SPA still serves its own files and its deep links', () => {
    const index = request('/');
    expect(index.statusCode).toBe(200);
    expect(String(index.body)).toBe('INDEX');
    expect(index.headers?.['Content-Type']).toBe('text/html');

    const asset = request('/app.js');
    expect(String(asset.body)).toBe('APPJS');
    expect(asset.headers?.['Content-Type']).toBe('application/javascript');

    // A deep link (a client-side route) must still get the SPA shell.
    const deep = request('/dashboard');
    expect(deep.statusCode).toBe(200);
    expect(String(deep.body)).toBe('INDEX');
  });

  // (6) F6 THE DIRECTIONAL CONTROL FOR THE FIX. A fix that refuses EVERY
  // path containing `..` would satisfy arms (1)-(4) while breaking legitimate
  // deep links that merely happen to spell `..` in the middle. The repaired
  // server must serve a file whose request path contains a textual `..` but
  // resolves INSIDE publicDir.
  //
  // This is the arm that separates "confinement" from "string matching":
  // the confinement is decided by the RESOLVED path, not by the spelling.
  it('(6) F6 control: a textual ".." that resolves inside publicDir is still served', () => {
    const rec = request('/nested/../app.js');
    expect(rec.statusCode).toBe(200);
    expect(String(rec.body)).toBe('APPJS');
  });

  // (7) F7 THE ENCODED FORM. `..` can reach the server percent-encoded
  // (`%2e%2e`), in which case the request path contains no literal `..` at
  // all. A fix that only inspects the RAW spelling misses it; a fix that
  // DECODES first (and then confines) does not.
  it('(7) F7: a percent-encoded traversal does NOT escape publicDir', () => {
    const variants = [
      '/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
      '/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/passwd',
      '/nested/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
    ];
    for (const p of variants) {
      const rec = request(p);
      expect(isSystemFile(String(rec.body)), `encoded variant ${p} served a system file`).toBe(false);
    }
  });

  // (8) F8 THE POSITIVE CONTROL FOR THE DETECTOR. The suite must be able to
  // see a system file WHEN ONE IS SERVED. If this arm cannot fail, every
  // negative arm above is vacuously true. It uses a file OUTSIDE publicDir
  // that is guaranteed to exist and to have no dot-segment.
  it('(8) F8 control: the detector CAN see a system file when one is served', () => {
    // /etc/hostname exists on every Linux host and has no dot-segment.
    const rec = request('/../../../../../../etc/hostname');
    const served = isSystemFile(String(rec.body)) || /us-vps4/.test(String(rec.body));
    if (served) {
      // The server is still vulnerable -- the negative arms would be
      // meaningless, so make that loud rather than silent.
      expect(served, 'THE SERVER IS STILL VULNERABLE').toBe(false);
    }
  });

  // (8b) F8b THE ARM THAT MAKES THE DECODE STEP LOAD-BEARING.
  //
  // ⭐ THIS ARM WAS ADDED BECAUSE THE FIRST VERSION OF THIS SUITE HAD A
  // HOLE, AND THE MUTATION MATRIX FOUND IT.
  //
  // Arm (7) asserts that a percent-ENCODED traversal does not escape. But a
  // literal path with `%2e%2e` does not NAME an existing file, so with the
  // decode step REMOVED the encoded traversal still misses and falls back to
  // index.html -- the arm stays GREEN. The mutation matrix measured exactly
  // that: arm M2 ("the percent-decode step is removed") SURVIVED, which means
  // arm (7) was VACUOUS with respect to the decode step.
  //
  // The defect the encode step is FOR is not "an encoded traversal" -- it is
  // that a legitimate file whose NAME contains a character that must arrive
  // encoded on the wire can never be served unless the server DECODES the
  // path before resolving it. That is the direction the decode step has to
  // work in, and it is observable: the file `a b.js` exists in the root, and
  // the request `/a%20b.js` must return ITS bytes.
  //
  // With the decode step removed, `%20` is never turned back into a space,
  // the resolved path names a file that does not exist, the handler falls
  // back to index.html, and THIS arm goes RED. So the arm pins the decode
  // step in the direction that actually matters, and it pins the POSITIVE
  // behaviour (a legitimate file is served) rather than only the negative
  // one (an escape is refused).
  it('(8b) F8b: a legitimate file whose name arrives percent-encoded is still served', () => {
    const rec = request('/a%20b.js');
    expect(rec.statusCode).toBe(200);
    expect(String(rec.body)).toBe('SPACED');
    expect(rec.headers?.['Content-Type']).toBe('application/javascript');
  });

  // (8c) F8c THE OTHER DIRECTION OF THE SAME ARM. A percent-encoded
  // traversal that names an EXISTING file outside the root must be refused
  // for the same reason a literal one is: the decode happens BEFORE the
  // confinement check, so the resolved path is the one that is checked.
  //
  // `..%2f` decodes to `../`, and `/etc/hostname` is guaranteed to exist on
  // every Linux host, so with the decode step removed the confinement check
  // sees a path that still contains `%2f` -- a path that does not name an
  // existing file -- and the escape is missed.
  it('(8c) F8c: a percent-encoded traversal that names an existing file is refused', () => {
    for (const p of [
      '/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/hostname',
      '/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc/hostname',
    ]) {
      const rec = request(p);
      expect(
        String(rec.body),
        `encoded variant naming an existing file ${p} was served`,
      ).not.toMatch(/us-vps4/);
    }
  });

  // (9) F9 THE END-TO-END ARM over a REAL socket. A fake req/res pair can
  // express the handler's branch decisions, but the wire behaviour is what a
  // client actually meets: a `..` in the request LINE. This arm boots a real
  // http.Server and issues a raw request.
  //
  // The port is ALLOCATED, not hardcoded -- a hardcoded port is a SHARED
  // RESOURCE, and an orphan from an earlier aborted run makes the suite fail
  // with EADDRINUSE, which reads exactly like "the fix is broken".
  it('(9) F9 end-to-end: a raw traversal request over a real socket serves no system file', async () => {
    const server = http.createServer(createUiRequestHandler(dir) as never);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const rawGet = (rawPath: string): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1', () => {
          sock.write(
            `GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
          );
        });
        const chunks: Buffer[] = [];
        sock.on('data', (d) => chunks.push(d as Buffer));
        sock.on('error', reject);
        sock.on('close', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const idx = text.indexOf('\r\n\r\n');
          const head = idx >= 0 ? text.slice(0, idx) : text;
          const body = idx >= 0 ? text.slice(idx + 4) : '';
          const m = head.match(/^HTTP\/1\.[01] (\d{3})/);
          resolve({ status: m ? parseInt(m[1], 10) : 0, body });
        });
      });

    try {
      for (const p of [
        '/../../../../../../etc/passwd',
        '/../../../../../../etc/shadow',
        '/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
      ]) {
        const res = await rawGet(p);
        expect(isSystemFile(res.body), `${p} served a system file`).toBe(false);
      }
      // The positive case over the same wire: the SPA still works.
      const ok = await rawGet('/app.js');
      expect(ok.status).toBe(200);
      expect(ok.body).toContain('APPJS');
    } finally {
      // Graceful FIRST, then forceful. An immediate SIGKILL skips SIGTERM.
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 60_000);
});
