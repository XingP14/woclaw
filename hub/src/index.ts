import { WSServer } from './ws_server.js';
import { RestServer } from './rest_server.js';
import { ClawDB } from './db.js';
import { Config } from './types.js';
import { GraphStore } from './graph/store.js';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import http from 'http';
import type { StorageConfig } from './types.js';

function buildDefaultStorageConfig(): StorageConfig {
  const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();
  if (dbType === 'mysql') {
    return {
      type: 'mysql',
      mysql: process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE ? {
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : undefined,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD || undefined,
        database: process.env.MYSQL_DATABASE,
        connectionLimit: process.env.MYSQL_CONNECTION_LIMIT ? parseInt(process.env.MYSQL_CONNECTION_LIMIT) : undefined,
      } : undefined,
    };
  }

  return {
    type: 'sqlite',
    sqlitePath: process.env.SQLITE_PATH || undefined,
  };
}

const DEFAULT_CONFIG: Config = {
  port: parseInt(process.env.PORT || '8080'),
  restPort: parseInt(process.env.REST_PORT || '8081'),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || '/data',
  storage: buildDefaultStorageConfig(),
  authToken: process.env.AUTH_TOKEN || 'change-me-in-production',
  tlsKey: process.env.TLS_KEY || undefined,
  tlsCert: process.env.TLS_CERT || undefined,
};

async function main() {
  console.log(`
  ██████╗ ███████╗██╗   ██╗    ██╗     ██╗███╗   ██╗██╗   ██╗██╗  ██╗
  ██╔══██╗██╔════╝██║   ██║    ██║     ██║████╗  ██║██║   ██║╚██╗██╔╝
  ██║  ██║█████╗  ██║   ██║    ██║     ██║██╔██╗ ██║██║   ██║ ╚███╔╝ 
  ██║  ██║██╔══╝  ╚██╗ ██╔╝    ██║     ██║██║╚██╗██║██║   ██║ ██╔██╗ 
  ██████╔╝███████╗ ╚████╔╝     ███████╗██║██║ ╚████║╚██████╔╝██╔╝ ██╗
  ╚═════╝ ╚══════╝  ╚═══╝      ╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝
  
  OpenClaw Multi-Agent Communication Hub
  `);

  // Load config from environment or file
  let config = DEFAULT_CONFIG;
  const configPath = process.env.CONFIG_FILE;
  if (configPath) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      config = { ...config, ...fileConfig };
      console.log(`[WoClaw] Loaded config from ${configPath}`);
    } catch (e) {
      console.error(`[WoClaw] Failed to load config: ${e}`);
      process.exit(1);
    }
  }

  console.log(`[WoClaw] Configuration:`);
  console.log(`  WebSocket Port: ${config.port}`);
  console.log(`  REST Port: ${config.restPort}`);
  console.log(`  Host: ${config.host}`);
  console.log(`  Data Dir: ${config.dataDir}`);
  console.log(`  Storage: ${config.storage?.type || 'sqlite'}`);
  if (config.storage?.type === 'sqlite') {
    console.log(`  SQLite Path: ${config.storage.sqlitePath || join(config.dataDir, 'woclaw.sqlite')}`);
  } else if (config.storage?.type === 'mysql' && config.storage.mysql) {
    console.log(`  MySQL Host: ${config.storage.mysql.host}:${config.storage.mysql.port || 3306}`);
    console.log(`  MySQL Database: ${config.storage.mysql.database}`);
  }
  console.log(`  Auth Token: ${config.authToken.substring(0, 8)}...`);
  console.log(`  TLS: ${config.tlsKey ? 'enabled (wss:// + https://)' : 'disabled (ws:// + http://)'}`);
  console.log('');

  // Initialize database
  const db = new ClawDB(config);
  console.log('[WoClaw] Database initialized');

  // Initialize WebSocket server (this also creates TopicsManager and MemoryPool internally)
  const wsServer = new WSServer(config, db);

  // Initialize Graph Memory store (v1.0)
  const graphStore = new GraphStore();

  // Wire GraphStore into MemoryPool for auto-linking on memory writes
  wsServer.getMemoryPool().graphStore = graphStore;

  // Start REST API server with access to db, topics, memory, graph
  const restServer = new RestServer(config, db, wsServer.getTopicsManager(), wsServer.getMemoryPool(), graphStore, wsServer);
  restServer.start();

  // v1.0: Start Web UI static file server on port 8084
  const uiPort = 8084;
  const publicDir = join(process.cwd(), 'public');
  if (existsSync(publicDir)) {
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
    uiServer.listen(uiPort, () => {
      console.log(`  Web UI:    http://${config.host}:${uiPort}`);
    });
    process.on('SIGINT', () => { uiServer.close(); });
    process.on('SIGTERM', () => { uiServer.close(); });
  }

  console.log('[WoClaw] Server started successfully');
  console.log('');
  console.log('[WoClaw] Endpoints:');
  const wsProto = config.tlsKey ? 'wss' : 'ws';
  const restProto = config.tlsKey ? 'https' : 'http';
  console.log(`  WebSocket: ${wsProto}://${config.host}:${config.port}`);
  console.log(`  REST API:  ${restProto}://${config.host}:${config.restPort}`);
  console.log(`  Graph:     ${restProto}://${config.host}:${config.restPort}/graph/{nodes,edges,stats}`);
  console.log('');

  // Graceful shutdown
  const shutdown = () => {
    console.log('[WoClaw] Shutting down...');
    restServer.close();
    wsServer.close();
    void db.close().finally(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[WoClaw] Fatal error:', e);
  process.exit(1);
});
