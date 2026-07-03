/**
 * packages/opencode-woclaw-plugin/tests/opencode-plugin-log.test.js
 *
 * Regression tests for opencode_plugin_log.js — the helper-extraction
 * per-prefix pattern chain #9 closure. 07-04 06:03 cron.
 *
 * Mirrors mcp-bridge/test/mcp-log.test.js structure (12 tests total):
 *   - 3 module shape tests
 *   - 3 canonical signature tests
 *   - 3 runtime wire-format parity tests
 *   - 3 closure / import + 6-site migration parity tests
 *
 * Run with: node --test packages/opencode-woclaw-plugin/tests/opencode-plugin-log.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = resolve(__dirname, '..');
const HELPER_PATH = resolve(PLUGIN_DIR, 'opencode_plugin_log.js');
const INDEX_PATH = resolve(PLUGIN_DIR, 'index.js');

test('opencode_plugin_log.js helper extraction (07-04 06:03 cron chain #9)', async (t) => {
  // ── module shape (3) ─────────────────────────────────────────────────
  await t.test('opencode_plugin_log.js exists at packages/opencode-woclaw-plugin/opencode_plugin_log.js', () => {
    const src = readFileSync(HELPER_PATH, 'utf-8');
    assert.ok(src.length > 0, 'helper file should not be empty');
    assert.ok(src.includes('opencodeLog'), 'should declare opencodeLog');
    assert.ok(src.includes('opencodeWarn'), 'should declare opencodeWarn');
    assert.ok(src.includes('opencodeError'), 'should declare opencodeError');
  });

  await t.test('exports 3 helpers: opencodeLog, opencodeWarn, opencodeError', async () => {
    const mod = await import('../opencode_plugin_log.js');
    assert.equal(typeof mod.opencodeLog, 'function');
    assert.equal(typeof mod.opencodeWarn, 'function');
    assert.equal(typeof mod.opencodeError, 'function');
  });

  await t.test('all 3 helpers are named function declarations (canonical shape)', () => {
    const src = readFileSync(HELPER_PATH, 'utf-8');
    for (const name of ['opencodeLog', 'opencodeWarn', 'opencodeError']) {
      const re = new RegExp(`^export function ${name}\\(msg, \\.\\.\\.args\\) \\{`, 'm');
      assert.match(src, re, `expected canonical signature for ${name}`);
    }
  });

  // ── canonical signature (3) ──────────────────────────────────────────
  await t.test('opencodeLog signature: (msg, ...args) → console.log("[WoClaw] ${msg}", ...args)', async () => {
    const mod = await import('../opencode_plugin_log.js');
    const orig = console.log;
    let captured = null;
    console.log = (...args) => { captured = args; };
    try {
      mod.opencodeLog('hello', 'extra1', 42);
      assert.deepEqual(captured, ['[WoClaw] hello', 'extra1', 42]);
    } finally {
      console.log = orig;
    }
  });

  await t.test('opencodeWarn signature: (msg, ...args) → console.warn("[WoClaw] ${msg}", ...args)', async () => {
    const mod = await import('../opencode_plugin_log.js');
    const orig = console.warn;
    let captured = null;
    console.warn = (...args) => { captured = args; };
    try {
      mod.opencodeWarn('warn-test', { k: 'v' });
      assert.deepEqual(captured, ['[WoClaw] warn-test', { k: 'v' }]);
    } finally {
      console.warn = orig;
    }
  });

  await t.test('opencodeError signature: (msg, ...args) → console.error("[WoClaw] ${msg}", ...args)', async () => {
    const mod = await import('../opencode_plugin_log.js');
    const orig = console.error;
    let captured = null;
    console.error = (...args) => { captured = args; };
    try {
      mod.opencodeError('err-test');
      assert.deepEqual(captured, ['[WoClaw] err-test']);
    } finally {
      console.error = orig;
    }
  });

  // ── runtime wire-format parity (3) ───────────────────────────────────
  await t.test('opencodeLog runtime wire-format is byte-identical to pre-refactor inline console.log("[WoClaw] foo", x)', async () => {
    const mod = await import('../opencode_plugin_log.js');
    const orig = console.log;
    let captured = null;
    console.log = (...args) => { captured = args; };
    try {
      const hubUrl = 'ws://localhost:8080';
      mod.opencodeLog('Plugin initialized. Hub:', hubUrl);
      assert.deepEqual(captured, ['[WoClaw] Plugin initialized. Hub:', hubUrl]);
    } finally {
      console.log = orig;
    }
  });

  await t.test('opencodeLog template-string interpolation works (Loaded shared context (42 chars))', async () => {
    const mod = await import('../opencode_plugin_log.js');
    const orig = console.log;
    let captured = null;
    console.log = (...args) => { captured = args; };
    try {
      mod.opencodeLog(`Loaded shared context (${42} chars)`);
      assert.deepEqual(captured, ['[WoClaw] Loaded shared context (42 chars)']);
    } finally {
      console.log = orig;
    }
  });

  await t.test('opencodeLog no-arg msg works (No shared context found)', async () => {
    const mod = await import('../opencode_plugin_log.js');
    const orig = console.log;
    let captured = null;
    console.log = (...args) => { captured = args; };
    try {
      mod.opencodeLog('No shared context found');
      assert.deepEqual(captured, ['[WoClaw] No shared context found']);
    } finally {
      console.log = orig;
    }
  });

  // ── closure / 6-site migration parity (3) ────────────────────────────
  await t.test('index.js imports opencodeLog from ./opencode_plugin_log.js', () => {
    const src = readFileSync(INDEX_PATH, 'utf-8');
    assert.match(src, /import\s*\{\s*opencodeLog\s*\}\s*from\s*["']\.\/opencode_plugin_log\.js["']/);
  });

  await t.test('index.js has 0 inline console.log("[WoClaw]") sites (6 sites collapsed to 0)', () => {
    const src = readFileSync(INDEX_PATH, 'utf-8');
    // match exact pattern `console.log("[WoClaw]...` (any leading quote/escape form)
    const inlineSites = src.match(/console\.log\(["'`]?\[WoClaw\]/g) || [];
    assert.equal(inlineSites.length, 0,
      `expected 0 inline console.log("[WoClaw] ...") sites after migration, found ${inlineSites.length}: ${JSON.stringify(inlineSites)}`);
  });

  await t.test('index.js has exactly 6 opencodeLog call sites (1 plugin-init + 2 session.created + 2 session.compacted + 1 catch)', () => {
    const src = readFileSync(INDEX_PATH, 'utf-8');
    const callSites = src.match(/^\s*opencodeLog\(/gm) || [];
    assert.equal(callSites.length, 6,
      `expected exactly 6 opencodeLog call sites, found ${callSites.length}`);
    // verify each line number matches the originally-migrated 6 sites:
    // L54 (Plugin initialized) / L77 (Loaded shared context) / L81 (No shared context)
    // L84 (Could not load) / L102 (Session snapshot saved) / L104 (Could not save)
    const lines = src.split('\n');
    const opencodeLogLines = lines
      .map((line, idx) => ({ line: idx + 1, content: line }))
      .filter(({ content }) => /^\s*opencodeLog\(/.test(content))
      .map(({ line }) => line);
    assert.deepEqual(opencodeLogLines, [54, 77, 81, 84, 102, 104],
      `opencodeLog lines shifted from canonical [54,77,81,84,102,104]: got ${JSON.stringify(opencodeLogLines)}`);
  });
});
