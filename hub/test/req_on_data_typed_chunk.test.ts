import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the untyped `req.on('data', chunk => ...)` callback
 * pattern in hub/src. Originally 16 sites existed in rest_server.ts; all 15
 * inline `let body = ''; req.on('data', (chunk: Buffer) => ...)` POST
 * handlers were extracted to a single `readJsonBody(req): Promise<string>`
 * helper in rest_server.ts L104 (07-02 04:11 cron). The 16th site
 * (handleGraphNodeCreate L1137, for-await at L1139) used a different `for await (const chunk of
 * req)` shape and was left intact.
 *
 * Updated strategy (post-extraction):
 *   - read every hub/src/*.ts file
 *   - assert 0 `req.on('data', ...)` sites remain in code (the helper body
 *     itself is the only canonical accumulation site)
 *   - assert 0 untyped `req.on('data', chunk =>` patterns remain
 *   - assert `readJsonBody` is defined as an exported function
 *   - assert the helper's chunk annotation is `(chunk: Buffer)`
 *   - assert the helper's body uses `chunk.toString('utf8')` (parity with
 *     the 11 originally-typed sites — utf8 is what Node http.IncomingMessage
 *     emits for POST bodies by default)
 *   - sanity floor: at least 1 `readJsonBody` call site in rest_server.ts
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

describe('hub/src req.on("data", ...) is funneled through readJsonBody helper (07-02 04:11 cron)', () => {
  // Strip the helper body itself from the search — the helper is the only
  // legitimate accumulator. We do this by scanning only files that are not
  // the helper owner, plus excluding the specific helper body line range.
  const allSites = FILES.flatMap((f) => {
    const src = readFileSync(join(HUB_SRC, f), 'utf8');
    return findReqOnDataSites(src).map((s) => ({ ...s, file: f }));
  });

  it('readJsonBody helper is defined in rest_server.ts (the single accumulator)', () => {
    const restSrc = readFileSync(join(HUB_SRC, 'rest_server.ts'), 'utf8');
    expect(restSrc).toMatch(/function readJsonBody\(req: http\.IncomingMessage\): Promise<string>/);
  });

  it('the readJsonBody helper uses (chunk: Buffer) annotation', () => {
    const restSrc = readFileSync(join(HUB_SRC, 'rest_server.ts'), 'utf8');
    // Find the function body block and check the chunk annotation is typed.
    const helperRe = /function readJsonBody[\s\S]*?req\.on\(\s*['"]data['"]\s*,\s*\(chunk:\s*Buffer\s*\)/;
    expect(restSrc).toMatch(helperRe);
  });

  it('the readJsonBody helper body uses chunk.toString("utf8")', () => {
    const restSrc = readFileSync(join(HUB_SRC, 'rest_server.ts'), 'utf8');
    const helperRe = /function readJsonBody[\s\S]*?chunk\.toString\(\s*['"]utf8['"]\s*\)/;
    expect(restSrc).toMatch(helperRe);
  });

  it('readJsonBody is called at >=15 sites in rest_server.ts (was 15 inline handlers)', () => {
    const restSrc = readFileSync(join(HUB_SRC, 'rest_server.ts'), 'utf8');
    const callCount = (restSrc.match(/readJsonBody\(req\)\.then\(/g) || []).length;
    expect(callCount).toBeGreaterThanOrEqual(15);
  });

  it('zero req.on("data", ...) sites remain outside the readJsonBody helper (regression gate)', () => {
    // Filter out sites that are inside the readJsonBody helper body itself.
    // The helper spans from `function readJsonBody(...)` to its closing `}`.
    // We do this by reading the file and excluding lines between those two
    // markers.
    const restSrc = readFileSync(join(HUB_SRC, 'rest_server.ts'), 'utf8');
    const lines = restSrc.split(/\r?\n/);
    let inHelper = false;
    let helperDepth = 0;
    const externalSites: { line: number; raw: string; file: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inHelper && /function readJsonBody\(/.test(line)) {
        inHelper = true;
        helperDepth = 0;
      }
      if (inHelper) {
        for (const ch of line) {
          if (ch === '{') helperDepth++;
          else if (ch === '}') helperDepth--;
        }
        if (helperDepth <= 0 && line.includes('}')) {
          inHelper = false;
        }
        continue;
      }
      if (/req\.on\(\s*['"]data['"]\s*,/.test(line)) {
        externalSites.push({ line: i + 1, raw: line, file: 'rest_server.ts' });
      }
    }
    // Also scan other hub/src files — they should have zero.
    for (const f of FILES) {
      if (f === 'rest_server.ts') continue;
      const src = readFileSync(join(HUB_SRC, f), 'utf8');
      findReqOnDataSites(src).forEach((s) => {
        externalSites.push({ ...s, file: f });
      });
    }
    expect(
      externalSites,
      `req.on('data', ...) sites found outside the readJsonBody helper:\n${externalSites
        .map((o) => `  ${o.file}:${o.line}  ${o.raw.trim()}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('zero untyped `req.on("data", chunk =>` patterns remain anywhere', () => {
    const untypedRe = /req\.on\(\s*['"]data['"]\s*,\s*chunk\s*=>/;
    const offenders = allSites.filter((s) => untypedRe.test(s.raw));
    expect(offenders).toEqual([]);
  });
});
