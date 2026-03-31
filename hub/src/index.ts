import { WSServer } from './ws_server.js';
import { RestServer } from './rest_server.js';
import { ClawDB } from './db.js';
import { Config } from './types.js';
import { readFileSync } from 'fs';

const DEFAULT_CONFIG: Config = {
  port: parseInt(process.env.PORT || '8080'),
  restPort: parseInt(process.env.REST_PORT || '8081'),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || '/data',
  authToken: process.env.AUTH_TOKEN || 'change-me-in-production',
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
  console.log(`  Auth Token: ${config.authToken.substring(0, 8)}...`);
  console.log('');

  // Initialize database
  const db = new ClawDB(config.dataDir);
  console.log('[WoClaw] Database initialized');

  // Initialize WebSocket server (this also creates TopicsManager and MemoryPool internally)
  const wsServer = new WSServer(config, db);
  
  // Start REST API server with access to db, topics, memory
  const restServer = new RestServer(config, db, wsServer.getTopicsManager(), wsServer.getMemoryPool());
  restServer.start();
  
  console.log('[WoClaw] Server started successfully');
  console.log('');
  console.log('[WoClaw] Endpoints:');
  console.log(`  WebSocket: ws://${config.host}:${config.port}`);
  console.log(`  REST API:  http://${config.host}:${config.restPort}`);
  console.log('');

  // Graceful shutdown
  const shutdown = () => {
    console.log('[WoClaw] Shutting down...');
    restServer.close();
    wsServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[WoClaw] Fatal error:', e);
  process.exit(1);
});
