// ClawLink Plugin for OpenClaw
// Enables OpenClaw agents to connect to ClawLink hub

import type { ChannelPlugin, ChannelPluginContext } from '@openclaw/sdk';

export interface ClawLinkConfig {
  hubUrl: string;
  agentId: string;
  token: string;
  autoJoin?: string[];
  topics?: string[];
}

interface OutboundMessage {
  type: string;
  topic?: string;
  content?: string;
  key?: string;
  value?: any;
}

export class ClawLinkChannel implements ChannelPlugin {
  name = 'clawlink';
  private ws: WebSocket | null = null;
  private config: ClawLinkConfig | null = null;
  private ctx: ChannelPluginContext | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pendingMessages: Map<string, (result: any) => void> = new Map();
  private messageHandlers: ((msg: any) => void)[] = [];
  private topics: Set<string> = new Set();
  private agentId: string = '';

  async initialize(ctx: ChannelPluginContext): Promise<void> {
    this.ctx = ctx;
    const config = ctx.config as ClawLinkConfig;
    this.config = config;
    this.agentId = config.agentId;
    
    if (config.autoJoin) {
      for (const topic of config.autoJoin) {
        this.topics.add(topic);
      }
    }
    if (config.topics) {
      for (const topic of config.topics) {
        this.topics.add(topic);
      }
    }

    this.connect();
  }

  private connect(): void {
    if (!this.config || !this.ctx) return;

    const url = `${this.config.hubUrl}?agentId=${encodeURIComponent(this.config.agentId)}&token=${encodeURIComponent(this.config.token)}`;
    
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.ctx?.logger.info(`[ClawLink] Connected to hub: ${this.config?.hubUrl}`);
        
        // Auto-join topics
        for (const topic of this.topics) {
          this.send({ type: 'join', topic });
        }
        
        // Start ping interval
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.send({ type: 'ping' });
          }
        }, 25000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          this.ctx?.logger.error('[ClawLink] Failed to parse message:', e);
        }
      };

      this.ws.onclose = (event) => {
        this.ctx?.logger.warn(`[ClawLink] Disconnected (code: ${event.code})`);
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        this.ctx?.logger.error('[ClawLink] WebSocket error:', error);
      };
    } catch (e) {
      this.ctx?.logger.error('[ClawLink] Failed to connect:', e);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ctx?.logger.info('[ClawLink] Attempting to reconnect...');
      this.connect();
    }, 5000);
  }

  private send(msg: OutboundMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'welcome':
        this.ctx?.logger.info(`[ClawLink] Authenticated as ${msg.agentId}`);
        break;

      case 'message':
        // Handle incoming message - dispatch to OpenClaw
        if (msg.from !== this.agentId) {
          const message = {
            channel: 'clawlink',
            id: msg.id,
            from: msg.from,
            text: msg.content,
            topic: msg.topic,
            timestamp: msg.timestamp,
          };
          
          // Dispatch to OpenClaw
          this.ctx?.dispatch(message);
        }
        break;

      case 'join':
        this.ctx?.logger.debug(`[ClawLink] Agent ${msg.agent} joined ${msg.topic}`);
        break;

      case 'leave':
        this.ctx?.logger.debug(`[ClawLink] Agent ${msg.agent} left ${msg.topic}`);
        break;

      case 'history':
        this.ctx?.logger.debug(`[ClawLink] Received ${msg.messages.length} historical messages for ${msg.topic}`);
        // Process history if needed
        for (const historicalMsg of msg.messages) {
          if (historicalMsg.from !== this.agentId) {
            this.ctx?.dispatch({
              channel: 'clawlink',
              id: historicalMsg.id,
              from: historicalMsg.from,
              text: historicalMsg.content,
              topic: historicalMsg.topic,
              timestamp: historicalMsg.timestamp,
              isHistorical: true,
            });
          }
        }
        break;

      case 'pong':
        // Keepalive response, nothing to do
        break;

      case 'memory_update':
        this.ctx?.logger.debug(`[ClawLink] Memory updated: ${msg.key} by ${msg.from}`);
        // Could trigger a context update here
        break;

      case 'memory_value':
        // Response to memory_read
        break;

      case 'topics_list':
      case 'topic_members':
        // Response to queries
        break;

      case 'error':
        this.ctx?.logger.error(`[ClawLink] Server error: ${msg.code} - ${msg.message}`);
        break;
    }

    // Notify handlers
    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch (e) {
        this.ctx?.logger.error('[ClawLink] Handler error:', e);
      }
    }
  }

  // Public API for sending messages from OpenClaw
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
      const mid = Date.now().toString();
      this.pendingMessages.set(mid, resolve);
      this.send({ type: 'memory_read', key });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingMessages.has(mid)) {
          this.pendingMessages.delete(mid);
          resolve(null);
        }
      }, 5000);
    });
  }

  onMessage(handler: (msg: any) => void): void {
    this.messageHandlers.push(handler);
  }

  async shutdown(): Promise<void> {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    
    // Leave all topics
    for (const topic of this.topics) {
      this.send({ type: 'leave', topic });
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Agent shutting down');
    }
  }
}

export default new ClawLinkChannel();
