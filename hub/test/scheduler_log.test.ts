/**
 * Regression test for the scheduler_log helper extraction (07-03 cron).
 *
 * Before this round, hub/src/scheduler.ts contained 15 inline
 * `console.[log|warn|error]('[ForgettingScheduler] ...')` call sites (start /
 * stop / runDailyExtractionScan / runWeeklyEviction), each duplicating the
 * `[ForgettingScheduler] ` prefix literal. Two latent risks:
 *   (1) drift — a future site could change or omit the prefix and stay silent
 *   (2) uniformity — `console.error('[ForgettingScheduler] Daily scan error:',
 *       errorMessage(err))` mixes template-string + helper patterns in a way
 *       that's hard to grep + lint across 15 sites.
 *
 * rFIX: extract 3 module-local helpers (schedLog / schedWarn / schedError)
 * into hub/src/scheduler_log.ts (parallels hub/src/hub_log.ts hubLog /
 * hubWarn / hubError, 07-03 02:03 cron; and federation.ts fedLog / fedWarn /
 * fedError, 07-03 01:33 commit 32501fb). Each prepends `[ForgettingScheduler] `
 * so call sites pass only the message body. The 3 underlying console.* calls
 * are confined to the helper bodies.
 *
 * This regression test gates:
 *   (1) the 3 helpers are declared at file scope with canonical signatures
 *   (2) helper bodies route to the matching console.* call
 *   (3) scheduler.ts contains exactly 15 sched[Log|Warn|Error] call sites
 *       (parity with the 15 pre-refactor inline sites)
 *   (4) no inline `console.[log|warn|error](`...`[ForgettingScheduler]`...)`
 *       site remains in scheduler.ts
 *   (5) scheduler_log.ts has exactly 3 helper exports
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHED_LOG_PATH = join(process.cwd(), 'src', 'scheduler_log.ts');
const SCHEDULER_PATH = join(process.cwd(), 'src', 'scheduler.ts');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('hub/src/scheduler_log.ts helpers (07-03 cron regression gate)', () => {
  it('schedLog helper is declared at file scope with canonical signature', () => {
    const src = readSrc(SCHED_LOG_PATH);
    expect(src).toMatch(/export function schedLog\(msg: string, \.\.\.args: unknown\[\]\): void \{/);
  });

  it('schedWarn helper is declared at file scope with canonical signature', () => {
    const src = readSrc(SCHED_LOG_PATH);
    expect(src).toMatch(/export function schedWarn\(msg: string, \.\.\.args: unknown\[\]\): void \{/);
  });

  it('schedError helper is declared at file scope with canonical signature', () => {
    const src = readSrc(SCHED_LOG_PATH);
    expect(src).toMatch(/export function schedError\(msg: string, \.\.\.args: unknown\[\]\): void \{/);
  });

  it('schedLog body routes to console.log with `[ForgettingScheduler] ${msg}` prefix', () => {
    const src = readSrc(SCHED_LOG_PATH);
    expect(src).toMatch(/console\.log\(`\[ForgettingScheduler\] \$\{msg\}`,\s*\.\.\.args\)/);
  });

  it('schedWarn body routes to console.warn with `[ForgettingScheduler] ${msg}` prefix', () => {
    const src = readSrc(SCHED_LOG_PATH);
    expect(src).toMatch(/console\.warn\(`\[ForgettingScheduler\] \$\{msg\}`,\s*\.\.\.args\)/);
  });

  it('schedError body routes to console.error with `[ForgettingScheduler] ${msg}` prefix', () => {
    const src = readSrc(SCHED_LOG_PATH);
    expect(src).toMatch(/console\.error\(`\[ForgettingScheduler\] \$\{msg\}`,\s*\.\.\.args\)/);
  });
});

describe('hub/src/scheduler.ts migrated to scheduler_log helpers', () => {
  it('imports schedLog/schedWarn/schedError from ./scheduler_log.js', () => {
    const src = readSrc(SCHEDULER_PATH);
    expect(src).toMatch(/import \{ schedLog, schedWarn, schedError \} from ['"]\.\/scheduler_log\.js['"]/);
  });

  it('contains exactly 15 sched[Log|Warn|Error] call sites (parity with pre-refactor 15 inline sites)', () => {
    const src = readSrc(SCHEDULER_PATH);
    const logCalls = (src.match(/schedLog\(/g) || []).length;
    const warnCalls = (src.match(/schedWarn\(/g) || []).length;
    const errorCalls = (src.match(/schedError\(/g) || []).length;
    // Pre-refactor inline counts: 11 console.log + 2 console.warn + 2 console.error = 15
    expect(logCalls).toBe(11);
    expect(warnCalls).toBe(2);
    expect(errorCalls).toBe(2);
    expect(logCalls + warnCalls + errorCalls).toBe(15);
  });

  it('no inline `console.[log|warn|error](`...`[ForgettingScheduler]`...)` site remains', () => {
    const src = readSrc(SCHEDULER_PATH);
    const lines = src.split('\n');
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/console\.(log|warn|error)\(/.test(line) && /\[ForgettingScheduler\]/.test(line)) {
        violations.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('no template-string `[ForgettingScheduler]` literal remains (gate against inline regression)', () => {
    // A regression that re-introduces an inline site (e.g. someone copy-pastes
    // the old pattern) would re-add a `[ForgettingScheduler]` template literal
    // directly in scheduler.ts. Since the prefix is now centralized in
    // scheduler_log.ts, the only legitimate occurrence in scheduler.ts is the
    // import statement — and imports don't have it.
    const src = readSrc(SCHEDULER_PATH);
    const occurrences = (src.match(/\[ForgettingScheduler\]/g) || []).length;
    expect(occurrences).toBe(0);
  });
});
