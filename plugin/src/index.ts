// WoClaw Plugin Entry Point for OpenClaw
// Uses defineChannelPluginEntry for proper OpenClaw v2026.3.22+ compatibility

// @ts-ignore - openclaw is a peer dependency, types resolved at runtime
import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { woclawChannelPlugin, channelInstance } from './channel.js';

export default defineChannelPluginEntry({
  id: 'woclaw',
  name: 'WoClaw',
  description: 'Connect to WoClaw Hub for topic-based multi-agent communication and shared memory.',
  plugin: woclawChannelPlugin,
  setRuntime: (runtime) => {
    try {
      // Auto-connect to Hub when runtime is set (gateway startup)
      // Config can be in channels.woclaw OR plugins.entries.woclaw.config
      // runtime.config is a runtime config wrapper; call loadConfig() to get actual config
      let cfg = undefined;
      if (typeof runtime.config?.loadConfig === 'function') {
        try {
          const fullCfg = runtime.config.loadConfig();
          cfg = fullCfg?.channels?.['woclaw'] || fullCfg?.plugins?.entries?.['woclaw']?.config;
          console.error('[WoClaw] setRuntime called, cfg from loadConfig:', cfg ? 'found' : 'not found');
          console.error('[WoClaw] fullCfg.channels keys:', fullCfg?.channels ? Object.keys(fullCfg.channels) : 'none');
        } catch(e) {
          console.error('[WoClaw] loadConfig error:', e);
        }
      } else {
        console.error('[WoClaw] setRuntime called, no loadConfig available');
        console.error('[WoClaw] runtime.config keys:', runtime.config ? Object.keys(runtime.config) : 'none');
      }
      console.error('[WoClaw] cfg:', JSON.stringify(cfg));
      if (cfg && cfg.hubUrl && cfg.agentId && cfg.token) {
        const logger = runtime.logger ?? {
          info: (msg: string) => console.error(`[WoClaw] ${msg}`),
          warn: (msg: string) => console.error(`[WoClaw] WARN: ${msg}`),
          error: (msg: string, ...args: any[]) => console.error(`[WoClaw] ERROR: ${msg}`, ...args),
          debug: (msg: string) => console.error(`[WoClaw] DEBUG: ${msg}`),
        };
        const dispatchFn = (msg: any) => {
          if (runtime.dispatch) runtime.dispatch({ channel: 'woclaw', ...msg });
        };
        channelInstance.initialize(cfg, dispatchFn, logger);
        logger.info('[WoClaw] Runtime set, attempting connection...');
      } else {
        console.error('[WoClaw] No valid config found in runtime, skipping auto-connect');
      }
    } catch(e) {
      console.error('[WoClaw] setRuntime exception:', e);
    }
  },
});
