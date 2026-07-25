/**
 * Regression test for the round-57 observability-envelope extension
 * (hub/src/hub_log.ts hubEvent helper, 2026-07-25 cron tick).
 *
 * Round 57 ships woclaw/observability-envelope as the first PoC out of 21
 * rounds of substrate design (R35-R56). The goal of this test file is to
 * gate the envelope helper without disturbing the 18 pre-existing hub_log
 * tests, all of which continue to assert byte-identical console.* output.
 *
 * Gates:
 *   (1) source: hub_log.ts declares hubEvent at file scope with a stable
 *       public signature
 *   (2) source: hubEvent is gated by `WOCLAW_LOG_FORMAT === 'json'` so the
 *       default path is byte-identical (no-op when env is unset)
 *   (3) runtime default mode (env unset): hubEvent emits nothing to
 *       console.* — preserves 28+ existing call sites with zero behavior
 *       change
 *   (4) runtime json mode: hubEvent emits a single NDJSON line to the
 *       matching console.* channel, with the canonical envelope shape
 *       (ts / level / event / trace_id / span_id / topic_id / session_key /
 *       agent_id / duration_ms / attrs)
 *   (5) runtime json mode: hubEvent routes each HubLogLevel to the matching
 *       console.* method (info→log, warn→warn, error→error)
 *   (6) runtime json mode: optional context fields are omitted from the
 *       JSON object when undefined (sparse envelope, not full shape dump)
 *   (7) runtime json mode: attrs payload survives JSON round-trip
 *   (8) regression: pre-existing hubLog/hubWarn/hubError helpers remain
 *       byte-identical (the 3 spec gates — see hub_log.test.ts suite 1 — are
 *       re-verified here to confirm this round did not break them)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUB_LOG_PATH = join(__dirname, '..', 'src', 'hub_log.ts');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('hub/src/hub_log.ts hubEvent helper (round 57 observability-envelope PoC)', () => {
  const ORIGINAL_ENV = process.env.WOCLAW_LOG_FORMAT;

  beforeEach(() => {
    // Reset env per-test so a previous test's mutation cannot leak forward.
    delete process.env.WOCLAW_LOG_FORMAT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL_ENV === undefined) {
      delete process.env.WOCLAW_LOG_FORMAT;
    } else {
      process.env.WOCLAW_LOG_FORMAT = ORIGINAL_ENV;
    }
  });

  it('source: hubEvent is declared at file scope with a stable signature', () => {
    const src = readSrc(HUB_LOG_PATH);
    expect(src).toMatch(/export function hubEvent\(input: HubEventInput\): void \{/);
  });

  it('source: HubEventInput type declares level + event + optional attrs/context', () => {
    const src = readSrc(HUB_LOG_PATH);
    expect(src).toMatch(/export interface HubEventInput \{/);
    expect(src).toMatch(/level:\s*HubLogLevel/);
    expect(src).toMatch(/event:\s*string/);
    expect(src).toMatch(/attrs\?:\s*HubEventAttrs/);
    expect(src).toMatch(/context\?:\s*HubEventContext/);
  });

  it('source: helper is gated by `WOCLAW_LOG_FORMAT === "json"` env check', () => {
    const src = readSrc(HUB_LOG_PATH);
    expect(src).toMatch(/process\.env\.WOCLAW_LOG_FORMAT\s*===\s*['"]json['"]/);
  });

  it('runtime default (env unset): hubEvent is a no-op — preserves 28+ legacy sites', async () => {
    delete process.env.WOCLAW_LOG_FORMAT;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Dynamic import so the spy attaches after module load — same pattern as
    // db_log.test.ts runtime gates.
    const mod = await import('../src/hub_log.js');
    mod.hubEvent({ level: 'info', event: 'hub.topic.created', context: { topic_id: 't-1' } });
    mod.hubEvent({ level: 'warn', event: 'hub.session.expired' });
    mod.hubEvent({ level: 'error', event: 'hub.db.connect_failed', attrs: { host: 'localhost' } });
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('runtime default (env="text"): hubEvent is a no-op — explicit text mode stays legacy', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'text';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/hub_log.js');
    mod.hubEvent({ level: 'info', event: 'hub.topic.created' });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('runtime json mode: hubEvent emits one NDJSON line on the matching console.* channel (info→log)', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/hub_log.js');
    mod.hubEvent({
      level: 'info',
      event: 'hub.topic.created',
      context: { topic_id: 't-42', trace_id: 'a1b2c3d4e5f6a7b8' },
      attrs: { peer_count: 3 },
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0] as string;
    expect(typeof line).toBe('string');
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('hub.topic.created');
    expect(parsed.topic_id).toBe('t-42');
    expect(parsed.trace_id).toBe('a1b2c3d4e5f6a7b8');
    expect(parsed.attrs).toEqual({ peer_count: 3 });
    expect(typeof parsed.ts).toBe('number');
  });

  it('runtime json mode: warn level routes to console.warn', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/hub_log.js');
    mod.hubEvent({ level: 'warn', event: 'hub.session.expiring', context: { session_key: 's-1' } });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const parsed = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(parsed.level).toBe('warn');
    expect(parsed.session_key).toBe('s-1');
  });

  it('runtime json mode: error level routes to console.error', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('../src/hub_log.js');
    mod.hubEvent({ level: 'error', event: 'hub.db.connect_failed', attrs: { host: 'mysql.local', port: 3306 } });
    expect(errSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(parsed.level).toBe('error');
    expect(parsed.event).toBe('hub.db.connect_failed');
    expect(parsed.attrs).toEqual({ host: 'mysql.local', port: 3306 });
  });

  it('runtime json mode: undefined context fields are omitted from the envelope (sparse, not full-shape dump)', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/hub_log.js');
    mod.hubEvent({ level: 'info', event: 'hub.boot' });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).not.toHaveProperty('trace_id');
    expect(parsed).not.toHaveProperty('span_id');
    expect(parsed).not.toHaveProperty('topic_id');
    expect(parsed).not.toHaveProperty('session_key');
    expect(parsed).not.toHaveProperty('agent_id');
    expect(parsed).not.toHaveProperty('duration_ms');
    expect(parsed).not.toHaveProperty('attrs');
    // Only the always-present fields survive.
    expect(Object.keys(parsed).sort()).toEqual(['event', 'level', 'ts']);
  });

  it('runtime json mode: duration_ms is preserved as a number (numeric coercion safe)', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/hub_log.js');
    mod.hubEvent({
      level: 'info',
      event: 'hub.request.served',
      context: { duration_ms: 17, topic_id: 't-1' },
    });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.duration_ms).toBe(17);
    expect(typeof parsed.duration_ms).toBe('number');
  });

  it('runtime json mode: attrs payload round-trips through JSON serialization', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/hub_log.js');
    const attrs = { retry: 3, host: 'mysql.local', nested: { ok: true } };
    mod.hubEvent({ level: 'info', event: 'hub.op', attrs });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.attrs).toEqual(attrs);
    // Round-trip must reconstruct the same nested shape.
    expect(parsed.attrs.nested.ok).toBe(true);
  });
});

describe('hub/src/hub_log.ts round-57 regression: legacy hubLog/hubWarn/hubError remain unchanged', () => {
  // These three gates re-verify the byte-identical pre-refactor contract that
  // round 57 must NOT break. If any of these fail, the envelope PoC has
  // introduced a behavior change to a 28+ call site — block the ship.
  it('source: hubLog helper body still routes to console.log with `[WoClaw]` prefix', () => {
    const src = readSrc(HUB_LOG_PATH);
    expect(src).toMatch(
      /export function hubLog\(msg: string, \.\.\.args: unknown\[\]\): void \{\s*console\.log\(`\[WoClaw\] \$\{msg\}`, \.\.\.args\);\s*\}/,
    );
  });

  it('source: hubWarn helper body still routes to console.warn with `[WoClaw]` prefix', () => {
    const src = readSrc(HUB_LOG_PATH);
    expect(src).toMatch(
      /export function hubWarn\(msg: string, \.\.\.args: unknown\[\]\): void \{\s*console\.warn\(`\[WoClaw\] \$\{msg\}`, \.\.\.args\);\s*\}/,
    );
  });

  it('source: hubError helper body still routes to console.error with `[WoClaw]` prefix', () => {
    const src = readSrc(HUB_LOG_PATH);
    expect(src).toMatch(
      /export function hubError\(msg: string, \.\.\.args: unknown\[\]\): void \{\s*console\.error\(`\[WoClaw\] \$\{msg\}`, \.\.\.args\);\s*\}/,
    );
  });

  it('runtime: hubLog("test") still emits exactly `[WoClaw] test` to console.log (byte-identity gate)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/hub_log.js');
    mod.hubLog('test');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[WoClaw] test');
  });
});
