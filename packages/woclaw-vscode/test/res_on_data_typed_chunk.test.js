// Regression test for the 漏更模式续集 — untyped `res.on('data', chunk => ...)`
// callback in packages/woclaw-vscode/src/extension.ts.
//
// Parallel to hub/test/req_on_data_typed_chunk.test.ts (06-29 22:03 cron, 6f5175c)
// which pinned 16/16 req.on('data', ...) sites in hub/src to (chunk: Buffer) +
// chunk.toString('utf8') body. The woclaw-vscode package was outside that
// audit's scope (hub/src/*.ts only) so the single res.on('data', (chunk) => data += chunk)
// site at extension.ts:23 (inside httpGet<T>()'s http.get callback) was missed.
//
// rCAUSE: under vscode tsconfig.json strict:true + noImplicitAny:false, the
// `res.on('data', (chunk) => data += chunk)` callback parameter `chunk`
// silently widens to `any` because @types/node IncomingMessage inherits from
// stream.Readable whose on('data') listener signature is `(chunk: any) => void`
// (verified in node_modules/@types/node/stream.d.ts:650). So tsc --noEmit
// does NOT catch the missing annotation. Same failure mode as the hub
// rest_server.ts bug, just in a different package.
//
// rFIX: extension.ts:23 changed from
//   res.on('data', (chunk) => data += chunk);
// to
//   res.on('data', (chunk: Buffer) => { data += chunk.toString('utf8'); });
// Body semantics byte-identical (Node http.IncomingMessage emits Buffers by
// default; utf8 toString is what the 16 typed hub sites use).
//
// rTEST: this file — 4 regression tests asserting (1) sanity floor: ≥1
// res.on('data', ...) site exists in src/extension.ts; (2) every callback
// parameter has explicit (chunk: Buffer) annotation; (3) every callback body
// uses chunk.toString('utf8') (parity gate with the 16 hub sites); (4) zero
// untyped `res.on('data', chunk =>` patterns remain (regression gate).
// Mirrors hub/test/req_on_data_typed_chunk.test.ts structure adapted to
// node:test (vscode package uses `node --test` not vitest).
//
// Runs under `node --test` (Node 18+) — no extra devDeps needed.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'extension.ts');
const src = fs.readFileSync(SRC, 'utf8');

// Split src into lines for line-by-line scanning (avoids regex pain with
// multi-line arrow function bodies).
const lines = src.split(/\r?\n/);

function findResOnDataSites(source) {
  const ls = source.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    // Match a line containing `res.on('data',` or `res.on("data",`. We scan
    // res.on (not req.on) because the vscode httpGet<T>() calls http.get()
    // which exposes the response as `res` (a ClientRequest's IncomingMessage).
    if (/res\.on\(\s*['"]data['"]\s*,/.test(ls[i])) {
      out.push({ line: i + 1, raw: ls[i] });
    }
  }
  return out;
}

test('woclaw-vscode: at least 1 res.on("data", ...) site exists in src/extension.ts (sanity floor)', () => {
  const sites = findResOnDataSites(src);
  assert.ok(
    sites.length >= 1,
    `expected >=1 res.on("data", ...) site in src/extension.ts, found ${sites.length}`,
  );
});

test('woclaw-vscode: every res.on("data", ...) callback parameter has explicit (chunk: Buffer) annotation', () => {
  const sites = findResOnDataSites(src);
  const typedRe = /res\.on\(\s*['"]data['"]\s*,\s*\(chunk:\s*Buffer\s*\)/;
  for (const s of sites) {
    assert.ok(
      typedRe.test(s.raw),
      `regression: res.on("data", ...) at line ${s.line} missing (chunk: Buffer) annotation: "${s.raw.trim()}"`,
    );
  }
});

test('woclaw-vscode: every res.on("data", ...) callback body uses chunk.toString("utf8") (parity with 16 hub sites)', () => {
  const sites = findResOnDataSites(src);
  // Allow either a single-line or multi-line body; for single-line, the
  // toString must appear on the same line. For multi-line, we only require
  // the typed annotation on the opening line (covered by the prior test)
  // and the toString call to appear within the immediately-following block
  // (up to 4 lines). Simpler: just assert both chunk.toString and 'utf8'
  // appear in the same multi-line block.
  for (const s of sites) {
    const start = s.line - 1;
    // Look at this line and up to 3 following lines (block-body scan)
    const window = lines.slice(start, start + 4).join(' ');
    assert.ok(
      /chunk\.toString\(\s*['"]utf8['"]\s*\)/.test(window),
      `regression: res.on("data", ...) body at line ${s.line} missing chunk.toString('utf8'): "${s.raw.trim()}"`,
    );
  }
});

test('woclaw-vscode: zero untyped `res.on("data", chunk =>` patterns remain (regression gate)', () => {
  // Strip line comments and block comments before scanning — comment text
  // describing the migration would otherwise be a false positive.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const untypedRe = /res\.on\(\s*['"]data['"]\s*,\s*chunk\s*=>/;
  assert.ok(
    !untypedRe.test(codeOnly),
    'regression: src/extension.ts contains an untyped `res.on("data", chunk =>` pattern; annotate with (chunk: Buffer)',
  );
});
