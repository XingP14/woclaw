import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseEnvInt } from '../src/env_helpers.js';

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR); // .../hub
const INDEX_TS = join(HUB_DIR, 'src', 'index.ts');
const ENV_HELPERS_TS = join(HUB_DIR, 'src', 'env_helpers.ts');
const DEFAULT_CONFIG_TS = join(HUB_DIR, 'src', 'default_config.ts');

describe('parseEnvInt helper migration (index.ts env-var integer parsing)', () => {
  it('index.ts exists at expected path', () => {
    expect(existsSync(INDEX_TS)).toBe(true);
  });

  it('index.ts imports DEFAULT_CONFIG from ./default_config.js', () => {
    // 2026-10-04 02:03 cron: DEFAULT_CONFIG and buildDefaultStorageConfig moved
    // out of index.ts to src/default_config.ts, same reason as env_helpers on
    // 00:03 — index.ts ends in a top-level `main().catch(...)` and cannot be
    // imported by a test. The behavioral coverage now lives in
    // test/default_config_runtime.test.ts; the call-site inventory assertions
    // below read the new module.
    const text = readFileSync(INDEX_TS, 'utf8');
    expect(text).toMatch(/import \{ DEFAULT_CONFIG \} from ['"]\.\/default_config\.js['"]/);
  });

  it('default_config.ts imports parseEnvInt from ./env_helpers.js', () => {
    const text = readFileSync(DEFAULT_CONFIG_TS, 'utf8');
    expect(text).toMatch(/import \{ parseEnvInt, parseEnvString \} from ['"]\.\/env_helpers\.js['"]/);
  });

  it('index.ts no longer re-declares the config builders (no shadowing copy)', () => {
    // A re-added local `function buildDefaultStorageConfig` would shadow the
    // import and the runtime tests would keep exercising the wrong symbol.
    const text = readFileSync(INDEX_TS, 'utf8');
    expect(text.match(/^function buildDefaultStorageConfig\(/gm) || []).toEqual([]);
    expect(text.match(/^const DEFAULT_CONFIG: Config = \{/gm) || []).toEqual([]);
  });

  it('env_helpers.ts declares the parseEnvInt helper with canonical signature', () => {
    const text = readFileSync(ENV_HELPERS_TS, 'utf8');
    expect(text).toMatch(/export function parseEnvInt\(name: string, opts: \{ default\?: number \} = \{\}\): number \| undefined \{/);
  });

  it('parseEnvInt helper body checks for undefined or empty-string raw env value', () => {
    const text = readFileSync(ENV_HELPERS_TS, 'utf8');
    // The helper body should be:
    //   const raw = process.env[name];
    //   if (raw === undefined || raw === '') {
    //     return opts.default;
    //   }
    //   return parseInt(raw, 10);
    expect(text).toMatch(/const raw = process\.env\[name\];/);
    expect(text).toMatch(/if \(raw === undefined \|\| raw === ''\)/);
    expect(text).toMatch(/return parseInt\(raw, 10\)/);
  });

  it('default_config.ts calls parseEnvInt exactly 4 times (all migrated sites)', () => {
    const text = readFileSync(DEFAULT_CONFIG_TS, 'utf8');
    const calls = text.match(/parseEnvInt\(/g) || [];
    // 4 call sites. The declaration no longer lives in this file.
    expect(calls.length).toBe(4);
  });

  it('parseEnvInt call sites cover MYSQL_PORT (no default), MYSQL_CONNECTION_LIMIT (no default), PORT (default 8080), REST_PORT (default 8081)', () => {
    const text = readFileSync(DEFAULT_CONFIG_TS, 'utf8');
    expect(text).toMatch(/port: parseEnvInt\('MYSQL_PORT'\)/);
    expect(text).toMatch(/connectionLimit: parseEnvInt\('MYSQL_CONNECTION_LIMIT'\)/);
    expect(text).toMatch(/port: parseEnvInt\('PORT', \{ default: 8080 \}\)/);
    expect(text).toMatch(/restPort: parseEnvInt\('REST_PORT', \{ default: 8081 \}\)/);
  });

  it('0 inline `parseInt(process.env.*)` sites remain in the config builders (regression gate, comments stripped)', () => {
    const raw = readFileSync(DEFAULT_CONFIG_TS, 'utf8');
    // Strip /** ... */ block comments and // ... line comments so the helper's
    // JSDoc reference to the old inline pattern doesn't false-positive the gate.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const inline = code.match(/parseInt\(process\.env\./g);
    expect(inline).toBeNull();
  });

  it('0 inline `process.env.X ? parseInt(...)` ternary sites remain in the config builders (regression gate)', () => {
    const raw = readFileSync(DEFAULT_CONFIG_TS, 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const ternaries = code.match(/process\.env\.[A-Z_]+ \? parseInt\(/g);
    expect(ternaries).toBeNull();
  });

  it('DEFAULT_CONFIG.port default 8080 and DEFAULT_CONFIG.restPort default 8081 preserved verbatim', () => {
    const text = readFileSync(DEFAULT_CONFIG_TS, 'utf8');
    // The two defaulted sites must use the explicit 8080/8081 defaults — not
    // accidentally bumped. Regression check for the migration's constant
    // preservation.
    expect(text).toMatch(/port: parseEnvInt\('PORT', \{ default: 8080 \}\)/);
    expect(text).toMatch(/restPort: parseEnvInt\('REST_PORT', \{ default: 8081 \}\)/);
  });
});

describe('parseEnvInt semantics — behavioral parity with original 4 sites', () => {
  // Behavioral parity is verified by running the real helper in-process
  // against the exact same input shapes the 4 inline sites received.
  //
  // 2026-10-04 00:03 cron: this used to be a local copy of the helper,
  // "copied verbatim from index.ts so the test exercises the actual
  // implementation logic". It did not — it was a second implementation that
  // could drift from the original with every assertion staying green. The
  // helper now lives in src/env_helpers.ts and is imported for real by
  // test/env_helpers_runtime.test.ts. These cases are kept as a second,
  // independently-named set so a regression in either file is visible, and
  // they now drive the same imported symbol.
  it('returns undefined when env var is absent (parity with `process.env.X ? ... : undefined` sites)', () => {
    const NAME = 'TEST_PARSE_ENV_INT_ABSENT';
    delete process.env[NAME];
    expect(parseEnvInt(NAME)).toBeUndefined();
  });

  it('returns undefined when env var is empty string and no default provided (parity with ternary sites)', () => {
    const NAME = 'TEST_PARSE_ENV_INT_EMPTY_NODEF';
    process.env[NAME] = '';
    expect(parseEnvInt(NAME)).toBeUndefined();
  });

  it('returns opts.default when env var is absent and default provided (parity with `|| \'8080\'` sites)', () => {
    const NAME = 'TEST_PARSE_ENV_INT_ABSENT_DEF';
    delete process.env[NAME];
    expect(parseEnvInt(NAME, { default: 8080 })).toBe(8080);
  });

  it('returns opts.default when env var is empty string and default provided', () => {
    const NAME = 'TEST_PARSE_ENV_INT_EMPTY_DEF';
    process.env[NAME] = '';
    expect(parseEnvInt(NAME, { default: 8081 })).toBe(8081);
  });

  it('parses positive integer verbatim', () => {
    const NAME = 'TEST_PARSE_ENV_INT_POSITIVE';
    process.env[NAME] = '4242';
    expect(parseEnvInt(NAME)).toBe(4242);
  });

  it('parses zero', () => {
    const NAME = 'TEST_PARSE_ENV_INT_ZERO';
    process.env[NAME] = '0';
    expect(parseEnvInt(NAME)).toBe(0);
  });

  it('returns NaN for unparseable values (parity with parseInt() behavior)', () => {
    const NAME = 'TEST_PARSE_ENV_INT_GARBAGE';
    process.env[NAME] = 'abc';
    expect(Number.isNaN(parseEnvInt(NAME))).toBe(true);
  });

  it('preserves MYSQL_PORT semantics: empty → undefined (was ternary `process.env.X ? parseInt : undefined`)', () => {
    // Mirrors the buildDefaultStorageConfig L21 case where MYSQL_PORT is
    // optional. Empty string must NOT coerce to NaN — must yield undefined so
    // mysql2 driver falls back to its own default port.
    const NAME = 'TEST_MYSQL_PORT';
    process.env[NAME] = '';
    expect(parseEnvInt(NAME)).toBeUndefined();
  });

  it('preserves PORT semantics: empty → default 8080 (was `parseInt(process.env.PORT || \'8080\')`)', () => {
    // Mirrors DEFAULT_CONFIG.port: when PORT is empty, must use 8080 (not NaN).
    const NAME = 'TEST_PORT';
    process.env[NAME] = '';
    expect(parseEnvInt(NAME, { default: 8080 })).toBe(8080);
  });

  it('REST_PORT custom value 9001 is parsed verbatim', () => {
    const NAME = 'TEST_REST_PORT_CUSTOM';
    process.env[NAME] = '9001';
    expect(parseEnvInt(NAME, { default: 8081 })).toBe(9001);
  });
});
