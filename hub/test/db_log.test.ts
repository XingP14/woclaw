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
 * Extension (07-17 02:03 cron, chain #30 db_log parity):
 *   (8) runtime: dbWarn emits `[ClawDB] ${msg}` exactly via console.warn
 *   (9) runtime: dbError/dbWarn spread ...args verbatim to console.*
 *   (10) source: db_log.ts declares exactly 3 export function helpers and
 *        exactly 3 console.* call sites inside helper bodies (one per level)
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

describe('hub/src/db_log.ts runtime parity (extension — closes dbWarn + ...args spread gaps)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Gap closed: parity with hub_log/hubWarn (covered at hub_log.test.ts), but
  // db_log.test.ts previously only had runtime cases for dbError + dbLog.
  // dbWarn body must route to console.warn with the same `[ClawDB] ${msg}`
  // template prefix the dbError body uses.
  it('dbWarn(`idempotency miss for key ${k}`) emits exactly `console.warn(`[ClawDB] idempotency miss for key ${k}`)`', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('../src/db_log.js');
    mod.dbWarn('idempotency miss for key abc-123');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[ClawDB] idempotency miss for key abc-123');
  });

  // Gap closed: db_log.ts helpers all declare `...args: unknown[]` so callers
  // can pass trailing context (e.g. dbError('Failed:', e)). The inline sites
  // in db.ts used the same trailing-arg shape (dbError('Failed to import legacy
  // JSON store:', errorMessage(e))), so the spread must route through verbatim.
  it('dbError(`Failed:`, errObj) spreads ...args and emits `console.error(`[ClawDB] Failed:`, errObj)`', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('../src/db_log.js');
    const errObj = new Error('ENOENT: no such file');
    mod.dbError('Failed:', errObj);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith('[ClawDB] Failed:', errObj);
  });

  // Gap closed: confirm ...args spread works for warn-level too (parity gate
  // across all 3 helpers — the helper bodies are byte-identical except for the
  // console.* method, so each helper must accept and forward variadic args).
  it('dbWarn(`migration drift detected`, count) spreads ...args to console.warn', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('../src/db_log.js');
    mod.dbWarn('migration drift detected', 42);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[ClawDB] migration drift detected', 42);
  });

  // Gap closed: source-level sanity gate — db_log.ts should declare exactly 3
  // `export function` helper bodies (dbLog/dbWarn/dbError) and contain exactly
  // 3 console.* call sites, all of them inside the helper bodies. This catches
  // accidental duplication of the prefix literal or introduction of an
  // additional inline call site.
  it('source sanity: db_log.ts declares exactly 3 helpers and exactly 3 console.* calls inside helper bodies', () => {
    const src = readSrc(DB_LOG_PATH);
    const codeOnly = src.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
    const helperCount = (codeOnly.match(/export function db(Log|Warn|Error)\(/g) || []).length;
    expect(helperCount).toBe(3);
    const logCount = (codeOnly.match(/console\.log\(/g) || []).length;
    const warnCount = (codeOnly.match(/console\.warn\(/g) || []).length;
    const errorCount = (codeOnly.match(/console\.error\(/g) || []).length;
    expect(logCount).toBe(1);
    expect(warnCount).toBe(1);
    expect(errorCount).toBe(1);
  });
});
