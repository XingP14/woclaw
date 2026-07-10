// Regression test for chain #25 — woclaw-vscode command-dispatch parity.
//
// Pin 9 textual gates on the activate() command-dispatch surface of
// packages/woclaw-vscode/src/extension.ts so silent drift on any of
// these surfaces is caught at `node --test` time:
//   1. exactly 3 `registerTreeDataProvider('woclaw-<id>', provider)` calls
//      with IDs `woclaw-topics` + `woclaw-agents` + `woclaw-memory`
//      (the 3 views declared in package.json#contributes.views.woclaw-explorer).
//   2. the 3 initial-load `void <provider>.<method>(...)` calls in
//      order: `topicsProvider.refresh()` → `agentsProvider.refresh()` →
//      `memoryProvider.search('')`. The empty-string argument pins the
//      "load all entries on activation" contract; swapping to a query
//      would break viewsWelcome until the user types something.
//   3. exactly 3 `registerCommand('woclaw.<name>', ...)` calls with
//      names `woclaw.showDashboard` + `woclaw.refreshAll` +
//      `woclaw.memorySearch`. These match the 2 entries in
//      package.json#contributes.commands plus the showDashboard command
//      that is bound to the status bar but not in the command palette.
//   4. `woclaw.showDashboard` has a 2-branch dispatch on `if (health)`:
//      health truthy → `showInformationMessage('WoClaw Hub: ... agents,
//      ... topics — ...', { modal: false })`; falsy →
//      `showWarningMessage('WoClaw Hub unreachable at ...')`. The
//      `modal: false` flag must be present so the toast is non-blocking.
//   5. `woclaw.refreshAll` invokes 3 things in order: `await
//      updateStatusBar()` → `memoryProvider.search(memoryProvider.query)`
//      → `showInformationMessage('WoClaw: Refreshed')`. Pinning the
//      stored-query reuse means a refresh preserves the user's last
//      search filter rather than reverting to all-entries.
//   6. `woclaw.memorySearch` uses `showInputBox({ prompt: 'Search WoClaw
//      memory…' })` (with the ellipsis `…` U+2026, NOT three dots `...`)
//      and the `if (q !== undefined) memoryProvider.search(q)` guard
//      (already gated by chain #24 gate 8, but the showInputBox prompt
//      literal is its own regression risk — the prompt is shown in the
//      input box UI and any drift silently changes user-visible text).
//   7. `executeCommand('setContext', 'woclaw.hasData', true)` is called
//      once at the end of activate() — the `woclaw.hasData` context key
//      is referenced by the `viewsWelcome` `when: '!woclaw.hasData'`
//      clauses (2 references in package.json), so the literal must stay
//      in sync.
//   8. `treeRefresh = () => { memoryProvider.search(memoryProvider.query) }`
//      closure exists at the end of activate() — wires the `treeRefresh`
//      let-binding declared at L12 so external callers (test harness,
//      future migrate.js consumers) can request a refresh without going
//      through the command palette.
//   9. `pollTimer = setInterval(updateStatusBar, pollIntervalSec * 1000)`
//      wraps the poll interval in `* 1000` to convert seconds → ms. The
//      `pollIntervalSec ?? 30` default at the previous line pins the
//      in-source fallback to 30 (seconds), and the `* 1000` multiplier
//      must stay — silently dropping it would make the status bar poll
//      30×/sec instead of every 30s.
//
// Pre-fix verified-failing via revert test on all 9 gates — each gate
// will trip on its specific surface if a future refactor moves a
// command handler, changes a literal prompt string, swaps the
// registerCommand signature, etc.
//
// Runs under `node --test` (Node 18+) — no extra devDeps needed.
// Mirrors test/get_hub_url_default.test.js (chain #24) structure.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'extension.ts');
const PKG = path.join(__dirname, '..', 'package.json');

const src = fs.readFileSync(SRC, 'utf8');
const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));

// Extract command body by slicing from the registerCommand(...) call
// through the next line that begins with `  });` at indentation level 2
// (the close of the activate()-local command block). This avoids the
// greedy-non-greedy trap where `});` inside the body prematurely matches.
function extractCommandBody(srcText, commandName) {
  const startRe = new RegExp(`registerCommand\\('${commandName.replace(/\./g, '\\.')}',`);
  const startMatch = startRe.exec(srcText);
  if (!startMatch) return null;
  const start = startMatch.index;
  // Walk lines from `start` forward and look for the first `  });` (2-space indent)
  // that closes the command body. Inner bodies like the showInformationMessage
  // call end with `);` at 6+ space indent, so a 2-space indent uniquely
  // matches the activate-local command block close.
  const tail = srcText.slice(start);
  const lines = tail.split('\n');
  let acc = '';
  for (const line of lines) {
    acc += line + '\n';
    if (line === '  });') {
      return acc;
    }
    // Safety: stop at next registerCommand or end of activate() if we never found close.
    if (acc.length > 4000) return null;
  }
  return null;
}

