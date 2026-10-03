import { WSServer } from './ws_server.js';
import { RestServer } from './rest_server.js';
import { ClawDB } from './db.js';
import { GraphStore } from './graph/store.js';
import { SessionStore } from './session_store.js';
import { ForgettingScheduler } from './scheduler.js';
import { existsSync } from 'fs';
import { join } from 'path';
import http from 'http';
import { errorMessage } from './errors.js';
import { hubLog, hubWarn, hubError } from './hub_log.js';
import { printStartupHeader, printConfigDump, printEndpointsBanner } from './startup_banner.js';
import { DEFAULT_CONFIG } from './default_config.js';
import { createUiRequestHandler } from './ui_static.js';
import { loadConfigFile } from './config_file.js';

// parseEnvInt / parseEnvString moved to ./env_helpers.js on 2026-10-04
// (00:03 cron) so they can be imported by tests. DEFAULT_CONFIG and
// buildDefaultStorageConfig moved to ./default_config.js on 2026-10-04
// (02:03 cron), same reason: this file ends in a top-level `main().catch(...)`,
// so anything left module-private here is unreachable from a test without
// booting the hub — which is why their behavioral coverage would have had to
// be a local copy that could drift. Bodies unchanged.
//
// DEFAULT_CONFIG stays a module-load-time const for index.ts's own single-boot
// use, exactly as pre-extraction. The call-time builder is exported from
// ./default_config.js for tests; index.ts deliberately does not use it, because
// reading the env once at process start is the pre-extraction semantics and
// changing it is out of scope for a behavior-preserving extraction.

async function main() {
  printStartupHeader();

  // Load config from environment or file
  let config = DEFAULT_CONFIG;
  const configPath = process.env.CONFIG_FILE;
  if (configPath) {
    try {
      config = loadConfigFile(configPath, config);
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
    const uiServer = http.createServer(createUiRequestHandler(publicDir));
    // Chain #32 follow-up: attach an 'error' listener to uiServer BEFORE listen()
    // so a port-conflict on 8084 (EADDRINUSE when an orphaned hub process still
    // holds the port) becomes a logged warning instead of an unhandled 'error'
    // event that crashes the hub within ~2s. The REST/WS servers stay up; the
    // Web UI dashboard simply becomes unavailable on this port.
    uiServer.on('error', (err: NodeJS.ErrnoException) => {
      hubWarn(`Web UI server failed to bind port ${uiPort}: ${err.code ?? 'UNKNOWN'} ${err.message}. The REST API and WebSocket hub continue running; the /public dashboard is unavailable.`);
    });
    uiServer.listen(uiPort);
    process.on('SIGINT', () => { uiServer.close(); });
    process.on('SIGTERM', () => { uiServer.close(); });
  }

  hubLog('Server started successfully');
  // chain #16: blank-line separator moved INTO printEndpointsBanner helper
  // (was inline at L185, helper now prints leading console.log('') itself)
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
