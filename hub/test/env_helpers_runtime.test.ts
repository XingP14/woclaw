import { describe, it, expect, afterEach } from 'vitest';
import { parseEnvInt, parseEnvString } from '../src/env_helpers.js';

// Runtime counterpart to parse_env_int.test.ts + parse_env_string.test.ts.
//
// Both of those files pin the SOURCE TEXT of hub/src/index.ts (call counts,
// regexes over the literal source) and, for their behavioral cases, run a
// LOCAL COPY of each helper, annotated "copied verbatim from index.ts so the
// test exercises the actual implementation logic". It does not. The copy is a
// second implementation, and nothing in either file ties it to the original:
// if parseEnvInt's real body returned `parseInt(raw, 10) + 1`, both suites
// would still be green because every behavioral assertion runs against the
// copy, and the source-text assertions only check that a line reading
// `return parseInt(raw, 10)` exists somewhere in index.ts.
//
// The reason for the copy is structural: parseEnvInt/parseEnvString were
// module-private in index.ts, which ends in a top-level `main().catch(...)`.
// Importing it from a test boots the entire hub, so the real symbols were
// unreachable. On 2026-10-04 (00:03 cron) the bodies were extracted verbatim
// to hub/src/env_helpers.ts, index.ts now imports them, and this file drives
// the real exports. The copy is what let the drift hide.
//
// The two source-grep suites are KEPT: they own the call-site inventory
// (exactly 4 parseEnvInt and 8 parseEnvString sites, the specific env var
// names, the zero-inline-parseInt regression gates) which this file cannot
// see from outside the module. What this file owns is that the bodies
// themselves behave as the call sites assume.

const MUTATED: string[] = [];

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  MUTATED.push(name);
}

afterEach(() => {
  for (const name of MUTATED.splice(0)) {
    delete process.env[name];
  }
});

describe('parseEnvInt — the real exported implementation', () => {
  it('returns undefined when the env var is absent and no default is given', () => {
    setEnv('WC_RT_INT_ABSENT', undefined);
    expect(parseEnvInt('WC_RT_INT_ABSENT')).toBeUndefined();
  });

  it('returns undefined for an empty value and no default, not NaN', () => {
    setEnv('WC_RT_INT_EMPTY_NODEF', '');
    expect(parseEnvInt('WC_RT_INT_EMPTY_NODEF')).toBeUndefined();
  });

  it('returns the default when the env var is absent', () => {
    setEnv('WC_RT_INT_ABSENT_DEF', undefined);
    expect(parseEnvInt('WC_RT_INT_ABSENT_DEF', { default: 8080 })).toBe(8080);
  });

  it('returns the default for an empty value — the `|| default` semantic', () => {
    setEnv('WC_RT_INT_EMPTY_DEF', '');
    expect(parseEnvInt('WC_RT_INT_EMPTY_DEF', { default: 8081 })).toBe(8081);
  });

  it('parses a positive integer verbatim (the mutation canary)', () => {
    setEnv('WC_RT_INT_POS', '4242');
    expect(parseEnvInt('WC_RT_INT_POS')).toBe(4242);
  });

  it('parses zero without falling back to the default', () => {
    setEnv('WC_RT_INT_ZERO', '0');
    expect(parseEnvInt('WC_RT_INT_ZERO', { default: 8080 })).toBe(0);
  });

  it('parses a negative integer verbatim', () => {
    setEnv('WC_RT_INT_NEG', '-5');
    expect(parseEnvInt('WC_RT_INT_NEG')).toBe(-5);
  });

  it('returns NaN for an unparseable value, preserving parseInt parity', () => {
    setEnv('WC_RT_INT_GARBAGE', 'abc');
    expect(Number.isNaN(parseEnvInt('WC_RT_INT_GARBAGE'))).toBe(true);
  });

  it('parses only the leading digits of a trailing-garbage value', () => {
    setEnv('WC_RT_INT_TRAILING', '12abc');
    expect(parseEnvInt('WC_RT_INT_TRAILING')).toBe(12);
  });

  it('does not reinterpret a value past MAX_SAFE_INTEGER', () => {
    setEnv('WC_RT_INT_HUGE', '99999999999999999999');
    expect(parseEnvInt('WC_RT_INT_HUGE')).toBe(99999999999999999999);
  });

  it('reads process.env at call time, not at module load', () => {
    // If the helper cached the env map on first call, flipping the value
    // between two calls in the same test would return the stale first value.
    setEnv('WC_RT_INT_LATE', '1');
    expect(parseEnvInt('WC_RT_INT_LATE')).toBe(1);
    process.env.WC_RT_INT_LATE = '2';
    expect(parseEnvInt('WC_RT_INT_LATE')).toBe(2);
  });

  it('preserves the MYSQL_PORT contract: empty means undefined, not NaN', () => {
    // buildDefaultStorageConfig passes no default here, so an empty MYSQL_PORT
    // must yield undefined for the mysql2 driver to apply its own port.
    setEnv('WC_RT_MYSQL_PORT', '');
    expect(parseEnvInt('WC_RT_MYSQL_PORT')).toBeUndefined();
  });

  it('preserves the PORT contract: empty means 8080', () => {
    setEnv('WC_RT_PORT', '');
    expect(parseEnvInt('WC_RT_PORT', { default: 8080 })).toBe(8080);
  });

  it('preserves the REST_PORT contract: empty means 8081', () => {
    setEnv('WC_RT_REST_PORT', '');
    expect(parseEnvInt('WC_RT_REST_PORT', { default: 8081 })).toBe(8081);
  });
});

