import { WebSocketServer, WebSocket as WSType } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { Agent, InboundMessage, OutboundMessage, Config } from './types.js';
import { TopicsManager } from './topics.js';
import { MemoryPool } from './memory.js';
import { ClawDB } from './db.js';

// Use ws WebSocket type explicitly
type WS = InstanceType<typeof WSType>;

export class WSServer {
  private wss: WebSocketServer;
  private agents: Map<string, Agent<WS>> = new Map();
  private agentByWs: Map<WS, string> = new Map();
  private topics: TopicsManager;
  private memory: MemoryPool;
  private db: ClawDB;
  private config: Config;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(config: Config, db: ClawDB) {
    this.config = config;
    this.db = db;
    this.topics = new TopicsManager();
    this.memory = new MemoryPool(db);
    
    this.wss = new WebSocketServer({ port: config.port });
    
    this.wss.on('connection', (ws: WS, req) => {
      this.handleConnection(ws, req);
    });

    this.pingInterval = setInterval(() => {
      this.pingAll();
    }, 30000);

    console.log(`[ClawLink] WebSocket server running on ws://${config.host}:${config.port}`);
  }

  private handleConnection(ws: WS, req: any): void {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const agentId = url.searchParams.get('agentId');
    const token = url.searchParams.get('token');

    if (!agentId || token !== this.config.authToken) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    if (this.agents.has(agentId)) {
      const oldAgent = this.agents.get(agentId);
      if (oldAgent?.ws.readyState === 1) { // OPEN = 1
        oldAgent.ws.close(4002, 'Replaced by new connection');
      }
    }

    const agent: Agent<WS> = {
      agentId,
      ws,
      topics: new Set(),
      connectedAt: Date.now(),
    };
    this.agents.set(agentId, agent);
    this.agentByWs.set(ws, agentId);

    console.log(`[ClawLink] Agent connected: ${agentId} (total: ${this.agents.size})`);

    this.send(ws, {
      type: 'welcome',
      agentId,
      timestamp: Date.now(),
      topics: this.topics.getAllTopics().map(t => t.name),
    });

    ws.on('message', (data: Buffer) => {
      try {
        const msg: InboundMessage = JSON.parse(data.toString());
        this.handleMessage(agentId, msg);
      } catch (e) {
        this.sendError(ws, 'invalid_message', 'Failed to parse message');
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(agentId);
    });

    ws.on('error', (err: Error) => {
      console.error(`[ClawLink] WebSocket error for ${agentId}:`, err.message);
      this.handleDisconnect(agentId);
    });
  }

  private handleMessage(agentId: string, msg: InboundMessage): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    switch (msg.type) {
      case 'message':
        if (!msg.topic || !msg.content) {
          this.sendError(agent.ws, 'missing_fields', 'topic and content required');
          return;
        }
        this.handleChatMessage(agentId, msg.topic, msg.content);
        break;

      case 'join':
        if (!msg.topic) {
          this.sendError(agent.ws, 'missing_fields', 'topic required');
          return;
        }
        this.handleJoin(agentId, msg.topic);
        break;

      case 'leave':
        if (!msg.topic) {
          this.sendError(agent.ws, 'missing_fields', 'topic required');
          return;
        }
        this.handleLeave(agentId, msg.topic);
        break;

      case 'memory_write':
        if (!msg.key) {
          this.sendError(agent.ws, 'missing_fields', 'key required');
          return;
        }
        this.handleMemoryWrite(agentId, msg.key, msg.value);
        break;

      case 'memory_read':
        if (!msg.key) {
          this.sendError(agent.ws, 'missing_fields', 'key required');
          return;
        }
        this.handleMemoryRead(agent.ws, agentId, msg.key);
        break;

      case 'topics_list':
        this.handleTopicsList(agent.ws);
        break;

      case 'topic_members':
        if (!msg.topic) {
          this.sendError(agent.ws, 'missing_fields', 'topic required');
          return;
        }
        this.handleTopicMembers(agent.ws, msg.topic);
        break;

      case 'ping':
        this.send(agent.ws, { type: 'pong', timestamp: Date.now() });
        break;

      default:
        this.sendError(agent.ws, 'unknown_type', `Unknown message type: ${msg.type}`);
    }
  }

  private handleChatMessage(fromAgent: string, topic: string, content: string): void {
    const message = {
      id: uuidv4(),
      type: 'message' as const,
      topic,
      from: fromAgent,
      content,
      timestamp: Date.now(),
    };

    this.db.saveMessage({
      id: message.id,
      topic: message.topic,
      from: message.from,
      content: message.content,
      timestamp: message.timestamp,
    });

    const recipients = this.topics.broadcast(topic, message);
    for (const agentId of recipients) {
      const agent = this.agents.get(agentId);
      if (agent && agent.ws.readyState === 1) {
        this.send(agent.ws, message);
      }
    }

    const sender = this.agents.get(fromAgent);
    if (sender && sender.ws.readyState === 1) {
      this.send(sender.ws, { ...message, sent: true });
    }
  }

