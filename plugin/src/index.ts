// WoClaw Plugin Entry Point for OpenClaw
// Uses defineChannelPluginEntry for proper OpenClaw v2026.3.22+ compatibility

// @ts-ignore - openclaw is a peer dependency, types resolved at runtime
import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { woclawChannelPlugin, channelInstance } from './channel.js';
import { readFileSync } from 'fs';
import { homedir } from 'os';

function initWoclaw(api: any) {
  // Read config from file first (most reliable - works regardless of api.cfg state)
  let fileCfg: any = null;
  try {
    fileCfg = JSON.parse(readFileSync(`${homedir()}/.openclaw/openclaw.json`, 'utf-8'));
  } catch { /* ignore - will fall back to api.cfg */ }

  // File config takes priority, then api.cfg, then api.runtime.cfg
  const effectiveCfg = fileCfg ?? api.cfg ?? api.runtime?.cfg;
  const channelsCfg = effectiveCfg?.channels?.['woclaw'];
  const pluginCfg = effectiveCfg?.plugins?.entries?.['xingp14-woclaw']?.config;
  const cfg = channelsCfg || pluginCfg || {};
  if (cfg.enabled !== false) {
    const serviceKind = process.env.OPENCLAW_SERVICE_KIND?.trim();
    const serviceMarker = process.env.OPENCLAW_SERVICE_MARKER?.trim();
    const processArgs = process.argv.slice(2).join(' ');
    const isGatewayService =
      serviceKind === 'gateway' ||
      serviceMarker === 'gateway' ||
      processArgs === 'gateway' ||
      processArgs.startsWith('gateway ');
    if (!isGatewayService) {
      const logger = api.logger ?? { info: console.error.bind(null, '[WoClaw]'), warn: console.error.bind(null, '[WoClaw] WARN:'), error: console.error.bind(null, '[WoClaw] ERROR:'), debug: console.error.bind(null, '[WoClaw] DEBUG:') };
      logger.debug('[WoClaw] Skipping auto-connect outside gateway service');
      return;
    }
    const logger = api.logger ?? { info: console.error.bind(null, '[WoClaw]'), warn: console.error.bind(null, '[WoClaw] WARN:'), error: console.error.bind(null, '[WoClaw] ERROR:'), debug: console.error.bind(null, '[WoClaw] DEBUG:') };
    channelInstance.initialize(cfg, (msg) => { if (api.runtime?.dispatch) api.runtime.dispatch({ channel: 'woclaw', ...msg }); }, logger);
  }
}

const entry = defineChannelPluginEntry({
  id: 'xingp14-woclaw',
  name: 'WoClaw',
  description: 'Connect to WoClaw Hub for topic-based multi-agent communication and shared memory.',
  plugin: woclawChannelPlugin,
  registerFull: (api) => {
    initWoclaw(api);
  },
});

export default entry;
