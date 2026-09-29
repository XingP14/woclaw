/**
 * Gap-closure tests for hub/src/hub_log.ts `hubEvent` (2026-09-30 02:03 tick).
 *
 * Fresh full-repo `npx vitest run --coverage` reported hub_log.ts at
 * 24/27 branches (3 dark arms). Existing coverage in hub_event.test.ts is
 * excellent but structurally blind to two surfaces:
 *
 *   1. The `catch` fallback at hub_log.ts:136-142. Its own comment says
 *      "keep observability non-fatal even on pathological input" — but
 *      nothing ever made JSON.stringify throw, so the fallback had ZERO
 *      execution. That is the highest-risk dark arm in the file: a
 *      regression that drops the try/catch (or narrows it) turns a single
 *      malformed `attrs` bag into an uncaught TypeError inside a log call,
 *      i.e. observability becomes fatal — the exact opposite of the
 *      documented contract. It also silently drops every optional context
 *      field, so a collector sees a well-formed line with no trace_id.
 *
 *   2. The sparse-envelope false arms for `span_id` and `session_key`
 *      (hub_log.ts:129 and :132). Existing cases only ever supply
 *      `topic_id`, so the "field is absent" arm for those two keys was
 *      never observed, leaving room for a one-sided edit (e.g. changing
 *      `!== undefined` to a truthiness check) that would drop a valid
 *      `span_id: ''` or `session_key: 0` without any test turning red.
 *
 * Gates:
 *   (A) json mode + circular attrs -> single fallback NDJSON line on the
 *       matching console.* channel, carrying ts/level/event and the
 *       '<unserializable>' attrs marker, and NOT throwing
 *   (B) json mode + bigint attrs -> same fallback (second serializer
 *       thrower, different from circular refs)
 *   (C) fallback fires per level, so the catch cannot leak a mis-routed
 *       channel (info->log, warn->warn, error->error)
 *   (D) json mode + fully-populated context -> all 6 context keys plus
 *       attrs survive, and each `!== undefined` guard is exercised with a
 *       present value
 *   (E) json mode + context supplied but empty -> every optional key is
 *       absent (sparse envelope preserved)
 *   (F) json mode + falsy-but-defined context values (span_id '', 
 *       session_key 0) -> the `!== undefined` guards keep them (guards are
 *       presence checks, not truthiness checks)
 *   (G) default (env unset) mode -> hubEvent stays a no-op even with
 *       circular attrs, so the thrower never reaches console at all
 *   (H) after (A), the next well-formed event still emits a full envelope
 *       — the fallback does not latch any module state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MOD_PATH = '../src/hub_log.js';

function circular(): Record<string, unknown> {
  const o: Record<string, unknown> = { name: 'loop' };
  o.self = o;
  return o;
}

describe('hub/src/hub_log.ts hubEvent unserializable-attrs fallback + context-guard arms', () => {
  const ORIGINAL_ENV = process.env.WOCLAW_LOG_FORMAT;

  beforeEach(() => {
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

  // --- (A) circular attrs -------------------------------------------------
  it('json mode: circular attrs throw inside JSON.stringify -> fallback envelope with <unserializable> marker, no throw', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import(MOD_PATH);

    expect(() =>
      mod.hubEvent({ level: 'info', event: 'hub.op', attrs: circular() }),
    ).not.toThrow();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.event).toBe('hub.op');
    expect(parsed.level).toBe('info');
    expect(typeof parsed.ts).toBe('number');
    expect(parsed.attrs).toBe('<unserializable>');
  });

  // --- (B) bigint attrs ---------------------------------------------------
  it('json mode: bigint attrs also hit the fallback (second serializer thrower)', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import(MOD_PATH);

    // BigInt throws TypeError in JSON.stringify — a distinct code path
    // from the circular-reference case above, so the catch must be
    // generic, not `e.code === 'CIRCULAR'`.
    mod.hubEvent({ level: 'info', event: 'hub.op', attrs: { big: BigInt(7) } });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.attrs).toBe('<unserializable>');
  });

  // --- (C) per-level routing of the fallback ------------------------------
  it('json mode: the fallback line is routed to the console channel matching each level', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import(MOD_PATH);

    mod.hubEvent({ level: 'warn', event: 'hub.a', attrs: circular() });
    mod.hubEvent({ level: 'error', event: 'hub.b', attrs: circular() });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string).attrs).toBe('<unserializable>');
    expect(JSON.parse(errSpy.mock.calls[0][0] as string).attrs).toBe('<unserializable>');
  });

  // --- (D) fully-populated context ----------------------------------------
  it('json mode: fully-populated context emits all 6 context keys plus attrs', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import(MOD_PATH);

    mod.hubEvent({
      level: 'info',
      event: 'hub.topic.created',
      context: {
        trace_id: 't-123',
        span_id: 's-456',
        topic_id: 'tp-1',
        session_key: 'sk-1',
        agent_id: 'ag-1',
        duration_ms: 42,
      },
      attrs: { ok: true },
    });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.trace_id).toBe('t-123');
    expect(parsed.span_id).toBe('s-456');
    expect(parsed.topic_id).toBe('tp-1');
    expect(parsed.session_key).toBe('sk-1');
    expect(parsed.agent_id).toBe('ag-1');
    expect(parsed.duration_ms).toBe(42);
    expect(parsed.attrs).toEqual({ ok: true });
  });

  // --- (E) empty context -> sparse envelope -------------------------------
  it('json mode: empty context object keeps the envelope sparse (no context keys)', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import(MOD_PATH);

    mod.hubEvent({ level: 'info', event: 'hub.op', context: {} });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(Object.keys(parsed).sort()).toEqual(['event', 'level', 'ts']);
  });

  // --- (F) falsy-but-defined context values -------------------------------
  it('json mode: falsy-but-defined context values are preserved (guards are !undefined, not truthiness)', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import(MOD_PATH);

    mod.hubEvent({
      level: 'info',
      event: 'hub.op',
      context: { span_id: '', session_key: 0, duration_ms: 0 },
    });

    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toHaveProperty('span_id', '');
    expect(parsed).toHaveProperty('session_key', 0);
    expect(parsed).toHaveProperty('duration_ms', 0);
  });

  // --- (G) default mode stays a no-op -------------------------------------
  it('default mode: circular attrs never reach console (hubEvent no-ops before serializing)', async () => {
    delete process.env.WOCLAW_LOG_FORMAT;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import(MOD_PATH);

    expect(() =>
      mod.hubEvent({ level: 'warn', event: 'hub.op', attrs: circular() }),
    ).not.toThrow();

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // --- (H) fallback does not latch state ----------------------------------
  it('json mode: a well-formed event after a fallback still emits a full envelope', async () => {
    process.env.WOCLAW_LOG_FORMAT = 'json';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import(MOD_PATH);

    mod.hubEvent({ level: 'info', event: 'hub.bad', attrs: circular() });
    mod.hubEvent({
      level: 'info',
      event: 'hub.good',
      context: { trace_id: 't-9' },
      attrs: { fine: 1 },
    });

    expect(logSpy).toHaveBeenCalledTimes(2);
    const second = JSON.parse(logSpy.mock.calls[1][0] as string);
    expect(second.event).toBe('hub.good');
    expect(second.trace_id).toBe('t-9');
    expect(second.attrs).toEqual({ fine: 1 });
  });
});
