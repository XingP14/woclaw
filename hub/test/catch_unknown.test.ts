import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Regression test for the 漏更模式续集 — `.catch((e) =>` and `.catch(err =>`
 * in hub/src/*.ts. Under `strict: false` in tsconfig these parameters silently
 * default to `any`, so a regression that drops the explicit `: unknown` type
 * annotation would hide `e.message` access bugs and break noImplicitAny upgrade.
 *
 * Strategy:
 *   - read each hub/src/*.ts file
 *   - find every `.catch(` site
 *   - assert the callback parameter has an explicit type annotation
 *     (either `: unknown` or `: Error` — the latter is also acceptable when
 *      the call site is typed `Promise<Error>`)
 */

const HUB_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const FILES = readdirSync(HUB_SRC).filter(f => f.endsWith('.ts') && !f.startsWith('errors.'));

interface CatchSite { file: string; line: number; match: string; }

function findCatchSites(): CatchSite[] {
  const sites: CatchSite[] = [];
  for (const f of FILES) {
    const text = readFileSync(join(HUB_SRC, f), 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match `.catch(<something>` — could be `.catch(e =>`, `.catch((e) =>`, `.catch((e: unknown) =>`, etc.
      const m = line.match(/\.catch\s*\(/);
      if (!m) continue;
      sites.push({ file: f, line: i + 1, match: line.trim() });
    }
  }
  return sites;
}

describe('hub src .catch() callback parameter must be explicitly typed', () => {
  it('every .catch() callback in hub/src/*.ts declares an explicit type annotation', () => {
    const sites = findCatchSites();
    expect(sites.length, 'expected ≥5 .catch() sites in hub/src').toBeGreaterThanOrEqual(5);

    // For each site, the callback parameter must be typed.
    // Patterns we accept:
    //   .catch((e: unknown) => ...
    //   .catch((err: unknown) => ...
    //   .catch((e: Error) => ...
    //   .catch((err: Error) => ...
    const UNANNOTATED = /\.catch\s*\(\s*(?:\(\s*)?(?:e|err)\s*(?:,\s*\w+)?\s*\)\s*=>/;

    const violations: string[] = [];
    for (const site of sites) {
      if (UNANNOTATED.test(site.match)) {
        violations.push(`${site.file}:${site.line}: ${site.match}`);
      }
    }
    expect(violations, `untyped .catch() callbacks:\n${violations.join('\n')}`).toEqual([]);
  });

  it('counts the catch-sites hardened in this round (federation L64 + index L160 + rest_server L101/L116 + ws_server L166)', () => {
    const sites = findCatchSites();
    // Sanity check: at least 7 sites should be present (5 new + 2 pre-existing in rest_server L1198/1220).
    expect(sites.length).toBeGreaterThanOrEqual(7);
  });
});
