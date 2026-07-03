/**
 * Regression test for hub/src/memory.ts:337 notifySubscribers catch migration
 * to hubError helper (07-04 05:05 cron, helper-extraction chain #8).
 *
 * Before this round, hub/src/memory.ts contained 1 inline
 * `console.error('Error notifying subscriber:', ...)` call site in
 * MemoryPool.notifySubscribers catch block, duplicating the [WoClaw] prefix
 * pattern that's already centralized in hub/src/hub_log.ts hubError helper
 * (07-03 02:03 commit 3a2bdc4, hub_log 28-site chain). The inline site was
 * the ONLY remaining bare `console.error(...)` call outside of the
 * startup-banner blocks in hub/src/index.ts (which intentionally use
 * non-prefixed format for human readability of the startup summary).
 *
 * Why migrate:
 *   (1) drift — a future site could change the prefix or omit it entirely
 *   (2) uniformity — `hubError('foo', x)` is consistent with rest_server,
 *       ws_server, federation's fedError, scheduler's schedError, db's dbError
 *       so log-greppers can find all hub-scoped errors via `[WoClaw]` token
 *   (3) noise-gating parity — future round may want to gate hubError by
 *       NODE_ENV/JEST_WORKER_ID for jest --silent, mirroring src/core/
 *       pattern; migrating inline sites upfront means the gate applies
 *       uniformly without having to re-touch stragglers
 *
 * rFIX: (1) `hub/src/memory.ts` add `import { hubError } from './hub_log.js';`
 * after the errorMessage import. (2) Replace the inline
 * `console.error('Error notifying subscriber:', errorMessage(e));` with
 * `hubError('Error notifying subscriber:', errorMessage(e));`. The wire-format
 * is byte-identical: hubError('foo', x) emits exactly
 * console.error(`[WoClaw] foo`, x).
 *
 * This regression test gates:
 *   (1) memory.ts imports hubError from ./hub_log.js
 *   (2) memory.ts has exactly 1 hubError call site (notifySubscribers L337)
 *   (3) memory.ts has 0 inline `console.error(`...` call sites (the migration
 *       was 1:1 — pre-refactor 1 site, post-refactor 0 sites)
 *   (4) memory.ts still uses errorMessage from ./errors.js (parity check —
 *       a regression that drops the errorMessage wrapper should also fail)
 *   (5) runtime: MemoryPool.notifySubscribers with a throwing subscriber
 *       invokes hubError, NOT bare console.error. Verified by spying
 *       console.error and asserting the [WoClaw] prefix is present.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MEMORY_PATH = join(process.cwd(), 'src', 'memory.ts');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('hub/src/memory.ts:337 notifySubscribers catch migrated to hubError (07-04 05:05 cron, chain #8)', () => {
  it('imports hubError from ./hub_log.js (regression gate)', () => {
    const src = readSrc(MEMORY_PATH);
    expect(src).toMatch(
      /import\s+\{\s*hubError\s*\}\s+from\s+['"]\.\/hub_log\.js['"]/,
    );
  });

  it('contains exactly 1 hubError call site (notifySubscribers L337)', () => {
    const src = readSrc(MEMORY_PATH);
    // Match `hubError(` not preceded by a word char (so we don't double-count
    // e.g. `myHubError(` or `hubErrorStream(`).
    const matches = src.match(/(?<![A-Za-z0-9_])hubError\s*\(/g) || [];
    expect(matches.length).toBe(1);
  });

  it('contains 0 inline `console.error(` call sites in src/memory.ts (regression gate)', () => {
    const src = readSrc(MEMORY_PATH);
    // Match bare console.error opening paren (not inside `console.error(`...`)
    // used as a string literal in a comment). Strip comments first.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/\/\/.*$/gm, '');           // line comments
    const consoleErrorRe = /(?<![A-Za-z0-9_])console\.error\s*\(/;
    expect(codeOnly).not.toMatch(consoleErrorRe);
  });

  it('preserves errorMessage(...) wrapper around the caught error (parity gate)', () => {
    const src = readSrc(MEMORY_PATH);
    // The migrated line should still wrap the error in errorMessage(...) so
    // structured Error objects render as a useful string instead of [object Object].
    expect(src).toMatch(
      /hubError\(\s*['"]Error notifying subscriber:['"]\s*,\s*errorMessage\(e\)\s*\)/,
    );
  });
});

describe('hub/src/memory.ts notifySubscribers runtime: hubError wire-format parity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a throwing subscriber routes the error through hubError (emits `[WoClaw] Error notifying subscriber: <msg>` via console.error)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Dynamic import so the spy attaches before module-level code runs.
    const { MemoryPool } = await import('../src/memory.js');
    // We don't need a real DB — MemoryPool only requires `db` to forward
    // .write/.read/.recall etc., but notifySubscribers is purely in-memory
    // (uses this.subscribers map). We pass a minimal stub.
    const stubDb: any = {
      // notifySubscribers doesn't call any of these, but TypeScript needs the shape.
      getMemory: async () => undefined,
      setMemory: async () => {},
      listMemory: async () => [],
      recall: async () => [],
    };
    const mp = new MemoryPool(stubDb);
    mp.subscribe('agent-throws', () => {
      throw new Error('boom-subscriber-fail');
    });
    // Trigger notify. OutboundMessage shape minimal.
    mp.notifySubscribers({
      type: 'test',
      key: 'k',
      value: 'v',
      updatedBy: 'u',
      updatedAt: 0,
      tags: [],
    });
    expect(errSpy).toHaveBeenCalledTimes(1);
    // hubError prefixes with `[WoClaw] `; the migrated line passes
    // 'Error notifying subscriber:' as the message and errorMessage(e) as the
    // trailing arg, so the full console.error call should be:
    //   console.error('[WoClaw] Error notifying subscriber:', 'boom-subscriber-fail')
    expect(errSpy).toHaveBeenCalledWith(
      '[WoClaw] Error notifying subscriber:',
      'boom-subscriber-fail',
    );
  });
});
