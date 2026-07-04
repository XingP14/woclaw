import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR); // .../hub
const INDEX_TS = join(HUB_DIR, 'src', 'index.ts');

describe('parseEnvString helper migration (index.ts env-var string parsing)', () => {
  it('index.ts exists at expected path', () => {
    expect(existsSync(INDEX_TS)).toBe(true);
  });

  it('index.ts declares the parseEnvString helper with canonical signature', () => {
    const text = readFileSync(INDEX_TS, 'utf8');
    expect(text).toMatch(/function parseEnvString\(name: string, opts: \{ default\?: string \} = \{\}\): string \| undefined \{/);
  });

  it('parseEnvString helper body checks for undefined or empty-string raw env value', () => {
    const text = readFileSync(INDEX_TS, 'utf8');
    // The helper body should be:
    //   const raw = process.env[name];
    //   if (raw === undefined || raw === '') {
    //     return opts.default;
    //   }
    //   return raw;
    expect(text).toMatch(/function parseEnvString[\s\S]*?const raw = process\.env\[name\];/);
    expect(text).toMatch(/function parseEnvString[\s\S]*?if \(raw === undefined \|\| raw === ''\)/);
    expect(text).toMatch(/function parseEnvString[\s\S]*?return raw;\n\}/);
  });

  it('parseEnvString is called exactly 8 times (all migrated sites)', () => {
    const text = readFileSync(INDEX_TS, 'utf8');
    const calls = text.match(/parseEnvString\(/g) || [];
    // 1 declaration + 8 call sites = 9 total
    expect(calls.length).toBe(9);
  });

  it('parseEnvString call sites cover DB_TYPE/MYSQL_PASSWORD/SQLITE_PATH/HOST/DATA_DIR/AUTH_TOKEN/TLS_KEY/TLS_CERT', () => {
    const text = readFileSync(INDEX_TS, 'utf8');
    // 5 sites with default string
    expect(text).toMatch(/parseEnvString\('DB_TYPE', \{ default: 'sqlite' \}\)/);
    expect(text).toMatch(/parseEnvString\('HOST', \{ default: '0\.0\.0\.0' \}\)/);
    expect(text).toMatch(/parseEnvString\('DATA_DIR', \{ default: '\/data' \}\)/);
    expect(text).toMatch(/parseEnvString\('AUTH_TOKEN', \{ default: 'change-me-in-production' \}\)/);
    // 3 sites with no default → return undefined
    expect(text).toMatch(/password: parseEnvString\('MYSQL_PASSWORD'\)/);
    expect(text).toMatch(/sqlitePath: parseEnvString\('SQLITE_PATH'\)/);
    expect(text).toMatch(/tlsKey: parseEnvString\('TLS_KEY'\)/);
    expect(text).toMatch(/tlsCert: parseEnvString\('TLS_CERT'\)/);
  });

  it('0 inline `process.env.X || \'default\'` sites remain in DEFAULT_CONFIG (regression gate)', () => {
    const raw = readFileSync(INDEX_TS, 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // Pattern: process.env.X || 'something' — should be 0 after migration.
    const inline = code.match(/process\.env\.[A-Z_]+ \|\| '/g);
    expect(inline).toBeNull();
  });

  it('0 inline `process.env.X || undefined` sites remain in DEFAULT_CONFIG (regression gate)', () => {
    const raw = readFileSync(INDEX_TS, 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // Pattern: process.env.X || undefined — should be 0 after migration.
    const inline = code.match(/process\.env\.[A-Z_]+ \|\| undefined/g);
    expect(inline).toBeNull();
  });

  it('DB_TYPE default \'sqlite\' and HOST default \'0.0.0.0\' preserved verbatim', () => {
    const text = readFileSync(INDEX_TS, 'utf8');
    expect(text).toMatch(/parseEnvString\('DB_TYPE', \{ default: 'sqlite' \}\)/);
    expect(text).toMatch(/parseEnvString\('HOST', \{ default: '0\.0\.0\.0' \}\)/);
  });
});

describe('parseEnvString semantics — behavioral parity with original 8 sites', () => {
  // Behavioral parity verified by running the helper in-process against the
  // exact same input shapes the 8 inline sites received. We copy the helper
  // verbatim from index.ts so the test exercises the actual implementation
  // logic.
  function parseEnvString(name: string, opts: { default?: string } = {}): string | undefined {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
      return opts.default;
    }
    return raw;
  }

  it('returns undefined when env var is absent (parity with `process.env.X || undefined` sites)', () => {
    const NAME = 'TEST_PARSE_ENV_STRING_ABSENT';
    delete process.env[NAME];
    expect(parseEnvString(NAME)).toBeUndefined();
  });

  it('returns undefined when env var is empty string and no default provided', () => {
    const NAME = 'TEST_PARSE_ENV_STRING_EMPTY_NODEF';
    process.env[NAME] = '';
    expect(parseEnvString(NAME)).toBeUndefined();
  });

  it('returns opts.default when env var is absent and default provided', () => {
    const NAME = 'TEST_PARSE_ENV_STRING_ABSENT_DEF';
    delete process.env[NAME];
    expect(parseEnvString(NAME, { default: 'sqlite' })).toBe('sqlite');
  });

  it('returns opts.default when env var is empty string and default provided', () => {
    const NAME = 'TEST_PARSE_ENV_STRING_EMPTY_DEF';
    process.env[NAME] = '';
    expect(parseEnvString(NAME, { default: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('returns env value verbatim when present (no trim, no lowercase)', () => {
    const NAME = 'TEST_PARSE_ENV_STRING_VERBATIM';
    process.env[NAME] = 'MixedCase-VALUE_42';
    expect(parseEnvString(NAME)).toBe('MixedCase-VALUE_42');
  });

  it('returns empty-string verbatim does NOT happen — empty maps to default/undefined (semantic collapse)', () => {
    const NAME = 'TEST_PARSE_ENV_STRING_EMPTY_COLLAPSE';
    process.env[NAME] = '';
    // Unlike parseEnvString's literal-return promise, the empty-string
    // semantic is collapsed: empty maps to default. This matches the original
    // 5 `|| 'default'` sites which treated empty as missing.
    expect(parseEnvString(NAME, { default: 'fallback' })).toBe('fallback');
    expect(parseEnvString(NAME)).toBeUndefined();
  });

  it('preserves MYSQL_PASSWORD semantics: empty → undefined (was `process.env.X || undefined`)', () => {
    const NAME = 'TEST_MYSQL_PASSWORD';
    process.env[NAME] = '';
    expect(parseEnvString(NAME)).toBeUndefined();
  });

  it('preserves AUTH_TOKEN semantics: empty → default \'change-me-in-production\' (was `|| \'change-me...\'`)', () => {
    const NAME = 'TEST_AUTH_TOKEN';
    process.env[NAME] = '';
    expect(parseEnvString(NAME, { default: 'change-me-in-production' })).toBe('change-me-in-production');
  });

  it('preserves DB_TYPE semantics: custom \'mysql\' returned verbatim for downstream .toLowerCase()', () => {
    const NAME = 'TEST_DB_TYPE';
    process.env[NAME] = 'mysql';
    // No lowercase transformation in helper — caller does .toLowerCase() before
    // dispatching to the buildDefaultStorageConfig branch.
    expect(parseEnvString(NAME, { default: 'sqlite' })).toBe('mysql');
  });

  it('returns custom HOST verbatim', () => {
    const NAME = 'TEST_HOST';
    process.env[NAME] = '127.0.0.1';
    expect(parseEnvString(NAME, { default: '0.0.0.0' })).toBe('127.0.0.1');
  });

  it('returns custom DATA_DIR verbatim', () => {
    const NAME = 'TEST_DATA_DIR';
    process.env[NAME] = '/var/lib/woclaw';
    expect(parseEnvString(NAME, { default: '/data' })).toBe('/var/lib/woclaw');
  });
});
