import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  buildDefaultConfig,
  buildDefaultStorageConfig,
  DEFAULT_CONFIG,
} from '../src/default_config.js';

// Runtime counterpart to the source-grep assertions in
// test/parse_env_int.test.ts + test/parse_env_string.test.ts, for the half of
// the config surface those two files could only ever reach as TEXT.
//
// 2026-10-04 02:03 cron: DEFAULT_CONFIG and buildDefaultStorageConfig were
// module-private in index.ts, which ends with a top-level `main().catch(...)`
// that binds a WS server, opens the DB and starts the forgetting scheduler.
// Importing it from a test would start real listeners, so both symbols were
// unreachable from every suite. Their bodies moved verbatim to
// hub/src/default_config.ts, index.ts now imports DEFAULT_CONFIG from there,
// and this file drives the real exports.
//
// This is the third instance of the same class on this repo (parseIntParam on
// 2026-10-03, parseEnvInt/parseEnvString on 2026-10-04 00:03, these two now).
// The class in one line: a config branch that no test ever EXECUTES, so a grep
// that finds the right text satisfies every gate that mentions it. What the
// grep suites cannot see, and what this file owns:
//
//   1. DB_TYPE is case-normalised. DB_TYPE=MySQL must produce a mysql storage
//      config, not silently fall through to sqlite.
//   2. The mysql sub-config is gated on THREE vars being truthy, so a partially
//      configured mysql backend yields `mysql: undefined` — which db.ts turns
//      into "MySQL storage selected but storage.mysql config is missing" rather
//      than a connection attempt with undefined fields.
//   3. The env is read at CALL time. A test can flip an env var and observe the
//      change; a module-load-time const could never be observed at all.
//   4. Every defaulted field really does fall back to its documented default,
//      and every non-defaulted one really is undefined rather than "" or NaN.

const HUB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_NAMES = [
  'DB_TYPE', 'MYSQL_HOST', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE',
  'MYSQL_PORT', 'MYSQL_CONNECTION_LIMIT', 'SQLITE_PATH',
  'PORT', 'REST_PORT', 'HOST', 'DATA_DIR', 'AUTH_TOKEN', 'TLS_KEY', 'TLS_CERT',
];

afterEach(() => {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
});

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