  private handleJoin(agentId: string, topic: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.topics.joinTopic(agentId, topic);
    agent.topics.add(topic);

    const history = this.db.getMessages(topic, 50);
    history.reverse();

    this.send(agent.ws, {
      type: 'history',
      topic,
      messages: history,
      agents: this.topics.getTopicAgents(topic),
      timestamp: Date.now(),
    });

    const notification: OutboundMessage = {
      type: 'join',
      topic,
      agent: agentId,
      timestamp: Date.now(),
    };

    for (const otherAgentId of this.topics.getTopicAgents(topic)) {
      if (otherAgentId !== agentId) {
        const other = this.agents.get(otherAgentId);
        if (other && other.ws.readyState === 1) {
          this.send(other.ws, notification);
        }
      }
    }

    console.log(`[ClawLink] ${agentId} joined topic: ${topic}`);
  }

  private handleLeave(agentId: string, topic: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.topics.leaveTopic(agentId, topic);
    agent.topics.delete(topic);

    const notification: OutboundMessage = {
      type: 'leave',
      topic,
      agent: agentId,
      timestamp: Date.now(),
    };

    for (const otherAgentId of this.topics.getTopicAgents(topic)) {
      const other = this.agents.get(otherAgentId);
      if (other && other.ws.readyState === 1) {
        this.send(other.ws, notification);
      }
    }

    console.log(`[ClawLink] ${agentId} left topic: ${topic}`);
  }

  private handleMemoryWrite(fromAgent: string, key: string, value: any): void {
    const mem = this.memory.write(key, value, fromAgent);
    
    const notification: OutboundMessage = {
      type: 'memory_update',
      key,
      value: mem.value,
      from: fromAgent,
      timestamp: mem.updatedAt,
    };
    this.memory.notifySubscribers(notification);

    for (const [agentId, agent] of this.agents) {
      if (agent.ws.readyState === 1) {
        this.send(agent.ws, notification);
      }
    }
  }

  private handleMemoryRead(ws: WS, fromAgent: string, key: string): void {
    const mem = this.memory.read(key);
    this.send(ws, {
      type: 'memory_value',
      key,
      value: mem?.value ?? null,
      exists: !!mem,
      updatedAt: mem?.updatedAt ?? null,
      updatedBy: mem?.updatedBy ?? null,
      timestamp: Date.now(),
    });
  }

  private handleTopicsList(ws: WS): void {
    const topics = this.topics.getAllTopics().map(t => ({
      name: t.name,
      agents: t.agents.size,
    }));
    this.send(ws, { type: 'topics_list', topics, timestamp: Date.now() });
  }

  private handleTopicMembers(ws: WS, topic: string): void {
    const agents = this.topics.getTopicAgents(topic);
    this.send(ws, { type: 'topic_members', topic, agents, timestamp: Date.now() });
  }

  private handleDisconnect(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const leftTopics = this.topics.removeAgent(agentId);

    for (const topic of leftTopics) {
      const notification: OutboundMessage = {
        type: 'leave',
        topic,
        agent: agentId,
        timestamp: Date.now(),
      };

      for (const [otherId, other] of this.agents) {
        if (otherId !== agentId && other.ws.readyState === 1) {
          this.send(other.ws, notification);
        }
      }
    }

    this.agents.delete(agentId);
    this.agentByWs.delete(agent.ws);
    this.memory.unsubscribe(agentId);

    console.log(`[ClawLink] Agent disconnected: ${agentId} (remaining: ${this.agents.size})`);
  }

  private send(ws: WS, msg: OutboundMessage): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WS, code: string, message: string): void {
    this.send(ws, { type: 'error', code, message, timestamp: Date.now() });
  }

  private pingAll(): void {
    for (const [agentId, agent] of this.agents) {
      if (agent.ws.readyState === 1) {
        try {
          (agent.ws as any).ping();
        } catch (e) {
          console.error(`[ClawLink] Ping failed for ${agentId}`);
          this.handleDisconnect(agentId);
        }
      }
    }
  }

  getStats() {
    return {
      agents: this.agents.size,
      topics: this.topics.getStats(),
      memory: this.memory.getAll().length,
    };
  }

  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    for (const [_, agent] of this.agents) {
      agent.ws.close(1001, 'Server shutting down');
    }
    this.wss.close();
    this.db.close();
    console.log('[ClawLink] Server closed');
  }
}
