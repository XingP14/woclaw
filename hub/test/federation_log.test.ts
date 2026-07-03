import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the federation_log helper extraction (07-04 01:23 cron).
 *
 * Before this round the codebase contained 16 + 2 = 18 inline
 * `console.[log|warn|error]('[WoClaw Federation] ...')` call sites split
 * across two files:
 *   - hub/src/federation.ts: 16 sites (file-local helpers fedLog/fedWarn/
 *     fedError declared at top of file)
 *   - hub/src/ws_server.ts: 2 sites (L65 "Received federated memory" + L74
 *     "Sent N federated memories") — these could NOT import the file-local
 *     helpers from federation.ts and so rolled their own prefix literal,
 *     drifting outside the chain
 *
 * Two latent risks:
 *   (1) drift — a future site could change or omit the prefix and stay silent
 *   (2) uniformity — `console.log('[WoClaw Federation] Received federated
 *       memory ...')` mixes template-string + literal-prefix patterns in a
 *       way that's hard to grep + lint across both files
 *
 * rFIX: lift the 3 helpers (fedLog / fedWarn / fedError) out of
 * federation.ts into a dedicated module at hub/src/federation_log.ts
 * (parallels hub/src/hub_log.ts hubLog/hubWarn/hubError, 07-03 02:03 commit
 * 3a2bdc4; hub/src/scheduler_log.ts schedLog/schedWarn/schedError, 07-03
 * 06:23 commit 17d2060; hub/src/db_log.ts dbLog/dbWarn/dbError, 07-03 22:03
 * commit ac984c8). Each prepends `[WoClaw Federation] ` so call sites pass
 * only the message body. The 3 underlying console.* calls are confined to
 * the helper bodies. federation.ts now imports the helpers; ws_server.ts
 * (which previously couldn't reach them) gains access via the same module.
 * All 18 sites (16 federation.ts + 2 ws_server.ts) route through the
 * helpers; behavior is byte-identical (each helper emits exactly the same
 * `console.<level>(`[WoClaw Federation] ${msg}`, ...args)` shape the inline
 * sites used, so downstream log parsers / grep / stdout capture work without
 * any change).
 *
 * This regression test gates:
 *   (1) the 3 helpers are declared at file scope of federation_log.ts with
 *       canonical `export function` signatures
 *   (2) helper bodies route to the matching console.* call with the
 *       `[WoClaw Federation] ${msg}` template prefix
 *   (3) federation.ts imports fedLog/fedWarn/fedError from ./federation_log.js
 *       and contains exactly 16 call sites (parity pre-refactor) and ZERO
 *       file-local `function fed(Log|Warn|Error)` declarations
 *   (4) ws_server.ts imports fedLog from ./federation_log.js and contains
 *       exactly 2 fedLog call sites (parity pre-refactor 2 inline sites)
 *       and ZERO inline `[WoClaw Federation]` literal in either federation.ts
 *       or ws_server.ts (regression gate)
 *   (5) runtime wire-format parity: fedLog("Received federated memory 'k'
 *       from hub-1") emits exactly the same console.log call the previous
 *       inline form produced
 */

const FED_LOG_PATH = join(process.cwd(), 'src', 'federation_log.ts');
const FED_PATH = join(process.cwd(), 'src', 'federation.ts');
const WS_PATH = join(process.cwd(), 'src', 'ws_server.ts');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('hub/src/federation_log.ts helpers (07-04 01:23 cron regression gate)', () => {
  it('fedLog helper is declared at file scope with canonical export signature', () => {
    const src = readSrc(FED_LOG_PATH);
    expect(src).toMatch(/export function fedLog\(msg: string, \.\.\.args: unknown\[\]\): void \{/);
  });

  it('fedWarn helper is declared at file scope with canonical export signature', () => {
    const src = readSrc(FED_LOG_PATH);
    expect(src).toMatch(/export function fedWarn\(msg: string, \.\.\.args: unknown\[\]\): void \{/);
  });

  it('fedError helper is declared at file scope with canonical export signature', () => {
    const src = readSrc(FED_LOG_PATH);
    expect(src).toMatch(/export function fedError\(msg: string, \.\.\.args: unknown\[\]\): void \{/);
  });

  it('fedLog body routes to console.log with `[WoClaw Federation] ${msg}` prefix', () => {
    const src = readSrc(FED_LOG_PATH);
    expect(src).toMatch(/console\.log\(`\[WoClaw Federation\] \$\{msg\}`,\s*\.\.\.args\)/);
  });

  it('fedWarn body routes to console.warn with `[WoClaw Federation] ${msg}` prefix', () => {
    const src = readSrc(FED_LOG_PATH);
    expect(src).toMatch(/console\.warn\(`\[WoClaw Federation\] \$\{msg\}`,\s*\.\.\.args\)/);
  });

  it('fedError body routes to console.error with `[WoClaw Federation] ${msg}` prefix', () => {
    const src = readSrc(FED_LOG_PATH);
    expect(src).toMatch(/console\.error\(`\[WoClaw Federation\] \$\{msg\}`,\s*\.\.\.args\)/);
  });
});

describe('hub/src/federation.ts migrated to federation_log module (no file-local helpers)', () => {
  it('imports fedLog/fedWarn/fedError from ./federation_log.js', () => {
    const src = readSrc(FED_PATH);
    expect(src).toMatch(/import\s+\{\s*fedLog,\s*fedWarn,\s*fedError\s*\}\s+from\s+['"]\.\/federation_log\.js['"]/);
  });

  it('contains exactly 16 fed[Log|Warn|Error] call sites (parity with pre-refactor 16 inline sites)', () => {
    const src = readSrc(FED_PATH);
    // Match `fedLog(`, `fedWarn(`, `fedError(` not preceded by `function ` (so
    // we don't double-count the now-removed file-local helper declarations).
    const matches = src.match(/(?<!function )(?<![A-Za-z0-9_])fed(Log|Warn|Error)\s*\(/g) || [];
    expect(matches.length).toBe(16);
  });

  it('NO file-local `function fed[Log|Warn|Error]` declarations remain (lifted to federation_log.ts)', () => {
    const src = readSrc(FED_PATH);
    expect(src).not.toMatch(/^\s*function fed(Log|Warn|Error)\(/m);
  });

  it('no inline `console.[log|warn|error](`...`[WoClaw Federation]`...)` site remains in federation.ts (regression gate)', () => {
    const src = readSrc(FED_PATH);
    // Match console.<level> opening paren with a backtick-template containing
    // the [WoClaw Federation] prefix literal. This is the exact pattern the
    // refactor eliminates. (Excludes the 3 helper bodies now living in
    // federation_log.ts which we test separately above.)
    const inlineRe = /console\.(log|warn|error)\(\s*`[^`]*\[WoClaw Federation\][^`]*`/;
    expect(src).not.toMatch(inlineRe);
  });
});

describe('hub/src/ws_server.ts migrated to federation_log helpers (closes the 2-site leak)', () => {
  it('imports fedLog from ./federation_log.js', () => {
    const src = readSrc(WS_PATH);
    expect(src).toMatch(/import\s+\{\s*fedLog\s*\}\s+from\s+['"]\.\/federation_log\.js['"]/);
  });

  it('contains exactly 2 fedLog call sites (parity with pre-refactor 2 inline sites — L66 "Received" + L75 "Sent")', () => {
    const src = readSrc(WS_PATH);
    // Match `fedLog(` not preceded by a word char or `function `.
    const matches = src.match(/(?<!function )(?<![A-Za-z0-9_])fedLog\s*\(/g) || [];
    expect(matches.length).toBe(2);
  });

  it('no inline `console.[log|warn|error](`...`[WoClaw Federation]`...)` site remains in ws_server.ts (regression gate)', () => {
    const src = readSrc(WS_PATH);
    const inlineRe = /console\.(log|warn|error)\(\s*`[^`]*\[WoClaw Federation\][^`]*`/;
    expect(src).not.toMatch(inlineRe);
  });
});

describe('hub/src/federation_log.ts runtime wire-format (parity with pre-refactor inline sites)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fedLog(`Received federated memory \'k\' from hub-1`) emits exactly `console.log(`[WoClaw Federation] Received federated memory \'k\' from hub-1`)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Dynamic import so spies attach after module load.
    const mod = await import('../src/federation_log.js');
    mod.fedLog(`Received federated memory 'k' from hub-1`);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(`[WoClaw Federation] Received federated memory 'k' from hub-1`);
  });

  it('fedError(`Invalid message from hub-2:`, `ECONNRESET`) emits exactly `console.error(`[WoClaw Federation] Invalid message from hub-2:`, `ECONNRESET`)`', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await import('../src/federation_log.js');
    mod.fedError('Invalid message from hub-2:', 'ECONNRESET');
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith('[WoClaw Federation] Invalid message from hub-2:', 'ECONNRESET');
  });
});