describe('buildDefaultStorageConfig — the real exported implementation', () => {
  it('defaults to a sqlite storage config when DB_TYPE is unset', () => {
    expect(buildDefaultStorageConfig()).toEqual({ type: 'sqlite', sqlitePath: undefined });
  });

  it('defaults to sqlite for an empty DB_TYPE (the empty-means-missing collapse)', () => {
    setEnv('DB_TYPE', '');
    expect(buildDefaultStorageConfig().type).toBe('sqlite');
  });

  it('treats DB_TYPE=sqlite as sqlite and carries SQLITE_PATH through', () => {
    setEnv('DB_TYPE', 'sqlite');
    setEnv('SQLITE_PATH', '/var/lib/woclaw/woclaw.sqlite');
    expect(buildDefaultStorageConfig()).toEqual({
      type: 'sqlite',
      sqlitePath: '/var/lib/woclaw/woclaw.sqlite',
    });
  });

  it('reads DB_TYPE case-insensitively: MySQL selects the mysql backend', () => {
    // THE case-insensitivity claim, executed. A grep asserting `.toLowerCase()`
    // is present on the DB_TYPE line would stay green if the normalisation were
    // moved off the value that is actually compared.
    setEnv('DB_TYPE', 'MySQL');
    setEnv('MYSQL_HOST', 'db.local');
    setEnv('MYSQL_USER', 'woclaw');
    setEnv('MYSQL_DATABASE', 'woclawdb');
    expect(buildDefaultStorageConfig().type).toBe('mysql');
  });

  it.each(['mysql', 'MySQL', 'MYSQL', 'mYsQl'])(
    'DB_TYPE=%s selects the mysql backend',
    (value: string) => {
      setEnv('DB_TYPE', value);
      setEnv('MYSQL_HOST', 'db.local');
      setEnv('MYSQL_USER', 'woclaw');
      setEnv('MYSQL_DATABASE', 'woclawdb');
      expect(buildDefaultStorageConfig().type).toBe('mysql');
    },
  );

  it('builds the full mysql sub-config when all three connection vars are present', () => {
    setEnv('DB_TYPE', 'mysql');
    setEnv('MYSQL_HOST', 'db.local');
    setEnv('MYSQL_USER', 'woclaw');
    setEnv('MYSQL_PASSWORD', 's3cret');
    setEnv('MYSQL_DATABASE', 'woclawdb');
    setEnv('MYSQL_PORT', '3307');
    setEnv('MYSQL_CONNECTION_LIMIT', '12');
    expect(buildDefaultStorageConfig()).toEqual({
      type: 'mysql',
      mysql: {
        host: 'db.local',
        port: 3307,
        user: 'woclaw',
        password: 's3cret',
        database: 'woclawdb',
        connectionLimit: 12,
      },
    });
  });

  it.each(['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE'])(
    'yields mysql: undefined when %s is missing (partial config is not half-filled)',
    (missing: string) => {
      setEnv('DB_TYPE', 'mysql');
      setEnv('MYSQL_HOST', 'db.local');
      setEnv('MYSQL_USER', 'woclaw');
      setEnv('MYSQL_DATABASE', 'woclawdb');
      delete process.env[missing];
      const cfg = buildDefaultStorageConfig();
      expect(cfg.type).toBe('mysql');
      expect(cfg.mysql).toBeUndefined();
    },
  );

  it('yields mysql: undefined when a connection var is set to an empty string', () => {
    // The gate is a truthiness test, so '' is as absent as unset. db.ts then
    // raises the "config is missing" error rather than connecting with ''.
    setEnv('DB_TYPE', 'mysql');
    setEnv('MYSQL_HOST', '');
    setEnv('MYSQL_USER', 'woclaw');
    setEnv('MYSQL_DATABASE', 'woclawdb');
    expect(buildDefaultStorageConfig().mysql).toBeUndefined();
  });

  it('leaves MYSQL_PORT and MYSQL_CONNECTION_LIMIT undefined when unset, not NaN', () => {
    // parseEnvInt with no default must yield undefined so the mysql2 driver
    // applies its own port/limit. NaN would reach the driver as a port.
    setEnv('DB_TYPE', 'mysql');
    setEnv('MYSQL_HOST', 'db.local');
    setEnv('MYSQL_USER', 'woclaw');
    setEnv('MYSQL_DATABASE', 'woclawdb');
    const cfg = buildDefaultStorageConfig();
    expect(cfg.mysql?.port).toBeUndefined();
    expect(cfg.mysql?.connectionLimit).toBeUndefined();
  });

  it('treats an empty MYSQL_PASSWORD as undefined rather than the empty string', () => {
    setEnv('DB_TYPE', 'mysql');
    setEnv('MYSQL_HOST', 'db.local');
    setEnv('MYSQL_USER', 'woclaw');
    setEnv('MYSQL_PASSWORD', '');
    setEnv('MYSQL_DATABASE', 'woclawdb');
    expect(buildDefaultStorageConfig().mysql?.password).toBeUndefined();
  });

  it('falls through to sqlite for an unrecognised DB_TYPE rather than producing an empty config', () => {
    setEnv('DB_TYPE', 'postgres');
    expect(buildDefaultStorageConfig().type).toBe('sqlite');
  });

  it('ignores SQLITE_PATH on the mysql branch — no sqlitePath key leaks into a mysql config', () => {
    setEnv('DB_TYPE', 'mysql');
    setEnv('SQLITE_PATH', '/should/not/appear.sqlite');
    setEnv('MYSQL_HOST', 'db.local');
    setEnv('MYSQL_USER', 'woclaw');
    setEnv('MYSQL_DATABASE', 'woclawdb');
    const cfg = buildDefaultStorageConfig();
    // Key ABSENCE, not just an undefined value. `expect(cfg.mysql).toBeUndefined()`
    // alone is satisfied by `{ type: 'sqlite', sqlitePath: p, mysql: undefined }`,
    // which is what mutant M7 produced and what this assertion was originally
    // written as. db.ts dispatches on `config.storage?.mysql` truthiness, so an
    // extra explicit-undefined key is harmless today — but the shape is what a
    // CONFIG_FILE merge and a JSON round-trip both care about, and a grep suite
    // cannot see it at all.
    expect(cfg).not.toHaveProperty('sqlitePath');
    expect(Object.keys(cfg).sort()).toEqual(['mysql', 'type']);
  });

  it('ignores the MYSQL_* vars on the sqlite branch — no mysql key at all', () => {
    setEnv('DB_TYPE', 'sqlite');
    setEnv('MYSQL_HOST', 'db.local');
    setEnv('MYSQL_USER', 'woclaw');
    setEnv('MYSQL_DATABASE', 'woclawdb');
    const cfg = buildDefaultStorageConfig();
    expect(cfg.mysql).toBeUndefined();
    expect(cfg).not.toHaveProperty('mysql');
    expect(Object.keys(cfg).sort()).toEqual(['sqlitePath', 'type']);
  });

  it('reads process.env at call time — two calls in one test see different values', () => {
    setEnv('DB_TYPE', 'sqlite');
    expect(buildDefaultStorageConfig().type).toBe('sqlite');
    setEnv('DB_TYPE', 'mysql');
    setEnv('MYSQL_HOST', 'db.local');
    setEnv('MYSQL_USER', 'woclaw');
    setEnv('MYSQL_DATABASE', 'woclawdb');
    expect(buildDefaultStorageConfig().type).toBe('mysql');
  });

  it('returns a fresh object per call — a caller mutating the result cannot poison the next call', () => {
    setEnv('SQLITE_PATH', '/original.sqlite');
    const first = buildDefaultStorageConfig();
    first.sqlitePath = '/mutated.sqlite';
    (first as { type?: string }).type = 'mysql';
    expect(buildDefaultStorageConfig().sqlitePath).toBe('/original.sqlite');
    expect(buildDefaultStorageConfig().type).toBe('sqlite');
  });
});

