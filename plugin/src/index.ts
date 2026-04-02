// WoClaw Plugin Entry Point for OpenClaw
// Uses defineChannelPluginEntry for proper OpenClaw v2026.3.22+ compatibility

// @ts-ignore - openclaw is a peer dependency, types resolved at runtime
import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { woclawChannelPlugin, channelInstance } from './channel.js';

// Retry helper
function initWoclaw(api: any) {
  const channelsCfg = api.cfg?.channels?.['woclaw'];
  const pluginCfg = api.cfg?.plugins?.entries?.['woclaw']?.config;
  const cfg = channelsCfg || pluginCfg;
  if (cfg?.hubUrl && cfg?.agentId && cfg?.token) {
    const logger = api.logger ?? { info: console.error.bind(null, '[WoClaw]'), warn: console.error.bind(null, '[WoClaw] WARN:'), error: console.error.bind(null, '[WoClaw] ERROR:'), debug: console.error.bind(null, '[WoClaw] DEBUG:') };
    channelInstance.initialize(cfg, (msg) => { if (api.runtime?.dispatch) api.runtime.dispatch({ channel: 'woclaw', ...msg }); }, logger);
    console.error('[WoClaw] Auto-connected via', channelsCfg ? 'channels.woclaw' : 'plugins.entries.woclaw.config');
  } else {
    console.error('[WoClaw] No cfg in api — will retry on registerFull');
  }
}

const entry = defineChannelPluginEntry({
  id: 'woclaw',
  name: 'WoClaw',
  description: 'Connect to WoClaw Hub for topic-based multi-agent communication and shared memory.',
  plugin: woclawChannelPlugin,
  setRuntime: (runtime) => {
    console.error('[WoClaw] setRuntime called');
    initWoclaw({ cfg: runtime.cfg || runtime, runtime, logger: runtime.logger });
  },
  registerFull: (api) => {
    console.error('[WoClaw] registerFull called');
    initWoclaw(api);
    // Also set up a periodic check in case config loads later
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
