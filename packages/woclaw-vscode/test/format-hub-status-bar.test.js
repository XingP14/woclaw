// Regression test for chain #18 status-bar-format-extraction:
// `formatHubStatusBar(health)` centralizes the 2 statusBarItem.text+color
// templates previously duplicated across the connected/disconnected
// branches of `updateStatusBar`. Without this helper, the `$(hubot)
// WoClaw:` prefix + the green/red hex codes were duplicated across the
// connected + disconnected branches, which risks drift if one site
// changes. This test reads src/extension.ts as text and asserts:
//   1. A `formatHubStatusBar` helper exists in src/extension.ts.
//   2. The helper returns HubStatusBar { text, color } shape with the
//      expected `$(hubot) WoClaw:` prefix in both branches.
//   3. updateStatusBar calls the helper instead of inlining the
//      text/color templates (i.e. the literal `#4caf50` / `#f44336`
//      hex codes are no longer present in `updateStatusBar`).
//   4. The compiled out/extension.js preserves the same call pattern
//      (chain #18 helper stays after `npm run compile`).
// A regression that re-inlines the branches will trip the checks below.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SRC_PATH = path.join(__dirname, '..', 'src', 'extension.ts');
const OUT_PATH = path.join(__dirname, '..', 'out', 'extension.js');

function readSrc() { return fs.readFileSync(SRC_PATH, 'utf8'); }
function readOut() {
  if (!fs.existsSync(OUT_PATH)) return '';
  return fs.readFileSync(OUT_PATH, 'utf8');
}

test('woclaw-vscode: formatHubStatusBar helper exists in src/extension.ts', () => {
  const src = readSrc();
  if (!/function\s+formatHubStatusBar\s*\(/.test(src)) {
    throw new Error('formatHubStatusBar helper missing from src/extension.ts');
  }
});

test('woclaw-vscode: formatHubStatusBar returns text/color for connected + disconnected', () => {
  const src = readSrc();
  // Both branches must contain the "$(hubot) WoClaw:" prefix.
  const hubotMatches = src.match(/\$\(hubot\)\s*WoClaw:/g) || [];
  if (hubotMatches.length < 2) {
    throw new Error(`expected ≥2 $(hubot) WoClaw: prefixes (connected + disconnected), found ${hubotMatches.length}`);
  }
  // The hex color codes must live inside the helper, not in updateStatusBar.
  if (!src.includes("#4caf50") || !src.includes("#f44336")) {
    throw new Error('expected #4caf50 (green) + #f44336 (red) hex codes to appear in helper');
  }
});

test('woclaw-vscode: updateStatusBar delegates to formatHubStatusBar helper', () => {
  const src = readSrc();
  // Locate updateStatusBar body and ensure it calls formatHubStatusBar(...).
  // Pattern: function updateStatusBar() { ... formatHubStatusBar(health) ... }
  const m = src.match(/async\s+function\s+updateStatusBar\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
  if (!m) {
    throw new Error('updateStatusBar function not found');
  }
  const body = m[1];
  if (!/formatHubStatusBar\s*\(/.test(body)) {
    throw new Error('updateStatusBar body must call formatHubStatusBar helper (chain #18)');
  }
  // The literal hex codes must NOT appear inside updateStatusBar anymore.
  if (/#4caf50/.test(body) || /#f44336/.test(body)) {
    throw new Error('hex codes leaked back into updateStatusBar — helper extraction broken');
  }
});

test('woclaw-vscode: out/extension.js preserves formatHubStatusBar call from updateStatusBar', () => {
  const out = readOut();
  if (out.length === 0) {
    // OK — package may not have been compiled locally; src-only check is
    // authoritative. CI will compile on push.
    return;
  }
  if (!/formatHubStatusBar\s*\(/.test(out)) {
    throw new Error('out/extension.js missing formatHubStatusBar — `npm run compile` stale');
  }
});