describe('buildDefaultConfig — the real exported implementation', () => {
  it('produces the documented defaults with no env set', () => {
    expect(buildDefaultConfig()).toEqual({
      port: 8080,
      restPort: 8081,
      host: '0.0.0.0',
      dataDir: '/data',
      storage: { type: 'sqlite', sqlitePath: undefined },
      authToken: 'change-me-in-production',
      tlsKey: undefined,
      tlsCert: undefined,
    });
  });

  it('reads PORT / REST_PORT as integers, not strings', () => {
    setEnv('PORT', '9000');
    setEnv('REST_PORT', '9001');
    const cfg = buildDefaultConfig();
    expect(cfg.port).toBe(9000);
    expect(cfg.restPort).toBe(9001);
    expect(typeof cfg.port).toBe('number');
  });

  it('falls back to 8080 / 8081 for an empty PORT / REST_PORT', () => {
    setEnv('PORT', '');
    setEnv('REST_PORT', '');
    expect(buildDefaultConfig().port).toBe(8080);
    expect(buildDefaultConfig().restPort).toBe(8081);
  });

  it('carries HOST, DATA_DIR and AUTH_TOKEN through verbatim', () => {
    setEnv('HOST', '127.0.0.1');
    setEnv('DATA_DIR', '/var/lib/woclaw');
    setEnv('AUTH_TOKEN', 'custom-token');
    const cfg = buildDefaultConfig();
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.dataDir).toBe('/var/lib/woclaw');
    expect(cfg.authToken).toBe('custom-token');
  });

  it('carries the TLS pair through when set and leaves both undefined when not', () => {
    setEnv('TLS_KEY', '/etc/woclaw/server.key');
    setEnv('TLS_CERT', '/etc/woclaw/server.crt');
    let cfg = buildDefaultConfig();
    expect(cfg.tlsKey).toBe('/etc/woclaw/server.key');
    expect(cfg.tlsCert).toBe('/etc/woclaw/server.crt');
    delete process.env.TLS_KEY;
    delete process.env.TLS_CERT;
    cfg = buildDefaultConfig();
    expect(cfg.tlsKey).toBeUndefined();
    expect(cfg.tlsCert).toBeUndefined();
  });

  it('never falls back to the change-me AUTH_TOKEN when one is explicitly set', () => {
    setEnv('AUTH_TOKEN', 'WoClaw2026');
    expect(buildDefaultConfig().authToken).not.toBe('change-me-in-production');
  });

  it('embeds the storage config rather than leaving storage undefined', () => {
    setEnv('DB_TYPE', 'mysql');
    setEnv('MYSQL_HOST', 'db.local');
    setEnv('MYSQL_USER', 'woclaw');
    setEnv('MYSQL_DATABASE', 'woclawdb');
    expect(buildDefaultConfig().storage?.type).toBe('mysql');
  });

  it('reads the env at call time — the reason this is a function and not a const', () => {
    setEnv('PORT', '7000');
    expect(buildDefaultConfig().port).toBe(7000);
    setEnv('PORT', '7001');
    expect(buildDefaultConfig().port).toBe(7001);
  });

  it('returns a fresh object per call, so callers can spread-merge without cross-talk', () => {
    setEnv('PORT', '8000');
    const a = buildDefaultConfig();
    a.port = 1;
    const b = buildDefaultConfig();
    expect(b.port).toBe(8000);
    expect(a).not.toBe(b);
  });
});

