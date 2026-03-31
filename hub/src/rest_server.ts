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
          this.handleMemoryList(res);
        } else {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
      } else if (path.startsWith('/memory/')) {
        const key = decodeURIComponent(path.slice(8));
        if (method === 'GET') {
          this.handleMemoryGet(res, key);
        } else if (method === 'DELETE') {
          this.handleMemoryDelete(res, key);
        } else {
          res.writeHead(405);
          res.end(JSON.stringify({ error: 'Method not allowed' }));
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      topics: stats.topicDetails.map(t => ({
        name: t.name,
        agents: t.agents,
      }))
    }));
  }

  private handleMemoryList(res: http.ServerResponse): void {
    const allMemory = this.memory.getAll();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      memory: allMemory.map(m => ({
        key: m.key,
        updatedAt: m.updatedAt,
        updatedBy: m.updatedBy,
      }))
    }));
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
