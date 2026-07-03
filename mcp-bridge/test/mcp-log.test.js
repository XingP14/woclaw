// Regression test for mcp-bridge/src/mcp_log.js helper extraction
// (07-04 02:53 cron chain #7). The helper centralizes the `[WoClaw MCP]`
// prefix that was previously inlined as `console.error('[WoClaw MCP] ...')`
// at 5 sites in mcp-bridge/src/index.js (lines 43 / 56 / 61 / 66 / 267 / 306;
// line 312 `main().catch(console.error)` is bare passthrough, NOT migrated).
//
// This test asserts:
//   1. mcp_log.js module shape (3 named exports mcpLog/mcpWarn/mcpError)
//   2. runtime wire-format parity with pre-refactor inline sites
//      (each helper forwards to console.error with `[WoClaw MCP]` prefix)
//   3. closure parity — index.js no longer contains the manual prefix
//      (pre-refactor `console.error('[WoClaw MCP]')` substring appeared 6 times;
//      post-refactor 0 times — 5 sites migrated to helpers + 1 untouched passthrough
//      which has no `[WoClaw MCP]` prefix in the literal)
//   4. byte-identical emission: mcpError("foo", x) ≡ console.error("[WoClaw MCP] foo", x)
//
// Runs under `node --test` (Node 18+) — no extra devDeps needed (parallels
// packages/woclaw-vscode/test/eventemitter.test.js 03768ae pattern).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = join(__dirname, '..', 'src', 'mcp_log.js');
const INDEX_PATH = join(__dirname, '..', 'src', 'index.js');

test('mcp-bridge: mcp_log.js module shape — 3 named exports (mcpLog/mcpWarn/mcpError)', async () => {
  const mod = await import('../src/mcp_log.js');
  assert.strictEqual(typeof mod.mcpLog, 'function', 'mcpLog export missing');
  assert.strictEqual(typeof mod.mcpWarn, 'function', 'mcpWarn export missing');
  assert.strictEqual(typeof mod.mcpError, 'function', 'mcpError export missing');
});

test('mcp-bridge: mcp_log.js exports are arrow-less function declarations (canonical shape)', () => {
  const src = readFileSync(HELPER_PATH, 'utf-8');
  for (const name of ['mcpLog', 'mcpWarn', 'mcpError']) {
    // canonical signature: `export function <name>(msg, ...args) {`
    // (mcp-bridge is JS not TS, so we drop the `: string` / `: unknown[]` annotations)
    const re = new RegExp(`^export function ${name}\\(msg, \\.\\.\\.args\\) \\{`, 'm');
    assert.match(src, re, `expected canonical signature for ${name}`);
  }
});

test('mcp-bridge: mcp_log.js forwards to console.error with [WoClaw MCP] prefix (mcpLog)', () => {
  const src = readFileSync(HELPER_PATH, 'utf-8');
  assert.match(
    src,
    /export function mcpLog\(msg, \.\.\.args\) \{\s*console\.error\(`\[WoClaw MCP\] \$\{msg\}`, \.\.\.args\);\s*\}/,
    'mcpLog body must forward to console.error with [WoClaw MCP] prefix',
  );
});

test('mcp-bridge: mcp_log.js forwards to console.error with [WoClaw MCP] prefix (mcpWarn)', () => {
  const src = readFileSync(HELPER_PATH, 'utf-8');
  assert.match(
    src,
    /export function mcpWarn\(msg, \.\.\.args\) \{\s*console\.error\(`\[WoClaw MCP\] \$\{msg\}`, \.\.\.args\);\s*\}/,
    'mcpWarn body must forward to console.error with [WoClaw MCP] prefix',
  );
});

test('mcp-bridge: mcp_log.js forwards to console.error with [WoClaw MCP] prefix (mcpError)', () => {
  const src = readFileSync(HELPER_PATH, 'utf-8');
  assert.match(
    src,
    /export function mcpError\(msg, \.\.\.args\) \{\s*console\.error\(`\[WoClaw MCP\] \$\{msg\}`, \.\.\.args\);\s*\}/,
    'mcpError body must forward to console.error with [WoClaw MCP] prefix',
  );
});

test('mcp-bridge: runtime wire-format — mcpError("foo", x) emits console.error("[WoClaw MCP] foo", x)', async () => {
  const mod = await import('../src/mcp_log.js');
  const original = console.error;
  const captured = [];
  console.error = (...args) => captured.push(args);
  try {
    mod.mcpError('foo', { k: 1 }, 'tail');
    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0][0], '[WoClaw MCP] foo');
    assert.deepStrictEqual(captured[0][1], { k: 1 });
    assert.strictEqual(captured[0][2], 'tail');
  } finally {
    console.error = original;
  }
});

