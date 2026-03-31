// ClawLink Plugin for OpenClaw
// Enables OpenClaw agents to connect to ClawLink hub

const { WebSocket } = require('ws');

class ClawLinkChannel {
  constructor() {
    this.name = 'clawlink';
    this.ws = null;
    this.config = null;
    this.ctx = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.pendingMessages = new Map();
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
        this.ctx?.logger?.info(`[ClawLink] Connected to hub: ${this.config?.hubUrl}`);
        
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
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          this.ctx?.logger?.error('[ClawLink] Failed to parse message:', e);
        }
      };

      this.ws.onclose = (event) => {
        this.ctx?.logger?.warn(`[ClawLink] Disconnected (code: ${event.code})`);
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        this.ctx?.logger?.error('[ClawLink] WebSocket error:', error);
      };
    } catch (e) {
      this.ctx?.logger?.error('[ClawLink] Failed to connect:', e);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ctx?.logger?.info('[ClawLink] Attempting to reconnect...');
      this.connect();
    }, 5000);
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.ctx?.logger?.info(`[ClawLink] Authenticated as ${msg.agentId}`);
        break;

      case 'message':
        if (msg.from !== this.agentId) {
          this.ctx?.dispatch({
            channel: 'clawlink',
            id: msg.id,
            from: msg.from,
            text: msg.content,
            topic: msg.topic,
            timestamp: msg.timestamp,
          });
        }
        break;

      case 'join':
        this.ctx?.logger?.debug(`[ClawLink] Agent ${msg.agent} joined ${msg.topic}`);
        break;

      case 'leave':
        this.ctx?.logger?.debug(`[ClawLink] Agent ${msg.agent} left ${msg.topic}`);
        break;

      case 'history':
        this.ctx?.logger?.debug(`[ClawLink] Received ${msg.messages?.length || 0} historical messages for ${msg.topic}`);
        for (const historicalMsg of (msg.messages || [])) {
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
        break;

      case 'memory_update':
        this.ctx?.logger?.debug(`[ClawLink] Memory updated: ${msg.key} by ${msg.from}`);
        break;

      case 'error':
        this.ctx?.logger?.error(`[ClawLink] Server error: ${msg.code} - ${msg.message}`);
        break;

      case 'memory_result':
        if (msg.mid && this.pendingMessages.has(msg.mid)) {
          const resolve = this.pendingMessages.get(msg.mid);
          this.pendingMessages.delete(msg.mid);
          resolve(msg.value ?? null);
        }
        break;
    }

    for (const handler of this.messageHandlers) {
      try {
        handler(msg);
      } catch (e) {
        this.ctx?.logger?.error('[ClawLink] Handler error:', e);
      }
    }
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (e) {
        this.ctx?.logger?.error('[ClawLink] Failed to send message:', e);
      }
    } else {
      this.ctx?.logger?.warn('[ClawLink] Cannot send: WebSocket not connected');
    }
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

  async writeMemory(key, value) {
    this.send({ type: 'memory_write', key, value });
  }

  async readMemory(key) {
    return new Promise((resolve) => {
      const mid = Date.now().toString();
      this.pendingMessages.set(mid, resolve);
      this.send({ type: 'memory_read', key, mid });
      
      setTimeout(() => {
        if (this.pendingMessages.has(mid)) {
          this.pendingMessages.delete(mid);
          resolve(null);
        }
      }, 5000);
    });
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

module.exports = new ClawLinkChannel();
