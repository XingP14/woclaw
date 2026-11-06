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
  // Match a line containing the tree event emitter's fire call and capture
  // its arguments. The emitter lives behind treeEvents after helper extraction.
  const m = line.match(/treeEvents\.emitter\.fire\s*\(([^)]*)\)/);
  if (!m) return null;
  return m[1].trim();
}

test('woclaw-vscode: every treeEvents.emitter.fire() call passes at least 1 arg (regression 03768ae)', () => {
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
  // also break the typed call sites because the new return type Promise<T | null>
  // differs from Promise<any>.
  //
  // R534 UPDATE: the call-site type arguments changed, because the old ones
  // were WRONG. The extension used to assert `httpGet<Topic[]>('/topics')` —
  // a bare-array claim — while the Hub actually serves an ENVELOPE
  // `{topics:[...]}`. The assertion was never checked, so it compiled and
  // shipped, and the tree providers then called `.map()` on an object
  // ("t.map is not a function"). The contract now lives in src/hub-api.ts and
  // is pinned against the REAL Hub by
  // integration-test/vscode-hub-contract.test.ts.
  //
  // The gate that still matters here is the GENERIC-ness of httpGet (no
  // Promise<any> leak) plus the fact that every call site still carries an
  // explicit type argument. The specific type arguments are now:
  //   HubHealthBody ×1 (/health — the one flat, un-enveloped endpoint)
  //   unknown     ×4 (the four envelope endpoints — the narrowing happens at
  //                runtime inside hub-api.ts, because asserting a type at
  //                the call site is precisely the bug this round fixes)
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
      /\bhttpGet\s*<(unknown|[A-Z][A-Za-z0-9_]+(\[\])?)>\s*\(/.test(ln),
      `regression: httpGet call site missing explicit type arg: "${ln.trim()}"`,
    );
  }
});

test('R534: the extension does NOT assert a payload type at the call site (it unwraps at runtime)', () => {
  // The regression that this whole round is about: a type assertion at a call
  // site is a CLAIM, and the claim was wrong on all four endpoints. The
  // envelope endpoints must be fetched as `unknown` and narrowed by the
  // runtime unwrappers in src/hub-api.ts.
  //
  // Only /health may carry a concrete type argument — it is the one endpoint
  // the Hub serves UN-enveloped.
  for (const ln of lines) {
    const m = ln.match(/\bhttpGet\s*<([^>]*)>\s*\(\s*'([^']*)'/);
    if (!m) continue;
    const [, typeArg, url] = m;
    if (url === '/health') {
      assert.strictEqual(
        typeArg,
        'HubHealthBody',
        `the /health call site must keep its concrete type argument, got: ${typeArg}`,
      );
      continue;
    }
    assert.strictEqual(
      typeArg,
      'unknown',
      `R534 regression: the ${url} call site asserts \`${typeArg}\` at the call site. `
      + 'The Hub serves an ENVELOPE there, so the payload type must be narrowed at '
      + 'runtime by src/hub-api.ts, not asserted here.',
    );
  }
});