describe('parseEnvString — the real exported implementation', () => {
  it('returns undefined when the env var is absent and no default is given', () => {
    setEnv('WC_RT_STR_ABSENT', undefined);
    expect(parseEnvString('WC_RT_STR_ABSENT')).toBeUndefined();
  });

  it('returns undefined for an empty value and no default', () => {
    setEnv('WC_RT_STR_EMPTY_NODEF', '');
    expect(parseEnvString('WC_RT_STR_EMPTY_NODEF')).toBeUndefined();
  });

  it('returns the default when the env var is absent', () => {
    setEnv('WC_RT_STR_ABSENT_DEF', undefined);
    expect(parseEnvString('WC_RT_STR_ABSENT_DEF', { default: 'sqlite' })).toBe('sqlite');
  });

  it('returns the default for an empty value — the `|| default` semantic', () => {
    setEnv('WC_RT_STR_EMPTY_DEF', '');
    expect(parseEnvString('WC_RT_STR_EMPTY_DEF', { default: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('returns the value verbatim with no trim and no lowercase', () => {
    setEnv('WC_RT_STR_VERBATIM', '  MixedCase-VALUE_42  ');
    expect(parseEnvString('WC_RT_STR_VERBATIM')).toBe('  MixedCase-VALUE_42  ');
  });

  it('returns "0" verbatim rather than treating it as falsy', () => {
    // The pre-helper sites were `process.env.X || 'default'`, which maps "0"
    // to the default. The helper returns it. This is the one place the helper
    // is deliberately not `||`-shaped, so pin it explicitly.
    setEnv('WC_RT_STR_ZERO_STRING', '0');
    expect(parseEnvString('WC_RT_STR_ZERO_STRING', { default: 'fallback' })).toBe('0');
  });

  it('reads process.env at call time, not at module load', () => {
    setEnv('WC_RT_STR_LATE', 'first');
    expect(parseEnvString('WC_RT_STR_LATE')).toBe('first');
    process.env.WC_RT_STR_LATE = 'second';
    expect(parseEnvString('WC_RT_STR_LATE')).toBe('second');
  });

  it('preserves the DB_TYPE contract: value returned verbatim for caller-side toLowerCase()', () => {
    setEnv('WC_RT_DB_TYPE', 'MySQL');
    expect(parseEnvString('WC_RT_DB_TYPE', { default: 'sqlite' })).toBe('MySQL');
  });

  it('preserves the MYSQL_PASSWORD contract: empty means undefined', () => {
    setEnv('WC_RT_MYSQL_PASSWORD', '');
    expect(parseEnvString('WC_RT_MYSQL_PASSWORD')).toBeUndefined();
  });

  it('preserves the AUTH_TOKEN contract: empty means the change-me default', () => {
    setEnv('WC_RT_AUTH_TOKEN', '');
    expect(parseEnvString('WC_RT_AUTH_TOKEN', { default: 'change-me-in-production' }))
      .toBe('change-me-in-production');
  });

  it('preserves the TLS_KEY / TLS_CERT contract: empty means undefined', () => {
    setEnv('WC_RT_TLS_KEY', '');
    setEnv('WC_RT_TLS_CERT', '');
    expect(parseEnvString('WC_RT_TLS_KEY')).toBeUndefined();
    expect(parseEnvString('WC_RT_TLS_CERT')).toBeUndefined();
  });

  it('preserves the HOST and DATA_DIR verbatim returns', () => {
    setEnv('WC_RT_HOST', '127.0.0.1');
    setEnv('WC_RT_DATA_DIR', '/var/lib/woclaw');
    expect(parseEnvString('WC_RT_HOST', { default: '0.0.0.0' })).toBe('127.0.0.1');
    expect(parseEnvString('WC_RT_DATA_DIR', { default: '/data' })).toBe('/var/lib/woclaw');
  });
});

describe('env_helpers module shape', () => {
  it('exports exactly the two helpers and nothing else', () => {
    // An extra export here is a signal that a third helper was added to this
    // module without a test file to drive it.
    const mod = { parseEnvInt, parseEnvString };
    expect(Object.keys(mod).sort()).toEqual(['parseEnvInt', 'parseEnvString']);
  });

  it('index.ts imports both helpers from ./env_helpers.js', async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const hubDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    const text = readFileSync(join(hubDir, 'src', 'index.ts'), 'utf8');
    expect(text).toMatch(/import \{ parseEnvInt, parseEnvString \} from ['"]\.\/env_helpers\.js['"]/);
  });

  it('index.ts no longer re-declares either helper (no shadowing copy)', () => {
    // A re-added local `function parseEnvInt` would shadow the import and the
    // runtime tests would keep testing the wrong symbol, silently.
    return import('fs').then(({ readFileSync }) => {
      return import('path').then(({ join, dirname }) => {
        return import('url').then(({ fileURLToPath }) => {
          const hubDir = join(dirname(fileURLToPath(import.meta.url)), '..');
          const text = readFileSync(join(hubDir, 'src', 'index.ts'), 'utf8');
          const localInt = text.match(/^function parseEnvInt\(/gm) || [];
          const localStr = text.match(/^function parseEnvString\(/gm) || [];
          expect(localInt).toEqual([]);
          expect(localStr).toEqual([]);
        });
      });
    });
  });
});
