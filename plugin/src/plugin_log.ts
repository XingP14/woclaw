/**
 * plugin/src/plugin_log.ts
 *
 * Centralized `[WoClaw]` prefix helpers for the WoClaw OpenClaw plugin
 * entry point. Mirrors the federation_log / hub_log / scheduler_log /
 * db_log helper-extraction pattern.
 *
 * Usage:
 *   import { pluginLog, pluginWarn, pluginError } from './plugin_log.js';
 *
 *   pluginError('setRuntime called with cfg:', cfg);
 *   // → console.error('[WoClaw] setRuntime called with cfg:', cfg)
 *
 * Strategy:
 *   - All helpers forward to `console.error` (matching the existing
 *     `console.error.bind(null, '[WoClaw]')` fallback logger shape in
 *     plugin/src/index.ts and plugin/src/channel.ts).
 *   - Wire-format is byte-identical to pre-refactor inline sites: each
 *     `pluginX('foo', x)` emits exactly `console.error('[WoClaw] foo', x)`.
 *   - multi-arg passthrough (...args: unknown[]) so callers can keep their
 *     structured payload alongside the message (parity with fedLog et al.).
 */
export function pluginLog(msg: string, ...args: unknown[]): void {
  console.error(`[WoClaw] ${msg}`, ...args);
}

export function pluginWarn(msg: string, ...args: unknown[]): void {
  console.error(`[WoClaw] ${msg}`, ...args);
}

export function pluginError(msg: string, ...args: unknown[]): void {
  console.error(`[WoClaw] ${msg}`, ...args);
}
