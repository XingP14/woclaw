import http from 'http';
import https from 'https';
import { readFileSync } from 'fs';
import { ClawDB } from './db.js';
import { TopicsManager } from './topics.js';
import { MemoryPool } from './memory.js';
import { Config } from './types.js';
import { WSServer } from './ws_server.js';

export class RestServer {
  private server: http.Server | null = null;
  private db: ClawDB;
  private topics: TopicsManager;
  private memory: MemoryPool;
  private config: Config;
  private wsServer: WSServer | null = null;

  constructor(config: Config, db: ClawDB, topics: TopicsManager, memory: MemoryPool, wsServer?: WSServer) {
    this.config = config;
    this.db = db;
    this.topics = topics;
    this.memory = memory;
    this.wsServer = wsServer || null;
  }

  start(): void {
    const useTLS = !!(this.config.tlsKey && this.config.tlsCert);
    if (useTLS) {
      try {
        const tlsOptions: https.ServerOptions = {
          key: readFileSync(this.config.tlsKey!),
          cert: readFileSync(this.config.tlsCert!),
        };
        this.server = https.createServer(tlsOptions, (req, res) => {
          this.handleRequest(req, res);
        });
        console.log(`[WoClaw] REST API running on https://${this.config.host}:${this.config.restPort} (TLS)`);
      } catch (e: any) {
        console.error(`[WoClaw] Failed to load TLS certificate for REST: ${e.message}`);
        throw e;
      }
    } else {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      console.log(`[WoClaw] REST API running on http://${this.config.host}:${this.config.restPort}`);
    }

    this.server.listen(this.config.restPort, this.config.host);
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // Auth check for write operations
    const authHeader = req.headers.authorization;
    if (method !== 'GET' && authHeader !== `Bearer ${this.config.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    try {
      if (path === '/health') {
        this.handleHealth(res);
      } else if (path === '/topics') {
        if (method === 'GET') {
          this.handleTopicsList(res);
        } else {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
      // v0.4: Agent discovery
      } else if (path === '/agents') {
        if (method === 'GET') {
          this.handleAgentsList(res);
        } else {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
      // v1.0: Rate limiting status
      } else if (path === '/rate-limits') {
        if (method === 'GET') {
          this.handleRateLimits(res);
        } else {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
      } else if (path === '/memory') {
        if (method === 'GET') {
          this.handleMemoryList(res, url.searchParams.get('tags'));
        } else if (method === 'POST') {
          this.handleMemoryWrite(req, res);
        } else {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
      // v0.4: Semantic Recall (must be before /memory/:key route)
      } else if (path.startsWith('/memory/recall')) {
        const q = url.searchParams.get('q');
        const intent = url.searchParams.get('intent');
        const limit = parseInt(url.searchParams.get('limit') || '10');
        if (!q) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'q (query) parameter required' }));
        } else {
          this.handleMemoryRecall(res, q, intent || undefined, Math.min(limit, 50));
        }
      } else if (path.startsWith('/memory/tags/')) {
        const tag = decodeURIComponent(path.slice(13));
        if (method === 'GET') {
          this.handleMemoryByTag(res, tag);
        } else {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
      } else if (path.startsWith('/memory/')) {
        const memPath = path.slice(8);
        // v0.4: GET /memory/:key/versions
        if (memPath.endsWith('/versions')) {
          const key = decodeURIComponent(memPath.slice(0, -9));
          if (method === 'GET') {
            this.handleMemoryVersions(res, key);
          } else {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
          }
        } else {
          const key = decodeURIComponent(memPath);
          if (method === 'GET') {
            this.handleMemoryGet(res, key);
          } else if (method === 'DELETE') {
            this.handleMemoryDelete(res, key);
          } else {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
          }
        }
      } else if (path.startsWith('/topics/')) {
        const topicName = decodeURIComponent(path.slice(8));
        if (method === 'GET') {
          this.handleTopicMessages(res, topicName, url.searchParams.get('limit'));
        } else {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
      // v0.4: Delegation REST endpoints
      } else if (path === '/delegations' || path.startsWith('/delegations')) {
        this.handleDelegations(req, res, url, path, method);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (e: any) {
      console.error('[WoClaw] REST error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  private handleHealth(res: http.ServerResponse): void {
    const stats = this.topics.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      agents: stats.totalAgents,
      topics: stats.totalTopics,
    }));
  }

  private handleTopicsList(res: http.ServerResponse): void {
    const stats = this.topics.getStats();
    // Merge in-memory topics with persisted topics from ClawDB
    const persistedTopics = this.db.getTopicStats();
    const allTopicNames = new Set([
      ...stats.topicDetails.map(t => t.name),
      ...persistedTopics.map(t => t.name),
    ]);
    const merged = Array.from(allTopicNames).map(name => {
      const live = stats.topicDetails.find(t => t.name === name);
      return { name, agents: live ? live.agents : 0 };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ topics: merged }));
  }

  // v0.4: Agent discovery endpoint
  private handleAgentsList(res: http.ServerResponse): void {
    if (!this.wsServer) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Agent info not available' }));
      return;
    }
    const agents = this.wsServer.getAgentsInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agents, count: agents.length }));
  }

  // v1.0: Rate limit status
  private handleRateLimits(res: http.ServerResponse): void {
    if (!this.wsServer) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit info not available' }));
      return;
    }
    const statuses = this.wsServer.getRateLimitStatuses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rateLimits: statuses, count: statuses.length }));
  }

  private handleMemoryList(res: http.ServerResponse, tagsFilter?: string | null): void {
    let allMemory = this.memory.getAll();
    // v0.4: filter by tag (comma-separated for multiple)
    if (tagsFilter) {
      const tags = tagsFilter.split(',').map(t => t.trim());
      allMemory = allMemory.filter(m => tags.some(t => m.tags.includes(t)));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      memory: allMemory.map(m => ({
        key: m.key,
        value: m.value,
        tags: m.tags,
        ttl: m.ttl,
        expireAt: m.expireAt,
        updatedAt: m.updatedAt,
        updatedBy: m.updatedBy,
      }))
    }));
  }

  private handleMemoryWrite(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { key, value, tags, ttl } = JSON.parse(body);
        if (!key) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'key required' }));
          return;
        }
        const mem = this.memory.write(key, value ?? '', 'rest-api', tags ?? [], ttl ?? 0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          key: mem.key,
          value: mem.value,
          tags: mem.tags,
          ttl: mem.ttl,
          expireAt: mem.expireAt,
          updatedAt: mem.updatedAt,
          updatedBy: mem.updatedBy,
        }));
      } catch (e: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
  }

  private handleMemoryGet(res: http.ServerResponse, key: string): void {
    const mem = this.memory.read(key);
    if (!mem) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Key not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      key: mem.key,
      value: mem.value,
      tags: mem.tags,
      ttl: mem.ttl,
      expireAt: mem.expireAt,
      updatedAt: mem.updatedAt,
      updatedBy: mem.updatedBy,
    }));
  }

  private handleMemoryDelete(res: http.ServerResponse, key: string): void {
    const deleted = this.memory.delete(key);
    if (!deleted) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Key not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, key }));
  }

  // v0.4: Memory Versioning endpoint
  private handleMemoryVersions(res: http.ServerResponse, key: string): void {
    const versions = this.memory.getVersions(key);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      key,
      count: versions.length,
      versions: versions.map(v => ({
        key: v.key,
        value: v.value,
        version: v.version,
        tags: v.tags,
        ttl: v.ttl,
        expireAt: v.expireAt,
        updatedAt: v.updatedAt,
        updatedBy: v.updatedBy,
      }))
    }));
  }

  // v0.4: Semantic Recall endpoint
  private handleMemoryRecall(res: http.ServerResponse, query: string, intent?: string, limit: number = 10): void {
    const results = this.memory.recall(query, intent, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      query,
      intent: intent || null,
      count: results.length,
      results: results.map(m => ({
        key: m.key,
        value: m.value,
        tags: m.tags,
        ttl: m.ttl,
        expireAt: m.expireAt,
        updatedAt: m.updatedAt,
        updatedBy: m.updatedBy,
      }))
    }));
  }

  private handleMemoryByTag(res: http.ServerResponse, tag: string): void {
    const results = this.memory.queryByTag(tag);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tag,
      count: results.length,
      memory: results.map(m => ({
        key: m.key,
        value: m.value,
        tags: m.tags,
        ttl: m.ttl,
        expireAt: m.expireAt,
        updatedAt: m.updatedAt,
        updatedBy: m.updatedBy,
      }))
    }));
  }

  // v0.4: Delegation REST API dispatcher
  private handleDelegations(req: http.IncomingMessage, res: http.ServerResponse, url: URL, path: string, method: string): void {
    if (!this.wsServer) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Delegation not available' }));
      return;
    }

    // GET /delegations/pending?agentId=X
    if (path === '/delegations/pending' && method === 'GET') {
      const agentId = url.searchParams.get('agentId');
      if (!agentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'agentId query param required' }));
        return;
      }
      const pending = this.wsServer.getDelegations({ toAgent: agentId })
        .filter(d => d.status === 'requested' || d.status === 'accepted' || d.status === 'running');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ delegations: pending, count: pending.length }));
      return;
    }

    // GET /delegations — list all (with optional filters)
    if (path === '/delegations' && method === 'GET') {
      const fromAgent = url.searchParams.get('fromAgent') ?? undefined;
      const toAgent = url.searchParams.get('toAgent') ?? undefined;
      const status = url.searchParams.get('status') ?? undefined;
      const all = this.wsServer.getDelegations({ fromAgent, toAgent, status: status || undefined });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ delegations: all, count: all.length }));
      return;
    }

    // POST /delegations — create delegation (REST → WebSocket routing)
    if (path === '/delegations' && method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { id, toAgent, task, topic } = JSON.parse(body);
          if (!id || !toAgent || !task) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'id, toAgent, task required' }));
            return;
          }
          // Use a dummy fromAgent for REST-created delegations
          const fromAgent = 'rest-api';
          const delegation: import('./types.js').Delegation = {
            id,
            fromAgent,
            toAgent,
            task,
            topic,
            status: 'requested',
            progress: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          this.wsServer.createDelegation(delegation);
          this.wsServer.sendToAgent(toAgent, {
            type: 'delegate_incoming',
            id,
            fromAgent,
            task,
            topic,
            createdAt: delegation.createdAt,
          } as import('./types.js').OutboundMessage);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, id, status: 'requested' }));
        } catch (e: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET /delegations/:id
    const delegMatch = path.match(/^\/delegations\/(.+)$/);
    if (delegMatch && method === 'GET') {
      const id = delegMatch[1];
      const d = this.wsServer.getDelegation(id);
      if (!d) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Delegation not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ delegation: d }));
      return;
    }

    // DELETE /delegations/:id — cancel
    if (delegMatch && method === 'DELETE') {
      const id = delegMatch[1];
      const d = this.wsServer.getDelegation(id);
      if (!d) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Delegation not found' }));
        return;
      }
      // Update in-memory directly (REST-side cancel)
      d.status = 'cancelled';
      d.note = 'Cancelled via REST API';
      d.updatedAt = Date.now();
      // Notify both parties via WS
      this.wsServer.sendToAgent(d.toAgent, {
        type: 'delegate_status',
        id,
        status: 'cancelled',
        updatedAt: d.updatedAt,
      } as import('./types.js').OutboundMessage);
      if (d.fromAgent !== d.toAgent) {
        this.wsServer.sendToAgent(d.fromAgent, {
          type: 'delegate_status',
          id,
          status: 'cancelled',
          updatedAt: d.updatedAt,
        } as import('./types.js').OutboundMessage);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, delegation: d }));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed for this path' }));
  }

  private handleTopicMessages(res: http.ServerResponse, topic: string, limit?: string | null): void {
    const limitNum = Math.min(parseInt(limit || '50'), 200);
    const messages = this.db.getMessages(topic, limitNum);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      topic,
      messages: messages.reverse(),
      count: messages.length,
    }));
  }

  close(): void {
    if (this.server) {
      this.server.close();
      console.log('[WoClaw] REST server closed');
    }
  }
}
