import http from 'http';
import { ClawDB } from './db.js';
import { TopicsManager } from './topics.js';
import { MemoryPool } from './memory.js';
import { Config } from './types.js';

export class RestServer {
  private server: http.Server | null = null;
  private db: ClawDB;
  private topics: TopicsManager;
  private memory: MemoryPool;
  private config: Config;

  constructor(config: Config, db: ClawDB, topics: TopicsManager, memory: MemoryPool) {
    this.config = config;
    this.db = db;
    this.topics = topics;
    this.memory = memory;
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(this.config.restPort, () => {
      console.log(`[WoClaw] REST API running on http://${this.config.host}:${this.config.restPort}`);
    });
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
      } else if (path === '/memory') {
        if (method === 'GET') {
          this.handleMemoryList(res, url.searchParams.get('tags'));
        } else if (method === 'POST') {
          this.handleMemoryWrite(req, res);
        } else {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
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
