import { WSServer } from './ws_server.js';
import { ClawDB } from './db.js';
import { Config } from './types.js';
import { readFileSync } from 'fs';
import { join } from 'path';

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
      console.log(`[ClawLink] Loaded config from ${configPath}`);
    } catch (e) {
      console.error(`[ClawLink] Failed to load config: ${e}`);
      process.exit(1);
    }
  }

  console.log(`[ClawLink] Configuration:`);
  console.log(`  WebSocket Port: ${config.port}`);
  console.log(`  REST Port: ${config.restPort}`);
  console.log(`  Host: ${config.host}`);
  console.log(`  Data Dir: ${config.dataDir}`);
  console.log(`  Auth Token: ${config.authToken.substring(0, 8)}...`);
  console.log('');

  // Initialize database
  const db = new ClawDB(config.dataDir);
  console.log('[ClawLink] Database initialized');

  // Start WebSocket server
  const wsServer = new WSServer(config, db);
  console.log('[ClawLink] Server started successfully');
  console.log('');

  // Graceful shutdown
  const shutdown = () => {
    console.log('[ClawLink] Shutting down...');
    wsServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[ClawLink] Fatal error:', e);
  process.exit(1);
});
