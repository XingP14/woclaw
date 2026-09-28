// Regression test for chain #26 — woclaw-vscode tree-item rendering +
// status-bar opt-out gates.
//
// The three TreeDataProviders in src/extension.ts build user-visible
// vscode.TreeItem objects (label / iconPath / tooltip / description /
// contextValue / collapsibleState). Those literals were only covered
// indirectly: chain #25 pins the command-dispatch surface of activate(),
// chain #18 pins formatHubStatusBar, and the httpGet tests pin the
// transport. A silent edit to a tooltip template (e.g. dropping the
// `…` truncation suffix, or joining topics with ' / ' instead of ', ')
// would change what the user sees without failing any test.
//
// Likewise updateStatusBar's early-return branch — `statusBar: false`
// hides the item and returns before any HTTP request is issued — had no
// gate at all, so a refactor could delete the early return and start
// polling the Hub even when the user disabled the status bar.
//
// This test reads src/extension.ts as text and pins 6 gates:
//   1. updateStatusBar reads the `statusBar` config key and early-returns
//      with `statusBarItem.hide()` BEFORE `fetchHubHealth()` is called.
//   2. AgentsTreeDataProvider.getChildren labels items with `a.id`,
//      uses ThemeIcon('hubot'), and formats the tooltip from
//      `new Date(a.connectedAt).toLocaleString()` + `a.topics.join(', ')`.
//   3. TopicsTreeDataProvider.getChildren stamps contextValue 'topic'
//      on every top-level item and sets collapsibleState = Expanded.
//   4. MemoryTreeDataProvider.getChildren uses ThemeIcon('symbol-key'),
//      truncates the tooltip at 120 chars and the description at 60
//      chars, both with the `…` (U+2026) suffix.
//   5. MemoryTreeDataProvider.search lower-cases BOTH the query and the
//      key/value before matching (case-insensitive filter contract).
//   6. All three providers set iconPath for their items — a provider
//      that stops setting iconPath renders as a blank row.
//
// Runs under `node --test` (Node 18+) — no extra devDeps needed.
// Mirrors test/commands_dispatch_parity.test.js (chain #25) structure.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'extension.ts');
const src = fs.readFileSync(SRC, 'utf8');
const codeOnly = src
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
  .replace(/\/\/.*$/gm, '');           // line comments

// Slice a class body: from `class <Name>` to the matching closing brace
// at column 0 (`\n}`), which is the file's class-body terminator style.
function sliceClass(name) {
  const start = codeOnly.indexOf(`class ${name} `);
  if (start === -1) return null;
  const end = codeOnly.indexOf('\n}\n', start);
  if (end === -1) return null;
  return codeOnly.slice(start, end);
}

function sliceFunction(sigRe) {
  const m = codeOnly.match(sigRe);
  if (!m) return null;
  // Balanced-brace scan from the match start.
  let i = codeOnly.indexOf('{', m.index);
  let depth = 0;
  for (let j = i; j < codeOnly.length; j++) {
    if (codeOnly[j] === '{') depth++;
    else if (codeOnly[j] === '}') {
      depth--;
      if (depth === 0) return codeOnly.slice(m.index, j + 1);
    }
  }
  return null;
}

test('woclaw-vscode: updateStatusBar hides + returns before fetchHubHealth when statusBar=false (chain #26)', () => {
  const body = sliceFunction(/async\s+function\s+updateStatusBar\s*\(\s*\)/);
  assert.ok(body, 'expected `async function updateStatusBar()` to extract');
  const hideIdx = body.indexOf('statusBarItem.hide()');
  const fetchIdx = body.indexOf('fetchHubHealth(');
  assert.ok(hideIdx !== -1, 'updateStatusBar must call statusBarItem.hide() on the statusBar=false branch');
  assert.ok(fetchIdx !== -1, 'updateStatusBar must call fetchHubHealth() on the enabled branch');
  assert.ok(
    hideIdx < fetchIdx,
    'statusBar=false must early-return (hide) BEFORE any Hub HTTP request is issued',
  );
  assert.ok(
    /if\s*\(\s*!\s*cfg\.get<boolean>\(\s*'statusBar'\s*\)\s*\)/.test(body),
    "updateStatusBar must gate on the `statusBar` config key",
  );
});

