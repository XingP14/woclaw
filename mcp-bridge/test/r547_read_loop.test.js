// R547 — the MCP bridge's JSON-RPC read loop drops every request.
//
// Subject: mcp-bridge/src/index.js (the read loop at the end of main()).
// Counterparty: none needed for the primary arm — the defect is internal.
//
// THE DEFECT
// ----------
// The loop is:
//     for await (const chunk of rl) {
//       buffer += chunk;
//       const lines = buffer.split('\n');
//       buffer = lines.pop() || '';
//       for (const line of lines) { ...handle... }
//     }
//
// `readline`'s async iterator yields the line WITHOUT its terminator, so
// `chunk` never contains '\n'. `buffer.split('\n')` therefore yields exactly
// ONE element (the whole chunk), `lines.pop()` takes that element, and
// `lines` is EMPTY. The inner `for (const line of lines)` loop body never
// executes — not once. Every JSON-RPC request that arrives is silently
// discarded and the bridge never writes a single byte to stdout.
//
// MEASURED 2026-11-17 01:0x CST against this tree: the real bridge, fed two
// well-formed requests on stdin, produced 0 bytes of stdout and hung.
//
// This is a "one-line" bug with a total-failure consequence, and it is
// invisible to every existing test: mcp-bridge/test/mcp-log.test.js only
// asserts the shape of the mcp_log.js helper and never drives the loop.
//
// The arms are written so that A/A2 FAIL on the current tree (the defect is
// present) and PASS once the loop is fixed. Arms B/C/D are the mechanism and
// its controls, and they are RED/GREEN independent of the repair.
//
// Run with:
//     node --test test/r547_read_loop.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(__dirname, '..', 'src', 'index.js');
const INDEX_SRC = readFileSync(INDEX_PATH, 'utf-8');
const LOOP_SHAPE_PATH = join(__dirname, 'r547_loop_shape.mjs');
const INPUT_PATH = join(__dirname, 'r547_input.jsonl');

/** Spawn a node script, feed it `input` on stdin, collect stdout/stderr.
 *
 * NOTE: the bridge NEVER exits on its own — its WebSocket reconnect timer
 * keeps the event loop alive forever. So this helper resolves as soon as the
 * stdout it is waiting for has arrived (or the deadline passes), and it
 * kills the child afterwards. Waiting for `exit` instead would report every
 * call as a timeout, even when the answer was already on stdout.
 */
function runNode(scriptPath, input, { timeoutMs = 8000, env = {}, untilStdout = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let out = '';
    let err = '';
    let settled = false;

    const finish = (timedOut) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve({ out, err, timedOut });
    };

    child.stdout.on('data', (d) => {
      out += d.toString();
      if (untilStdout && out.includes('\n')) finish(false);
    });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', () => {});
    child.on('exit', () => finish(false));

    const timer = setTimeout(() => finish(true), timeoutMs);

    child.stdin.write(input);
    child.stdin.end();
  });
}

const INPUT = readFileSync(INPUT_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// Arm A — the real bridge, spawned, must answer a JSON-RPC request.
//
// This is the load-bearing arm: it drives the ACTUAL entry point as a child
// process and asserts on its ACTUAL stdout. It does not re-implement the
// loop, does not mock readline, and does not re-implement the handler.
//
// The hub is NOT required: `initialize` and `tools/list` are answered
// entirely from the bridge's own local state, so this arm has no network
// dependency and no live-hub flakiness.
// ---------------------------------------------------------------------------
test('R547/A — the real bridge answers a JSON-RPC request on stdout (regression: read loop dropped every request)', async () => {
  const res = await runNode(INDEX_PATH, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n', { untilStdout: true });
  assert.ok(
    !res.timedOut && res.out.trim().length > 0,
    `bridge produced no stdout for a well-formed initialize request — ` +
    `the JSON-RPC read loop discarded it (out=${JSON.stringify(res.out)} ` +
    `err=${JSON.stringify(res.err.slice(0, 300))})`,
  );
  const msg = JSON.parse(res.out.trim().split('\n')[0]);
  assert.strictEqual(msg.id, 1, 'response must carry the request id');
  assert.ok(msg.result, 'response must carry a result');
  assert.ok(msg.result.protocolVersion, 'initialize must report a protocolVersion');
});

test('R547/A2 — the real bridge answers tools/list with the WoClaw tools (regression: same dropped-request path)', async () => {
  const res = await runNode(INDEX_PATH, JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} }) + '\n', { untilStdout: true });
  assert.ok(
    !res.timedOut && res.out.trim().length > 0,
    `bridge produced no stdout for tools/list — same dropped-request defect ` +
    `(out=${JSON.stringify(res.out)} err=${JSON.stringify(res.err.slice(0, 300))})`,
  );
  const msg = JSON.parse(res.out.trim().split('\n')[0]);
  assert.ok(Array.isArray(msg.result.tools), 'tools/list must return a tools array');
  assert.ok(msg.result.tools.length >= 8,
    `expected at least 8 advertised tools, got ${msg.result.tools.length}`);
});

