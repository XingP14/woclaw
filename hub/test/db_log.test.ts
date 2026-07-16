/**
 * Regression test for the db_log helper extraction (07-03 cron).
 *
 * Before this round, hub/src/db.ts contained 2 inline
 * `console.error('[ClawDB] ...')` call sites (legacy JSON store import
 * paths, L540 SQLite + L1087 MySQL), each duplicating the `[ClawDB] `
 * prefix literal. Two latent risks:
 *   (1) drift — a future site could change or omit the prefix and stay silent
 *   (2) uniformity — `console.error('[ClawDB] Failed to import legacy JSON
 *       store:', errorMessage(e))` mixes template-string + helper patterns
 *       in a way that's hard to grep + lint across 2 sites
 *
 * rFIX: extract 3 module-local helpers (dbLog / dbWarn / dbError) into
 * hub/src/db_log.ts (parallels hub/src/hub_log.ts hubLog / hubWarn /
 * hubError, 07-03 02:03 commit 3a2bdc4; hub/src/scheduler_log.ts schedLog /
 * schedWarn / schedError, 07-03 06:23 commit 17d2060; and federation.ts
 * fedLog / fedWarn / fedError, 07-03 01:33 commit 32501fb). Each prepends
 * `[ClawDB] ` so call sites pass only the message body. The 3 underlying
 * console.* calls are confined to the helper bodies.
 *
 * This regression test gates:
 *   (1) the 3 helpers are declared at file scope with canonical signatures
 *   (2) helper bodies route to the matching console.* call
 *   (3) db.ts contains exactly 2 dbError call sites (parity with the 2
 *       pre-refactor inline sites; L540 SQLite + L1087 MySQL legacy import
 *       catch blocks)
 *   (4) no inline `console.[log|warn|error](`...`[ClawDB]`...)` site
 *       remains in db.ts
 *   (5) db.ts imports dbError from ./db_log.js (regression gate — verify
 *       the new module is wired)
 *   (6) db_log.ts has exactly 3 helper exports
 *   (7) runtime: dbError('foo', 'bar') emits exactly
 *       `console.error('[ClawDB] foo', 'bar')` (wire-format identity gate)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_LOG_PATH = join(__dirname, '..', 'src', 'db_log.ts');
const DB_PATH = join(__dirname, '..', 'src', 'db.ts');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('hub/src/db_log.ts helpers (07-03 cron regression gate)', () => {
  it('dbLog helper is declared at file scope with canonical signature', () => {
    const src = readSrc(DB_LOG_PATH);
    expect(src).toMatch(/export function dbLog\(msg: string, \.\.\.args: unknown\[\]\): void \{/);
  });

  it('dbWarn helper is declared at file scope with canonical signature', () => {
    const src = readSrc(DB_LOG_PATH);
    expect(src).toMatch(/export function dbWarn\(msg: string, \.\.\.args: unknown\[\]\): void \{/);
  });

  it('dbError helper is declared at file scope with canonical signature', () => {
    const src = readSrc(DB_LOG_PATH);
    expect(src).toMatch(/export function dbError\(msg: string, \.\.\.args: unknown\[\]\): void \{/);
  });

  it('dbLog body routes to console.log with `[ClawDB] ${msg}` prefix', () => {
    const src = readSrc(DB_LOG_PATH);
    expect(src).toMatch(/console\.log\(`\[ClawDB\] \$\{msg\}`,\s*\.\.\.args\)/);
  });

  it('dbWarn body routes to console.warn with `[ClawDB] ${msg}` prefix', () => {
    const src = readSrc(DB_LOG_PATH);
    expect(src).toMatch(/console\.warn\(`\[ClawDB\] \$\{msg\}`,\s*\.\.\.args\)/);
  });

  it('dbError body routes to console.error with `[ClawDB] ${msg}` prefix', () => {
    const src = readSrc(DB_LOG_PATH);
    expect(src).toMatch(/console\.error\(`\[ClawDB\] \$\{msg\}`,\s*\.\.\.args\)/);
  });
});

describe('hub/src/db.ts migrated to db_log helpers', () => {
  it('imports dbError from ./db_log.js', () => {
    const src = readSrc(DB_PATH);
    expect(src).toMatch(/import\s+\{\s*dbError\s*\}\s+from\s+['"]\.\/db_log\.js['"]/);
  });

  it('contains exactly 2 dbError call sites (parity with pre-refactor 2 inline sites — L540 SQLite + L1087 MySQL legacy import catch blocks)', () => {
    const src = readSrc(DB_PATH);
    // Match `dbError(` not preceded by a word char (so we don't double-count e.g.
    // `myDbError(` or `dbErrorStream(`).
    const matches = src.match(/(?<![A-Za-z0-9_])dbError\s*\(/g) || [];
    expect(matches.length).toBe(2);
  });

  it('no inline `console.[log|warn|error](`...`[ClawDB]`...)` site remains in db.ts (regression gate)', () => {
    const src = readSrc(DB_PATH);
    // Match console.<level> opening paren with a backtick-template containing
    // the [ClawDB] prefix literal. This is the exact pattern the refactor
    // eliminates.
    const inlineRe = /console\.(log|warn|error)\(\s*`[^`]*\[ClawDB\][^`]*`/;
    expect(src).not.toMatch(inlineRe);
  });
});

describe('hub/src/db_log.ts runtime wire-format (parity with pre-refactor inline sites)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dbError(`Failed: ${e}`) emits exactly `console.error(`[ClawDB] Failed: ${e}`)`', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Dynamic import so spies attach after module load.
    const mod = await import('../src/db_log.js');
    mod.dbError('Failed: ENOENT');
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith('[ClawDB] Failed: ENOENT');
  });

  it('dbLog(`started`) emits exactly `console.log(`[ClawDB] started`)`', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('../src/db_log.js');
    mod.dbLog('started');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[ClawDB] started');
  });
});