test('woclaw-vscode: AgentsTreeDataProvider items carry id label + hubot icon + joined-topic tooltip (chain #26)', () => {
  const cls = sliceClass('AgentsTreeDataProvider');
  assert.ok(cls, 'expected `class AgentsTreeDataProvider` to extract');
  assert.match(cls, /new\s+vscode\.TreeItem\(\s*a\.id\s*\)/, 'agent TreeItem label must be a.id');
  assert.match(cls, /new\s+vscode\.ThemeIcon\(\s*'hubot'\s*\)/, 'agent TreeItem must use ThemeIcon(\'hubot\')');
  assert.match(
    cls,
    /new\s+Date\(\s*a\.connectedAt\s*\)\.toLocaleString\(\)/,
    'agent tooltip must render connectedAt via toLocaleString()',
  );
  assert.match(
    cls,
    /a\.topics\.join\(\s*',\s*'\s*\)/,
    "agent tooltip must join topics with ', '",
  );
  assert.match(cls, /item\.tooltip\s*=/, 'agent TreeItem must set a tooltip');
});

test('woclaw-vscode: TopicsTreeDataProvider stamps contextValue topic + Expanded collapsibleState (chain #26)', () => {
  const cls = sliceClass('TopicsTreeDataProvider');
  assert.ok(cls, 'expected `class TopicsTreeDataProvider` to extract');
  assert.match(cls, /item\.contextValue\s*=\s*'topic'/, "topic TreeItem must set contextValue='topic'");
  assert.match(
    cls,
    /item\.collapsibleState\s*=\s*vscode\.TreeItemCollapsibleState\.Expanded/,
    'topic TreeItem must be Expanded so agents render as children',
  );
  assert.match(
    cls,
    /el\.contextValue\s*===\s*'topic'/,
    "getChildren must branch on el.contextValue === 'topic'",
  );
});

test('woclaw-vscode: MemoryTreeDataProvider truncates tooltip@120 + description@60 with U+2026 (chain #26)', () => {
  const cls = sliceClass('MemoryTreeDataProvider');
  assert.ok(cls, 'expected `class MemoryTreeDataProvider` to extract');
  assert.match(
    cls,
    /new\s+vscode\.ThemeIcon\(\s*'symbol-key'\s*\)/,
    "memory TreeItem must use ThemeIcon('symbol-key')",
  );
  assert.match(
    cls,
    /item\.tooltip\s*=\s*`\$\{m\.value\.substring\(0,\s*120\)\}\$\{m\.value\.length\s*>\s*120\s*\?\s*'…'\s*:\s*''\}/,
    'memory tooltip must truncate at 120 chars with the … suffix',
  );
  assert.match(
    cls,
    /item\.description\s*=\s*m\.value\.substring\(0,\s*60\)\s*\+\s*\(\s*m\.value\.length\s*>\s*60\s*\?\s*'…'\s*:\s*''\s*\)/,
    'memory description must truncate at 60 chars with the … suffix',
  );
  assert.match(cls, /m\.tags\.join\(\s*',\s*'\s*\)/, "memory tooltip must join tags with ', '");
});

test('woclaw-vscode: MemoryTreeDataProvider.search lower-cases query + key + value (chain #26)', () => {
  const cls = sliceClass('MemoryTreeDataProvider');
  assert.ok(cls, 'expected `class MemoryTreeDataProvider` to extract');
  assert.match(cls, /q\.toLowerCase\(\)/, 'search must lower-case the query');
  assert.match(cls, /m\.key\.toLowerCase\(\)/, 'search must lower-case the entry key');
  assert.match(cls, /m\.value\.toLowerCase\(\)/, 'search must lower-case the entry value');
  assert.match(
    cls,
    /await\s+httpGet<MemoryEntry\[\]>\(\s*'\/memory\?limit=50'\s*\)/,
    'search must fetch /memory?limit=50 with an explicit MemoryEntry[] type arg',
  );
});

test('woclaw-vscode: all 3 providers set iconPath on every rendered item (chain #26)', () => {
  for (const name of ['TopicsTreeDataProvider', 'AgentsTreeDataProvider', 'MemoryTreeDataProvider']) {
    const cls = sliceClass(name);
    assert.ok(cls, `expected class ${name} to extract`);
    assert.match(cls, /iconPath\s*=/, `${name} must set iconPath on its TreeItems`);
  }
});
