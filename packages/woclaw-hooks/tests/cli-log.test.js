/**
 * packages/woclaw-hooks/tests/cli-log.test.js
 *
 * Regression tests for cli_log.js — helper-extraction per-prefix pattern
 * chain #10 closure + chain #11 gemini 漏更 closure + chain #12 claude 漏更 closure. 07-07 01:03 cron.
 *
 * Mirrors packages/opencode-woclaw-plugin/tests/opencode-plugin-log.test.js
 * structure (12 tests total): all CJS (matches woclaw-hooks subpackage
 * conventions — no "type":"module" in packages/woclaw-hooks/package.json).
 *
 *   - 3 module shape tests
 *   - 3 canonical signature tests
 *   - 3 runtime wire-format parity tests
 *   - 3 closure / import + 61-site migration parity tests
 *
 * Run with: node --test packages/woclaw-hooks/tests/cli-log.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const HELPER_PATH = path.resolve(__dirname, '..', 'lib', 'cli_log.js');
const INSTALL_PATH = path.resolve(__dirname, '..', 'install.js');
const CLAUDE_PATH = path.resolve(__dirname, '..', 'claude-migrate.js');
const CODEX_MIGRATE_PATH = path.resolve(__dirname, '..', 'codex-migrate.js');
const GEMINI_PATH = path.resolve(__dirname, '..', 'gemini-migrate.js');
const OPENCLAW_PATH = path.resolve(__dirname, '..', 'openclaw-migrate.js');
const CODEX_CLI_PATH = path.resolve(__dirname, '..', '..', 'codex-woclaw', 'bin', 'cli.js');

test('cli_log.js helper extraction (07-04 06:34 cron chain #10 — woclaw-hooks)', async (t) => {
  // ── module shape (3) ─────────────────────────────────────────────────
  await t.test('cli_log.js exists at packages/woclaw-hooks/lib/cli_log.js', () => {
    const src = readFileSync(HELPER_PATH, 'utf-8');
    assert.ok(src.length > 0, 'helper file should not be empty');
    assert.ok(src.includes('hooksOk'), 'should declare hooksOk');
    assert.ok(src.includes('hooksErr'), 'should declare hooksErr');
    assert.ok(src.includes('PREFIXES'), 'should export PREFIXES table');
  });

  await t.test('exports 10 helpers + PREFIXES table', () => {
    const cliLog = require('../lib/cli_log');
    const expected = ['hooksOk', 'hooksWarn', 'hooksStep', 'hooksList', 'hooksHint',
                     'hooksNote', 'hooksConfig', 'hooksStatus', 'hooksRemove', 'hooksErr'];
    for (const name of expected) {
      assert.equal(typeof cliLog[name], 'function', name + ' should be a function');
    }
    assert.equal(typeof cliLog.PREFIXES, 'object', 'PREFIXES should be exported');
    assert.equal(cliLog.PREFIXES.OK, '\u2705 ', 'PREFIXES.OK should be checkmark+space');
    assert.equal(cliLog.PREFIXES.WARN, '\u26a0\ufe0f  ', 'PREFIXES.WARN should be warning+space');
  });

  await t.test('all 10 helpers are named function declarations (canonical shape)', () => {
    const src = readFileSync(HELPER_PATH, 'utf-8');
    const names = ['hooksOk', 'hooksWarn', 'hooksStep', 'hooksList', 'hooksHint',
                   'hooksNote', 'hooksConfig', 'hooksStatus', 'hooksRemove', 'hooksErr'];
    for (const name of names) {
      // Each helper declared as: function NAME(msg, ...args) {
      const sig = 'function ' + name + '(msg, ...args) {';
      assert.ok(src.includes(sig), 'expected canonical signature for ' + name + ': ' + sig);
    }
  });

  // ── canonical signature (3) ──────────────────────────────────────────
  await t.test('hooksOk signature: (msg, ...args) -> console.log(prefix + msg, ...args)', () => {
    const cliLog = require('../lib/cli_log');
    const orig = console.log;
    let captured = null;
    console.log = function () { captured = Array.from(arguments); };
    try {
      cliLog.hooksOk('Installed (claude): precompact.sh', 'extra1', 42);
      assert.deepEqual(captured, ['\u2705 Installed (claude): precompact.sh', 'extra1', 42]);
    } finally {
      console.log = orig;
    }
  });

  await t.test('hooksWarn signature: (msg, ...args) -> console.log("warning+space " + msg, ...args) — woclaw-hooks convention: warnings on stdout', () => {
    const cliLog = require('../lib/cli_log');
    const orig = console.log;
    let captured = null;
    console.log = function () { captured = Array.from(arguments); };
    try {
      cliLog.hooksWarn('Missing hooks: precompact.sh', { k: 'v' });
      assert.deepEqual(captured, ['\u26a0\ufe0f  Missing hooks: precompact.sh', { k: 'v' }]);
    } finally {
      console.log = orig;
    }
  });

  await t.test('hooksErr signature: (msg, ...args) -> console.error(msg, ...args) — preserves pre-refactor console.error convention', () => {
    const cliLog = require('../lib/cli_log');
    const orig = console.error;
    let captured = null;
    console.error = function () { captured = Array.from(arguments); };
    try {
      cliLog.hooksErr('Unknown framework: foo');
      assert.deepEqual(captured, ['Unknown framework: foo']);
    } finally {
      console.error = orig;
    }
  });

  // ── runtime wire-format parity (3) ───────────────────────────────────
  await t.test('hooksOk runtime wire-format byte-identical to pre-refactor console.log("check " + msg)', () => {
    const cliLog = require('../lib/cli_log');
    const orig = console.log;
    let captured = null;
    console.log = function () { captured = Array.from(arguments); };
    try {
      cliLog.hooksOk('Installed (claude): precompact.sh');
      assert.deepEqual(captured, ['\u2705 Installed (claude): precompact.sh']);
    } finally {
      console.log = orig;
    }
  });

  await t.test('hooksStep template-string interpolation works (Migrating up to N Codex sessions)', () => {
    const cliLog = require('../lib/cli_log');
    const orig = console.log;
    let captured = null;
    console.log = function () { captured = Array.from(arguments); };
    try {
      cliLog.hooksStep('\nMigrating up to ' + 42 + ' Codex sessions...\n');
      assert.deepEqual(captured, ['\ud83d\udd04 \nMigrating up to 42 Codex sessions...\n']);
    } finally {
      console.log = orig;
    }
  });

  await t.test('hooksList no-arg msg works (Available Claude Code Sessions header)', () => {
    const cliLog = require('../lib/cli_log');
    const orig = console.log;
    let captured = null;
    console.log = function () { captured = Array.from(arguments); };
    try {
      cliLog.hooksList('\nAvailable Claude Code Sessions\n');
      assert.deepEqual(captured, ['\ud83d\udccb \nAvailable Claude Code Sessions\n']);
    } finally {
      console.log = orig;
    }
  });

  // ── closure / 61-site migration parity (3) ───────────────────────────
  await t.test('all 6 modified files import cli_log via require', () => {
    const installSrc = readFileSync(INSTALL_PATH, 'utf-8');
    const claudeSrc = readFileSync(CLAUDE_PATH, 'utf-8');
    const codexSrc = readFileSync(CODEX_MIGRATE_PATH, 'utf-8');
    const geminiSrc = readFileSync(GEMINI_PATH, 'utf-8');
    const openclawSrc = readFileSync(OPENCLAW_PATH, 'utf-8');
    const codexCliSrc = readFileSync(CODEX_CLI_PATH, 'utf-8');
    // 5 woclaw-hooks scripts: require('./lib/cli_log')
    assert.match(installSrc, /require\(['"]\.\/lib\/cli_log['"]\)/, 'install.js should require cli_log');
    assert.match(claudeSrc, /require\(['"]\.\/lib\/cli_log['"]\)/, 'claude-migrate.js should require cli_log');
    assert.match(codexSrc, /require\(['"]\.\/lib\/cli_log['"]\)/, 'codex-migrate.js should require cli_log');
    assert.match(geminiSrc, /require\(['"]\.\/lib\/cli_log['"]\)/, 'gemini-migrate.js should require cli_log');
    assert.match(openclawSrc, /require\(['"]\.\/lib\/cli_log['"]\)/, 'openclaw-migrate.js should require cli_log');
    // codex-woclaw/bin/cli.js: cross-subpackage require
    assert.match(codexCliSrc, /require\(['"]\.\.\/\.\.\/woclaw-hooks\/lib\/cli_log['"]\)/,
      'codex-woclaw/bin/cli.js should require cli_log via cross-subpackage path');
  });

  await t.test('0 inline emoji-prefix console.log sites remain in 6 migrated files', () => {
    // match `console.log("<emoji> <msg>"...)` patterns — emoji characters at start
    // of the first string arg to console.log
    const EMOJI_CHARS = '[\u2705\u26a0\ufe0f\ud83d\udd04\ud83d\udccb\ud83d\udd27\ud83d\udce1\ud83d\udca1\ud83d\uddd1\ufe0f\ud83d\udcdd]';
    const EMOJI_RE = new RegExp('console\\.log\\([\\\'"`]\\s*' + EMOJI_CHARS + '\\s', 'g');
    for (const p of [INSTALL_PATH, CLAUDE_PATH, CODEX_MIGRATE_PATH, GEMINI_PATH, OPENCLAW_PATH, CODEX_CLI_PATH]) {
      const src = readFileSync(p, 'utf-8');
      const matches = src.match(EMOJI_RE) || [];
      assert.equal(matches.length, 0,
        'expected 0 inline emoji-prefix console.log sites in ' + path.basename(p) + ', found ' + matches.length);
    }
  });

  await t.test('total hook call sites across 6 files = 61 (install 21 + claude 12 + codex-migrate 5 + gemini 12 + openclaw 7 + codex-woclaw-cli 4)', () => {
    const RE = /\bhooks(?:Ok|Warn|Step|List|Hint|Note|Config|Status|Remove|Err)\s*\(/g;
    const countCalls = (p) => {
      const src = readFileSync(p, 'utf-8');
      // strip the destructured import line(s) — they contain the binding names
      const lines = src.split('\n').filter(l =>
        !/const\s*\{[^}]*hooks(?:Ok|Warn|Step|List|Hint|Note|Config|Status|Remove|Err)/.test(l)
      ).join('\n');
      return (lines.match(RE) || []).length;
    };
    const counts = {
      install: countCalls(INSTALL_PATH),
      claude: countCalls(CLAUDE_PATH),
      'codex-migrate': countCalls(CODEX_MIGRATE_PATH),
      gemini: countCalls(GEMINI_PATH),
      openclaw: countCalls(OPENCLAW_PATH),
      'codex-woclaw-cli': countCalls(CODEX_CLI_PATH),
    };
    assert.deepEqual(counts,
      { install: 21, claude: 12, 'codex-migrate': 5, gemini: 12, openclaw: 7, 'codex-woclaw-cli': 4 },
      'migration site counts shifted: got ' + JSON.stringify(counts));
  });
  // ── chain #11 closure: gemini-migrate 漏更 closure (3 new tests) ───────
  await t.test('gemini-migrate.js: 0 inline status console.log sites remain (excl printHelp template + 2 blank-line spacers)', () => {
    const src = readFileSync(GEMINI_PATH, 'utf-8');
    // Strip the printHelp template (multi-line template starting with `\nWoClaw Gemini CLI`)
    // and the 2 blank-line spacers (console.log('') calls). The remaining inline
    // console.log must be 0 (chain #11 closes the 5 status sites + 1 console.error).
    // Strip the printHelp multi-line template literal call (1 site) and the 2 blank-line spacers.
    // Remaining inline console.log must be 0 after chain #11 (5 status sites + 1 console.error closed).
    const stripped = src
      .replace(/console\.log\(\s*`[\s\S]*?`\s*\);/g, '')                       // 1 multi-line template literal (printHelp)
      .replace(/console\.log\(\s*''\s*\);/g, '');                                    // 2 blank-line spacers (L203/L210)
    // Count any inline console.log(...) that is NOT a destructured import line and NOT inside the helper file
    const INLINE_RE = /console\.log\(/g;
    const matches = stripped.match(INLINE_RE) || [];
    assert.equal(matches.length, 0,
      'expected 0 inline status console.log sites after chain #11 migration, found ' + matches.length);
  });

  await t.test('gemini-migrate.js: 0 inline console.error sites remain (catch handler migrated to hooksErr)', () => {
    const src = readFileSync(GEMINI_PATH, 'utf-8');
    const matches = src.match(/console\.error\(/g) || [];
    assert.equal(matches.length, 0,
      'expected 0 inline console.error sites after chain #11 migration, found ' + matches.length);
  });

  await t.test('gemini-migrate.js: imports hooksNote + hooksErr from cli_log (chain #11 additions)', () => {
    const src = readFileSync(GEMINI_PATH, 'utf-8');
    assert.match(src, /hooksNote/, 'should destructure hooksNote');
    assert.match(src, /hooksErr/, 'should destructure hooksErr');
    // Verify each of the 6 new call sites is present
    const EXPECTED = [
      /hooksList\('No Gemini sessions found\.'\)/,                                  // was L202
      /hooksList\(`- \$\{session\.sessionId\}  /,                                   // was L208 (session list item)
      /hooksWarn\(`Session not found: \$\{targetValue\}`\)/,                        // was L224
      /hooksNote\(summary\)/,                                                       // was L228
      /hooksStep\(`→ \$\{session\.sessionId\} /,                                    // was L238 (migration progress)
      /hooksErr\(err\)/,                                                            // was L247 (catch handler)
    ];
    for (const re of EXPECTED) {
      assert.match(src, re, 'expected chain #11 call site: ' + re);
    }
  });
  // ── chain #12 closure: claude-migrate 漏更 closure (3 new tests) ───────
  await t.test('claude-migrate.js: 0 inline status console.log sites remain (excl printHelp template + 2 blank-line spacers)', () => {
    const src = readFileSync(CLAUDE_PATH, 'utf-8');
    // Strip the printHelp multi-line template literal call (1 site) and the 2 blank-line spacers.
    // Remaining inline console.log must be 0 after chain #12 (5 status sites + 1 console.error closed).
    const stripped = src
      .replace(/console\.log\(\s*`[\s\S]*?`\s*\);/g, '')                       // 1 multi-line template literal (printHelp)
      .replace(/console\.log\(\s*''\s*\);/g, '');                                    // 2 blank-line spacers (L171/L179)
    const INLINE_RE = /console\.log\(/g;
    const matches = stripped.match(INLINE_RE) || [];
    assert.equal(matches.length, 0,
      'expected 0 inline status console.log sites after chain #12 migration, found ' + matches.length);
  });

  await t.test('claude-migrate.js: 0 inline console.error sites remain (catch handler migrated to hooksErr)', () => {
    const src = readFileSync(CLAUDE_PATH, 'utf-8');
    const matches = src.match(/console\.error\(/g) || [];
    assert.equal(matches.length, 0,
      'expected 0 inline console.error sites after chain #12 migration, found ' + matches.length);
  });

  await t.test('claude-migrate.js: imports hooksNote + hooksErr from cli_log (chain #12 additions)', () => {
    const src = readFileSync(CLAUDE_PATH, 'utf-8');
    assert.match(src, /hooksNote/, 'should destructure hooksNote');
    assert.match(src, /hooksErr/, 'should destructure hooksErr');
    // Verify each of the 6 new call sites is present
    const EXPECTED = [
      /hooksList\('No sessions found\.'\)/,                                          // was L170
      /hooksList\(`- \$\{session\.sessionId\}  /,                                   // was L177 (session list item)
      /hooksWarn\(`Session not found: \$\{targetValue\}`\)/,                         // was L193
      /hooksNote\(summary\)/,                                                       // was L197
      /hooksStep\(`→ \$\{session\.sessionId\} /,                                     // was L208 (migration progress)
      /hooksErr\(err\)/,                                                            // was L217 (catch handler)
    ];
    for (const re of EXPECTED) {
      assert.match(src, re, 'expected chain #12 call site: ' + re);
    }
  });
});
