/**
 * plugin/src/plugin_log.ts
 *
 * Centralized `[WoClaw]` prefix helpers + bind-fallback factory for the
 * WoClaw OpenClaw plugin entry point. Mirrors the federation_log /
 * hub_log / scheduler_log / db_log / mcp_log helper-extraction pattern.
 *
 * Usage:
 *   import { pluginLog, pluginWarn, pluginError, createPluginLogger } from './plugin_log.js';
 *
 *   pluginError('setRuntime called with cfg:', cfg);
 *   // → console.error('[WoClaw] setRuntime called with cfg:', cfg)
 *
 *   const logger = api.logger ?? createPluginLogger();
 *   logger.info('hello');
 *   // → console.error('[WoClaw] hello')
 *   logger.warn('oops');
 *   // → console.error('[WoClaw] WARN: oops')
 *
 *   // Override prefix drift — channel.ts uses '[WoClaw WARN:]' (no space,
 *   // colon inside brackets) vs index.ts's '[WoClaw] WARN:' (colon outside).
 *   // Both forms are preserved byte-identically via the optional `prefixes`
 *   // arg to avoid changing observable runtime output during refactor.
 *   const channelLogger = createPluginLogger({
 *     warn: '[WoClaw WARN:]',
 *     error: '[WoClaw ERROR:]',
 *     debug: '[WoClaw DEBUG:]',
 *   });
 *
 * Strategy:
 *   - All helpers forward to `console.error` (matching the existing
 *     wire-format: `console.error('[WoClaw] foo', x)`).
 *   - Wire-format is byte-identical to pre-refactor inline sites: each
 *     `pluginX('foo', x)` emits exactly `console.error('[WoClaw] foo', x)`.
 *   - multi-arg passthrough (...args: unknown[]) so callers can keep their
 *     structured payload alongside the message (parity with hubLog et al.).
 *   - `createPluginLogger(prefixes?)` returns a WoClawLogger-shaped object
 *     with info/warn/error/debug methods that all forward through
 *     `console.error.bind(null, '<prefix>')` matching the legacy bind-fallback
 *     shape used in plugin/src/channel.ts and plugin/src/index.ts
 *     (`{ info: console.error.bind(null, '[WoClaw]'), warn: console.error.bind(null, '[WoClaw] WARN:'), ... }`).
 */

/**
 * Minimal logger shape used by the WoClaw channel/runtime fallback. Mirrors
 * the OpenClaw `WoClawLogger` interface that channel.ts depends on. We
 * intentionally keep this declaration local so the helper module has zero
 * dependency on openclaw/plugin-sdk types — keeping the helper pure.
 */
export interface PluginLogger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
}

/**
 * Optional prefix overrides for createPluginLogger(). Any omitted field
 * falls back to the index.ts canonical prefix `[WoClaw] <LEVEL>:` shape
 * (matching plugin/src/index.ts L44/48 wire-format). Channel.ts can pass
 * `{warn: '[WoClaw WARN:]'}` etc. to preserve its existing prefix drift.
 */
export interface PluginLoggerPrefixes {
  info?: string;
  warn?: string;
  error?: string;
  debug?: string;
}

export function pluginLog(msg: string, ...args: unknown[]): void {
  console.error(`[WoClaw] ${msg}`, ...args);
}

export function pluginWarn(msg: string, ...args: unknown[]): void {
  console.error(`[WoClaw] ${msg}`, ...args);
}

export function pluginError(msg: string, ...args: unknown[]): void {
  console.error(`[WoClaw] ${msg}`, ...args);
}

/**
 * createPluginLogger() — bind-fallback logger factory matching the legacy
 * inline `{ info: console.error.bind(null, '[WoClaw]'), ... }` shape used
 * in plugin/src/channel.ts (L507-510 and L523-526 with prefix drift
 * `[WoClaw WARN:]`) and plugin/src/index.ts (L44, L48 with canonical
 * `[WoClaw] WARN:` prefix).
 *
 * Each method forwards to `console.error` with the matching prefix
 * (literal `[WoClaw]`, `[WoClaw] WARN:`, `[WoClaw] ERROR:`,
 * `[WoClaw] DEBUG:` by default — overridable via the optional `prefixes`
 * arg). Wire-format is byte-identical to the inline bind-fallback sites,
 * so `createPluginLogger().info('hello')` emits exactly
 * `console.error('[WoClaw] hello')`.
 *
 * 07-05 01:26 cron helper-extraction chain #8 (factory pattern): closes
 * 5-site `[WoClaw ...]` prefix duplication gap (3 logger objects in
 * channel.ts + 2 in index.ts) — 4 prefix variants × 5 sites = 20 bind
 * sites total, all forwarding to `console.error` with literal `[WoClaw ...]`
 * prefix.
 */
export function createPluginLogger(prefixes: PluginLoggerPrefixes = {}): PluginLogger {
  const info = prefixes.info ?? '[WoClaw]';
  const warn = prefixes.warn ?? '[WoClaw] WARN:';
  const error = prefixes.error ?? '[WoClaw] ERROR:';
  const debug = prefixes.debug ?? '[WoClaw] DEBUG:';
  return {
    info: console.error.bind(null, info),
    warn: console.error.bind(null, warn),
    error: console.error.bind(null, error),
    debug: console.error.bind(null, debug),
  };
}
