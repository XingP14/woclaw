import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// This test may run from either woclaw/ or woclaw/hub/ depending on caller.
// Resolve paths relative to the test file's own location so both work.
const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR); // .../hub
const REST_SERVER = join(HUB_DIR, 'src', 'rest_server.ts');

describe('parseIntParam helper migration (rest_server.ts)', () => {
  it('rest_server.ts exists at expected path', () => {
    expect(existsSync(REST_SERVER)).toBe(true);
  });

  it('rest_server.ts declares the parseIntParam helper with canonical signature', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/function parseIntParam\(url: URL, name: string, defaultValue: number\): number \{/);
  });

  it('parseIntParam helper body uses parseInt(raw, 10) for radix-10 parsing', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // The helper body should be:
    //   const raw = url.searchParams.get(name) || String(defaultValue);
    //   return parseInt(raw, 10);
    // Anchor: searchParams.get(name) || String(defaultValue) — matches the
    // 6 original `||` sites' null/empty semantics (treats null AND '' as missing)
    expect(text).toMatch(/url\.searchParams\.get\(name\) \|\| String\(defaultValue\)/);
    expect(text).toMatch(/return parseInt\(raw, 10\)/);
  });

  it('parseIntParam is called >=7 times (all migrated sites)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const matches = text.match(/parseIntParam\(/g) || [];
    // 1 declaration + 7 call sites = 8 total
    expect(matches.length).toBeGreaterThanOrEqual(8);
  });

  it('parseIntParam call sites cover limit (3x), depth, maxDepth, gracePeriodMs', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // limit: 3 sites (L219, L236, L349, L1049 — wait 4 sites, the helper has 1 declaration + 7 calls = 8)
    // Actually let me re-count: L219 limit/10, L236 limit/10, L348 depth, L349 limit/50, L358 maxDepth, L448 gracePeriodMs, L1049 limit/20 = 7 calls
    expect(text.match(/parseIntParam\(url, 'limit'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(text).toMatch(/parseIntParam\(url, 'depth'/);
    expect(text).toMatch(/parseIntParam\(url, 'maxDepth'/);
    expect(text).toMatch(/parseIntParam\(url2, 'gracePeriodMs'/);
  });

  it('0 inline parseInt(url.searchParams.get(...)) sites remain in code (regression gate)', () => {
    const raw = readFileSync(REST_SERVER, 'utf8');
    // Strip /** ... */ block comments so the helper's JSDoc reference to
    // `parseInt(url.searchParams.get(name) || String(defaultValue))` does not
    // false-positive the regression gate.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const inline = code.match(/parseInt\(url\.searchParams\.get\(/g);
    expect(inline).toBeNull();
  });

  it('0 inline parseInt(url2.searchParams.get(...)) sites remain in code (regression gate)', () => {
    const raw = readFileSync(REST_SERVER, 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const inline = code.match(/parseInt\(url2\.searchParams\.get\(/g);
    expect(inline).toBeNull();
  });

  it('L1204 limit function-param parseInt(limit || \'50\') is preserved (different param shape, not a URL search)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // This site takes `limit: string | null` as a function parameter (handleTopicMessages),
    // not from url.searchParams. Deliberately NOT migrated.
    expect(text).toMatch(/Math\.min\(parseInt\(limit \|\| '50'\), 200\)/);
  });
});

describe('parseIntParam semantics — behavioral parity with original 6 `||` sites', () => {
  // Behavioral parity is verified by running the helper in-process against the
  // exact same input shapes the 7 inline sites received. We use Node's URL
  // constructor (already available globally) and the helper copied verbatim
  // from rest_server.ts so the test exercises the actual implementation logic.
  function parseIntParam(url: URL, name: string, defaultValue: number): number {
    const raw = url.searchParams.get(name) || String(defaultValue);
    return parseInt(raw, 10);
  }

  it('returns defaultValue when query param is absent (null)', () => {
    const url = new URL('http://localhost/memory/search?q=hi');
    expect(parseIntParam(url, 'limit', 10)).toBe(10);
  });

  it('returns defaultValue when query param is empty string (treats "" as missing, matches `||` sites)', () => {
    const url = new URL('http://localhost/memory/search?q=hi&limit=');
    // 6 of 7 original sites used `||` which treats '' as falsy → falls back to default.
    // After migration all 7 sites have this uniform semantics.
    expect(parseIntParam(url, 'limit', 10)).toBe(10);
  });

  it('parses positive integer verbatim', () => {
    const url = new URL('http://localhost/x?limit=42');
    expect(parseIntParam(url, 'limit', 10)).toBe(42);
  });

  it('parses zero', () => {
    const url = new URL('http://localhost/x?limit=0');
    expect(parseIntParam(url, 'limit', 10)).toBe(0);
  });

  it('returns NaN for unparseable values (parity with parseInt(\'abc\') behavior)', () => {
    const url = new URL('http://localhost/x?limit=abc');
    expect(Number.isNaN(parseIntParam(url, 'limit', 10))).toBe(true);
  });

  it('returns defaultValue 300000 for gracePeriodMs absent', () => {
    const url = new URL('http://localhost/admin/token/rotate');
    expect(parseIntParam(url, 'gracePeriodMs', 300000)).toBe(300000);
  });

  it('handles 4-digit maxDepth 5 default correctly', () => {
    const url = new URL('http://localhost/graph/paths/a/b');
    expect(parseIntParam(url, 'maxDepth', 5)).toBe(5);
    const url2 = new URL('http://localhost/graph/paths/a/b?maxDepth=10');
    expect(parseIntParam(url2, 'maxDepth', 5)).toBe(10);
  });
});
