// Regression test for chain #24 — woclaw-vscode config-helper constants.
//
// The `getHubUrl()` helper at packages/woclaw-vscode/src/extension.ts:14
// falls back to a hard-coded default of `http://localhost:8083` when the
// user has not configured `woclaw.hubUrl` in their VS Code settings. The
// 5000ms request timeout at L30 (`req.setTimeout(5000, ...)`) is the
// hard cap for any single HTTP request the extension issues.
//
// Both values are silent drift risks: a refactor that re-routes the
// default URL to a different host (e.g. localhost:8084, http://127.0.0.1)
// or changes the timeout (e.g. 3000 / 10000) would compile cleanly under
// tsc but break local development silently. This test pins both values
// to the chain #24 anchor (12-gate suite + extension.ts source).
//
// Strategy: read src/extension.ts as text and assert:
//   1. `getHubUrl` helper is declared as a function with a string return.
//   2. The fallback default `http://localhost:8083` is present (L14 of
//      src/extension.ts).
//   3. The `req.setTimeout(5000, ...)` call is present at L30.
//   4. The `req.destroy()` is called inside the setTimeout callback (so
//      the request is actually aborted on timeout, not just abandoned).
//   5. The `resolve(null)` pattern is used for all 3 failure paths
//      (setTimeout, req.on('error'), res.on('end') JSON.parse catch) —
//      pins the "errors degrade to null, never throw" contract.
//   6. The 3 tree providers (Topics / Agents / Memory) each call
//      `_onDidChangeTreeData.fire(undefined)` after their `await httpGet<>(...)`
//      refresh — pins the 03768ae EventEmitter.fire() arg-signature
//      parity across the 3 providers.
//   7. The deactivate() function calls `clearInterval(pollTimer)` and
//      `statusBarItem?.dispose()` — pins the dispose-chain contract so
//      reactivation doesn't leak timers/status-bar items.
//   8. The `q !== undefined` guard wraps the `memoryProvider.search(q)`
//      call inside the `woclaw.memorySearch` command handler — pins
//      the "user-cancelled input box" semantics (input box returns
//      undefined when dismissed, which must NOT trigger a blank
//      search that wipes the existing entries list).
//
// Runs under `node --test` (Node 18+) — no extra devDeps needed.
// Mirrors test/eventemitter.test.js + test/http_get_res_typed.test.js
// structure. Pre-fix verified-failing via revert test on gates 1-7.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'extension.ts');
const PKG = path.join(__dirname, '..', 'package.json');
const src = fs.readFileSync(SRC, 'utf8');
const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));

// Strip line + block comments before scanning — comment text describing
// the contract would otherwise be a false positive.
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

test('woclaw-vscode: getHubUrl() helper declared as function returning string (regression #24)', () => {
  // Pin the function signature so a future refactor that renames the
  // helper, drops the return type, or replaces it with an inline
  // `vscode.workspace.getConfiguration(...).get<string>(...)` call
  // would trip the gate.
  const m = codeOnly.match(/function\s+getHubUrl\s*\(\s*\)\s*:\s*string/);
  assert.ok(
    m,
    'expected `function getHubUrl(): string` declaration in src/extension.ts (chain #24)',
  );
});

test('woclaw-vscode: getHubUrl() fallback default is `http://localhost:8083` (regression #24)', () => {
  // Pin the literal fallback string. Changing the default port (e.g. to
  // 8084) or host (e.g. to 127.0.0.1) would silently break local dev
  // because the package.json `contributes.configuration.properties.
  // woclaw.hubUrl.default` is `"http://localhost:8083"` and the
  // `vscode.workspace.getConfiguration(...).get<string>('hubUrl')`
  // call returns undefined when unset, which triggers the `||` fallback.
  assert.ok(
    src.includes("'http://localhost:8083'"),
    'expected literal `http://localhost:8083` fallback in src/extension.ts (chain #24)',
  );
});

