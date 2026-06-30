// Regression test for the 漏更模式续集 — untyped `res` parameter in
// `httpGet<T>()`'s http.get callback at packages/woclaw-vscode/src/extension.ts:21.
//
// Parallel to test/res_on_data_typed_chunk.test.js (07-01 06:07 cron, dc45ea1)
// which pinned the single res.on('data', ...) callback's `chunk` parameter as
// (chunk: Buffer) at extension.ts:23. That commit was scoped to the inner
// res.on callback; the outer http.get callback's `res` parameter at line 21
// stayed untyped (inferred as http.IncomingMessage by tsc strict, but never
// annotated).
//
// rCAUSE: under vscode tsconfig.json strict:true + noImplicitAny:false, tsc
// infers `res` as http.IncomingMessage from http.get's overload signature, so
// a missing annotation is silently accepted (no error). Same failure mode as
// the 6f5175c hub/rest_server bug, just at a different call site. A future
// refactor that changes the inferred type (e.g. swapping http.get for
// https.get or a wrapper) could re-widen `res` to `any` without warning.
//
// rFIX: extension.ts:21 changed from
//   const req = http.get(`${url}${path}`, (res) => {
// to
//   const req = http.get(`${url}${path}`, (res: http.IncomingMessage) => {
// Explicit annotation matches the prior 6f5175c / dc45ea1 chain convention
// (every Node-streams callback parameter gets a named type annotation, never
// left to inference). Behavior byte-identical — http.IncomingMessage is
// exactly what tsc was already inferring. `http` is already imported at the
// top of extension.ts (line 2) so no new import needed.
//
// rTEST: this file — 5 regression tests asserting (1) sanity floor: ≥1
// http.get(..., (res) => ...) call site exists in src/extension.ts; (2) the
// http.get callback's `res` parameter has explicit `: http.IncomingMessage`
// annotation (regression gate); (3) `http` module is imported (regression
// gate — required for the annotation to resolve); (4) zero untyped
// `http.get(..., (res) =>` patterns remain (regression gate); (5) the
// inferred `req: http.ClientRequest` annotation is preserved at L22
// (regression gate — verify we didn't accidentally remove the existing
// `const req` typing).
//
// Runs under `node --test` (Node 18+) — no extra devDeps needed. Mirrors
// test/res_on_data_typed_chunk.test.js structure.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'extension.ts');
const src = fs.readFileSync(SRC, 'utf8');

// Strip line comments and block comments before scanning — comment text
// describing the migration would otherwise be a false positive.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

function findHttpGetResSites(source) {
  // Match `http.get(`, then scan forward for the matching `) =>` to find the
  // callback parameter list. We use a bounded lookahead (≤4 lines) since
  // http.get calls in this file are single-line.
  const ls = source.split(/\r?\n/);
  const sites = [];
  const httpGetRe = /http\.get\s*\(/;
  for (let i = 0; i < ls.length; i++) {
    if (!httpGetRe.test(ls[i])) continue;
    // Scan up to 4 lines ahead for the callback's parameter list
    const window = ls.slice(i, i + 4).join('\n');
    const m = window.match(/http\.get\s*\(\s*[^,]+,\s*\(([^)]*)\)\s*=>/);
    if (m) sites.push({ line: i + 1, raw: m[0], params: m[1] });
  }
  return sites;
}

test('woclaw-vscode: at least 1 http.get(..., (res) => ...) call site exists in src/extension.ts (sanity floor)', () => {
  const sites = findHttpGetResSites(codeOnly);
  assert.ok(
    sites.length >= 1,
    `expected ≥1 http.get() call site, found ${sites.length}`,
  );
});

test('woclaw-vscode: http.get callback res parameter has explicit : http.IncomingMessage annotation (regression gate)', () => {
  const sites = findHttpGetResSites(codeOnly);
  assert.ok(sites.length >= 1, 'no http.get() call site found');
  for (const s of sites) {
    const typedRe = /:\s*http\.IncomingMessage/;
    assert.ok(
      typedRe.test(s.params),
      `regression: http.get() callback at line ${s.line} missing ': http.IncomingMessage' annotation on res parameter: params="${s.params}"`,
    );
  }
});

test('woclaw-vscode: http module is imported at top of src/extension.ts (regression gate for IncomingMessage annotation)', () => {
  // `import * as http from 'http'` should appear on a top-of-file line
  // (within the first 10 lines). The explicit : http.IncomingMessage
  // annotation depends on this import resolving.
  const head = src.split(/\r?\n/).slice(0, 10).join('\n');
  const httpImportRe = /import\s+\*\s+as\s+http\s+from\s+['"]http['"]/;
  assert.ok(
    httpImportRe.test(head),
    `regression: top-of-file http import missing; explicit : http.IncomingMessage annotation requires it`,
  );
});

test('woclaw-vscode: zero untyped `http.get(..., (res) =>` patterns remain (regression gate)', () => {
  // Match http.get(..., (res) => where (res) has no type annotation.
  // We allow whitespace inside the parens but not `:`.
  const untypedRe = /http\.get\s*\(\s*[^,]+,\s*\(\s*res\s*\)\s*=>/;
  assert.ok(
    !untypedRe.test(codeOnly),
    'regression: src/extension.ts contains an untyped `http.get(..., (res) =>` pattern; annotate with (res: http.IncomingMessage)',
  );
});

test('woclaw-vscode: const req = http.get(...) assignment is preserved (regression gate)', () => {
  // Verify the `const req =` prefix is still on the line containing http.get
  // — guards against an accidental refactor that turns the statement into an
  // unhandled promise or removes the variable used by req.on('error', ...)
  // and req.setTimeout(...) below.
  const ls = codeOnly.split(/\r?\n/);
  const reqRe = /^\s*const\s+req\s*=\s*http\.get\s*\(/;
  const matches = ls.filter((ln) => reqRe.test(ln));
  assert.ok(
    matches.length >= 1,
    `regression: 'const req = http.get(...)' assignment missing; the http.get call site no longer feeds the req.on('error') + req.setTimeout() cleanup chain`,
  );
});
