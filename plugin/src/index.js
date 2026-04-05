// WoClaw Plugin for OpenClaw
// Enables OpenClaw agents to connect to WoClaw hub

import { WebSocket } from 'ws';

class WoClawChannel {
  constructor() {
    this.name = 'woclaw';
    this.ws = null;
    this.config = null;
    this.ctx = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.pendingMemoryReads = new Map();
    this.messageHandlers = [];
    this.topics = new Set();
    this.agentId = '';
  }

  async initialize(ctx) {
    this.ctx = ctx;
    const config = ctx.config;
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

  connect() {
    if (!this.config || !this.ctx) return;

    const url = `${this.config.hubUrl}?agentId=${encodeURIComponent(this.config.agentId)}&token=${encodeURIComponent(this.config.token)}`;
    
    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.ctx?.logger?.info(`[WoClaw] Connected to hub: ${this.config?.hubUrl}`);
        
        for (const topic of this.topics) {
          this.send({ type: 'join', topic });
        }
        
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.send({ type: 'ping' });
          }
        }, 25000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data.toString());
          this.handleMessage(msg);
        } catch (e) {
          this.ctx?.logger?.error('[WoClaw] Failed to parse message:', e);
        }
      };

      this.ws.onclose = (event) => {
        this.ctx?.logger?.warn(`[WoClaw] Disconnected (code: ${event.code})`);
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        this.ctx?.logger?.error('[WoClaw] WebSocket error:', error);
      };
    } catch (e) {
      this.ctx?.logger?.error('[WoClaw] Failed to connect:', e);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ctx?.logger?.info('[WoClaw] Attempting to reconnect...');
      this.connect();
    }, 5000);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.ctx?.logger?.info(`[WoClaw] Authenticated as ${msg.agentId}`);
        break;

      case 'message':
        if (msg.from !== this.agentId) {
          this.ctx?.dispatch({
            channel: 'woclaw',
            id: msg.id,
            from: msg.from,
            text: msg.content,
            topic: msg.topic,
            timestamp: msg.timestamp,
          });
        }
        break;

      case 'join':
        this.ctx?.logger?.debug(`[WoClaw] Agent ${msg.agent} joined ${msg.topic}`);
        break;

      case 'leave':
        this.ctx?.logger?.debug(`[WoClaw] Agent ${msg.agent} left ${msg.topic}`);
        break;

      case 'history':
        this.ctx?.logger?.debug(`[WoClaw] Received ${msg.messages?.length || 0} historical messages for ${msg.topic}`);
        for (const historicalMsg of (msg.messages || [])) {
          if (historicalMsg.from !== this.agentId) {
            this.ctx?.dispatch({
              channel: 'woclaw',
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
        break;

      case 'memory_update':
        this.ctx?.logger?.debug(`[WoClaw] Memory updated: ${msg.key} by ${msg.from}`);
        break;

      case 'error':
        this.ctx?.logger?.error(`[WoClaw] Server error: ${msg.code} - ${msg.message}`);
        break;

      case 'memory_value': {
        const queue = this.pendingMemoryReads.get(msg.key);
        if (queue && queue.length > 0) {
          this.resolveMemoryRead(msg.key, queue[0], msg.exists ? msg.value : null);
        }
        break;
      }
    }

    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch (e) {
        this.ctx?.logger?.error('[WoClaw] Handler error:', e);
      }
    }
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (e) {
        this.ctx?.logger?.error('[WoClaw] Failed to send message:', e);
      }
    } else {
      this.ctx?.logger?.warn('[WoClaw] Cannot send: WebSocket not connected');
    }
  }

  resolveMemoryRead(key, pending, value) {
    if (!pending || pending.resolved) return;

    pending.resolved = true;
    if (pending.timer) clearTimeout(pending.timer);
    pending.resolve(value);

    const queue = this.pendingMemoryReads.get(key);
    if (!queue) return;
    const index = queue.indexOf(pending);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this.pendingMemoryReads.delete(key);
  }

  async sendMessage(topic, content) {
    this.send({ type: 'message', topic, content });
  }

  async joinTopic(topic) {
    this.topics.add(topic);
    this.send({ type: 'join', topic });
  }

  async leaveTopic(topic) {
    this.topics.delete(topic);
    this.send({ type: 'leave', topic });
  }

  async writeMemory(key, value, tags = [], ttl = 0) {
    // v0.4: support tags (string[]) and ttl (seconds, 0=no expiry)
    this.send({ type: 'memory_write', key, value, tags, ttl });
  }

  async readMemory(key) {
    return new Promise((resolve) => {
      const pending = {
        resolve,
        resolved: false,
        timer: null,
      };
      pending.timer = setTimeout(() => {
        this.resolveMemoryRead(key, pending, null);
      }, 5000);

      const queue = this.pendingMemoryReads.get(key) || [];
      queue.push(pending);
      this.pendingMemoryReads.set(key, queue);
      this.send({ type: 'memory_read', key });
    });
  }

  async queryMemoryByTag(tag) {
    // v0.4: subscribe to memory_update events filtered by tag
    // Caller should use onMessage handler to receive matching updates
    return []; // REST fallback: use HTTP GET /memory/tags/:tag
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  async shutdown() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    
    for (const topic of this.topics) {
      this.send({ type: 'leave', topic });
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Agent shutting down');
    }
  }
}

export default new WoClawChannel();
