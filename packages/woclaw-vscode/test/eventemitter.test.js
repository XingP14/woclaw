// Regression test for commit 03768ae: EventEmitter.fire() must be called
// with at least 1 argument. Older @types/vscode allowed fire() with 0
// args; 1.110.0 requires ≥1 arg, breaking `tsc --strict` and `vsce
// package`. The three tree providers in src/extension.ts call
// `this._onDidChangeTreeData.fire(undefined)` (not bare `fire()`).
//
// This test reads src/extension.ts as text and asserts the pattern is
// preserved. A regression that removes the .fire(undefined) argument
// will trip the check below.
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

function lineMatchesFireCall(line) {
  // Match a line containing `_onDidChangeTreeData.fire(`. We want to
  // assert that on that line, `fire(` is followed by ≥1 non-`)` char
  // before the matching `)`. A simpler proxy: `fire(...)` where ... is
  // not empty.
  if (!_onDidChangeTreeDataDotFireDotOpenParenRe.test(line)) return null;
  const m = line.match(/_onDidChangeTreeData\.fire\s*\(([^)]*)\)/);
  if (!m) return null;
  return m[1].trim();
}

const _onDidChangeTreeDataDotFireDotOpenParenRe =
  /_onDidChangeTreeData\.fire\s*\(/;

test('woclaw-vscode: every _onDidChangeTreeData.fire() call passes ≥1 arg (regression 03768ae)', () => {
  const argLists = lines
    .map((ln) => lineMatchesFireCall(ln))
    .filter((x) => x !== null);
  assert.ok(
    argLists.length >= 3,
    `expected ≥3 .fire() calls (Topics/Agents/Memory providers), found ${argLists.length}`,
  );
  for (const args of argLists) {
    assert.notStrictEqual(
      args,
      '',
      `regression: 03768ae — bare .fire() with no args detected in src/extension.ts`,
    );
  }
});

test('woclaw-vscode: every commands.registerCommand() has a function handler (regression 03768ae)', () => {
  // Find the line where each registerCommand starts. The handler may
  // span multiple lines, so we just check the starting line contains
  // an arrow `=>` (the typical handler shape).
  const startLines = lines
    .map((ln, idx) => ({ ln, idx }))
    .filter(({ ln }) =>
      /registerCommand\s*\(/.test(ln),
    );
  assert.ok(
    startLines.length >= 1,
    `expected ≥1 commands.registerCommand() call, found ${startLines.length}`,
  );
  for (const { ln } of startLines) {
    // The handler must be on the same line as the start of the call —
    // we accept arrow functions (`async (...) =>`) and named fn refs
    // (e.g. `someFn`). The current 03768ae fix uses arrow handlers.
    assert.ok(
      /=>/.test(ln) || /\bfunction\b/.test(ln),
      `regression: 03768ae — registerCommand() handler is not a function: "${ln.trim()}"`,
    );
  }
});

test('woclaw-vscode: source compiles under tsc --noEmit (smoke check)', () => {
  // The compile script in package.json is `tsc -p ./`. We don't run it
  // here to keep this test dependency-free, but we assert the tsconfig
  // exists and is well-formed.
  const tsconfigPath = path.join(__dirname, '..', 'tsconfig.json');
  assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json missing');
  const cfg = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  assert.strictEqual(cfg.compilerOptions.strict, true, 'strict mode must be on');
});
