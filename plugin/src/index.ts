// WoClaw Plugin Entry Point for OpenClaw
// Uses defineChannelPluginEntry for proper OpenClaw v2026.3.22+ compatibility

// @ts-ignore - openclaw is a peer dependency, types resolved at runtime
import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { woclawChannelPlugin } from './channel.js';

export default defineChannelPluginEntry({
  id: 'woclaw',
  name: 'WoClaw',
  description: 'Connect to WoClaw Hub for topic-based multi-agent communication and shared memory.',
  plugin: woclawChannelPlugin,
});
