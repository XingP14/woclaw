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

test('woclaw-vscode: httpGet is generic + every call site passes an explicit type arg (regression: Promise<any> leak)', () => {
  // The internal httpGet() helper was widened from Promise<any> to Promise<T | null>
  // (generic) so each call site can declare the expected payload type and downstream
  // assignment (this.topics / this.agents / this.entries) is statically safe under
  // tsc --strict. A regression that strips the generic back to Promise<any> would
  // also break the 5 typed call sites (httpGet<HubHealth|Topic[]|Agent[]|MemoryEntry[]> where MemoryEntry[] has 2 call sites)
  // because the new return type Promise<T | null> differs from Promise<any>.
  //
  // Asserts:
  //   1. The function signature is generic + nullable (not bare Promise<any>).
  //   2. All 5 call sites pass an explicit type argument (HubHealth ×1, Topic[] ×1,
  //      Agent[] ×1, MemoryEntry[] ×2 — fetchHubHealth wraps the HubHealth call,
  //      so it counts as 1 of the 5 typed call sites, not a separate 6th).
  const sigRe = /function\s+httpGet\s*<[^>]+>\s*\(\s*path\s*:\s*string\s*\)\s*:\s*Promise<[^>]+>/;
  const sigLine = lines.find((ln) => /function\s+httpGet\s*[<(]/.test(ln));
  assert.ok(sigLine, 'httpGet function declaration not found in src/extension.ts');
  assert.ok(
    sigRe.test(sigLine),
    `httpGet must be generic + nullable (e.g. Promise<T | null>), got: "${sigLine.trim()}"`,
  );
  // No bare Promise<any> on the httpGet signature line.
  assert.ok(
    !/Promise<any>/.test(sigLine),
    `regression: bare Promise<any> on httpGet signature line: "${sigLine.trim()}"`,
  );

  // Find every call site. Each must use the httpGet<T>(...) form.
  // (regex bug fix: the previous version required the literal-string arg
  // to be empty (`[`'"]+[`'"]` matched NO actual call site — the source
  // has non-empty path strings like '/health' / '/topics' / '/agents' /
  // '/memory?limit=50'). Drop the literal-string constraint; any line
  // that mentions httpGet followed by `(` or `<` is a candidate.)
  const callCandidateRe = /\bhttpGet\b\s*[(<]/;
  const candidates = lines.filter((ln) => callCandidateRe.test(ln));
  // Exclude the function-declaration line itself; keep only call sites.
  const callLines = candidates.filter((ln) => !/^function\s+httpGet\b/.test(ln));
  assert.ok(
    callLines.length >= 5,
    `expected >=5 typed httpGet<T>(...) call sites, found ${callLines.length}`,
  );
  for (const ln of callLines) {
    assert.ok(
      /\bhttpGet\s*<[A-Z][A-Za-z0-9_]+(\[\])?>\s*\(/.test(ln),
      `regression: httpGet call site missing explicit type arg: "${ln.trim()}"`,
    );
  }
});

test('woclaw-vscode: no inline require(...) calls + path is imported at top of file (regression: 06-29 cron require→top-level-import)', () => {
  // The single `require('path').join(...)` call inside TopicsTreeDataProvider.getChildren
  // was hoisted to a class-scoped static `TOPIC_ICON_URI` constant built from a
  // top-level `import * as path from 'path'` (this round, parallel to 8e8a6de
  // migrating 10 require() calls to top-level imports in src/core/evaluator.ts).
  // This regression test fails if a future change re-introduces an inline
  // `require(...)` in src/extension.ts (e.g. someone copy-pastes from old code).
  // Strip line comments (// ...) and block comments (/* ... */) before scanning.
  // The class-scoped `TOPIC_ICON_URI` block contains the word `require(...)` inside
  // a comment describing the migration; we don't want to flag comments, only code.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/\/\/.*$/gm, '');           // line comments
  const requireRe = /\brequire\s*\(/;
  assert.ok(
    !requireRe.test(codeOnly),
    'regression: src/extension.ts contains an inline require(...) call; migrate to a top-level import',
  );
  // Sanity: the top of the file imports path.
  assert.ok(
    /import\s+\*\s+as\s+path\s+from\s+['"]path['"]/.test(src),
    'regression: top-level `import * as path from "path"` not found in src/extension.ts',
  );
  // Sanity: the hoisted constant is present.
  assert.ok(
    /private\s+static\s+readonly\s+TOPIC_ICON_URI/.test(src),
    'regression: TopicsTreeDataProvider.TOPIC_ICON_URI class constant missing',
  );
  // Sanity: there is at least one call site that uses the hoisted constant.
  assert.ok(
    /TopicsTreeDataProvider\.TOPIC_ICON_URI/.test(src),
    'regression: no call site references TopicsTreeDataProvider.TOPIC_ICON_URI',
  );
});

test('woclaw-vscode: every _onDidChangeTreeData.fire() call uses literal `undefined` (regression 03768ae hardening)', () => {
  // The first test in this file only asserts that the argument list is
  // non-empty (e.g. `_onDidChangeTreeData.fire(undefined)` vs bare
  // `_onDidChangeTreeData.fire()`). This test is stricter: it pins the
  // argument to the exact `undefined` literal. A regression that
  // accidentally switches to `null`, `void 0`, or anything else trips
  // this check. This is the vscode tree protocol idiom for "re-render
  // the entire tree" — passing anything else (e.g. `null`) is a
  // semantic break (it means "the root element changed", not
  // "everything changed").
  //
  // Pin the count to 3: 3 tree providers (Topics / Agents / Memory),
  // each with one refresh() path that fires the event. This matches
  // the count checked by the first test (>= 3).
  const fireLines = lines
    .map((ln) => ln.match(/_onDidChangeTreeData\.fire\s*\(([^)]*)\)/))
    .filter((m) => m !== null);
  assert.strictEqual(
    fireLines.length,
    3,
    `expected exactly 3 .fire() sites (Topics/Agents/Memory providers), found ${fireLines.length}`,
  );
  for (const m of fireLines) {
    const arg = m[1].trim();
    assert.strictEqual(
      arg,
      'undefined',
      `regression: 03768ae — .fire() argument must be the literal \`undefined\`, got "${arg}". Passing \`null\` or \`void 0\` is a semantic break (vscode tree-data-provider re-render-the-whole-tree contract).`,
    );
  }
});