test('R534: the four envelope endpoints are unwrapped by the runtime helpers, not assigned raw', () => {
  // The unwrapping must be visible in the source: a bare assignment of the
  // httpGet result into the provider's array field is exactly the bug.
  // Each envelope endpoint's fetch must go through an extract*() helper.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // /topics and /memory must be wrapped in their extractor.
  assert.match(
    codeOnly,
    /this\.topics\s*=\s*extractTopics\(/,
    'R534 regression: topics are assigned without extractTopics() — the raw envelope would be used as an array',
  );
  assert.match(
    codeOnly,
    /this\.entries\s*=\s*q\s*\?\s*all\.filter\(/,
    'R534 regression: memory entries are not filtered from an extracted array',
  );
  assert.match(
    codeOnly,
    /const all = extractMemory\(/,
    'R534 regression: memory is fetched without extractMemory()',
  );
  assert.match(
    codeOnly,
    /this\.agents\s*=\s*extractAgents\(/,
    'R534 regression: agents are assigned without extractAgents() — the raw envelope would be used as an array',
  );

  // And the raw-body anti-pattern must be gone entirely.
  assert.ok(
    !/await\s+httpGet<[^>]*>\(\s*'\/(topics|agents|memory)[^']*'\s*\)\s*\|\|\s*\[\]/.test(codeOnly),
    'R534 regression: an envelope endpoint is still assigned raw with `|| []`',
  );
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

test('woclaw-vscode: every treeEvents.emitter.fire() call uses literal `undefined` (regression 03768ae hardening)', () => {
  // The first test in this file only asserts that the argument list is
  // non-empty (e.g. `treeEvents.emitter.fire(undefined)` vs bare
  // `treeEvents.emitter.fire()`). This test is stricter: it pins the
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
    .map((ln) => ln.match(/treeEvents\.emitter\.fire\s*\(([^)]*)\)/))
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

test('woclaw-vscode: createTreeEvents<T>() centralizes EventEmitter creation + event exposure', () => {
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert.match(
    codeOnly,
    /function\s+createTreeEvents\s*<\s*T\s*>\s*\(\s*\)\s*:\s*\{\s*emitter\s*:\s*vscode\.EventEmitter\s*<\s*T\s*>\s*;\s*event\s*:\s*vscode\.Event\s*<\s*T\s*>\s*\}/,
    'createTreeEvents<T>() must expose a typed emitter and its matching event',
  );
  assert.match(
    codeOnly,
    /const\s+emitter\s*=\s*new\s+vscode\.EventEmitter\s*<\s*T\s*>\s*\(\s*\)\s*;/,
    'createTreeEvents<T>() must construct the EventEmitter exactly once',
  );
  assert.match(
    codeOnly,
    /return\s*\{\s*emitter\s*,\s*event\s*:\s*emitter\.event\s*\}\s*;/,
    'createTreeEvents<T>() must return the event owned by the same emitter',
  );
});

test('woclaw-vscode: all 3 providers use createTreeEvents<vscode.TreeItem | undefined>()', () => {
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const providerClasses = [
    'TopicsTreeDataProvider',
    'AgentsTreeDataProvider',
    'MemoryTreeDataProvider',
  ];

  for (const [index, className] of providerClasses.entries()) {
    const nextClass = providerClasses[index + 1];
    const start = codeOnly.indexOf(`class ${className}`);
    assert.ok(start >= 0, `${className} declaration not found`);
    const end = nextClass
      ? codeOnly.indexOf(`class ${nextClass}`, start)
      : codeOnly.indexOf('export function activate', start);
    const block = codeOnly.slice(start, end > start ? end : undefined);
    assert.match(
      block,
      /private\s+readonly\s+treeEvents\s*=\s*createTreeEvents\s*<\s*vscode\.TreeItem\s*\|\s*undefined\s*>\s*\(\s*\)\s*;/,
      `${className} must create one typed treeEvents pair`,
    );
    assert.match(
      block,
      /readonly\s+onDidChangeTreeData\s*=\s*this\.treeEvents\.event\s*;/,
      `${className} must expose the helper-owned event`,
    );
    assert.match(
      block,
      /this\.treeEvents\.emitter\.fire\s*\(\s*undefined\s*\)/,
      `${className} refresh path must fire undefined through the helper-owned emitter`,
    );
  }

  assert.strictEqual(
    (codeOnly.match(/createTreeEvents\s*<\s*vscode\.TreeItem\s*\|\s*undefined\s*>\s*\(\s*\)/g) || []).length,
    3,
    'expected one createTreeEvents call per Topics/Agents/Memory provider',
  );
  assert.strictEqual(
    (codeOnly.match(/new\s+vscode\.EventEmitter/g) || []).length,
    1,
    'only createTreeEvents<T>() may construct a vscode.EventEmitter',
  );
});