test('mcp-bridge: runtime wire-format — mcpLog and mcpWarn also emit [WoClaw MCP] prefix', async () => {
  const mod = await import('../src/mcp_log.js');
  const original = console.error;
  const captured = [];
  console.error = (...args) => captured.push(args);
  try {
    mod.mcpLog('hello');
    mod.mcpWarn('careful');
    assert.strictEqual(captured.length, 2);
    assert.strictEqual(captured[0][0], '[WoClaw MCP] hello');
    assert.strictEqual(captured[1][0], '[WoClaw MCP] careful');
  } finally {
    console.error = original;
  }
});

test('mcp-bridge: index.js imports from mcp_log.js (closure — chain #7 wired)', () => {
  const src = readFileSync(INDEX_PATH, 'utf-8');
  assert.match(
    src,
    /import\s*\{\s*mcpLog\s*,\s*mcpWarn\s*,\s*mcpError\s*\}\s*from\s*['"]\.\/mcp_log\.js['"]/,
    'index.js must import mcpLog/mcpWarn/mcpError from ./mcp_log.js',
  );
});

test('mcp-bridge: index.js — bare console.error("[WoClaw MCP] ...") calls reduced from 6 → 0 (5 migrated + 1 untouched passthrough has no [WoClaw MCP] prefix)', () => {
  const src = readFileSync(INDEX_PATH, 'utf-8');
  // pre-refactor: 6 `console.error('[WoClaw MCP] ...')` sites
  // post-refactor: 0 (5 sites migrated to mcpError/mcpWarn/mcpLog helpers,
  // 1 `main().catch(console.error)` passthrough is bare `console.error` —
  // NOT `[WoClaw MCP]` prefixed — so this regex still returns 0).
  const matches = src.match(/console\.error\(\s*['"]\[WoClaw MCP\]/g) || [];
  assert.strictEqual(
    matches.length,
    0,
    `expected 0 inline '[WoClaw MCP]' console.error calls in index.js after migration, found ${matches.length}`,
  );
});

test('mcp-bridge: index.js — bare `console.error` left intact (main().catch passthrough is intentional)', () => {
  // The bare `main().catch(console.error)` passthrough at line 312 must NOT
  // be migrated to `mcpError(...)` — it's a generic reject handler that
  // forwards the rejected Error verbatim, no prefix needed. We assert it
  // is still present.
  const src = readFileSync(INDEX_PATH, 'utf-8');
  assert.match(
    src,
    /main\(\)\.catch\(console\.error\)/,
    'main().catch(console.error) passthrough should remain bare (not migrated to mcpError)',
  );
});

test('mcp-bridge: index.js — exactly 6 callsite migrations (1 mcpLog + 1 mcpWarn + 4 mcpError)', () => {
  const src = readFileSync(INDEX_PATH, 'utf-8');
  // Strip the import line before counting (import has no parens, so the
  // `\bmcpLog\(` / `\bmcpWarn\(` / `\bmcpError\(` regex below already excludes
  // the import — but we sanity-check it does).
  const importLine = src.match(/^import\s*\{[^}]*mcpLog[^}]*\}\s*from[^;]+;?\s*$/m);
  if (importLine) {
    assert.strictEqual(
      importLine[0].match(/\bmcpLog\(/g),
      null,
      'import line should not have parens',
    );
  }
  const mcpLogCount = (src.match(/\bmcpLog\(/g) || []).length;
  const mcpWarnCount = (src.match(/\bmcpWarn\(/g) || []).length;
  const mcpErrorCount = (src.match(/\bmcpError\(/g) || []).length;
  // Call-site enumeration:
  //   L43 mcpLog('Connected to Hub:', hubUrl)         — 1 mcpLog
  //   L56 mcpError('Parse error:', e.message)         — 1 mcpError
  //   L61 mcpError('WS error:', err.message)          — 2 mcpError
  //   L66 mcpWarn('Disconnected, reconnecting in 3s') — 1 mcpWarn
  //   L267 mcpError('Failed to connect:', err.message)— 3 mcpError
  //   L306 mcpError('Error:', e.message)              — 4 mcpError
  assert.strictEqual(mcpLogCount, 1, `expected 1 mcpLog( call site, found ${mcpLogCount}`);
  assert.strictEqual(mcpWarnCount, 1, `expected 1 mcpWarn( call site, found ${mcpWarnCount}`);
  assert.strictEqual(mcpErrorCount, 4, `expected 4 mcpError( call sites, found ${mcpErrorCount}`);
});

test('mcp-bridge: parity assertion — post-refactor mcp_log.js wire-format ≡ pre-refactor console.error("[WoClaw MCP] ...")', () => {
  // This is the canonical parity claim: a hypothetical pre-refactor call
  //   console.error('[WoClaw MCP] foo', { x: 1 })
  // is byte-identical to a post-refactor call
  //   mcpError('foo', { x: 1 })
  // We assert this by snapshot-comparing the helper template literal prefix
  // matches the pre-refactor inline prefix exactly.
  const helperSrc = readFileSync(HELPER_PATH, 'utf-8');
  assert.match(
    helperSrc,
    /`\[WoClaw MCP\] \$\{msg\}`/,
    'mcp_log.js template literal prefix must match the pre-refactor inline prefix exactly',
  );
});
