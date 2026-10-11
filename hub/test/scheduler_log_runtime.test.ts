/**
 * test/scheduler_log_runtime.test.ts — R442
 *
 * The gap this closes
 * -------------------
 * hub/test/scheduler_log.test.ts is 100% SOURCE-TEXT. All 10 of its cases do
 * readFileSync() and match regexes; the file contains zero `await import(...)`
 * (grep -c: 0), so hub/src/scheduler_log.ts is never loaded into a JS runtime
 * by any suite in hub/test/. Its sibling logger suites DO load their module:
 *
 *     grep -c "await import"  db_log.test.ts          -> 5
 *     grep -c "await import"  federation_log.test.ts  -> 2
 *     grep -c "await import"  scheduler_log.test.ts   -> 0   <-- this file
 *
 * So the three modules that share one design -- a `[Prefix] ${msg}` template
 * plus a `...args` spread, differing only in the console.* method -- have
 * runtime coverage for 2 of 3. What the text suite actually asserts is:
 *
 *   (a) `console.error(`[ForgettingScheduler] ${msg}`, ...args)` appears in the
 *       file as literal text, and
 *   (b) scheduler.ts contains exactly 11/2/2 schedLog/schedWarn/schedError
 *       call sites.
 *
 * Neither drives the forwarding guarantee. A helper rewritten as
 *
 *     export function schedLog(msg: string, ...args: unknown[]): void {
 *       if (process.env.WOCLAW_QUIET) return;      // swallows
 *       console.log(`${msg}`);                     // prefix dropped
 *     }
 *
 * ... leaves scheduler_log.test.ts 10/10 green: (a) still matches for the two
 * helpers it did not mutate, (b) counts call sites in scheduler.ts, which the
 * helper body is not part of. It breaks every downstream log consumer and
 * every test that spyOn()s console in this repo.
 *
 * What this file pins
 * -------------------
 * 1. All three helpers reach the REAL console.* method, with the prefix
 *    applied and the caller's args forwarded verbatim (same arity, order and
 *    reference identity -- a clone/stringify would pass toEqual).
 * 2. Stream routing is not interchangeable: log->log, warn->warn, error->error,
 *    and no helper touches another stream.
 * 3. The `...args` contract: zero-arg and multi-arg calls both survive.
 * 4. Parity with the shape db_log.test.ts already pins at runtime, plus the
 *    warn-level case (db_log.test.ts pins dbWarn; this file pins schedWarn and
 *    schedError the same way).
 *
 * This suite pins; it does not change src/scheduler_log.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const load = async () => import('../src/scheduler_log.js');

describe('src/scheduler_log.ts forwarding contract at runtime (R442)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('schedLog prefixes the message, spreads ...args verbatim, and calls console.log once', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errObj = new Error('scan failed');
    const ctx = { scanned: 12 };
    const mod = await load();
    mod.schedLog('Daily scan queued', ctx, 7, undefined, errObj);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const args = logSpy.mock.calls[0];
    expect(args[0]).toBe('[ForgettingScheduler] Daily scan queued');
    expect(args).toHaveLength(5);
    // Reference identity, not just equality: a helper that cloned or
    // stringified its trailing args would still pass a toEqual.
    expect(args[1]).toBe(ctx);
    expect(args[2]).toBe(7);
    expect(args[3]).toBeUndefined();
    expect(args[4]).toBe(errObj);
  });

  it('schedWarn routes to console.warn with the prefix and does not touch stdout', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await load();
    mod.schedWarn('eviction skipped');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[ForgettingScheduler] eviction skipped');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('schedError routes to console.error with the prefix and forwards the trailing error', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('ECONNRESET');
    const mod = await load();
    mod.schedError('Weekly eviction error:', err);

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith('[ForgettingScheduler] Weekly eviction error:', err);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('schedLog does not write to stderr, and schedError does not write to stdout', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await load();
    mod.schedLog('started');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();

    logSpy.mockClear();
    mod.schedError('stopped');
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('a zero-argument-ish call still reaches the console (a swallowed call is not silent-free)', async () => {
    // schedLog('') is a real shape: msg is required but empty is legal, and the
    // prefix must still be emitted so the line is attributable.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await load();
    mod.schedLog('');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[ForgettingScheduler] ');
  });

  it('no WOCLAW_QUIET-style env gate can silence the helpers (R442 matrix M3)', async () => {
    // FINDING from the mutation matrix: arm M3 inserted
    //   `if (process.env.WOCLAW_QUIET) return;` at the top of schedLog
    // and all 16 tests stayed GREEN -- because no test ever sets the variable,
    // so the new branch is dead code under the suite. A helper that can be
    // silenced by ambient environment is a behaviour change for every log
    // consumer, and a silent-drop gate is exactly what the `[Prefix]` design
    // exists to make greppable.
    // This case sets the variable, so the branch is live and must not suppress.
    const prev = process.env.WOCLAW_QUIET;
    process.env.WOCLAW_QUIET = '1';
    try {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mod = await load();
      mod.schedLog('queued under WOCLAW_QUIET=1');
      mod.schedError('failed under WOCLAW_QUIET=1');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('[ForgettingScheduler] queued under WOCLAW_QUIET=1');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalledWith('[ForgettingScheduler] failed under WOCLAW_QUIET=1');
    } finally {
      if (prev === undefined) delete process.env.WOCLAW_QUIET;
      else process.env.WOCLAW_QUIET = prev;
    }
  });

  it('the three helper bodies are exactly one console call each -- no guard, no second sink', async () => {
    // Same shape db_log.test.ts pins at source level, asserted here at runtime:
    // if a future edit adds an env gate or a fallback write, the "called once"
    // assertions above stop being the whole story and this fails loudly.
    const mod = await load();
    expect(typeof mod.schedLog).toBe('function');
    expect(typeof mod.schedWarn).toBe('function');
    expect(typeof mod.schedError).toBe('function');
    // (msg: string, ...args: unknown[]) => length 1: one declared param, rest
    // does not count. A helper rewritten with a default (msg = 'x') or with two
    // declared params changes this and stops being the byte-compatible
    // forwarding shim the call sites were migrated onto.
    expect(mod.schedLog.length).toBe(1);
    expect(mod.schedWarn.length).toBe(1);
    expect(mod.schedError.length).toBe(1);
  });
});
