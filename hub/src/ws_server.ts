import { WebSocketServer, WebSocket as WSType } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import http from 'http';
import { readFileSync } from 'fs';
import { Agent, InboundMessage, OutboundMessage, Config, RateLimitEntry, RateLimitConfig, RateLimitStatus, DEFAULT_RATE_LIMIT_MESSAGES, DEFAULT_RATE_LIMIT_WINDOW_MS, FederationPeer } from './types.js';
import { TopicsManager } from './topics.js';
import { MemoryPool } from './memory.js';
import { ClawDB } from './db.js';
import { FederationManager } from './federation.js';

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
  private delegations: Map<string, import('./types.js').Delegation> = new Map();
  // Rate limiting
  // v1.0: Token rotation
  private gracePeriodMs: number = 5 * 60 * 1000;
  private gracePeriodEnd: number | null = null;
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private rateLimitConfig: RateLimitConfig = {
    messages: DEFAULT_RATE_LIMIT_MESSAGES,
    windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
  };
  // v1.0: Multi-Hub Federation
  private federationManager: FederationManager;

  constructor(config: Config, db: ClawDB) {
    this.config = config;
    this.db = db;
    if (config.tokenGracePeriodMs) this.gracePeriodMs = config.tokenGracePeriodMs;
    this.topics = new TopicsManager();
    this.memory = new MemoryPool(db);
    // v1.0: Initialize FederationManager
    if (!config.hubId) config.hubId = `hub-${uuidv4().slice(0, 8)}`;
    this.federationManager = new FederationManager(config);
    this.federationManager.start();

    const useTLS = !!(config.tlsKey && config.tlsCert);
    let server: http.Server | https.Server;

    if (useTLS) {
      try {
        const tlsOptions: https.ServerOptions = {
          key: readFileSync(config.tlsKey!),
          cert: readFileSync(config.tlsCert!),
        };
        server = https.createServer(tlsOptions);
        console.log(`[WoClaw] TLS enabled: wss://${config.host}:${config.port}`);
      } catch (e: any) {
        console.error(`[WoClaw] Failed to load TLS certificate: ${e.message}`);
        throw e;
      }
    } else {
      server = http.createServer();
      console.log(`[WoClaw] TLS disabled: ws://${config.host}:${config.port}`);
    }

    this.wss = new WebSocketServer({ server });
    this.wss.on('connection', (ws: WS, req) => {
      this.handleConnection(ws, req);
    });

    server.listen(config.port, config.host);

    this.pingInterval = setInterval(() => {
      this.pingAll();
    }, 30000);

    console.log(`[WoClaw] WebSocket server running on ${useTLS ? 'wss' : 'ws'}://${config.host}:${config.port}`);
  }

  private handleConnection(ws: WS, req: any): void {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const agentId = url.searchParams.get('agentId');
    const token = url.searchParams.get('token');

    // v1.0: Token rotation — accept current or next token during grace period
    const isValidToken = token === this.config.authToken ||
      (this.config.nextAuthToken && token === this.config.nextAuthToken);
    if (!agentId || !isValidToken) {
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

    console.log(`[WoClaw] Agent connected: ${agentId} (total: ${this.agents.size})`);

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
      console.error(`[WoClaw] WebSocket error for ${agentId}:`, err.message);
      this.handleDisconnect(agentId);
    });
  }

  private handleMessage(agentId: string, msg: InboundMessage): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Rate limiting check (skip for ping/pong to avoid bias)
    if (msg.type !== 'ping' && msg.type !== 'pong') {
      const rateLimitResult = this.checkRateLimit(agentId);
      if (rateLimitResult.limited) {
        this.sendError(agent.ws, 'RATE_LIMIT_EXCEEDED',
          `Rate limit exceeded. Retry after ${rateLimitResult.retryAfter}ms`,
          rateLimitResult.retryAfter);
        return;
      }
    }

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
        this.handleMemoryWrite(agentId, msg.key, msg.value, msg.tags, msg.ttl);
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

      case 'delegate_request':
        this.handleDelegateRequest(agentId, msg);
        break;

      case 'delegate_response':
        this.handleDelegateResponse(agentId, msg);
        break;

      case 'delegate_progress':
        this.handleDelegateProgress(agentId, msg);
        break;

      case 'delegate_result':
        this.handleDelegateResult(agentId, msg);
        break;

      case 'delegate_cancel':
        this.handleDelegateCancel(agentId, msg);
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

    console.log(`[WoClaw] ${agentId} joined topic: ${topic}`);
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

    console.log(`[WoClaw] ${agentId} left topic: ${topic}`);
  }

  private handleMemoryWrite(fromAgent: string, key: string, value: any, tags?: string[], ttl?: number): void {
    const { mem, duplicate, conflict, previousValue } = this.memory.write(key, value, fromAgent, tags ?? [], ttl ?? 0);

    const notification: OutboundMessage = {
      type: 'memory_update',
      key,
      value: mem.value,
      tags: mem.tags,
      ttl: mem.ttl,
      expireAt: mem.expireAt,
      from: fromAgent,
      timestamp: mem.updatedAt,
      // v1.0: Deduplication — conflict type in WS notification
      conflictType: duplicate ? 'DUPLICATE_WRITE' : conflict ? 'UPDATE_CONFLICT' : undefined,
      previousValue: (duplicate || conflict) ? previousValue : undefined,
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
      tags: mem?.tags ?? [],
      ttl: mem?.ttl ?? 0,
      expireAt: mem?.expireAt ?? 0,
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

    console.log(`[WoClaw] Agent disconnected: ${agentId} (remaining: ${this.agents.size})`);
  }

  private send(ws: WS, msg: OutboundMessage): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WS, code: string, message: string, retryAfter?: number): void {
    const msg: OutboundMessage = { type: 'error', code, message, timestamp: Date.now() };
    if (retryAfter !== undefined) (msg as any).retryAfter = retryAfter;
    this.send(ws, msg);
  }

  /**
   * Check rate limit for an agent.
   * Uses sliding window counter: keeps timestamps of recent messages within the window.
   * Returns { limited: false } if OK, { limited: true, retryAfter: ms } if exceeded.
   */
  private checkRateLimit(agentId: string): { limited: boolean; retryAfter?: number } {
    const now = Date.now();
    const { messages, windowMs } = this.rateLimitConfig;

    // Get or create entry
    let entry = this.rateLimits.get(agentId);
    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(agentId, entry);
    }

    // Remove timestamps outside the window
    const windowStart = now - windowMs;
    entry.timestamps = entry.timestamps.filter(t => t > windowStart);

    if (entry.timestamps.length >= messages) {
      // Oldest timestamp in window determines when agent can retry
      const oldest = entry.timestamps[0];
      const retryAfter = (oldest + windowMs) - now;
      return { limited: true, retryAfter: Math.max(0, retryAfter) };
    }

    // Record this message
    entry.timestamps.push(now);
    return { limited: false };
  }

  /** Get rate limit status for all agents (for REST API /rate-limits). */
  getRateLimitStatuses(): RateLimitStatus[] {
    const now = Date.now();
    const { messages, windowMs } = this.rateLimitConfig;
    const statuses: RateLimitStatus[] = [];

    for (const [agentId, entry] of this.rateLimits) {
      // Prune old timestamps first
      const windowStart = now - windowMs;
      const valid = entry.timestamps.filter(t => t > windowStart);
      entry.timestamps = valid;

      if (valid.length > 0 || this.agents.has(agentId)) {
        statuses.push({
          agentId,
          limit: messages,
          windowMs,
          currentCount: valid.length,
          oldestTimestamp: valid.length > 0 ? valid[0] : null,
        });
      }
    }

    return statuses;
  }

  /** Set rate limit config (called by REST API). */
  setRateLimitConfig(config: Partial<RateLimitConfig>): void {
    if (config.messages !== undefined) this.rateLimitConfig.messages = config.messages;
    if (config.windowMs !== undefined) this.rateLimitConfig.windowMs = config.windowMs;
  }

  private pingAll(): void {
    for (const [agentId, agent] of this.agents) {
      if (agent.ws.readyState === 1) {
        try {
          (agent.ws as any).ping();
        } catch (e) {
          console.error(`[WoClaw] Ping failed for ${agentId}`);
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
      delegations: this.delegations.size,
    };
  }

  getDelegation(id: string): import('./types.js').Delegation | undefined {
    return this.delegations.get(id);
  }

  getDelegations(filters?: { fromAgent?: string; toAgent?: string; status?: string }): import('./types.js').Delegation[] {
    let result = Array.from(this.delegations.values());
    if (filters?.fromAgent) result = result.filter(d => d.fromAgent === filters.fromAgent);
    if (filters?.toAgent) result = result.filter(d => d.toAgent === filters.toAgent);
    if (filters?.status) result = result.filter(d => d.status === filters.status);
    return result;
  }

  // v0.4: Send raw message to a specific connected agent (for REST API delegation routing)
  sendToAgent(agentId: string, msg: OutboundMessage): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.ws.readyState !== 1) return false;
    this.send(agent.ws, msg);
    return true;
  }

  getTopicsManager(): TopicsManager {
    return this.topics;
  }

  getMemoryPool(): MemoryPool {
    return this.memory;
  }

  // v0.4: Delegation - handle delegate_request
  private handleDelegateRequest(fromAgent: string, msg: import('./types.js').InboundMessage): void {
    const id = msg.id;
    const toAgent = msg.toAgent;
    if (!id || !toAgent || !msg.task) {
      const agent = this.agents.get(fromAgent);
      if (agent) this.sendError(agent.ws, 'missing_fields', 'id, toAgent, task required for delegate_request');
      return;
    }

    // Store delegation
    const delegation: import('./types.js').Delegation = {
      id,
      fromAgent,
      toAgent,
      task: msg.task as import('./types.js').DelegationTask,
      topic: msg.topic,
      status: 'requested',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.delegations.set(id, delegation);

    // Notify target agent
    const target = this.agents.get(toAgent);
    if (target && target.ws.readyState === 1) {
      this.send(target.ws, {
        type: 'delegate_incoming',
        id,
        fromAgent,
        task: msg.task,
        topic: msg.topic,
        createdAt: delegation.createdAt,
      } as OutboundMessage);
    } else {
      // Target not connected — reject immediately
      delegation.status = 'rejected';
      delegation.note = 'Target agent not connected';
      delegation.updatedAt = Date.now();
      this.sendDelegationUpdate(id, fromAgent);
      return;
    }

    // Confirm to delegator
    const agent = this.agents.get(fromAgent);
    if (agent && agent.ws.readyState === 1) {
      this.send(agent.ws, {
        type: 'delegate_status',
        id,
        status: 'requested',
        updatedAt: delegation.updatedAt,
      } as OutboundMessage);
    }
  }

  // v0.4: Delegation - handle delegate_response (accept/reject)
  private handleDelegateResponse(agentId: string, msg: import('./types.js').InboundMessage): void {
    const delegation = this.delegations.get(msg.id ?? '');
    if (!delegation) {
      const agent = this.agents.get(agentId);
      if (agent) this.sendError(agent.ws, 'not_found', `Delegation ${msg.id} not found`);
      return;
    }
    if (delegation.toAgent !== agentId) {
      const agent = this.agents.get(agentId);
      if (agent) this.sendError(agent.ws, 'forbidden', 'You are not the target of this delegation');
      return;
    }
    if (delegation.status !== 'requested') {
      const agent = this.agents.get(agentId);
      if (agent) this.sendError(agent.ws, 'invalid_state', `Delegation already ${delegation.status}`);
      return;
    }

    const newStatus = msg.status === 'accepted' ? 'accepted' : 'rejected';
    delegation.status = newStatus;
    delegation.note = msg.note;
    delegation.updatedAt = Date.now();
    if (newStatus === 'accepted') delegation.acceptedAt = Date.now();

    // Notify delegator
    this.sendDelegationUpdate(delegation.id, delegation.fromAgent);
  }

  // v0.4: Delegation - handle delegate_progress
  private handleDelegateProgress(agentId: string, msg: import('./types.js').InboundMessage): void {
    const delegation = this.delegations.get(msg.id ?? '');
    if (!delegation || delegation.toAgent !== agentId) {
      const agent = this.agents.get(agentId);
      if (agent) this.sendError(agent.ws, 'not_found', `Delegation ${msg.id} not found or not yours`);
      return;
    }
    delegation.progress = msg.progress ?? delegation.progress;
    delegation.updatedAt = Date.now();
    if (delegation.status === 'accepted') delegation.status = 'running';

    this.sendDelegationUpdate(delegation.id, delegation.fromAgent);
  }

  // v0.4: Delegation - handle delegate_result
  private handleDelegateResult(agentId: string, msg: import('./types.js').InboundMessage): void {
    const delegation = this.delegations.get(msg.id ?? '');
    if (!delegation || delegation.toAgent !== agentId) {
      const agent = this.agents.get(agentId);
      if (agent) this.sendError(agent.ws, 'not_found', `Delegation ${msg.id} not found or not yours`);
      return;
    }
    delegation.status = msg.status === 'done' ? 'done' : 'failed';
    delegation.result = msg.result;
    delegation.error = msg.error;
    delegation.summary = msg.summary;
    delegation.progress = 100;
    delegation.completedAt = Date.now();
    delegation.updatedAt = Date.now();

    // Publish result to topic if specified
    if (delegation.topic) {
      this.db.saveMessage({
        id: uuidv4(),
        topic: delegation.topic,
        from: agentId,
        content: JSON.stringify({ delegationId: delegation.id, result: delegation.result, summary: delegation.summary }),
        timestamp: Date.now(),
      });
      const recipients = this.topics.broadcast(delegation.topic, {
        id: uuidv4(),
        type: 'message',
        topic: delegation.topic,
        from: agentId,
        content: JSON.stringify({ delegationId: delegation.id, result: delegation.result, summary: delegation.summary }),
        timestamp: Date.now(),
      });
      for (const rid of recipients) {
        const r = this.agents.get(rid);
        if (r && r.ws.readyState === 1) {
          this.send(r.ws, {
            id: uuidv4(),
            type: 'message',
            topic: delegation.topic,
            from: agentId,
            content: JSON.stringify({ delegationId: delegation.id, result: delegation.result, summary: delegation.summary }),
            timestamp: Date.now(),
          } as OutboundMessage);
        }
      }
    }

    this.sendDelegationUpdate(delegation.id, delegation.fromAgent);
  }

  // v0.4: Delegation - handle delegate_cancel
  private handleDelegateCancel(agentId: string, msg: import('./types.js').InboundMessage): void {
    const delegation = this.delegations.get(msg.id ?? '');
    if (!delegation) {
      const agent = this.agents.get(agentId);
      if (agent) this.sendError(agent.ws, 'not_found', `Delegation ${msg.id} not found`);
      return;
    }
    if (delegation.fromAgent !== agentId) {
      const agent = this.agents.get(agentId);
      if (agent) this.sendError(agent.ws, 'forbidden', 'Only the delegator can cancel');
      return;
    }
    if (!['requested', 'accepted', 'running'].includes(delegation.status)) {
      const agent = this.agents.get(agentId);
      if (agent) this.sendError(agent.ws, 'invalid_state', `Cannot cancel delegation in ${delegation.status} state`);
      return;
    }

    delegation.status = 'cancelled';
    delegation.note = msg.reason ?? 'Cancelled by delegator';
    delegation.updatedAt = Date.now();

    // Notify both parties
    this.sendDelegationUpdate(delegation.id, delegation.fromAgent);
    this.sendDelegationUpdate(delegation.id, delegation.toAgent);
  }

  // v0.4: Delegation - create delegation from REST API
  createDelegation(d: import('./types.js').Delegation): void {
    this.delegations.set(d.id, d);
  }

  // v0.4: Delegation - send status update to a specific agent
  private sendDelegationUpdate(delegationId: string, toAgentId: string): void {
    const delegation = this.delegations.get(delegationId);
    if (!delegation) return;
    const target = this.agents.get(toAgentId);
    if (!target || target.ws.readyState !== 1) return;
    this.send(target.ws, {
      type: 'delegate_status',
      id: delegation.id,
      status: delegation.status,
      progress: delegation.progress,
      result: delegation.result,
      error: delegation.error,
      summary: delegation.summary,
      note: delegation.note,
      updatedAt: delegation.updatedAt,
    } as OutboundMessage);
  }

  // v0.4: Agent discovery - return connected agents info
  getAgentsInfo(): { agentId: string; connectedAt: number; topics: string[]; lastSeen: number }[] {
    const now = Date.now();
    const result: { agentId: string; connectedAt: number; topics: string[]; lastSeen: number }[] = [];
    for (const [agentId, agent] of this.agents) {
      result.push({
        agentId,
        connectedAt: agent.connectedAt,
        topics: Array.from(agent.topics),
        lastSeen: now, // WebSocket agents are live, no explicit lastSeen needed
      });
    }
    return result;
  }

  // v1.0: Token rotation — swap current → next, old token valid during grace period
  rotateToken(newToken: string, gracePeriodMs?: number): { oldToken: string; newToken: string; gracePeriodEnd: number } {
    const oldToken = this.config.authToken;
    const grace = gracePeriodMs ?? this.gracePeriodMs;
    this.config.nextAuthToken = oldToken;
    this.config.authToken = newToken;
    this.gracePeriodEnd = Date.now() + grace;
    this.gracePeriodMs = grace;
    console.log(`[WoClaw] Token rotated. Grace ends at ${new Date(this.gracePeriodEnd).toISOString()}`);
    return { oldToken, newToken, gracePeriodEnd: this.gracePeriodEnd };
  }

  getTokenStatus(): { currentTokenMasked: string; inGracePeriod: boolean; gracePeriodEnd: number | null } {
    return {
      currentTokenMasked: this.config.authToken.slice(0, 8) + '...',
      inGracePeriod: this.gracePeriodEnd !== null && Date.now() < this.gracePeriodEnd,
      gracePeriodEnd: this.gracePeriodEnd,
    };
  }

  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.federationManager?.stop();
    for (const [_, agent] of this.agents) {
      agent.ws.close(1001, 'Server shutting down');
    }
    this.wss.close();
    this.db.close();
    console.log('[WoClaw] Server closed');
  }

  // v1.0: Federation methods (delegated to FederationManager)
  getFederationPeersStatus() {
    return this.federationManager.getPeersStatus();
  }

  addFederationPeer(peer: FederationPeer) {
    this.federationManager.addPeer(peer);
  }

  federationSendToAgent(targetHubId: string, agentId: string, payload: any): boolean {
    return this.federationManager.sendToAgent(targetHubId, agentId, payload);
  }
}
