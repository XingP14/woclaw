/**
 * packages/opencode-woclaw-plugin/opencode_plugin_log.js
 *
 * Centralized `[WoClaw]` prefix helpers for the opencode-woclaw plugin.
 * Mirrors the helper-extraction per-prefix pattern across hub_log (28
 * sites) / schedLog (15) / dbLog (2) / federation_log fedLog (18) /
 * ws_server fedLog (2) / plugin_log pluginError (2) / mcp_log
 * mcpLog/mcpWarn/mcpError (6) / memory notifySubscribers hubError (1).
 *
 * This is the 9th chain — closing the previously-undetected 6-site
 * `[WoClaw]` prefix duplication gap in opencode-woclaw-plugin/index.js
 * (the OpenCode CLI plugin, 7th woclaw subpackage). The earlier cron
 * rounds grepped `.ts` files for `console.error` and missed this file
 * because (a) it is `.js` (no tsc coverage) and (b) it uses `console.log`
 * (info-level announcements, not errors). Subpackage count is now 8/8
 * consolidated (hub / plugin / woclaw-vscode / scheduler / db /
 * federation / mcp-bridge / opencode-woclaw-plugin).
 *
 * Usage:
 *   import { opencodeLog, opencodeWarn, opencodeError } from './opencode_plugin_log.js';
 *
 *   opencodeLog('Plugin initialized. Hub:', WOCLAW_HUB_URL);
 *   // → console.log('[WoClaw] Plugin initialized. Hub:', WOCLAW_HUB_URL)
 *
 * Strategy:
 *   - opencodeLog forwards to `console.log` (matching existing wire-format
 *     `console.log('[WoClaw] foo', x)` used by 6 inline sites).
 *   - opencodeWarn forwards to `console.warn`.
 *   - opencodeError forwards to `console.error`.
 *   - Wire-format is byte-identical to pre-refactor inline sites:
 *     `opencodeLog('foo', x)` emits exactly
 *     `console.log('[WoClaw] foo', x)`.
 *   - multi-arg passthrough (...args) so callers can keep their
 *     structured payload alongside the message (parity with hubLog
 *     et al.).
 *
 * 07-04 06:03 cron helper-extraction chain #9: closes 6-site `[WoClaw]`
 * prefix duplication gap in packages/opencode-woclaw-plugin/index.js
 * (lines 53 / 76 / 80 / 83 / 101 / 103 — all 6 are `console.log('[WoClaw] …')`
 * info-level announcements on plugin load, session.created, session.compacted).
 */

export function opencodeLog(msg, ...args) {
  console.log(`[WoClaw] ${msg}`, ...args);
}

export function opencodeWarn(msg, ...args) {
  console.warn(`[WoClaw] ${msg}`, ...args);
}

export function opencodeError(msg, ...args) {
  console.error(`[WoClaw] ${msg}`, ...args);
}
