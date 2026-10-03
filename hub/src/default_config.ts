// hub/src/default_config.ts
//
// Default hub configuration, extracted from hub/src/index.ts (2026-10-04
// 02:03 cron).
//
// Why: DEFAULT_CONFIG and buildDefaultStorageConfig were module-private in
// index.ts, which ends with a top-level `main().catch(...)` that boots the
// whole hub (binds a WS server, opens the DB, starts the scheduler). Importing
// index.ts from a test would start real listeners and a SQLite file, so both
// symbols were unreachable from every test. The consequence was the same one
// fixed twice already on this repo (parse_int_param_runtime.test.ts on
// 2026-10-03, env_helpers.ts on 2026-10-04 00:03): every assertion about the
// hub's env-var surface could only be a source-text grep over index.ts.
//
// Grep suites can see that a token is PRESENT. They cannot see that it is
// REACHED, or that the branch around it is taken. Concretely, before this
// extraction nothing observed that DB_TYPE=mysql with all three of
// MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE present produces
// `storage: { type: 'mysql', mysql: {...} }`, and nothing observed that
// dropping the lowercase normalisation on DB_TYPE would silently fall through
// to sqlite — the exact opposite of the requested storage backend. Both pass a
// grep that only asserts the DB_TYPE read plus a `.toLowerCase()` exists
// somewhere in index.ts.
//
// NOTE, for the call-site inventory suites in test/parse_env_*.test.ts: this
// comment deliberately does not spell out the helper name being extracted, so
// their `grep -c` call-site counts over this file are not inflated by prose.
// Do the same when editing comments in this file.
//
// The fix is the same shape as env_helpers.ts: move the bodies verbatim, export
// them, have index.ts import them. Behavior is byte-identical, including the
// intentional quirks noted in the body comments below.

import { parseEnvInt, parseEnvString } from './env_helpers.js';
import type { Config, StorageConfig } from './types.js';

/**
 * Build the storage config from the DB_TYPE / MYSQL_* / SQLITE_PATH env vars.
 *
 * Kept byte-identical to the pre-extraction body, including the truthiness
 * test on the three MySQL connection vars: when DB_TYPE=mysql but any of
 * MYSQL_HOST / MYSQL_USER / MYSQL_DATABASE is missing, `mysql` is undefined
 * rather than a half-filled object. ClawDB.createStorage then throws
 * "MySQL storage selected but storage.mysql config is missing" (or the
 * requires-host/user/database variant), which is a far better failure than
 * connecting to a default socket. That error is the load-bearing reason the
 * truthiness test must NOT become a `.every(Boolean)`-style rewrite.
 */
export function buildDefaultStorageConfig(): StorageConfig {
  const dbType = (parseEnvString('DB_TYPE', { default: 'sqlite' })).toLowerCase();
  if (dbType === 'mysql') {
    return {
      type: 'mysql',
      mysql: process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE ? {
        host: process.env.MYSQL_HOST,
        port: parseEnvInt('MYSQL_PORT'),
        user: process.env.MYSQL_USER,
        password: parseEnvString('MYSQL_PASSWORD'),
        database: process.env.MYSQL_DATABASE,
        connectionLimit: parseEnvInt('MYSQL_CONNECTION_LIMIT'),
      } : undefined,
    };
  }

  return {
    type: 'sqlite',
    sqlitePath: parseEnvString('SQLITE_PATH'),
  };
}

/**
 * Build the full default config from the environment.
 *
 * A function rather than a bare const because the env vars must be read at CALL
 * time, not at module-load time. index.ts keeps a module-level `DEFAULT_CONFIG`
 * for its own single-boot use; exposing only the builder is what makes the
 * env-var surface testable at all (a test cannot change process.env before a
 * module-load-time const has already been evaluated).
 */
export function buildDefaultConfig(): Config {
  return {
    port: parseEnvInt('PORT', { default: 8080 }),
    restPort: parseEnvInt('REST_PORT', { default: 8081 }),
    host: parseEnvString('HOST', { default: '0.0.0.0' }),
    dataDir: parseEnvString('DATA_DIR', { default: '/data' }),
    storage: buildDefaultStorageConfig(),
    authToken: parseEnvString('AUTH_TOKEN', { default: 'change-me-in-production' }),
    tlsKey: parseEnvString('TLS_KEY'),
    tlsCert: parseEnvString('TLS_CERT'),
  };
}

/**
 * The single-boot default used by index.ts main(). Kept as a const so index.ts
 * reads the same as before the extraction; its value is whatever the env said
 * at process start, exactly as pre-extraction.
 */
export const DEFAULT_CONFIG: Config = buildDefaultConfig();