test('chain-25-gate-1: 3 registerTreeDataProvider calls with woclaw-topics/-agents/-memory IDs', () => {
  const matches = [...src.matchAll(/vscode\.window\.registerTreeDataProvider\('(woclaw-[a-z]+)'/g)];
  assert.equal(matches.length, 3, `expected 3 registerTreeDataProvider calls, found ${matches.length}`);
  const ids = matches.map((m) => m[1]).sort();
  assert.deepEqual(ids, ['woclaw-agents', 'woclaw-memory', 'woclaw-topics'],
    `registerTreeDataProvider IDs drifted: ${JSON.stringify(ids)}`);
  // Cross-check: each registered ID must be declared in package.json views
  const viewIds = pkg.contributes.views['woclaw-explorer'].map((v) => v.id).sort();
  assert.deepEqual(ids, viewIds,
    `registered IDs must match package.json contributes.views.woclaw-explorer (${JSON.stringify(viewIds)})`);
});

test('chain-25-gate-2: 3 initial-load void calls in canonical order topics→agents→memory.search(\'\')', () => {
  // Slice the initial-load block: from `// Initial data load` comment through
  // to the line BEFORE `vscode.window.registerTreeDataProvider`.
  const initMatch = src.match(/\/\/ Initial data load\n([\s\S]*?)vscode\.window\.registerTreeDataProvider/);
  assert.ok(initMatch, 'initial data load block not found before first registerTreeDataProvider');
  const block = initMatch[1];
  // Three void calls in canonical order
  const tIdx = block.indexOf('topicsProvider.refresh()');
  const aIdx = block.indexOf('agentsProvider.refresh()');
  const mIdx = block.indexOf("memoryProvider.search('')");
  assert.ok(tIdx >= 0, 'topicsProvider.refresh() missing from initial-load block');
  assert.ok(aIdx >= 0, 'agentsProvider.refresh() missing from initial-load block');
  assert.ok(mIdx >= 0, "memoryProvider.search('') missing from initial-load block (must pass empty-string for all-entries load)");
  assert.ok(tIdx < aIdx, `topics refresh must precede agents refresh: tIdx=${tIdx} aIdx=${aIdx}`);
  assert.ok(aIdx < mIdx, `agents refresh must precede memory search: aIdx=${aIdx} mIdx=${mIdx}`);
});

test('chain-25-gate-3: 3 registerCommand calls with names woclaw.showDashboard/-refreshAll/-memorySearch', () => {
  const matches = [...src.matchAll(/vscode\.commands\.registerCommand\('(woclaw\.[A-Za-z]+)'/g)];
  assert.equal(matches.length, 3, `expected 3 registerCommand calls, found ${matches.length}`);
  const names = matches.map((m) => m[1]).sort();
  assert.deepEqual(names, ['woclaw.memorySearch', 'woclaw.refreshAll', 'woclaw.showDashboard'],
    `registerCommand names drifted: ${JSON.stringify(names)}`);
  // Cross-check: refreshAll + memorySearch must be declared in package.json commands;
  // showDashboard is bound to statusBarItem.command but not in the command palette.
  const paletteCmds = pkg.contributes.commands.map((c) => c.command).sort();
  assert.ok(paletteCmds.includes('woclaw.refreshAll'), 'package.json commands missing woclaw.refreshAll');
  assert.ok(paletteCmds.includes('woclaw.memorySearch'), 'package.json commands missing woclaw.memorySearch');
  assert.ok(!paletteCmds.includes('woclaw.showDashboard'),
    'woclaw.showDashboard is bound to statusBarItem.command only — should NOT be in command palette');
});

test('chain-25-gate-4: woclaw.showDashboard 2-branch dispatch (info modal:false / warning)', () => {
  // Pin: showDashboard must show info with { modal: false } on health, warning on null.
  const body = extractCommandBody(src, 'woclaw.showDashboard');
  assert.ok(body, 'woclaw.showDashboard command body not found');
  assert.ok(body.includes('showInformationMessage('),
    'showDashboard health-truthy branch must call showInformationMessage');
  assert.ok(/WoClaw Hub:.*agents.*topics/.test(body),
    "showDashboard info template literal must contain 'WoClaw Hub: ${health.agents} agents, ${health.topics} topics'");
  assert.ok(body.includes('{ modal: false }'),
    'showDashboard info call must pass { modal: false } so toast is non-blocking');
  assert.ok(body.includes('showWarningMessage('),
    'showDashboard health-falsy branch must call showWarningMessage');
  assert.ok(body.includes('WoClaw Hub unreachable at'),
    "showDashboard warning template literal must contain 'WoClaw Hub unreachable at ${url}'");
  // 2-branch if/else: exactly 2 message dispatch surfaces
  const branches = body.match(/vscode\.window\.show(I|W)/g) || [];
  assert.equal(branches.length, 2,
    `showDashboard must have exactly 2 message dispatch sites, found ${branches.length}`);
});

test('chain-25-gate-5: woclaw.refreshAll 3-step sequence updateStatusBar→search(query)→showInformationMessage', () => {
  const body = extractCommandBody(src, 'woclaw.refreshAll');
  assert.ok(body, 'woclaw.refreshAll command body not found');
  const updateIdx = body.indexOf('await updateStatusBar()');
  const searchIdx = body.indexOf('memoryProvider.search(memoryProvider.query)');
  const msgIdx = body.indexOf("showInformationMessage('WoClaw: Refreshed')");
  assert.ok(updateIdx >= 0, 'woclaw.refreshAll must call `await updateStatusBar()`');
  assert.ok(searchIdx >= 0, 'woclaw.refreshAll must call `memoryProvider.search(memoryProvider.query)` (stored query reuse)');
  assert.ok(msgIdx >= 0, "woclaw.refreshAll must call `showInformationMessage('WoClaw: Refreshed')`");
  assert.ok(updateIdx < searchIdx, `updateStatusBar must precede memoryProvider.search in refreshAll: u=${updateIdx} s=${searchIdx}`);
  assert.ok(searchIdx < msgIdx, `memoryProvider.search must precede info message in refreshAll: s=${searchIdx} m=${msgIdx}`);
});

test('chain-25-gate-6: woclaw.memorySearch showInputBox prompt literal uses U+2026 ellipsis + q!==undefined guard', () => {
  // Pin the exact prompt literal — drift in user-visible text.
  assert.ok(src.includes("showInputBox({ prompt: 'Search WoClaw memory…' })"),
    "woclaw.memorySearch showInputBox must use literal `prompt: 'Search WoClaw memory…'` (U+2026 ellipsis, NOT three dots)");
  assert.ok(!src.includes("showInputBox({ prompt: 'Search WoClaw memory...' })"),
    'showInputBox prompt must NOT regress to three ASCII dots');
  // The guard (chain #24 gate 8): q !== undefined (input-box-cancel semantics).
  const body = extractCommandBody(src, 'woclaw.memorySearch');
  assert.ok(body, 'woclaw.memorySearch command body not found');
  assert.ok(body.includes('if (q !== undefined) memoryProvider.search(q)'),
    'woclaw.memorySearch must guard with `if (q !== undefined) memoryProvider.search(q)` (NOT `q != null` — empty string is a valid query)');
});

test('chain-25-gate-7: executeCommand setContext woclaw.hasData true (matches package.json viewsWelcome when-clauses)', () => {
  assert.ok(src.includes("executeCommand('setContext', 'woclaw.hasData', true)"),
    "activate() must call `executeCommand('setContext', 'woclaw.hasData', true)` exactly once");
  // Cross-check: package.json viewsWelcome.when clauses reference `!woclaw.hasData`
  const welcomes = pkg.contributes.viewsWelcome || [];
  const whenClauses = welcomes.map((w) => w.when).filter(Boolean);
  assert.ok(whenClauses.length >= 1,
    'package.json viewsWelcome must declare at least one when-clause referencing woclaw.hasData');
  for (const w of whenClauses) {
    assert.ok(w.includes('woclaw.hasData'),
      `viewsWelcome when-clause must reference woclaw.hasData context key: got '${w}'`);
  }
});

test('chain-25-gate-8: treeRefresh closure wiring at end of activate()', () => {
  // Pin: the treeRefresh let-binding (L12) gets assigned a closure at end
  // of activate() that calls memoryProvider.search with stored query.
  assert.ok(src.includes('let treeRefresh: (() => void) | null = null;'),
    'treeRefresh let-binding must be declared at module scope (L12 type: (() => void) | null)');
  assert.ok(src.includes('treeRefresh = () => { memoryProvider.search(memoryProvider.query); };'),
    'activate() must assign `treeRefresh = () => { memoryProvider.search(memoryProvider.query) }` at end (closure wires external refresh hook)');
});

test('chain-25-gate-9: pollInterval default 30 + setInterval * 1000 multiplier (seconds→ms)', () => {
  // Pin: pollIntervalSec fallback ?? 30 AND setInterval * 1000 conversion.
  assert.ok(src.includes("get<number>('pollInterval') ?? 30"),
    "activate() must read pollInterval config with `?? 30` fallback (matches package.json default: 30 seconds)");
  // Cross-check package.json canonical default
  const pollDefault = pkg.contributes.configuration.properties['woclaw.pollInterval'].default;
  assert.equal(pollDefault, 30,
    `package.json woclaw.pollInterval.default must be 30 (seconds), got ${pollDefault}`);
  // Pin the * 1000 conversion (silently dropping it would poll 30×/sec instead of every 30s)
  assert.ok(src.includes('setInterval(updateStatusBar, pollIntervalSec * 1000)'),
    "activate() must wrap poll interval in `* 1000` to convert seconds → ms (silently dropping makes status bar poll 30×/sec)");
});
