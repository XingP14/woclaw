/**
 * packages/woclaw-hooks/lib/cli_log.js
 *
 * Centralized CLI emoji-decoration helpers for the woclaw-hooks scripts
 * (install.js, claude-migrate.js, gemini-migrate.js, codex-migrate.js,
 * openclaw-migrate.js) and the woclaw-codex/cli.js wrapper. Mirrors the
 * helper-extraction per-prefix pattern across hub_log (28 sites) /
 * schedLog (15) / dbLog (2) / federation fedLog (18) / ws_server fedLog
 * (2) / plugin pluginError (2) / mcp_log mcpLog/mcpWarn/mcpError (6) /
 * memory notifySubscribers hubError (1) / opencode_plugin_log
 * opencodeLog (6) — see those modules for the `[WoClaw]` prefix pattern.
 *
 * This is chain #10, the 9th subpackage consolidated. Unlike the
 * previous chains which extract a `[WoClaw]` literal prefix, this
 * module extracts the **emoji decoration** pattern (✅/⚠️/🔄/📋/🔧/
 * 📡/💡/🗑️/📝) that woclaw-hooks scripts emit as user-facing CLI
 * feedback. The wire-format is byte-identical to pre-refactor inline
 * sites: `hooksOk('Installed (claude): precompact.sh')` emits exactly
 * `console.log('✅ Installed (claude): precompact.sh')`.
 *
 * Why a separate module:
 *   - The woclaw-hooks scripts are pure CLI tools (CJS) installed via
 *     npm and run by humans (`npx woclaw-hooks`) and by migration
 *     pipelines. The console output is the user UX.
 *   - The emoji decoration duplication was 17 ✅ / 9 ⚠️ / 5 🔄 / 4 📋
 *     / 3 📝 / 2 💡 / 1 each 🔧/📡/🗑️ across 5 files (120 console
 *     sites total) — too much duplication for a 5-file subpackage
 *     where the emoji set is stable and well-known.
 *   - Helper extraction lets future copy tweaks (e.g. add "(chain #10
 *     refactored)" attribution, or localize the labels) happen in one
 *     place rather than 120 grep-and-replace sites.
 *
 * Strategy:
 *   - hooksOk(msg, ...args)        → console.log('✅ ' + msg, ...args)
 *   - hooksWarn(msg, ...args)      → console.log('⚠️  ' + msg, ...args)
 *     (matches pre-refactor call sites that used console.log for ⚠️
 *      since the woclaw-hooks CLI convention is to surface warnings on
 *      stdout, not stderr)
 *   - hooksStep(msg, ...args)      → console.log('🔄 ' + msg, ...args)
 *   - hooksList(msg, ...args)      → console.log('📋 ' + msg, ...args)
 *   - hooksHint(msg, ...args)      → console.log('💡 ' + msg, ...args)
 *   - hooksNote(msg, ...args)      → console.log('📝 ' + msg, ...args)
 *   - hooksConfig(msg, ...args)    → console.log('🔧 ' + msg, ...args)
 *   - hooksStatus(msg, ...args)    → console.log('📡 ' + msg, ...args)
 *   - hooksRemove(msg, ...args)    → console.log('🗑️  ' + msg, ...args)
 *   - hooksErr(msg, ...args)       → console.error(msg, ...args)
 *     (preserves the existing convention that woclaw-hooks uses
 *      console.error only for unrecoverable errors that abort the
 *      installer — e.g. "Unknown framework: foo")
 *   - helpers consume the message as-is, no template literal
 *     interpolation needed; multi-arg passthrough (...args) so callers
 *     can keep their structured payload alongside the message.
 *
 * 07-04 06:23 cron helper-extraction chain #10: closes 120-site emoji
 * decoration duplication gap across 5 woclaw-hooks scripts + 1
 * codex-woclaw cli wrapper. 9th subpackage consolidated.
 *
 * Usage (CJS):
 *   const cliLog = require('./lib/cli_log');
 *   cliLog.hooksOk('Installed (claude): precompact.sh');
 *   // → console.log('✅ Installed (claude): precompact.sh')
 */

'use strict';

const PREFIXES = Object.freeze({
  OK:     '✅ ',
  WARN:   '⚠️  ',
  STEP:   '🔄 ',
  LIST:   '📋 ',
  HINT:   '💡 ',
  NOTE:   '📝 ',
  CONFIG: '🔧 ',
  STATUS: '📡 ',
  REMOVE: '🗑️  ',
});

function hooksOk(msg, ...args) {
  console.log(PREFIXES.OK + msg, ...args);
}

function hooksWarn(msg, ...args) {
  console.log(PREFIXES.WARN + msg, ...args);
}

function hooksStep(msg, ...args) {
  console.log(PREFIXES.STEP + msg, ...args);
}

function hooksList(msg, ...args) {
  console.log(PREFIXES.LIST + msg, ...args);
}

function hooksHint(msg, ...args) {
  console.log(PREFIXES.HINT + msg, ...args);
}

function hooksNote(msg, ...args) {
  console.log(PREFIXES.NOTE + msg, ...args);
}

function hooksConfig(msg, ...args) {
  console.log(PREFIXES.CONFIG + msg, ...args);
}

function hooksStatus(msg, ...args) {
  console.log(PREFIXES.STATUS + msg, ...args);
}

function hooksRemove(msg, ...args) {
  console.log(PREFIXES.REMOVE + msg, ...args);
}

function hooksErr(msg, ...args) {
  console.error(msg, ...args);
}

module.exports = {
  hooksOk,
  hooksWarn,
  hooksStep,
  hooksList,
  hooksHint,
  hooksNote,
  hooksConfig,
  hooksStatus,
  hooksRemove,
  hooksErr,
  PREFIXES,
};
