import { WSServer } from './ws_server.js';
import { RestServer } from './rest_server.js';
import { ClawDB } from './db.js';
import { Config } from './types.js';
import { GraphStore } from './graph/store.js';
import { SessionStore } from './session_store.js';
import { ForgettingScheduler } from './scheduler.js';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import http from 'http';
import type { StorageConfig } from './types.js';
import { errorMessage } from './errors.js';
import { hubLog, hubWarn, hubError } from './hub_log.js';
import { printStartupHeader, printConfigDump, printEndpointsBanner } from './startup_banner.js';

/**
 * Parse an integer-valued process.env variable.
 *
 * Mirrors the dedup chain applied to URL query params (rest_server.ts
 * parseIntParam at L82-L86, 06-30 05:13 commit 045f1d7): collapses the
 * 4 inline `parseInt(process.env.X || 'default')` and
 * `process.env.X ? parseInt(process.env.X) : undefined` sites in
 * buildDefaultStorageConfig() and DEFAULT_CONFIG into a single helper
 * with explicit defaultValue semantics.
 *
 * Semantics:
 *   - Missing env var OR empty string ('') → `opts.default` if provided,
 *     else `undefined`.
 *     (matches original 4 sites: 2 `||` sites treat empty as missing → default,
 *      2 `?` sites treat empty as missing → undefined)
 *   - Present non-empty env var → `parseInt(value, 10)`. Unparseable values
 *     (e.g. PORT=abc) yield NaN — identical to the original inline behavior
 *     (preserves downstream propagation: NaN → port validation catches it).
 *
 * @param name - process.env variable name (e.g. 'PORT', 'MYSQL_PORT')
 * @param opts.default - default integer to return when env var is missing/empty.
 *                       Omit (or pass undefined) to return undefined instead.
 * @returns parsed integer, default, or undefined
 */
function parseEnvInt(name: string, opts: { default?: number } = {}): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return opts.default;
  }
  return parseInt(raw, 10);
}

/**
 * Parse a string-valued process.env variable.
 *
 * Mirrors the parseEnvInt helper (chain #14, 07-05 02:13 cron): collapses
 * the 8 inline `process.env.X || 'default'` and `process.env.X || undefined`
 * sites in buildDefaultStorageConfig() + DEFAULT_CONFIG into a single helper
 * with explicit defaultValue semantics.
 *
 * Semantics:
 *   - Missing env var OR empty string ('') → `opts.default` if provided,
 *     else `undefined`.
 *     (matches original 8 sites: 5 `||` sites with default-string treat empty
 *      as missing → default; 3 `|| undefined` sites treat empty as missing → undefined)
 *   - Present non-empty env var → returned verbatim (no trim, no lowercase,
 *     no parse — preserves downstream `.toLowerCase()` at DB_TYPE call site
 *     where the canonical-sqlite/mysql comparison depends on lowercased
 *     downstream behavior).
 *
 * @param name - process.env variable name (e.g. 'HOST', 'AUTH_TOKEN')
 * @param opts.default - default string to return when env var is missing/empty.
 *                       Omit (or pass undefined) to return undefined instead.
 * @returns parsed string, default, or undefined
 */
function parseEnvString(name: string, opts: { default?: string } = {}): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return opts.default;
  }
  return raw;
}

function buildDefaultStorageConfig(): StorageConfig {
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

const DEFAULT_CONFIG: Config = {
  port: parseEnvInt('PORT', { default: 8080 }),
  restPort: parseEnvInt('REST_PORT', { default: 8081 }),
  host: parseEnvString('HOST', { default: '0.0.0.0' }),
  dataDir: parseEnvString('DATA_DIR', { default: '/data' }),
  storage: buildDefaultStorageConfig(),
  authToken: parseEnvString('AUTH_TOKEN', { default: 'change-me-in-production' }),
  tlsKey: parseEnvString('TLS_KEY'),
  tlsCert: parseEnvString('TLS_CERT'),
};

async function main() {
  printStartupHeader();

  // Load config from environment or file
  let config = DEFAULT_CONFIG;
  const configPath = process.env.CONFIG_FILE;
  if (configPath) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      config = { ...config, ...fileConfig };
      hubLog(`Loaded config from ${configPath}`);
    } catch (e: unknown) {
      hubError(`Failed to load config: ${errorMessage(e)}`);
      process.exit(1);
    }
  }

  hubLog(`Configuration:`);
  printConfigDump(config);

  // Initialize database
  const db = new ClawDB(config);
  hubLog('Database initialized');

  // Initialize WebSocket server (this also creates TopicsManager and MemoryPool internally)
  const wsServer = new WSServer(config, db);

  // Initialize Graph Memory store (v1.0)
  const graphStore = new GraphStore();

  // Wire GraphStore into MemoryPool for auto-linking on memory writes
  wsServer.getMemoryPool().graphStore = graphStore;

  // Start REST API server with access to db, topics, memory, graph
  const restServer = new RestServer(config, db, wsServer.getTopicsManager(), wsServer.getMemoryPool(), graphStore, wsServer);
  restServer.start();

  // v1.0: Initialize and start ForgettingScheduler
  const sessionStore = new SessionStore(db);
  const forgettingScheduler = new ForgettingScheduler(db, sessionStore, null);
  forgettingScheduler.start();
  restServer.setForgettingScheduler(forgettingScheduler);

  // v1.0: Start Web UI static file server on port 8084. The Web UI URL
  // is appended to the Endpoints banner below — only when the static dir
  // actually exists (gated by the listen callback path). We capture the
  // `uiEnabled` flag here and pass it to printEndpointsBanner at the end
  // of main(); pre-refactor the URL printed inside uiServer.listen itself,
  // so this round shifts the print site from the listen callback to the
  // banner helper while preserving the conditional behaviour.
  const uiPort = 8084;
  const publicDir = join(process.cwd(), 'public');
  let uiEnabled = false;
  if (existsSync(publicDir)) {
    uiEnabled = true;
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html', '.js': 'application/javascript',
      '.css': 'text/css', '.json': 'application/json',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    };
    const uiServer = http.createServer((req, res) => {
      let filePath = join(publicDir, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      if (!existsSync(filePath)) filePath = join(publicDir, 'index.html');
      const ext = extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(readFileSync(filePath));
    });
    uiServer.listen(uiPort);
    process.on('SIGINT', () => { uiServer.close(); });
    process.on('SIGTERM', () => { uiServer.close(); });
  }

  hubLog('Server started successfully');
  console.log('');
  hubLog('Endpoints:');
  printEndpointsBanner(config, uiEnabled ? uiPort : undefined);

  // Graceful shutdown
  const shutdown = () => {
    hubLog('Shutting down...');
    forgettingScheduler.stop();
    restServer.close();
    wsServer.close();
    void db.close().finally(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e: unknown) => {
  hubError('Fatal error:', errorMessage(e));
  process.exit(1);
});
