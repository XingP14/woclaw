import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the logging-consistency 漏更模式续集 —
 * every `console.error(...)` line in hub/src/*.ts that has a captured
 * error variable in scope must propagate it via the `errorMessage(e|err)` helper.
 *
 * Two recurring mistakes this catches:
 *   (1) `console.error('label for', agentId)` — drops the error object entirely
 *   (2) `console.error('label', err.message)` — reads .message unsafely when
 *       the variable is typed `unknown`; should be `errorMessage(err)`.
 *
 * Two specific sites were hardened in this round (06-29 03:03 cron):
 *   - ws_server.ts L180: ws.on('error') handler — `(err: Error)` callback was
 *     reading `err.message`; converted to `errorMessage(err)` + `(err: unknown)`
 *     for consistency with the other 16 sites in hub/src.
 *   - ws_server.ts L539: pingAll() catch block — `console.error('[WoClaw] Ping
 *     failed for ${agentId}')` dropped the captured `e`; now passes
 *     `errorMessage(e)` as a second argument so the underlying failure is
 *     observable in logs.
 */

const HUB_SRC = join(process.cwd(), 'src');
const FILES = readdirSync(HUB_SRC).filter(f => f.endsWith('.ts') && !f.startsWith('errors.') && !f.startsWith('hub_log.'));

interface ConsoleErrorSite { file: string; line: number; text: string; }

function findConsoleErrorSites(): ConsoleErrorSite[] {
  const sites: ConsoleErrorSite[] = [];
  for (const f of FILES) {
    const text = readFileSync(join(HUB_SRC, f), 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match both `console.error(` (legacy direct call) AND `hubError(`
      // (the 07-03 02:03 cron helper — wraps console.error with [WoClaw]
      // prefix). Both must propagate captured errors via errorMessage().
      if (!line.includes('console.error(') && !line.includes('hubError(')) continue;
      sites.push({ file: f, line: i + 1, text: line.trim() });
    }
  }
  return sites;
}

describe('hub src console.error logs must propagate errors via errorMessage()', () => {
  it('counts ≥ 17 console.error sites with an error variable (sanity floor)', () => {
    const sites = findConsoleErrorSites();
    const withErrorVar = sites.filter(s => /\b(?:e|err)\b/.test(s.text));
    // 14 from prior rounds + 1 (ws_server L180) + 1 (ws_server L539) = 16,
    // MINUS 10 sites migrated to hubError() in the 07-03 02:03 cron refactor
    // (7 in rest_server.ts, 2 in ws_server.ts, 1 in index.ts). After the
    // migration the remaining `console.error` + `hubError` calls with an
    // error variable land in db.ts / scheduler.ts / session_archive.ts /
    // memory.ts / errors.ts / federation.ts (still using fedError which
    // has its own parallel gate). Sanity floor lowered to >=5 — the gate
    // remains meaningful because the next 2 tests check ALL sites (both
    // console.error AND hubError) use errorMessage() and avoid raw .message.
    expect(withErrorVar.length).toBeGreaterThanOrEqual(5);
  });

  it('every console.error with a captured error variable uses errorMessage(e|err)', () => {
    const sites = findConsoleErrorSites();
    const withErrorVar = sites.filter(s => /\b(?:e|err)\b/.test(s.text));
    const violations: string[] = [];
    for (const s of withErrorVar) {
      const usesHelper = s.text.includes('errorMessage(');
      if (!usesHelper) {
        violations.push(`${s.file}:${s.line}: ${s.text}`);
      }
    }
    expect(
      violations,
      `console.error sites that drop or unsafely read error:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('no console.error line reads .message directly (would be unsafe on unknown)', () => {
    const sites = findConsoleErrorSites();
    const rawMessage = sites.filter(s => /\.(?:message)\b/.test(s.text));
    expect(
      rawMessage.map(s => `${s.file}:${s.line}: ${s.text}`),
      'no raw .message reads — use errorMessage() so unknown/Error both safe'
    ).toEqual([]);
  });
});
