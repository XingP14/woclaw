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

import { readFileSync, existsSync, realpathSync, statSync } from 'fs';
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
  //
  // R498c 安全修复: `resolve` NORMALISES `..` but does NOT resolve SYMLINKS.
  // A symlink that lives INSIDE publicDir (an attacker-planted one, or an
  // operator's convenience link) therefore passes the textual containment
  // check and still points outside the root -- measured: with
  // `publicDir/escape -> /etc`, `GET /escape/passwd` was answered 200 with
  // the real /etc/shadow (root's password hashes). The confinement must be
  // decided on the REAL path of the file that will actually be opened, so the
  // root and the candidate are both resolved with `realpathSync` and compared
  // as real paths. `realpathSync` also normalises every intermediate symlink,
  // so a symlinked SUBDIRECTORY cannot smuggle the target out either.
  const publicRoot = resolve(publicDir);
  // The real path of the root itself (the root may itself be reached through
  // a symlink -- e.g. /tmp -> /private/tmp -- and the comparison must be
  // against the same coordinate system as the candidate's real path).
  let realRoot: string;
  try {
    realRoot = realpathSync(publicRoot);
  } catch {
    realRoot = publicRoot;
  }
  const indexPath = join(publicRoot, 'index.html');
  /** Is `candidate` (already real-path'd) inside the real root? */
  const insideRealRoot = (candidate: string): boolean =>
    candidate === realRoot || candidate.startsWith(realRoot + sep);
  /**
   * Resolve a candidate path to its REAL path, and refuse it if the real
   * path escapes the real root.
   *
   * Returns null when the candidate does not exist (a miss -> SPA fallback)
   * or when it escapes (a violation -> the same miss treatment; the file is
   * simply not served).
   */
  const realPathInsideRoot = (candidate: string): string | null => {
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      return null; // does not exist (or is unreadable) -> a miss
    }
    return insideRealRoot(real) ? real : null;
  };
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
    // R498c: the textual check above is NECESSARY but NOT SUFFICIENT -- it
    // says "the path, spelled out, starts with the root". What is served is
    // the file that path NAMES, and a symlink inside the root can name a file
    // outside it. So the candidate is additionally resolved to its REAL path
    // and the REAL path is what is confined.
    const realTarget = isInside ? realPathInsideRoot(target) : null;
    // A miss falls back to index.html (SPA behaviour, unchanged). The
    // fallback target is inside the root by construction, so it needs no
    // separate check.
    // R498d 安全修复: a DIRECTORY is a valid `existsSync` hit, so a directory
    // target used to survive to `readFileSync`, which throws EISDIR. The
    // throw happens INSIDE the http request handler, and src/index.ts
    // registers NO `uncaughtException` handler -- so one anonymous
    // `GET /<dir>` took the WHOLE hub process down (measured in a child
    // process with the hub's own error configuration: the request answered
    // nothing, every subsequent request was dead, and the process exited
    // with EISDIR). The confinement fix above does not help here: the
    // directory is legitimately INSIDE the root.
    //
    // So the served target must be a FILE, not merely an existing path. A
    // directory is a miss -> the SPA fallback, exactly like a missing file.
    let filePath = realTarget ?? indexPath;
    if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = indexPath;
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': UI_MIME_TYPES[ext] || UI_DEFAULT_CONTENT_TYPE });
    res.end(readFileSync(filePath));
  };
}
