// hub/src/ui_static.ts
//
// Web UI static-file request handling, extracted from hub/src/index.ts
// (2026-10-04 04:03 cron).
//
// Why: the handler was an inline `http.createServer(...)` callback inside
// main(). main() boots the whole hub (WS server, SQLite, scheduler), and
// index.ts ends in a top-level `main().catch(...)`, so the handler was
// unreachable from any test. The existing suite,
// hub/test/ui_server_eaddrinuse.test.ts, pins only the *attachment* of the
// error listener as source text and the presence of a `hubWarn` call — both
// regex-compatible with any behaviour whatsoever.
//
// Concretely, before this extraction nothing observed that:
//
//   - `/` resolves to index.html, but `/` with a query string (`/?x=1`) does
//     NOT take the index.html branch (the `=== '/'` comparison is exact), so
//     it falls through to the existsSync miss and lands on index.html anyway
//     — the two paths agree by accident, not by design;
//   - a path with a query string (`/app.js?v=2`) has the query stripped
//     before the file is read;
//   - a missing file falls back to index.html (SPA behaviour) rather than
//     404;
//   - the MIME map is keyed by the extension OF THE SERVED FILE, not of the
//     request — so a miss on `/foo.xyz` is served as index.html with
//     `text/html`, never `text/plain`;
//   - an unmapped extension yields `text/plain`.
//
// Each of those is a single line here, and each was previously only reachable
// by booting the hub. This file is the same shape as env_helpers.ts and
// default_config.ts: move the bodies verbatim, export them, drive them from a
// test with a fake req/res pair.
//
// Bodies unchanged. index.ts keeps the `existsSync(publicDir)` gate, the
// port, the error listener, the signal handlers, and the uiEnabled flag.

import { readFileSync, existsSync } from 'fs';
import { join, extname, resolve, sep } from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

/** Extension -> Content-Type for the Web UI static server. */
export const UI_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

/** Fallback Content-Type for an extension the map does not know. */
export const UI_DEFAULT_CONTENT_TYPE = 'text/plain';

/**
 * Build the request handler for the Web UI static server.
 *
 * Deliberately returns a plain `(req, res) => void` closure rather than an
 * http.Server, so a test can drive it with a fake req/res pair and no
 * listener is bound. The two calls it makes on `res` are writeHead and end.
 */
export function createUiRequestHandler(publicDir: string): (req: IncomingMessage, res: ServerResponse) => void {
  // R498b 安全修复: the resolved public root. The request path is joined onto
  // it, so the join has to be CONFINED to it.
  const publicRoot = resolve(publicDir);
  const indexPath = join(publicRoot, 'index.html');
  return (req, res) => {
    // R498b: `join` NORMALISES `..` away, so a request path can carry the
    // joined path OUT of publicDir entirely, and the old code then read
    // whatever file that resolved to -- an UNAUTHENTICATED ARBITRARY FILE
    // READ (measured: /etc/shadow was served, root's password hashes and
    // all). The fix is the same shape as llm-benchmark's R497 repair:
    // decode, strip the leading slashes, resolve against the root, and then
    // assert the RESOLVED path is still inside the root.
    //
    // The confinement is decided by the RESOLVED path, not by the spelling of
    // the request: a textual `..` that resolves INSIDE publicDir is still
    // served.
    let decoded: string;
    try {
      decoded = decodeURIComponent(req.url === '/' ? 'index.html' : req.url!.split('?')[0]);
    } catch {
      decoded = 'index.html';
    }
    const relative = decoded.replace(/^\/+/, '');
    const target = resolve(publicRoot, relative);
    const isInside = target === publicRoot || target.startsWith(publicRoot + sep);
    // A miss falls back to index.html (SPA behaviour, unchanged). The
    // fallback target is inside the root by construction, so it needs no
    // separate check.
    let filePath = isInside ? target : indexPath;
    if (!existsSync(filePath)) filePath = indexPath;
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': UI_MIME_TYPES[ext] || UI_DEFAULT_CONTENT_TYPE });
    res.end(readFileSync(filePath));
  };
}
