/**
 * mcp-bridge/src/mcp_log.js
 *
 * Centralized `[WoClaw MCP]` prefix helpers for the WoClaw MCP Bridge
 * entry point. Mirrors the federation_log / hub_log / scheduler_log /
 * db_log / plugin_log helper-extraction pattern.
 *
 * Usage:
 *   import { mcpLog, mcpWarn, mcpError } from './mcp_log.js';
 *
 *   mcpError('Parse error:', e.message);
 *   // → console.error('[WoClaw MCP] Parse error:', e.message)
 *
 * Strategy:
 *   - All helpers forward to `console.error` (matching the existing
 *     wire-format: `console.error('[WoClaw MCP] foo', x)`).
 *   - Wire-format is byte-identical to pre-refactor inline sites: each
 *     `mcpX('foo', x)` emits exactly `console.error('[WoClaw MCP] foo', x)`.
 *   - multi-arg passthrough (...args: unknown[]) so callers can keep their
 *     structured payload alongside the message (parity with hubLog et al.).
 *
 * 07-04 02:53 cron helper-extraction chain #7: closes 5-site
 * `[WoClaw MCP]` prefix duplication gap in mcp-bridge/src/index.js
 * (lines 42 / 55 / 60 / 65 / 266 / 305 — 6 sites total, 5 with `[WoClaw MCP]`
 * prefix + 1 bare `main().catch(console.error)` passthrough which is
 * intentionally NOT migrated).
 */

export function mcpLog(msg, ...args) {
  console.error(`[WoClaw MCP] ${msg}`, ...args);
}

export function mcpWarn(msg, ...args) {
  console.error(`[WoClaw MCP] ${msg}`, ...args);
}

export function mcpError(msg, ...args) {
  console.error(`[WoClaw MCP] ${msg}`, ...args);
}
