import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createUiRequestHandler, UI_MIME_TYPES, UI_DEFAULT_CONTENT_TYPE } from '../src/ui_static.js';

// Runtime counterpart to hub/test/ui_server_eaddrinuse.test.ts.
//
// That suite has three gates, none of which execute the handler:
//
//   (1) index.ts attaches uiServer.on('error') BEFORE uiServer.listen(uiPort)
//   (2) the handler body calls hubWarn
//   (3) a *generic* http.Server created by the TEST is given an error
//       listener before its own listen(), and a port conflict fires it
//
// Gate (3) is a statement about Node's http module, not about this
// repository's code: the server it exercises is built inside the test file.
// Gates (1) and (2) are `indexOf` and regex assertions. None of them can tell
// a correct static-file handler from one that serves the wrong bytes with the
// wrong Content-Type, because none of them ever builds one.
//
// The handler was module-private inside main() in index.ts, which ends in a
// top-level `main().catch(...)` that boots the whole hub — so this is the
// fifth instance on woclaw of the same class: behaviour only expressible as
// source text because the real symbol cannot be imported without a real
// side effect on load. The fix is the shape used for env_helpers.ts and
// default_config.ts: extract the body verbatim into ui_static.ts and drive it
// here with a fake req/res pair. No listener is bound and no port is taken.

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
let handler: (req: unknown, res: never) => void;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'woclaw-ui-static-'));
  writeFileSync(join(dir, 'index.html'), 'INDEX');
  writeFileSync(join(dir, 'app.js'), 'APPJS');
  writeFileSync(join(dir, 'style.css'), 'CSS');
  writeFileSync(join(dir, 'data.json'), '{"a":1}');
  writeFileSync(join(dir, 'logo.png'), 'PNG');
  writeFileSync(join(dir, 'photo.jpg'), 'JPG');
  writeFileSync(join(dir, 'icon.svg'), 'SVG');
  writeFileSync(join(dir, 'notes.xyz'), 'XYZ');
  mkdirSync(join(dir, 'nested'), { recursive: true });
  writeFileSync(join(dir, 'nested', 'deep.js'), 'DEEP');
  handler = createUiRequestHandler(dir) as never;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function request(url: string) {
  const { res, rec } = makeRes();
  handler({ url }, res);
  return rec;
}

describe('createUiRequestHandler — resolution', () => {
  it('serves index.html for the bare root path', () => {
    const rec = request('/');
    expect(rec.statusCode).toBe(200);
    expect(String(rec.body)).toBe('INDEX');
    expect(rec.headers?.['Content-Type']).toBe('text/html');
  });

  it('strips the query string before reading the file', () => {
    const rec = request('/app.js?v=2');
    expect(String(rec.body)).toBe('APPJS');
    expect(rec.headers?.['Content-Type']).toBe('application/javascript');
  });

  it('falls back to index.html for a missing file instead of 404 (SPA behaviour)', () => {
    const rec = request('/does-not-exist');
    // Still 200, and the bytes are index.html — this is a deliberate SPA
    // fallback, not an error path.
    expect(rec.statusCode).toBe(200);
    expect(String(rec.body)).toBe('INDEX');
  });

  it('serves a file from a nested directory', () => {
    const rec = request('/nested/deep.js');
    expect(String(rec.body)).toBe('DEEP');
  });
});

describe('createUiRequestHandler — Content-Type selection', () => {
  it('maps every declared extension to its declared Content-Type', () => {
    const cases: Array<[string, string]> = [
      ['/index.html', 'text/html'],
      ['/app.js', 'application/javascript'],
      ['/style.css', 'text/css'],
      ['/data.json', 'application/json'],
      ['/logo.png', 'image/png'],
      ['/photo.jpg', 'image/jpeg'],
      ['/icon.svg', 'image/svg+xml'],
    ];
    for (const [url, expected] of cases) {
      expect(request(url).headers?.['Content-Type']).toBe(expected);
    }
  });

  it('uses text/plain for an extension absent from the map', () => {
    const rec = request('/notes.xyz');
    expect(String(rec.body)).toBe('XYZ');
    expect(rec.headers?.['Content-Type']).toBe(UI_DEFAULT_CONTENT_TYPE);
    expect(rec.headers?.['Content-Type']).toBe('text/plain');
  });

  it('derives the Content-Type from the SERVED file, not the requested one', () => {
    // /missing.xyz misses, so index.html is served. The extension that decides
    // the type is .html, NOT .xyz — this is the distinction a handler that
    // looked up the request path first would get wrong.
    const rec = request('/missing.xyz');
    expect(rec.headers?.['Content-Type']).toBe('text/html');
  });
});

describe('createUiRequestHandler — the exported MIME table is the real one', () => {
  it('exposes exactly the seven extensions index.ts declared', () => {
    expect(Object.keys(UI_MIME_TYPES).sort()).toEqual(
      ['.css', '.html', '.js', '.jpg', '.json', '.png', '.svg'].sort(),
    );
  });

  it('has .js mapped to application/javascript, not text/javascript', () => {
    // A real behavioural distinction: both are accepted by browsers, but the
    // hub's dashboard is loaded as a module script and the value is part of
    // the served contract.
    expect(UI_MIME_TYPES['.js']).toBe('application/javascript');
    expect(UI_MIME_TYPES['.js']).not.toBe('text/javascript');
  });
});
