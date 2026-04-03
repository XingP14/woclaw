// WoClaw Plugin Entry Point for OpenClaw
// Uses defineChannelPluginEntry for proper OpenClaw v2026.3.22+ compatibility

// @ts-ignore - openclaw is a peer dependency, types resolved at runtime
import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { woclawChannelPlugin, channelInstance } from './channel.js';
import { readFileSync } from 'fs';

// Retry helper
function initWoclaw(api: any) {
  // Read config from file first (most reliable - works regardless of api.cfg state)
  let fileCfg: any = null;
  try {
    fileCfg = JSON.parse(readFileSync('/root/.openclaw/openclaw.json', 'utf-8'));
  } catch { /* ignore - will fall back to api.cfg */ }

  // File config takes priority, then api.cfg, then api.runtime.cfg
  const effectiveCfg = fileCfg ?? api.cfg ?? api.runtime?.cfg;
  const channelsCfg = effectiveCfg?.channels?.['woclaw'];
  const pluginCfg = effectiveCfg?.plugins?.entries?.['woclaw']?.config;
  const cfg = channelsCfg || pluginCfg;
  if (cfg?.hubUrl && cfg?.agentId && cfg?.token) {
    const logger = api.logger ?? { info: console.error.bind(null, '[WoClaw]'), warn: console.error.bind(null, '[WoClaw] WARN:'), error: console.error.bind(null, '[WoClaw] ERROR:'), debug: console.error.bind(null, '[WoClaw] DEBUG:') };
    channelInstance.initialize(cfg, (msg) => { if (api.runtime?.dispatch) api.runtime.dispatch({ channel: 'woclaw', ...msg }); }, logger);
  }
}

const entry = defineChannelPluginEntry({
  id: 'woclaw',
  name: 'WoClaw',
  description: 'Connect to WoClaw Hub for topic-based multi-agent communication and shared memory.',
  plugin: woclawChannelPlugin,
  setRuntime: (runtime) => {
    initWoclaw({ cfg: runtime.cfg || runtime, runtime, logger: runtime.logger });
  },
  registerFull: (api) => {
    initWoclaw(api);
    // Periodic retry in case config loads later
    const iv = setInterval(() => {
      if (!channelInstance.isConnected?.()) {
        initWoclaw(api);
      } else {
        clearInterval(iv);
      }
    }, 20000);
  },
});

export default entry;