// ---------------------------------------------------------------------------
// Arm B — the mechanism, pinned.
//
// The bridge's loop splits `buffer` on '\n' and pops the tail. For that to
// ever produce a line to handle, `chunk` must contain a newline. readline
// does not deliver one.
//
// The measurement is done by a helper that consumes a REAL `process.stdin`
// exactly the way the bridge does, because readline's async iterator does
// not settle on an in-memory PassThrough in this Node version.
// ---------------------------------------------------------------------------
test('R547/B — readline yields newline-free chunks, so the REAL loop arithmetic yields ZERO lines', async () => {
  const res = await runNode(LOOP_SHAPE_PATH, INPUT);
  assert.ok(!res.timedOut, 'loop-shape helper must not time out');
  const parsed = JSON.parse(res.out);
  const report = parsed.report;
  assert.ok(report.length >= 1, `expected at least 1 chunk, got ${report.length}`);
  // The helper EXTRACTS the arithmetic from src/index.js and executes it, so
  // this arm is connected to the subject: a mutation of index.js changes what
  // it computes. (An earlier version hard-coded the arithmetic in the helper;
  // the mutation matrix correctly reported this arm as SURVIVED — the probe
  // was measuring a copy. That is why the extraction is asserted here.)
  assert.match(parsed.block, /buffer\.split\('\\n'\)/,
    'the helper must have extracted the REAL split-on-newline statement from index.js');
  assert.match(parsed.block, /lines\.pop\(\)/,
    'the helper must have extracted the REAL pop-the-tail statement from index.js');

  // NOTE: the NUMBER of chunks readline yields is timing-dependent, so this
  // arm asserts the AGGREGATE property, never a chunk count. An earlier
  // version asserted `report.length >= 2` and flaked RED under load — the
  // count is not a property of the defect.
  for (const r of report) {
    assert.strictEqual(r.error, null, `the extracted block must not throw: ${r.error}`);
    assert.strictEqual(r.chunk_has_newline, false,
      `readline must not deliver a newline inside the chunk (got ${JSON.stringify(r.chunk)})`);
    assert.strictEqual(r.lines_to_handle, 0,
      `the bridge's split+pop must yield zero handleable lines (got ${r.lines_to_handle})`);
    assert.strictEqual(r.handled, false,
      'no chunk may ever be handled by the current loop shape');
  }
  assert.strictEqual(report.reduce((n, r) => n + r.lines_to_handle, 0), 0,
    'the total number of handleable lines across all chunks must be zero');
});

// ---------------------------------------------------------------------------
// Arm C — the source shape that makes the defect possible.
//
// Pins that the loop still splits on '\n' and pops the tail. If a future
// fix removes that shape, this arm goes RED on purpose, telling the reader
// that the mechanism arm (B) needs revisiting.
// ---------------------------------------------------------------------------
test('R547/C — index.js still splits the buffer on \'\\n\' and pops the tail (the shape that drops requests)', () => {
  assert.match(INDEX_SRC, /buffer\s*\+=\s*chunk/,
    'the buffer accumulation shape should still be present');
  assert.match(INDEX_SRC, /buffer\.split\('\\n'\)/,
    'the split-on-newline shape should still be present');
  assert.match(INDEX_SRC, /buffer\s*=\s*lines\.pop\(\)/,
    'the pop-the-tail shape should still be present');
});

// ---------------------------------------------------------------------------
// Arm D — the NEGATIVE control.
//
// The same arithmetic, fed a value that DOES contain a newline, must produce
// exactly one line to handle. If this control does not fire, the probe is
// broken and arms A/B prove nothing (the R497 lesson: a control that cannot
// fail is not a control).
// ---------------------------------------------------------------------------
test('R547/D — negative control: a chunk containing \'\\n\' DOES produce a line to handle', () => {
  let buffer = '';
  buffer += '{"a":1}\n{"b":2}';
  const lines = buffer.split('\n');
  const popped = lines.pop();
  assert.strictEqual(lines.length, 1,
    'control: a newline-bearing chunk must yield exactly one handleable line');
  assert.strictEqual(lines[0], '{"a":1}');
  assert.strictEqual(popped, '{"b":2}');
});

// ---------------------------------------------------------------------------
// Arm E — the REPAIR witness.
//
// If the loop is ever repaired, this arm must go RED, because it asserts the
// DEFECT IS STILL PRESENT. A repair that leaves this arm green means the
// defect is still there and only the symptoms moved.
//
// In other words: this arm is the "did we actually fix it" tripwire.
// ---------------------------------------------------------------------------
test('R547/E — repair tripwire: the defect is STILL present (this arm goes RED once the loop is fixed)', () => {
  const hasSplit = /buffer\.split\('\\n'\)/.test(INDEX_SRC);
  const hasPop = /buffer\s*=\s*lines\.pop\(\)/.test(INDEX_SRC);
  assert.ok(
    hasSplit && hasPop,
    'the split+pop shape is gone — the read loop appears repaired. ' +
    'Arms A/A2 should now be GREEN and this tripwire is EXPECTED to fail.',
  );
});
