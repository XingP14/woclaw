import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the 漏更模式续集 — untyped `req.on('data', chunk => ...)`
 * callbacks in hub/src/rest_server.ts. Under `strict: false` in hub/tsconfig.json
 * the parameter `chunk` silently defaults to `any`, which:
 *   - defeats any future `noImplicitAny: true` upgrade (would block build)
 *   - masks real type-safety bugs (e.g. accidental `body += chunk` against
 *     non-Buffer binary chunks)
 *   - breaks refactors that try to swap `chunk` for a typed `Buffer` (the
 *     function bodies drift byte-incompatible across the 11 already-typed
 *     sites)
 *
 * Strategy (parallels catch_unknown.test.ts / console_error_consistency.test.ts):
 *   - read every hub/src/*.ts file
 *   - find every `req.on('data',` site
 *   - assert the chunk callback has explicit `(chunk: Buffer)` annotation
 *   - also assert the callback body uses `chunk.toString('utf8')` (parity
 *     with the 11 typed sites — utf8 is what Node http.IncomingMessage emits
 *     for POST bodies by default)
 */

const HUB_SRC = join(process.cwd(), 'src');
const FILES = readdirSync(HUB_SRC).filter((f) => f.endsWith('.ts') && f !== 'errors.ts');

function findReqOnDataSites(source: string): { line: number; raw: string }[] {
  const lines = source.split(/\r?\n/);
  const out: { line: number; raw: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/req\.on\(\s*['"]data['"]\s*,/.test(lines[i])) {
      out.push({ line: i + 1, raw: lines[i] });
    }
  }
  return out;
}

describe('hub/src req.on("data", ...) chunk callbacks are typed (06-29 22:03 cron)', () => {
  const allSites = FILES.flatMap((f) => {
    const src = readFileSync(join(HUB_SRC, f), 'utf8');
    return findReqOnDataSites(src).map((s) => ({ ...s, file: f }));
  });

  it('at least 16 req.on("data", ...) sites exist in hub/src (sanity floor)', () => {
    expect(allSites.length).toBeGreaterThanOrEqual(16);
  });

  it('every req.on("data", ...) callback parameter has explicit (chunk: Buffer) annotation', () => {
    const typedRe = /req\.on\(\s*['"]data['"]\s*,\s*\(chunk:\s*Buffer\s*\)/;
    const offenders = allSites.filter((s) => !typedRe.test(s.raw));
    expect(
      offenders,
      `untyped req.on('data', ...) callbacks found:\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.raw.trim()}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('every req.on("data", ...) callback body uses chunk.toString("utf8") (parity with 11 typed sites)', () => {
    const utf8Re = /chunk\.toString\(\s*['"]utf8['"]\s*\)/;
    const offenders = allSites.filter((s) => !utf8Re.test(s.raw));
    expect(
      offenders,
      `req.on('data', ...) callbacks not using chunk.toString('utf8'):\n${offenders
        .map((o) => `  ${o.file}:${o.line}  ${o.raw.trim()}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('zero untyped `req.on("data", chunk =>` patterns remain (would catch regression)', () => {
    const untypedRe = /req\.on\(\s*['"]data['"]\s*,\s*chunk\s*=>/;
    const offenders = allSites.filter((s) => untypedRe.test(s.raw));
    expect(offenders).toEqual([]);
  });
});
