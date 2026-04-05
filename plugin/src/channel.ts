// WoClaw OpenClaw Channel Plugin
// Properly implements ChannelPlugin interface using defineChannelPluginEntry

// ChannelPlugin type comes from ./plugin-types.ts

// ============================================================================
// Types
// ============================================================================

import { WebSocket } from 'ws';

export interface WoClawConfig {
  hubUrl: string;
  agentId: string;
  token: string;
  autoJoin?: string[];
  topics?: string[];
}

export interface WoClawResolvedAccount {
  accountId: string;
  hubUrl: string;
  agentId: string;
  token: string;
  autoJoin: string[];
}

interface OutboundMessage {
  type: string;
  topic?: string;
  content?: string;
  key?: string;
  value?: any;
  id?: string;
}

interface PendingMemoryRead {
  resolve: (value: any) => void;
  timer: NodeJS.Timeout;
  resolved: boolean;
}

// ============================================================================
// WoClawChannel (per-account instance)
// ============================================================================

class WoClawChannelInstance {
  name = 'woclaw';
  private ws: WebSocket | null = null;
  private config: WoClawConfig | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private pendingMemoryReads: Map<string, PendingMemoryRead[]> = new Map();
  private topics: Set<string> = new Set();
  private agentId: string = '';
  private dispatchFn: ((msg: any) => void) | null = null;
  private logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string, ...args: any[]) => void; debug: (msg: string) => void } | null = null;

  initialize(config: WoClawConfig, dispatchFn: (msg: any) => void, logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string, ...args: any[]) => void; debug: (msg: string) => void }): void {
    // Close existing connection before reconnecting
    if (this.ws) {
      try { this.ws.close(1000, 'Reconnecting'); } catch(e) {}
      this.ws = null;
    }
    this.config = config;
    this.dispatchFn = dispatchFn;
    this.logger = logger;
    this.agentId = config.agentId;

    if (config.autoJoin) {
      for (const topic of config.autoJoin) this.topics.add(topic);
    }
    if (config.topics) {
      for (const topic of config.topics) this.topics.add(topic);
    }

    this.connect();

    // Startup fallback: ensure connection is established within 10s
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = setTimeout(() => {
      if (!this.ws || this.ws.readyState !== 1) {
        this.logger?.info('[WoClaw] Startup check: not connected, retrying...');
        this.connect();
      }
    }, 10000);
  }

  private connect(): void {
    if (!this.config || !this.logger) return;

    const url = `${this.config.hubUrl}?agentId=${encodeURIComponent(this.config.agentId)}&token=${encodeURIComponent(this.config.token)}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.logger!.info(`[WoClaw] Connected to hub: ${this.config?.hubUrl}`);
        for (const topic of this.topics) {
          this.send({ type: 'join', topic });
        }
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === 1) {
            this.send({ type: 'ping' });
          }
        }, 25000);
      };

      // Handle WebSocket ping frames from Hub - must respond at protocol level
      (this.ws as any).on('ping', () => {
        this.logger?.debug('[WoClaw] WebSocket ping received, sending pong');
        if (this.ws?.readyState === 1) {
          (this.ws as any).pong();
        }
      });

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data.toString());
          this.handleMessage(msg);
        } catch (e) {
          this.logger!.error('[WoClaw] Failed to parse message:', e);
        }
      };

      this.ws.onclose = (event) => {
        this.logger!.warn(`[WoClaw] Disconnected (code: ${event.code})`);
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        this.logger!.error('[WoClaw] WebSocket error:', error);
      };
    } catch (e) {
      this.logger!.error('[WoClaw] Failed to connect:', e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.logger!.info('[WoClaw] Attempting to reconnect...');
      this.connect();
    }, 5000);
  }

  private send(msg: OutboundMessage): void {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private resolveMemoryRead(key: string, pending: PendingMemoryRead, value: any): void {
    if (pending.resolved) return;

    pending.resolved = true;
    clearTimeout(pending.timer);
    pending.resolve(value);

    const queue = this.pendingMemoryReads.get(key);
    if (!queue) return;
    const idx = queue.indexOf(pending);
    if (idx >= 0) queue.splice(idx, 1);
    if (queue.length === 0) this.pendingMemoryReads.delete(key);
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'welcome':
        this.logger!.info(`[WoClaw] Authenticated as ${msg.agentId}`);
        break;

      case 'message':
        if (msg.from !== this.agentId && this.dispatchFn) {
          this.dispatchFn({
            channel: 'woclaw',
            id: msg.id,
            from: msg.from,
            text: msg.content,
            topic: msg.topic,
            timestamp: msg.timestamp,
          });
        }
        break;

      case 'memory_value': {
        const queue = this.pendingMemoryReads.get(msg.key);
        if (queue && queue.length > 0) {
          this.resolveMemoryRead(msg.key, queue[0], msg.exists ? msg.value : null);
        }
        break;
      }

      case 'join':
      case 'leave':
      case 'pong':
      case 'ping':
        if (msg.type === 'ping') {
          this.send({ type: 'pong' });
        }
        break;

      case 'error':
        this.logger!.error(`[WoClaw] Server error: ${msg.code} - ${msg.message}`);
        break;
    }
  }

  // Public API
  async sendMessage(topic: string, content: string): Promise<void> {
    this.send({ type: 'message', topic, content });
  }

  async joinTopic(topic: string): Promise<void> {
    this.topics.add(topic);
    this.send({ type: 'join', topic });
  }

  async leaveTopic(topic: string): Promise<void> {
    this.topics.delete(topic);
    this.send({ type: 'leave', topic });
  }

  async writeMemory(key: string, value: any): Promise<void> {
    this.send({ type: 'memory_write', key, value });
  }

  async readMemory(key: string): Promise<any> {
    return new Promise((resolve) => {
      const pending: PendingMemoryRead = {
        resolve,
        resolved: false,
        timer: setTimeout(() => {
          this.resolveMemoryRead(key, pending, null);
        }, 5000),
      };
      const queue = this.pendingMemoryReads.get(key) || [];
      queue.push(pending);
      this.pendingMemoryReads.set(key, queue);
      this.send({ type: 'memory_read', key });
    });
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1; // 1 = OPEN
  }

  shutdown(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    for (const topic of this.topics) {
      this.send({ type: 'leave', topic });
    }
    if (this.ws) {
      this.ws.close(1000, 'Agent shutting down');
    }
  }
}

// ============================================================================
// Global channel instance (single Hub connection)
// ============================================================================

export const channelInstance = new WoClawChannelInstance();

// ============================================================================
// Channel Config Adapter
// ============================================================================

function listAccountIds(cfg: any): string[] {
  const accounts = cfg?.channels?.['woclaw']?.accounts;
  if (!accounts) return ['default'];
  return Object.keys(accounts);
}

function resolveAccount(cfg: any, accountId?: string | null): WoClawResolvedAccount {
  const section = cfg?.channels?.['woclaw'];
  const accId = accountId ?? 'default';
  const account = section?.accounts?.[accId] ?? {};
  return {
    accountId: accId,
    hubUrl: account.hubUrl ?? section?.hubUrl ?? 'ws://localhost:8080',
    agentId: account.agentId ?? section?.agentId ?? '',
    token: account.token ?? section?.token ?? '',
    autoJoin: account.autoJoin ?? section?.autoJoin ?? [],
  };
}

function inspectAccount(cfg: any, accountId?: string | null): any {
  const account = resolveAccount(cfg, accountId);
  return {
    enabled: Boolean(account.hubUrl && account.agentId && account.token),
    configured: Boolean(account.hubUrl && account.agentId && account.token),
    hubUrl: account.hubUrl,
    agentId: account.agentId,
    tokenStatus: account.token ? 'available' : 'missing',
  };
}

function isConfigured(account: WoClawResolvedAccount): boolean {
  return Boolean(account.hubUrl && account.agentId && account.token);
}

function unconfiguredReason(account: WoClawResolvedAccount): string {
  if (!account.hubUrl) return 'hubUrl is required';
  if (!account.agentId) return 'agentId is required';
  if (!account.token) return 'token is required';
  return '';
}

// ============================================================================
// Channel Setup Adapter
// ============================================================================

function applyAccountConfig({ cfg, accountId, input }: { cfg: any; accountId: string; input: any }): any {
  const config = { ...cfg };
  if (!config.channels) config.channels = {};
  if (!config.channels['woclaw']) config.channels['woclaw'] = { accounts: {} };
  if (!config.channels['woclaw'].accounts) config.channels['woclaw'].accounts = {};

  config.channels['woclaw'].accounts[accountId] = {
    hubUrl: input.hubUrl,
    agentId: input.agentId,
    token: input.token,
    autoJoin: input.autoJoin ?? [],
  };

  return config;
}

function afterAccountConfigWritten(params: { cfg: any; accountId: string; runtime: any }): void {
  const account = resolveAccount(params.cfg, params.accountId);
  if (isConfigured(account)) {
    const dispatchFn = (msg: any) => {
      if (params.runtime?.dispatch) {
        params.runtime.dispatch({ channel: 'woclaw', ...msg });
      }
    };
    const logger = params.runtime?.logger ?? {
      info: (msg: string) => console.log(msg),
      warn: (msg: string) => console.warn(msg),
      error: (msg: string, ...args: any[]) => console.error(msg, ...args),
      debug: (msg: string) => console.debug(msg),
    };
    channelInstance.initialize(account, dispatchFn, logger);
  }
}

function destroyAccount(): void {
  channelInstance.shutdown();
}

// ============================================================================
// Channel Plugin Object
// ============================================================================

import type { ChannelPlugin } from './plugin-types.js';

export const woclawChannelPlugin: ChannelPlugin = {
  id: 'woclaw',
  meta: {
    id: 'woclaw',
    label: 'WoClaw',
    selectionLabel: 'WoClaw',
    docsPath: 'https://github.com/XingP14/woclaw',
    blurb: 'Connect to WoClaw Hub for topic-based multi-agent communication.',
    order: 50,
  },
  capabilities: {
    chatTypes: ['group'],
    polls: false,
    reactions: false,
    edit: false,
    unsend: false,
    reply: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: false,
  },
  config: {
    listAccountIds,
    resolveAccount,
    inspectAccount,
    isConfigured,
    unconfiguredReason,
  },
  setup: {
    resolveAccountId: ({ accountId }) => accountId ?? 'default',
    applyAccountConfig,
    afterAccountConfigWritten,
    destroyAccount,
  },
  messaging: {
    // Minimal messaging adapter - WoClaw uses sendMessage directly
  },
  outbound: {
    deliveryMode: 'direct',
  },
};