test('woclaw-vscode: req.setTimeout(5000, ...) call site is present (regression #24)', () => {
  // Pin the 5000ms request timeout. The exact pattern is
  //   req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  // located at L30 of src/extension.ts. A regression that changes the
  // timeout to 3000 / 10000 or removes the timeout entirely would
  // silently affect UX (user waits longer on unresponsive hub, or
  // requests bail too early).
  const m = codeOnly.match(/req\.setTimeout\(\s*5000\s*,\s*\(/);
  assert.ok(
    m,
    'expected `req.setTimeout(5000, ...)` call site in src/extension.ts (chain #24)',
  );
});

test('woclaw-vscode: setTimeout callback calls req.destroy() + resolve(null) (regression #24)', () => {
  // Pin that the timeout callback actually aborts the in-flight request
  // via `req.destroy()` (not just calls `resolve(null)` and leaves the
  // request hanging). The 3-failure-path pattern (setTimeout / req.on
  // error / res.on end JSON.parse catch) is also pinned.
  const setTimeoutBlockRe =
    /req\.setTimeout\(\s*5000\s*,\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)/;
  const m = codeOnly.match(setTimeoutBlockRe);
  assert.ok(m, 'expected req.setTimeout(5000, () => {...}) block to extract');
  const body = m[1];
  assert.ok(
    /req\.destroy\s*\(\s*\)/.test(body),
    'req.setTimeout callback must call `req.destroy()` to actually abort the request (chain #24)',
  );
  assert.ok(
    /resolve\s*\(\s*null\s*\)/.test(body),
    'req.setTimeout callback must call `resolve(null)` (chain #24)',
  );
});

test('woclaw-vscode: all 3 httpGet failure paths resolve(null) (regression #24)', () => {
  // The httpGet function has 3 failure paths, each must resolve(null),
  // never reject — the 3 callers (fetchHubHealth, Topics.refresh,
  // Agents.refresh, Memory.search) all handle `null` via the
  // `await httpGet<T>(...) || []` pattern.
  //
  // 1. setTimeout (test above)
  // 2. req.on('error', () => resolve(null))
  // 3. res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
  assert.ok(
    /req\.on\(\s*['"]error['"]\s*,\s*\(\s*\)\s*=>\s*resolve\s*\(\s*null\s*\)\s*\)/.test(codeOnly),
    'expected `req.on("error", () => resolve(null))` pattern (chain #24)',
  );
  // For the JSON.parse catch path, we look for `resolve(null)` inside
  // the catch block of the res.on('end') handler.
  const jsonParseCatchRe =
    /res\.on\(\s*['"]end['"]\s*,[^{]*\{[\s\S]*?try\s*\{[\s\S]*?resolve\s*\(\s*JSON\.parse[\s\S]*?\}[^{]*catch[^{]*\{[\s\S]*?resolve\s*\(\s*null\s*\)/;
  assert.ok(
    jsonParseCatchRe.test(codeOnly),
    'expected `res.on("end", ... try { resolve(JSON.parse(...)) } catch { resolve(null) })` pattern (chain #24)',
  );
});

test('woclaw-vscode: 3 tree providers each call treeEvents.emitter.fire(undefined) (regression #24 + 03768ae parity)', () => {
  // Pins the 03768ae EventEmitter.fire() arg-signature parity across
  // the 3 tree providers (Topics / Agents / Memory) — complements
  // test/eventemitter.test.js which also pins the createTreeEvents helper.
  // Each provider's refresh() / search() path must fire the helper-owned
  // emitter with literal undefined to request a whole-tree re-render.
  const fireUndefinedRe = /this\.treeEvents\.emitter\.fire\(\s*undefined\s*\)\s*;/g;
  const matches = codeOnly.match(fireUndefinedRe) || [];
  assert.strictEqual(
    matches.length,
    3,
    `expected exactly 3 \`this.treeEvents.emitter.fire(undefined);\` call sites (Topics/Agents/Memory), found ${matches.length} (chain #24 + 03768ae parity)`,
  );
});

test('woclaw-vscode: deactivate() calls clearInterval(pollTimer) + statusBarItem?.dispose() (regression #24)', () => {
  // Pin the dispose-chain contract. Without these calls, re-activating
  // the extension would leak the poll interval timer AND the
  // statusBarItem — visible as a duplicate status bar entry after
  // each window reload. Note: pollTimer might be null (lazy init), so
  // the `if (pollTimer)` guard must wrap `clearInterval`.
  const deactivateRe = /export\s+function\s+deactivate\s*\(\s*\)\s*\{([\s\S]*?)\n\}/;
  const m = codeOnly.match(deactivateRe);
  assert.ok(m, 'expected `export function deactivate() { ... }` to extract');
  const body = m[1];
  assert.ok(
    /if\s*\(\s*pollTimer\s*\)\s*clearInterval\s*\(\s*pollTimer\s*\)/.test(body),
    'deactivate() must call `if (pollTimer) clearInterval(pollTimer)` to drain the poll timer (chain #24)',
  );
  assert.ok(
    /statusBarItem\s*\?\s*\.\s*dispose\s*\(\s*\)/.test(body),
    'deactivate() must call `statusBarItem?.dispose()` to release the status bar item (chain #24)',
  );
});

test('woclaw-vscode: woclaw.memorySearch command guards with `q !== undefined` before search() (regression #24)', () => {
  // Pin the "user-cancelled input box" semantics. `vscode.window.showInputBox`
  // returns `undefined` when the user dismisses the dialog (clicks X or
  // presses Escape). A naive `memoryProvider.search(q)` call would
  // wipe the existing entries list and force a re-fetch with q=''.
  // The `if (q !== undefined)` guard preserves the previous query state.
  // Note: the check is for `q !== undefined` (NOT `q != null` / `q`),
  // because the empty string IS a valid user-typed query that should
  // re-fetch all entries.
  const memorySearchCmdRe =
    /vscode\.commands\.registerCommand\(\s*['"]woclaw\.memorySearch['"]\s*,[\s\S]*?if\s*\(\s*q\s*!==\s*undefined\s*\)\s*memoryProvider\.search\s*\(\s*q\s*\)/;
  assert.ok(
    memorySearchCmdRe.test(codeOnly),
    'expected `if (q !== undefined) memoryProvider.search(q)` guard inside `woclaw.memorySearch` command handler (chain #24)',
  );
});

test('woclaw-vscode: package.json contributes.configuration.properties.woclaw.hubUrl.default matches src/extension.ts fallback (regression #24)', () => {
  // Cross-check between the manifest default and the in-source fallback.
  // The package.json `woclaw.hubUrl.default` is what shows up in the
  // VS Code Settings UI when the user clicks "Reset Setting" — it must
  // match the in-source `|| 'http://localhost:8083'` fallback so that
  // "Reset" still works.
  const defaultInManifest = pkg.contributes?.configuration?.properties?.['woclaw.hubUrl']?.default;
  assert.strictEqual(
    defaultInManifest,
    'http://localhost:8083',
    'package.json contributes.configuration.properties.woclaw.hubUrl.default must be `http://localhost:8083` (chain #24)',
  );
});