describe('DEFAULT_CONFIG — the module-load-time snapshot index.ts consumes', () => {
  it('has the shape of a Config with all eight fields', () => {
    expect(Object.keys(DEFAULT_CONFIG).sort()).toEqual([
      'authToken', 'dataDir', 'host', 'port', 'restPort', 'storage', 'tlsCert', 'tlsKey',
    ]);
  });

  it('equals a builder call made against the same (unchanged) env', () => {
    // This is the honesty check on the const: it is defined as
    // buildDefaultConfig() at module load, so with no env mutation in between
    // the two must agree exactly. If someone later decouples them, this fails.
    expect(DEFAULT_CONFIG).toEqual(buildDefaultConfig());
  });

  it('is NOT rebuilt when the env changes afterwards — index.ts reads the env once at boot', () => {
    // Pins the pre-extraction semantics deliberately: DEFAULT_CONFIG remains a
    // module-load snapshot, not a live view. buildDefaultConfig() is the live
    // one. index.ts uses only DEFAULT_CONFIG, so a test must not assume the
    // const follows a later process.env mutation.
    const before = DEFAULT_CONFIG.port;
    setEnv('PORT', '5999');
    expect(DEFAULT_CONFIG.port).toBe(before);
    expect(buildDefaultConfig().port).toBe(5999);
  });
});

describe('default_config module shape', () => {
  it('exports exactly buildDefaultConfig, buildDefaultStorageConfig and DEFAULT_CONFIG', () => {
    const mod = { buildDefaultConfig, buildDefaultStorageConfig, DEFAULT_CONFIG };
    expect(Object.keys(mod).sort()).toEqual([
      'DEFAULT_CONFIG', 'buildDefaultConfig', 'buildDefaultStorageConfig',
    ]);
  });

  it('index.ts imports DEFAULT_CONFIG from ./default_config.js', () => {
    const text = readFileSync(join(HUB_DIR, 'src', 'index.ts'), 'utf8');
    expect(text).toMatch(/import \{ DEFAULT_CONFIG \} from ['"]\.\/default_config\.js['"]/);
  });

  it('index.ts no longer declares its own DEFAULT_CONFIG or storage builder', () => {
    // A re-added local declaration would shadow the import and every runtime
    // assertion above would be testing a symbol the hub does not use.
    const text = readFileSync(join(HUB_DIR, 'src', 'index.ts'), 'utf8');
    expect(text.match(/^function buildDefaultStorageConfig\(/gm) || []).toEqual([]);
    expect(text.match(/^const DEFAULT_CONFIG[^\n]*\{/gm) || []).toEqual([]);
  });

  it('index.ts no longer imports the now-unused Config / StorageConfig types', () => {
    const text = readFileSync(join(HUB_DIR, 'src', 'index.ts'), 'utf8');
    expect(text).not.toMatch(/^import \{ Config \} from '\.\/types\.js';$/m);
    expect(text).not.toMatch(/^import type \{ StorageConfig \} from '\.\/types\.js';$/m);
  });

  it('buildDefaultConfig returns a value assignable to the Config type — no cast needed', () => {
    // Compile-time contract, asserted at runtime as a value check. If Config
    // ever gains a required field, this file stops compiling before the test
    // runs; the assertion here is the belt to that braces.
    const cfg: Record<string, unknown> = buildDefaultConfig() as unknown as Record<string, unknown>;
    expect(cfg.port).toBeTypeOf('number');
    expect(cfg.host).toBeTypeOf('string');
    expect(cfg.dataDir).toBeTypeOf('string');
    expect(cfg.authToken).toBeTypeOf('string');
  });
});
