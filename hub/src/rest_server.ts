// OpenClaw v2026.6.1 (2026-06-01) routing surface:
// - ClawHub cards v2 schema (name / description / When-to-use / version / install_command) is
//   satisfied by hub/SKILL.md frontmatter + body — see hub/SKILL.md "OpenClaw v2026.6.1
//   compatible" section. No REST shape change is required for the card to parse.
// - Copilot Claude 1M long-context routing: POST /topics/:topic/message and POST /memory
//   accept opaque bodies up to SQLite TEXT / MySQL LONGTEXT limits (≥1M tokens ≈ 4 MB
//   UTF-8). Clients on the same topic receive the full body via WS broadcast; no
//   server-side chunking is enforced. Mythos-5 / Opus-4.8 1M-context agents can therefore
//   use the hub as their single relay without splitting payloads.
import http from 'http';
import https from 'https';
import { readFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ClawDB } from './db.js';
import { TopicsManager } from './topics.js';
import { MemoryPool } from './memory.js';
import { Config } from './types.js';
import { errorMessage } from './errors.js';
import { hubLog, hubWarn, hubError, hubEvent } from './hub_log.js';
import { WSServer } from './ws_server.js';
import { GraphStore } from './graph/store.js';
import type { EdgeType, GraphNodeType } from './graph/types.js';
import { SessionStore } from './session_store.js';
import type { ForgettingScheduler } from './scheduler.js';
import type { DBSession } from './types.js';

// ─── URL parsing helpers (replaces `as any` casts with type narrowing) ────
//
// These helpers narrow URLSearchParams.get(string) (which is `string | null`)
// to a typed literal-union value via a guard set, instead of bypassing the type
// system with `as any`. Used by 7 sites that previously cast raw query strings.

const EDGE_TYPES: readonly EdgeType[] = ['temporal', 'entity', 'causal', 'semantic'];
const NODE_TYPES: readonly GraphNodeType[] = ['memory', 'agent', 'topic'];

function parseEdgeType(raw: string | null): EdgeType | undefined {
  if (!raw) return undefined;
  return (EDGE_TYPES as readonly string[]).includes(raw) ? (raw as EdgeType) : undefined;
}

function parseNodeType(raw: string | null): GraphNodeType | undefined {
  if (!raw) return undefined;
  return (NODE_TYPES as readonly string[]).includes(raw) ? (raw as GraphNodeType) : undefined;
}

function parseEdgeTypes(raw: string | null): EdgeType[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const out: EdgeType[] = [];
  for (const p of parts) {
    const v = parseEdgeType(p);
    if (v) out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

function parseNodeTypes(raw: string | null): GraphNodeType[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const out: GraphNodeType[] = [];
  for (const p of parts) {
    const v = parseNodeType(p);
    if (v) out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Read a numeric query-string parameter and parse it as an integer.
 *
 * Centralizes the `parseInt(url.searchParams.get(name) || String(defaultValue))`
 * pattern that was previously inlined at 7 sites (limit / depth / maxDepth /
 * gracePeriodMs). Treats both `null` and `""` as missing (matching the
 * `||` short-circuit used by 6 of the 7 original sites). Returns NaN for
 * unparseable values, preserving the prior `parseInt('abc')` behavior so
 * downstream `Math.min(..., cap)` / SQL LIMIT semantics are byte-identical
 * for the 6 sites that previously used `||`. The single site that used
 * `??` (handleSessionSearch L1029) now also treats empty-string as missing,
 * which is a small behavior tightening (NaN -> defaultValue for ?limit=);
 * downstream `Math.min(NaN, 50)` is already `NaN`, so the only externally
 * observable change is `?limit=` no longer passing NaN through to SQL.
 */
function parseIntParam(url: URL, name: string, defaultValue: number): number {
  const raw = url.searchParams.get(name) || String(defaultValue);
  return parseInt(raw, 10);
}

/**
 * Read the request body as a UTF-8 string.
 *
 * Centralizes the inline "data + end" accumulation pattern (previously
 * repeated at 15 POST / PUT handlers in this file) behind a single helper.
 * Returns a Promise that resolves with the accumulated body string. Identical
 * wire-format behavior preserved: each chunk decoded as utf8, all chunks
 * concatenated.
 *
 * The 15 prior inline sites used the event-based form (`data` listener +
 * `end` listener). The single site that used the async-iterator form
 * `for await (const chunk of req) { body += chunk; }`
 * (handleGraphNodeCreate L1137, for-await at L1139) is a different shape and is left untouched —
 * migrating it would change the body-accumulation path from
 * Buffer.toString(undefined) to Buffer.toString('utf8') which is not
 * byte-identical for non-utf8 input. See test/read_json_body.test.ts for the
 * regression coverage.
 */
function readJsonBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export class RestServer {
  private server: http.Server | null = null;
  private db: ClawDB;
  private topics: TopicsManager;
  private memory: MemoryPool;
  private config: Config;
  private wsServer: WSServer | null = null;
  private graph: GraphStore;
  private sessionStore: SessionStore;
  private forgettingScheduler: ForgettingScheduler | null = null;

  constructor(config: Config, db: ClawDB, topics: TopicsManager, memory: MemoryPool, graph: GraphStore, wsServer?: WSServer, sessionStore?: SessionStore) {
    this.config = config;
    this.db = db;
    this.topics = topics;
    this.memory = memory;
    this.graph = graph;
    this.wsServer = wsServer || null;
    this.sessionStore = sessionStore ?? new SessionStore(db);
  }

  setForgettingScheduler(scheduler: ForgettingScheduler): void {
    this.forgettingScheduler = scheduler;
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
          void this.handleRequest(req, res).catch((e: unknown) => {
          hubError('REST handler error:', errorMessage(e));
            if (!res.headersSent) {
              RestServer.sendJsonError(res, 500, 'Internal server error');
            }
          });
        });
        hubLog(`REST API running on https://${this.config.host}:${this.config.restPort} (TLS)`);
        hubEvent({
          level: 'info',
          event: 'hub.rest.started',
          context: { trace_id: 'rest' },
          attrs: { host: this.config.host, port: this.config.restPort, tls: true },
        });
      } catch (e: unknown) {
        hubError(`Failed to load TLS certificate for REST: ${errorMessage(e)}`);
        throw e;
      }
    } else {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res).catch((e: unknown) => {
          hubError('REST handler error:', errorMessage(e));
          if (!res.headersSent) {
            RestServer.sendJsonError(res, 500, 'Internal server error');
          }
        });
      });
      hubLog(`REST API running on http://${this.config.host}:${this.config.restPort}`);
      hubEvent({
        level: 'info',
        event: 'hub.rest.started',
        context: { trace_id: 'rest' },
        attrs: { host: this.config.host, port: this.config.restPort, tls: false },
      });
    }

    this.server.listen(this.config.restPort, this.config.host);
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const requiresAuth = method !== 'GET' || path === '/admin/token/status';
    const isAuthorized = this.wsServer?.isTokenAuthorized(token) ?? token === this.config.authToken;
    if (requiresAuth && !isAuthorized) {
      RestServer.sendJsonError(res, 401, 'Unauthorized');
      return;
    }

    try {
      if (path === '/health') {
        this.handleHealth(res);
      } else if (path === '/ready') {
        this.handleReady(res);
      } else if (path === '/topics') {
        if (method === 'GET') {
          await this.handleTopicsList(res);
        } else {
          RestServer.sendJsonError(res, 405, 'Method not allowed');
        }
      // v0.4: Agent discovery
      } else if (path === '/agents') {
        if (method === 'GET') {
          this.handleAgentsList(res);
        } else {
          RestServer.sendJsonError(res, 405, 'Method not allowed');
        }
      // v1.0: Rate limiting status
      } else if (path === '/rate-limits') {
        if (method === 'GET') {
          this.handleRateLimits(res);
        } else {
          RestServer.sendJsonError(res, 405, 'Method not allowed');
        }
      } else if (path === '/memory') {
        if (method === 'GET') {
          await this.handleMemoryList(res, url.searchParams.get('tags'));
        } else if (method === 'POST') {
          await this.handleMemoryWrite(req, res);
        } else {
          RestServer.sendJsonError(res, 405, 'Method not allowed');
        }
      } else if (path === '/memory/stats' && method === 'GET') {
        await this.handleMemoryStats(res);
      // v0.4: Semantic Recall (must be before /memory/:key route)
      } else if (path.startsWith('/memory/recall')) {
        const q = url.searchParams.get('q');
        const intent = url.searchParams.get('intent');
        const limit = parseIntParam(url, 'limit', 10);
        if (!q) {
          RestServer.sendJsonError(res, 400, 'q (query) parameter required');
        } else {
          await this.handleMemoryRecall(res, q, intent || undefined, Math.min(limit, 50));
        }
      } else if (path.startsWith('/memory/tags/')) {
        const tag = decodeURIComponent(path.slice(13));
        if (method === 'GET') {
          await this.handleMemoryByTag(res, tag);
        } else {
          RestServer.sendJsonError(res, 405, 'Method not allowed');
        }
      // v1.0: GET /memory/search?q=...&limit=10 -- precise keyword search
      } else if (path === '/memory/search' && method === 'GET') {
        const q = url.searchParams.get('q');
        const limit = Math.min(parseIntParam(url, 'limit', 10), 50);
        const scope = url.searchParams.get('scope') || 'all';
        if (!q) {
          RestServer.sendJsonError(res, 400, 'Missing required query param: q');
          return;
        }
        const memories = await this.memory.search(q, limit, scope);
        RestServer.sendJsonSuccess(res, 200, { memories, count: memories.length, query: q, scope });
        return;
      } else if (path.startsWith('/memory/')) {
        const memPath = path.slice(8);
        // v0.4: GET /memory/:key/versions
        if (memPath.endsWith('/versions')) {
          const key = decodeURIComponent(memPath.slice(0, -9));
          if (method === 'GET') {
            await this.handleMemoryVersions(res, key);
          } else {
            RestServer.sendJsonError(res, 405, 'Method not allowed');
          }
        } else {
          const key = decodeURIComponent(memPath);
          if (method === 'GET') {
            await this.handleMemoryGet(res, key);
          } else if (method === 'DELETE') {
            await this.handleMemoryDelete(res, key);
          } else {
            RestServer.sendJsonError(res, 405, 'Method not allowed');
          }
        }
      } else if (path.startsWith('/topics/')) {
        const topicName = decodeURIComponent(path.slice(8));
        if (method === 'GET') {
          await this.handleTopicMessages(res, topicName, url.searchParams.get('limit'));
        } else if (method === 'POST') {
          // v1.0: Private topic sub-routes (/invite, /join) or regular topic creation
          const slashIdx = topicName.indexOf('/');
          if (slashIdx >= 0) {
            const baseName = topicName.slice(0, slashIdx);
            const subPath = topicName.slice(slashIdx + 1);
            if (subPath === 'invite') { this.handleTopicInvite(req, res, baseName); return; }
            if (subPath === 'join') { this.handleTopicJoin(req, res, baseName); return; }
          }
          this.handleTopicCreate(req, res, topicName);
        } else {
          RestServer.sendJsonError(res, 405, 'Method not allowed');
        }
      // v0.4: Delegation REST endpoints
      } else if (path === '/delegations' || path.startsWith('/delegations')) {
        this.handleDelegations(req, res, url, path, method);
      // R92.7 — agent-stream endpoints (S92 §4)
      } else if (path.startsWith('/streams/')) {
        // GET /streams/:topic/:runId — fetch a specific stream (cursor-based)
        const streamMatch = path.match(/^\/streams\/([^/]+)\/(.+)$/);
        if (streamMatch && method === 'GET') {
          const topic = decodeURIComponent(streamMatch[1]);
          const runId = decodeURIComponent(streamMatch[2]);
          const sinceCursor = parseIntParam(url, 'since_cursor', 0);
          try {
            const record = await this.db.getStream(runId);
            if (!record || record.topic !== topic) {
              RestServer.sendJsonError(res, 404, 'Stream not found');
              return;
            }
            const allEvents = JSON.parse(record.eventsJson) as import('./types.js').StreamEvent[];
            const events = allEvents.slice(sinceCursor);
            RestServer.sendJsonSuccess(res, 200, {
              run_id: runId,
              topic,
              schema_version: record.schemaVersion,
              started_at: record.startedAt,
              events,
              next_cursor: sinceCursor + events.length,
              exit: record.exitCode,
            });
          } catch (e) {
            RestServer.sendJsonError(res, 500, errorMessage(e));
          }
          return;
        }
        // GET /streams/:topic — list recent runs
        const topic = decodeURIComponent(path.slice(8));
        if (method === 'GET') {
          const limit = Math.min(parseIntParam(url, 'limit', 20), 100);
          try {
            const runs = await this.db.getStreamsByTopic(topic, limit);
            RestServer.sendJsonSuccess(res, 200, { runs, count: runs.length, topic });
          } catch (e) {
            RestServer.sendJsonError(res, 500, errorMessage(e));
          }
          return;
        }
        // POST /streams/:topic — publish a stream envelope
        if (method === 'POST') {
          await RestServer.readJsonObject<{ stream: import('./types.js').StreamEnvelope }>(req, res).then(async (data) => {
            if (!data) return;
            try {
              const envelope = data.stream;
              if (!envelope || !envelope.events || envelope.events.length === 0) {
                RestServer.sendJsonError(res, 400, 'stream.events must be non-empty');
                return;
              }
              const { validateAgentStream } = await import('./agent_stream.js');
              const issues = validateAgentStream(envelope);
              const hardIssues = issues.filter(i => i.code !== 'event_unknown');
              if (hardIssues.length > 0) {
                RestServer.sendJsonError(res, 400, `stream validation failed: ${hardIssues.map(i => i.code).join(', ')}`);
                return;
              }
              const runId = envelope.run_id || uuidv4();
              const lastEvent = envelope.events[envelope.events.length - 1];
              const exitCode = (lastEvent.event === 'result' && lastEvent.exit) ? lastEvent.exit : null;
              const startEv = envelope.events[0];
              await this.db.saveStream(
                runId,
                topic,
                'rest-api',
                startEv.schema_version || '1.0',
                envelope.started_at || Date.now(),
                JSON.stringify(envelope.events),
                exitCode
              );
              RestServer.sendJsonSuccess(res, 201, {
                run_id: runId,
                topic,
                events_received: envelope.events.length,
                exit_code: exitCode,
              });
            } catch (e: unknown) {
              RestServer.sendJsonError(res, 500, errorMessage(e));
            }
          });
          return;
        }
        RestServer.sendJsonError(res, 405, 'Method not allowed');
        return;
      // v1.0: Graph Memory — Node CRUD
      } else if (path === '/graph/nodes') {
        if (method === 'GET') {
          const type = url.searchParams.get('type') as GraphNodeType | null;
          this.handleGraphNodesList(res, type || undefined);
        } else if (method === 'POST') {
          this.handleGraphNodeCreate(req, res);
        } else {
          RestServer.sendJsonError(res, 405, 'Method not allowed');
        }
      } else if (path.startsWith('/graph/nodes/')) {
        const nodeId = decodeURIComponent(path.slice(13));
        if (method === 'GET') {
          this.handleGraphNodeGet(res, nodeId);
        } else if (method === 'DELETE') {
          this.handleGraphNodeDelete(res, nodeId);
        } else {
          RestServer.sendJsonError(res, 405, 'Method not allowed');
        }
      } else if (path === '/graph' && method === 'GET') {
        // Redirect /graph to /graph/nodes
        const nodes = this.graph.getNodes(undefined);
        RestServer.sendJsonSuccess(res, 200, { nodes, count: nodes.length });
      } else if (path === '/graph/edges' && method === 'GET') {
        const edges = this.graph.getEdges({
          source: url.searchParams.get('source') || undefined,
          target: url.searchParams.get('target') || undefined,
          type: parseEdgeType(url.searchParams.get('type')),
        });
        RestServer.sendJsonSuccess(res, 200, { edges, count: edges.length });
      } else if (path === '/graph/edges' && method === 'POST') {
        RestServer.readJsonObject<{ source: string; target: string; type: EdgeType; weight?: number; metadata?: Record<string, unknown> }>(req, res).then(async (data) => {
          if (!data) return;
          try {
            const { source, target, type, weight, metadata = {} } = data;
            if (!source || !target || !type) {
              RestServer.sendJsonError(res, 400, 'Missing required fields: source, target, type');
              return;
            }
            const edge = this.graph.addEdge({ source, target, type, weight, metadata });
            RestServer.sendJsonSuccess(res, 201, { edge });
          } catch (e: unknown) {
            RestServer.sendJsonError(res, 400, errorMessage(e));
          }
        });
      } else if (path.startsWith('/graph/edges/') && method === 'DELETE') {
        const edgeId = decodeURIComponent(path.slice(14));
        const removed = this.graph.removeEdge(edgeId);
        if (!removed) {
          RestServer.sendJsonError(res, 404, 'Edge not found');
          return;
        }
        RestServer.sendJsonSuccess(res, 200, { success: true, deleted: edgeId });
      } else if (path === '/graph/stats' && method === 'GET') {
        RestServer.sendJsonSuccess(res, 200, this.graph.getStats());
      } else if (path.startsWith('/graph/traverse/') && method === 'GET') {
        const nodeId = decodeURIComponent(path.slice(16));
        const depth = parseIntParam(url, 'depth', 1);
        const limit = parseIntParam(url, 'limit', 50);
        const edgeTypes = parseEdgeTypes(url.searchParams.get('edgeTypes'));
        const nodeTypes = parseNodeTypes(url.searchParams.get('nodeTypes'));
        const results = this.graph.traverse(nodeId, { depth, limit, edgeTypes, nodeTypes });
        RestServer.sendJsonSuccess(res, 200, { results, count: results.length });
      } else if (path.startsWith('/graph/paths/') && method === 'GET') {
        const parts = decodeURIComponent(path.slice(14)).split('/');
        if (parts.length >= 2) {
          const [from, to] = parts;
          const maxDepth = parseIntParam(url, 'maxDepth', 5);
const result = this.graph.findPath(from, to, maxDepth);
          if (!result) {
            RestServer.sendJsonError(res, 404, 'No path found');
          } else {
            RestServer.sendJsonSuccess(res, 200, { path: result });
          }
        } else {
          RestServer.sendJsonError(res, 400, 'Invalid path format. Use /graph/paths/:from/:to');
        }
      } else if (path.startsWith('/graph/related/') && method === 'GET') {
        const nodeId = decodeURIComponent(path.slice(15));
        const edgeTypes = parseEdgeTypes(url.searchParams.get('edgeTypes'));
        const nodeTypes = parseNodeTypes(url.searchParams.get('nodeTypes'));
        try {
          const related = this.graph.getRelated(nodeId, { edgeTypes, nodeTypes });
          RestServer.sendJsonSuccess(res, 200, related);
        } catch (e: unknown) {
          RestServer.sendJsonError(res, 404, errorMessage(e));
        }
      } else if (path === '/admin/token/status' && method === 'GET') {
        this.handleTokenStatus(res);
      } else if (path === '/admin/token/rotate' && method === 'POST') {
        this.handleTokenRotate(req, res);
      // v1.0: Federation REST endpoints
      } else if (path === '/federation/peers' && method === 'GET') {
        const peers = this.wsServer?.getFederationPeersStatus?.() ?? [];
        RestServer.sendJsonSuccess(res, 200, { peers });
      } else if (path === '/federation/peers' && method === 'POST') {
        RestServer.readJsonObject<{ hubId: string; wsUrl: string; federationToken: string }>(req, res).then(async (data) => {
          if (!data) return;
          try {
            const { hubId, wsUrl, federationToken } = data;
            if (!hubId || !wsUrl || !federationToken) {
              RestServer.sendJsonError(res, 400, 'Missing required fields: hubId, wsUrl, federationToken');
              return;
            }
            this.wsServer?.addFederationPeer?.({ hubId, wsUrl, federationToken, status: 'disconnected', lastSeen: 0, connectedAgents: 0 });
            RestServer.sendJsonSuccess(res, 200, { success: true, hubId });
          } catch (e: unknown) {
            RestServer.sendJsonError(res, 400, errorMessage(e));
          }
        });
      } else if (path === '/federation/send' && method === 'POST') {
        RestServer.readJsonObject<{ targetHubId: string; agentId: string; payload?: unknown }>(req, res).then(async (data) => {
          if (!data) return;
          try {
            const { targetHubId, agentId, payload } = data;
            if (!targetHubId || !agentId) {
              RestServer.sendJsonError(res, 400, 'Missing required fields: targetHubId, agentId');
              return;
            }
            const sent = this.wsServer?.federationSendToAgent?.(targetHubId, agentId, payload) ?? false;
            RestServer.sendJsonSuccess(res, 200, { success: sent });
          } catch (e: unknown) {
            RestServer.sendJsonError(res, 400, errorMessage(e));
          }
        });
      // v1.0: Session Memory routes
      } else if (path === '/sessions' || path.startsWith('/sessions/')) {
        this.handleSessionRequest(req, res, path, method, url);
      } else {
        RestServer.sendJsonError(res, 405, 'Method not allowed');
      }
    } catch (e: unknown) {
      hubError('REST error:', errorMessage(e));
      RestServer.sendJsonError(res, 500, errorMessage(e));
    }
  }

  // v1.0: Token rotation status
  private handleTokenStatus(res: http.ServerResponse): void {
    if (!this.wsServer) {
      RestServer.sendJsonError(res, 503, 'WebSocket server not available');
      return;
    }
    const status = this.wsServer.getTokenStatus();
    RestServer.sendJsonSuccess(res, 200, { status });
  }

  // v1.0: Token rotation — generate new token, old token valid during grace period
  private handleTokenRotate(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.wsServer) {
      RestServer.sendJsonError(res, 503, 'WebSocket server not available');
      return;
    }
    const url2 = new URL(req.url!, `http://${req.headers.host}`);
    const graceMs = parseIntParam(url2, 'gracePeriodMs', 300000);
    const newToken = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const result = this.wsServer.rotateToken(newToken, graceMs);
    RestServer.sendJsonSuccess(res, 200, {
      success: true,
      newToken: result.newToken,
      gracePeriodEnd: new Date(result.gracePeriodEnd).toISOString(),
      gracePeriodMs: graceMs,
    });
  }

  private handleHealth(res: http.ServerResponse): void {
    const stats = this.topics.getStats();
    RestServer.sendJsonSuccess(res, 200, {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now(),
      agents: stats.totalAgents,
      topics: stats.totalTopics,
    });
  }

  /**
   * /ready — Cloud-native readiness probe (k8s-style).
   * Returns 200 only when the hub is fully initialized and can serve traffic.
   * Differs from /health (liveness) which only confirms the process is running.
   *
   * Currently ready iff:
   *   - DB is initialized (this.db is not null)
   *   - TopicsManager + MemoryPool are wired (this.topics is not null)
   *   - WebSocket server is up (this.wsServer exists)
   */
  private handleReady(res: http.ServerResponse): void {
    const checks: Record<string, { ok: boolean; detail?: string }> = {
      db: { ok: this.db != null },
      topics: { ok: this.topics != null },
      memoryPool: { ok: this.memory != null },
      wsServer: { ok: this.wsServer != null }
    };
    const allOk = Object.values(checks).every(c => c.ok);
    res.writeHead(allOk ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: allOk ? 'ready' : 'not-ready',
      timestamp: Date.now(),
      checks
    }));
  }

  private async handleTopicsList(res: http.ServerResponse): Promise<void> {
    const stats = this.topics.getStats();
    // Merge in-memory topics with persisted topics from ClawDB
    const persistedTopics = await this.db.getTopicStats();
    const allTopicNames = new Set([
      ...stats.topicDetails.map(t => t.name),
      ...persistedTopics.map(t => t.name),
    ]);
    const merged = Array.from(allTopicNames).map(name => {
      const live = stats.topicDetails.find(t => t.name === name);
      return { name, agents: live ? live.agents : 0 };
    });
    RestServer.sendJsonSuccess(res, 200, { topics: merged });
  }

  // v0.4: Agent discovery endpoint
  private handleAgentsList(res: http.ServerResponse): void {
    if (!this.wsServer) {
      RestServer.sendJsonError(res, 503, 'Agent info not available');
      return;
    }
    const agents = this.wsServer.getAgentsInfo();
    RestServer.sendJsonSuccess(res, 200, { agents, count: agents.length });
  }

  // v1.0: Rate limit status
  private handleRateLimits(res: http.ServerResponse): void {
    if (!this.wsServer) {
      RestServer.sendJsonError(res, 503, 'Rate limit info not available');
      return;
    }
    const statuses = this.wsServer.getRateLimitStatuses();
    RestServer.sendJsonSuccess(res, 200, { rateLimits: statuses, count: statuses.length });
  }

  private async handleMemoryList(res: http.ServerResponse, tagsFilter?: string | null): Promise<void> {
    let allMemory = await this.memory.getAll();
    // v0.4: filter by tag (comma-separated for multiple)
    if (tagsFilter) {
      const tags = tagsFilter.split(',').map(t => t.trim());
      allMemory = allMemory.filter(m => tags.some(t => m.tags.includes(t)));
    }
    RestServer.sendJsonSuccess(res, 200, {
      memory: allMemory.map(m => ({
        key: m.key,
        value: m.value,
        tags: m.tags,
        ttl: m.ttl,
        expireAt: m.expireAt,
        updatedAt: m.updatedAt,
        updatedBy: m.updatedBy,
      }))
    });
  }

  private async handleMemoryStats(res: http.ServerResponse): Promise<void> {
    try {
      const sessions = await this.sessionStore.listSessions(undefined, undefined, 10000, 0);
      const count = sessions.length;
      const avgImportance = count > 0
        ? sessions.reduce((sum, session) => sum + (session.importance || 0), 0) / count
        : 0;
      const totalTranscriptChars = sessions.reduce((sum, session) => sum + (session.transcript?.length || 0), 0);
      const totalSummaryChars = sessions.reduce((sum, session) => sum + (session.summary?.length || 0), 0);
      RestServer.sendJsonSuccess(res, 200, {
        count,
        avgImportance,
        storageSize: {
          transcriptChars: totalTranscriptChars,
          summaryChars: totalSummaryChars,
          approxBytes: totalTranscriptChars + totalSummaryChars,
        },
      });
    } catch (e: unknown) {
      RestServer.sendJsonError(res, 500, errorMessage(e));
    }
  }

  private async handleMemoryWrite(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readJsonBody(req);

    try {
      const { key, value, tags, ttl } = JSON.parse(body);
      if (!key) {
        RestServer.sendJsonError(res, 400, 'key required');
        return;
      }
      const { mem, duplicate, conflict, previousValue } = await this.memory.write(key, value ?? '', 'rest-api', tags ?? [], ttl ?? 0);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (conflict) headers['X-WoClaw-Conflict'] = 'true';
      if (duplicate) headers['X-WoClaw-Duplicate'] = 'true';
      res.writeHead(200, headers);
      res.end(JSON.stringify({
        key: mem.key,
        value: mem.value,
        tags: mem.tags,
        ttl: mem.ttl,
        expireAt: mem.expireAt,
        updatedAt: mem.updatedAt,
        updatedBy: mem.updatedBy,
        duplicate,
        conflict,
        previousValue,
      }));
    } catch (e: unknown) {
      RestServer.sendJsonError(res, 400, errorMessage(e));
    }
  }

  private async handleMemoryGet(res: http.ServerResponse, key: string): Promise<void> {
    const mem = await this.memory.read(key);
    if (!mem) {
      RestServer.sendJsonError(res, 404, 'Key not found');
      return;
    }
    RestServer.sendJsonSuccess(res, 200, {
      key: mem.key,
      value: mem.value,
      tags: mem.tags,
      ttl: mem.ttl,
      expireAt: mem.expireAt,
      updatedAt: mem.updatedAt,
      updatedBy: mem.updatedBy,
    });
  }

  private async handleMemoryDelete(res: http.ServerResponse, key: string): Promise<void> {
    const deleted = await this.memory.delete(key);
    if (!deleted) {
      RestServer.sendJsonError(res, 404, 'Key not found');
      return;
    }
    RestServer.sendJsonSuccess(res, 200, { success: true, key });
  }

  // v0.4: Memory Versioning endpoint
  private async handleMemoryVersions(res: http.ServerResponse, key: string): Promise<void> {
    const versions = await this.memory.getVersions(key);
    RestServer.sendJsonSuccess(res, 200, {
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
    });
  }

  // v0.4: Semantic Recall endpoint
  private async handleMemoryRecall(res: http.ServerResponse, query: string, intent?: string, limit: number = 10): Promise<void> {
    const results = await this.memory.recall(query, intent, limit);
    RestServer.sendJsonSuccess(res, 200, {
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
    });
  }

  private async handleMemoryByTag(res: http.ServerResponse, tag: string): Promise<void> {
    const results = await this.memory.queryByTag(tag);
    RestServer.sendJsonSuccess(res, 200, {
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
    });
  }

  // v0.4: Delegation REST API dispatcher
  private handleDelegations(req: http.IncomingMessage, res: http.ServerResponse, url: URL, path: string, method: string): void {
    if (!this.wsServer) {
      RestServer.sendJsonError(res, 503, 'Delegation not available');
      return;
    }

    // GET /delegations/pending?agentId=X
    if (path === '/delegations/pending' && method === 'GET') {
      const agentId = url.searchParams.get('agentId');
      if (!agentId) {
        RestServer.sendJsonError(res, 400, 'agentId query param required');
        return;
      }
      const pending = this.wsServer.getDelegations({ toAgent: agentId })
        .filter(d => d.status === 'requested' || d.status === 'accepted' || d.status === 'running');
      RestServer.sendJsonSuccess(res, 200, { delegations: pending, count: pending.length });
      return;
    }

    // GET /delegations — list all (with optional filters)
    if (path === '/delegations' && method === 'GET') {
      const fromAgent = url.searchParams.get('fromAgent') ?? undefined;
      const toAgent = url.searchParams.get('toAgent') ?? undefined;
      const status = url.searchParams.get('status') ?? undefined;
      const all = this.wsServer.getDelegations({ fromAgent, toAgent, status: status || undefined });
      RestServer.sendJsonSuccess(res, 200, { delegations: all, count: all.length });
      return;
    }

    // POST /delegations — create delegation (REST → WebSocket routing)
    if (path === '/delegations' && method === 'POST') {
      RestServer.readJsonObject<{ id?: string; toAgent: string; task: import('./types.js').DelegationTask; topic?: string }>(req, res).then(async (data) => {
        if (!data) return;
        try {
          const { id: requestedId, toAgent, task, topic } = data;
          if (!toAgent || !task) {
            RestServer.sendJsonError(res, 400, 'toAgent and task required');
            return;
          }
          const id = requestedId || uuidv4();
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
          const delivered = this.wsServer.sendToAgent(toAgent, {
            type: 'delegate_incoming',
            id,
            fromAgent,
            task,
            topic,
            createdAt: delegation.createdAt,
          } as import('./types.js').OutboundMessage);
          if (!delivered) {
            delegation.status = 'rejected';
            delegation.note = 'Target agent not connected';
            delegation.updatedAt = Date.now();
          }
          RestServer.sendJsonSuccess(res, 200, {
            success: true,
            id,
            status: delegation.status,
            note: delegation.note ?? null,
          });
        } catch (e: unknown) {
          RestServer.sendJsonError(res, 400, errorMessage(e));
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
        RestServer.sendJsonError(res, 404, 'Delegation not found');
        return;
      }
      RestServer.sendJsonSuccess(res, 200, { delegation: d });
      return;
    }

    // DELETE /delegations/:id — cancel
    if (delegMatch && method === 'DELETE') {
      const id = delegMatch[1];
      const d = this.wsServer.getDelegation(id);
      if (!d) {
        RestServer.sendJsonError(res, 404, 'Delegation not found');
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
      RestServer.sendJsonSuccess(res, 200, { success: true, delegation: d });
      return;
    }

    // ═══════════════════════════════════════════════════════════
    // GRAPH MEMORY ROUTES (S21)
    // ═══════════════════════════════════════════════════════════

    // GET /graph/nodes — list all nodes (optional ?type=memory|agent|topic)
    if ((path === '/graph/nodes' || path === '/graph') && method === 'GET') {
      const url2 = new URL(req.url!, `http://${req.headers.host}`);
      const type = url2.searchParams.get('type') as GraphNodeType | null;
      const nodes = this.graph.getNodes(type || undefined);
      RestServer.sendJsonSuccess(res, 200, { nodes, count: nodes.length });
      return;
    }

    // POST /graph/nodes — create a node
    if (path === '/graph/nodes' && method === 'POST') {
      RestServer.readJsonObject<{ type: GraphNodeType; label: string; metadata?: Record<string, unknown> }>(req, res).then(async (data) => {
        if (!data) return;
        try {
          const { type, label, metadata = {} } = data;
          if (!type || !label) {
            RestServer.sendJsonError(res, 400, 'Missing required fields: type, label');
            return;
          }
          const node = this.graph.addNode({ type, label, metadata });
          RestServer.sendJsonSuccess(res, 201, { node });
        } catch (e: unknown) {
          RestServer.sendJsonError(res, 400, errorMessage(e));
        }
      });
      return;
    }

    // GET /graph/nodes/:id
    const nodeMatch = path.match(/^\/graph\/nodes\/(.+)$/);
    if (nodeMatch && method === 'GET') {
      const id = nodeMatch[1];
      const node = this.graph.getNode(id);
      if (!node) {
        RestServer.sendJsonError(res, 404, 'Node not found');
        return;
      }
      RestServer.sendJsonSuccess(res, 200, { node });
      return;
    }

    // DELETE /graph/nodes/:id
    if (nodeMatch && method === 'DELETE') {
      const id = nodeMatch[1];
      const removed = this.graph.removeNode(id);
      if (!removed) {
        RestServer.sendJsonError(res, 404, 'Node not found');
        return;
      }
      RestServer.sendJsonSuccess(res, 200, { success: true, deleted: id });
      return;
    }

    // GET /graph/edges — list edges (?source=X&target=Y&type=entity)
    if (path === '/graph/edges' && method === 'GET') {
      const url2 = new URL(req.url!, `http://${req.headers.host}`);
      const edges = this.graph.getEdges({
        source: url2.searchParams.get('source') || undefined,
        target: url2.searchParams.get('target') || undefined,
        type: parseEdgeType(url2.searchParams.get('type')),
      });
      RestServer.sendJsonSuccess(res, 200, { edges, count: edges.length });
      return;
    }

    // POST /graph/edges — create an edge
    if (path === '/graph/edges' && method === 'POST') {
      RestServer.readJsonObject<{ source: string; target: string; type: EdgeType; weight?: number; metadata?: Record<string, unknown> }>(req, res).then(async (data) => {
        if (!data) return;
        try {
          const { source, target, type, weight, metadata = {} } = data;
          if (!source || !target || !type) {
            RestServer.sendJsonError(res, 400, 'Missing required fields: source, target, type');
            return;
          }
          const edge = this.graph.addEdge({ source, target, type, weight, metadata });
          RestServer.sendJsonSuccess(res, 201, { edge });
        } catch (e: unknown) {
          RestServer.sendJsonError(res, 400, errorMessage(e));
        }
      });
      return;
    }

    // DELETE /graph/edges/:id
    const edgeMatch = path.match(/^\/graph\/edges\/(.+)$/);
    if (edgeMatch && method === 'DELETE') {
      const id = edgeMatch[1];
      const removed = this.graph.removeEdge(id);
      if (!removed) {
        RestServer.sendJsonError(res, 404, 'Edge not found');
        return;
      }
      RestServer.sendJsonSuccess(res, 200, { success: true, deleted: id });
      return;
    }

    // GET /graph/stats
    if (path === '/graph/stats' && method === 'GET') {
      RestServer.sendJsonSuccess(res, 200, this.graph.getStats());
      return;
    }

    // v1.0: Memory eviction management
    if (path === '/api/v1/memory/eviction' && method === 'GET') {
      this.handleMemoryEvictionSimple(res); return;
    }
    if (path === '/api/v1/memory/prune') {
      this.handleMemoryPruneSimple(req, res); return;
    }

    RestServer.sendJsonError(res, 405, 'Method not allowed for this path');
  }

  // ─────────────────────────────────────────────────────────────────
  // v1.0: Session Memory REST Handlers
  // ─────────────────────────────────────────────────────────────────

  private async handleSessionList(res: http.ServerResponse): Promise<void> {
    try {
      const sessions = await this.sessionStore.listSessions();
      RestServer.sendJsonSuccess(res, 200, { sessions, count: sessions.length });
    } catch (e: unknown) {
      RestServer.sendJsonError(res, 500, errorMessage(e));
    }
  }

  private async handleSessionCreate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    RestServer.readJsonObject<Partial<DBSession>>(req, res).then(async (data) => {
      if (!data) return;
      try {
        const now = Date.now();
        const session: DBSession = {
          id: data.id ?? uuidv4(),
          agentId: data.agentId ?? 'unknown',
          framework: data.framework ?? 'openclaw',
          startedAt: data.startedAt ?? now,
          endedAt: data.endedAt,
          transcript: data.transcript ?? '[]',
          summary: data.summary,
          importance: data.importance ?? 5.0,
          accessCount: 0,
          tags: data.tags ?? [],
          extracted: false,
          flagged: false,
          createdAt: now,
        };
        await this.sessionStore.registerSession(session);
        RestServer.sendJsonSuccess(res, 201, { success: true, session });
      } catch (e: unknown) {
        RestServer.sendJsonError(res, 400, errorMessage(e));
      }
    });
  }

  private async handleSessionGet(res: http.ServerResponse, id: string): Promise<void> {
    try {
      const session = await this.sessionStore.getSession(id);
      if (!session) {
        RestServer.sendJsonError(res, 404, 'Session not found');
        return;
      }
      await this.sessionStore.incrementAccessCount(id);
      RestServer.sendJsonSuccess(res, 200, { session });
    } catch (e: unknown) {
      RestServer.sendJsonError(res, 500, errorMessage(e));
    }
  }

  private async handleSessionUpdate(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
    RestServer.readJsonObject<Partial<DBSession>>(req, res).then(async (updates) => {
      if (!updates) return;
      try {
        await this.sessionStore.updateSession(id, updates);
        RestServer.sendJsonSuccess(res, 200, { success: true });
      } catch (e: unknown) {
        RestServer.sendJsonError(res, 400, errorMessage(e));
      }
    });
  }

  private async handleSessionDelete(res: http.ServerResponse, id: string): Promise<void> {
    try {
      const deleted = await this.sessionStore.deleteSession(id);
      res.writeHead(deleted ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: deleted, id }));
    } catch (e: unknown) {
      RestServer.sendJsonError(res, 500, errorMessage(e));
    }
  }

  private async handleSessionFeedback(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
    RestServer.readJsonObject<{ adjustment?: number; reason?: string; agentId?: string }>(req, res).then(async (data) => {
      if (!data) return;
      try {
        const { adjustment, reason, agentId } = data;
        await this.sessionStore.addFeedback(id, agentId ?? 'unknown', adjustment ?? 0, reason);
        RestServer.sendJsonSuccess(res, 200, { success: true });
      } catch (e: unknown) {
        RestServer.sendJsonError(res, 400, errorMessage(e));
      }
    });
  }

  private async handleSessionFlag(req: http.IncomingMessage, res: http.ServerResponse, id: string): Promise<void> {
    RestServer.readJsonObject<{ flagged?: unknown }>(req, res).then(async (data) => {
      if (!data) return;
      try {
        const { flagged } = data;
        await this.sessionStore.flagSession(id, !!flagged);
        RestServer.sendJsonSuccess(res, 200, { success: true });
      } catch (e: unknown) {
        RestServer.sendJsonError(res, 400, errorMessage(e));
      }
    });
  }

  private async handleSessionSearch(res: http.ServerResponse, url: URL): Promise<void> {
    const q = url.searchParams.get('q') ?? '';
    const limit = Math.min(parseIntParam(url, 'limit', 20), 50);
    try {
      const sessions = await this.sessionStore.searchSessions(q, limit);
      RestServer.sendJsonSuccess(res, 200, { sessions, count: sessions.length, query: q });
    } catch (e: unknown) {
      RestServer.sendJsonError(res, 500, errorMessage(e));
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // v1.0: Memory Eviction Handlers
  // ─────────────────────────────────────────────────────────────────

  private async handleMemoryEviction(res: http.ServerResponse): Promise<void> {
    try {
      const candidates = await this.db.getEvictionCandidates(3.0, 3.0, 20);
      RestServer.sendJsonSuccess(res, 200, { sessions: candidates.sessions, memories: candidates.memories, count: candidates.sessions.length + candidates.memories.length });
    } catch (e: unknown) {
      RestServer.sendJsonError(res, 500, errorMessage(e));
    }
  }

  private async handleMemoryPruneStatus(res: http.ServerResponse): Promise<void> {
    const status = this.forgettingScheduler?.getStatus() ?? { running: false, config: null, nextDaily: null, nextWeekly: null };
    RestServer.sendJsonSuccess(res, 200, { scheduler: status });
  }

  private async handleMemoryPrune(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.forgettingScheduler) {
      RestServer.sendJsonError(res, 400, 'ForgettingScheduler not configured');
      return;
    }
    readJsonBody(req).then(async (body: string) => {
      try {
        const result = await this.forgettingScheduler!.triggerEviction();
        RestServer.sendJsonSuccess(res, 200, { success: true, evicted: result });
      } catch (e: unknown) {
        RestServer.sendJsonError(res, 500, errorMessage(e));
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // v1.0: Session Memory Simple Handlers
  // ─────────────────────────────────────────────────────────────────

  private handleSessionRequest(req: http.IncomingMessage, res: http.ServerResponse, path: string, method: string, url: URL): void {
    if (path === '/sessions') {
      if (method === 'GET') { this.handleSessionList(res); return; }
      if (method === 'POST') { this.handleSessionCreate(req, res); return; }
    } else {
      const id = decodeURIComponent(path.slice(9));
      if (id === 'search' && method === 'GET') { this.handleSessionSearch(res, url); return; }
      if (method === 'GET') { this.handleSessionGet(res, id); return; }
      if (method === 'PUT') { this.handleSessionUpdate(req, res, id); return; }
      if (method === 'DELETE') { this.handleSessionDelete(res, id); return; }
      if (method === 'POST') {
        const subAction = url.searchParams.get('action');
        if (subAction === 'feedback') { this.handleSessionFeedback(req, res, id); return; }
        if (subAction === 'flag') { this.handleSessionFlag(req, res, id); return; }
      }
    }
    RestServer.sendJsonError(res, 405, 'Method not allowed for /sessions');
  }

  private async handleMemoryEvictionSimple(res: http.ServerResponse): Promise<void> {
    try {
      this.db.getEvictionCandidates(3.0, 3.0, 20).then(candidates => {
        RestServer.sendJsonSuccess(res, 200, { sessions: candidates.sessions, memories: candidates.memories, count: candidates.sessions.length + candidates.memories.length });
      }).catch((e: unknown) => {
        RestServer.sendJsonError(res, 500, errorMessage(e));
      });
    } catch (e: unknown) {
      RestServer.sendJsonError(res, 500, errorMessage(e));
    }
  }

  private async handleMemoryPruneSimple(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.forgettingScheduler) {
      RestServer.sendJsonError(res, 400, 'ForgettingScheduler not configured');
      return;
    }
    readJsonBody(req).then(async (body: string) => {
      this.forgettingScheduler!.triggerEviction().then(result => {
        RestServer.sendJsonSuccess(res, 200, { success: true, evicted: result });
      }).catch((e: unknown) => {
        RestServer.sendJsonError(res, 500, errorMessage(e));
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // v1.0: Graph Memory — Node CRUD Handlers
  // ─────────────────────────────────────────────────────────────────

  private handleGraphNodesList(res: http.ServerResponse, type?: GraphNodeType): void {
    const nodes = this.graph.getNodes(type);
    RestServer.sendJsonSuccess(res, 200, { nodes, count: nodes.length });
  }

  private async handleGraphNodeCreate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = '';
    for await (const chunk of req) { body += chunk; }
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch {
      RestServer.sendJsonError(res, 400, 'Invalid JSON body');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      RestServer.sendJsonError(res, 400, 'Body must be a JSON object');
      return;
    }
    const { type, label, metadata } = parsed as { type?: unknown; label?: unknown; metadata?: unknown };
    if (typeof type !== 'string' || typeof label !== 'string') {
      RestServer.sendJsonError(res, 400, 'type and label are required strings');
      return;
    }
    const validTypes = ['memory', 'agent', 'topic'] as const;
    if (!validTypes.includes(type as (typeof validTypes)[number])) {
      RestServer.sendJsonError(res, 400, `type must be one of: ${validTypes.join(', ')}`);
      return;
    }
    const meta: Record<string, unknown> = (metadata && typeof metadata === 'object' && !Array.isArray(metadata))
      ? metadata as Record<string, unknown>
      : {};
    const node = this.graph.addNode({ type: type as (typeof validTypes)[number], label, metadata: meta });
    RestServer.sendJsonSuccess(res, 201, { node });
  }

  private handleGraphNodeGet(res: http.ServerResponse, nodeId: string): void {
    const node = this.graph.getNode(nodeId);
    if (!node) {
      RestServer.sendJsonError(res, 404, 'Node not found');
      return;
    }
    RestServer.sendJsonSuccess(res, 200, { node });
  }

  private handleGraphNodeDelete(res: http.ServerResponse, nodeId: string): void {
    const deleted = this.graph.removeNode(nodeId);
    if (!deleted) {
      RestServer.sendJsonError(res, 404, 'Node not found');
      return;
    }
    RestServer.sendJsonSuccess(res, 200, { success: true, deleted: nodeId });
  }

  // ─────────────────────────────────────────────────────────────────

  private async handleTopicMessages(res: http.ServerResponse, topic: string, limit?: string | null): Promise<void> {
    const limitNum = Math.min(parseInt(limit || '50'), 200);
    const messages = await this.db.getMessages(topic, limitNum);
    RestServer.sendJsonSuccess(res, 200, {
      topic,
      messages: messages.reverse(),
      count: messages.length,
    });
  }

  close(): void {
    if (this.server) {
      this.server.close();
      hubLog('REST server closed');
    }
  }

  // v1.0: Create a topic (optionally private)
  private handleTopicCreate(req: http.IncomingMessage, res: http.ServerResponse, topicName: string): void {
    readJsonBody(req).then(async (body: string) => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const isPrivate = parsed && typeof parsed === 'object' && (parsed as { isPrivate?: unknown }).isPrivate === true;
        if (isPrivate) {
          this.topics.createPrivateTopic(topicName);
        } else {
          this.topics.createTopic(topicName, false);
        }
        const topic = this.topics.getTopic(topicName)!;
        RestServer.sendJsonSuccess(res, 201, { topic: { name: topic.name, isPrivate: topic.isPrivate, agents: [...topic.agents] } });
      } catch (e: unknown) {
        RestServer.sendJsonError(res, 400, errorMessage(e));
      }
    });
  }

  // v1.0: Invite an agent to a private topic
  private handleTopicInvite(req: http.IncomingMessage, res: http.ServerResponse, topicName: string): void {
    RestServer.readJsonObject<{ agentId: string; ttlMs?: number }>(req, res).then(async (data) => {
      if (!data) return;
      try {
        const { agentId, ttlMs } = data;
        if (!agentId) {
          RestServer.sendJsonError(res, 400, 'Missing required field: agentId');
          return;
        }
        const token = this.topics.inviteToTopic(topicName, agentId, ttlMs);
        RestServer.sendJsonSuccess(res, 200, { success: true, inviteToken: token, topic: topicName, invitedAgent: agentId });
      } catch (e: unknown) {
        RestServer.sendJsonError(res, 400, errorMessage(e));
      }
    });
  }

  // v1.0: Join a private topic with invite token
  private handleTopicJoin(req: http.IncomingMessage, res: http.ServerResponse, topicName: string): void {
    RestServer.readJsonObject<{ agentId: string; inviteToken: string }>(req, res, 403).then(async (data) => {
      if (!data) return;
      try {
        const { agentId, inviteToken } = data;
        if (!agentId || !inviteToken) {
          RestServer.sendJsonError(res, 400, 'Missing required fields: agentId, inviteToken');
          return;
        }
        const topic = this.topics.joinPrivateTopic(agentId, topicName, inviteToken);
        RestServer.sendJsonSuccess(res, 200, { success: true, topic: { name: topic.name, isPrivate: true, agents: [...topic.agents] } });
      } catch (e: unknown) {
        RestServer.sendJsonError(res, 403, errorMessage(e));
      }
    });
  }



  // ─── JSON error response helper (deduped from 65+ inline sites) ─────────
  //
  // Replaces the 2-line pattern:
  //   res.writeHead(status, { 'Content-Type': 'application/json' });
  //   res.end(JSON.stringify({ error: msg }));
  // which appeared 65+ times across 400/401/403/404/500/503 responses.
  //
  // Why a static helper (not instance method):
  //   - pure function of (res, status, msg) — no `this` access needed
  //   - callable from any future handler that imports RestServer
  //   - keeps test surface narrow (one method, not 65 inline sites)
  //
  // All 405 sites are now migrated (798a0ba + follow-up closure): sites
  // use the same 'Content-Type: application/json' writeHead shape as this
  // helper, and the body shape {error: msg} matches byte-for-byte.
  private static sendJsonError(
    res: http.ServerResponse,
    status: number,
    msg: string,
  ): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: msg }));
  }

  // ─── JSON success response helper (mirror of sendJsonError) ─────────────
  //
  // Replaces the 2-line pattern:
  //   res.writeHead(200|201, { 'Content-Type': 'application/json' });
  //   res.end(JSON.stringify(body));
  // which appeared across success responses (memory reads, graph queries,
  // session ops, etc.). Generalized to accept any JSON body shape; the
  // caller passes the literal object so call-site readability stays high.
  //
  // Sites NOT migrated (deliberate):
  //   - L137 OPTIONS preflight: writeHead(200) + end() with no body
  //   - L579 handleMemoryWrite: custom response headers (X-WoClaw-Conflict,
  //     X-WoClaw-Duplicate) need a different writeHead shape
  //   - 405 Method-not-allowed sites: all routed through sendJsonError
  //     (parity helper shared between success + error response paths)
  //   - multi-line body literals: closed by 39e7ba4 (10-site migration,
  //     token rotate + handleHealth + memory list/stats + memory get/
  //     versions/recall/byTag + delegation accept + topic messages); now
  //     only carve-outs above remain
  private static sendJsonSuccess(
    res: http.ServerResponse,
    status: 200 | 201,
    body: unknown,
  ): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }


  // ─── JSON request body read+parse helper (parallels readJsonBody module helper) ────
  //
  // Replaces the inline pattern at 13 POST/PUT handlers:
  //   readJsonBody(req).then(async (body: string) => {
  //     try {
  //       const X = JSON.parse(body);
  //       ... validation + operation ...
  //     } catch (e: unknown) {
  //       RestServer.sendJsonError(res, <code>, errorMessage(e));
  //     }
  //   });
  //
  // with:
  //   RestServer.readJsonObject<T>(req, res).then(async (data) => {
  //     if (!data) return; // helper already sent the error response
  //     try {
  //       ... validation + operation ...   // operation may still throw → catch routes through sendJsonError
  //     } catch (e: unknown) {
  //       RestServer.sendJsonError(res, <code>, errorMessage(e));
  //     }
  //   });
  //
  // On JSON.parse failure: writes a <errorStatus> (default 400) error response
  // via sendJsonError (byte-identical shape — {error: msg}) and returns null,
  // so the caller short-circuits via `if (!data) return;`.
  //
  // The surrounding try/catch at the call site is preserved for the case where
  // the downstream operation (addEdge / addFederationPeer / registerSession /
  // etc.) throws — those errors still need errorMessage(e) routing. The helper
  // only owns the JSON.parse step + the (body,res) glue — it does NOT swallow
  // operation errors.
  //
  // Why static (not instance): same rationale as sendJsonError/sendJsonSuccess
  // — pure of (req, res, errorStatus), no `this` access. Calls
  // `RestServer.sendJsonError` which is also private static — module-level
  // readJsonBody already takes the same module-level approach for the body
  // accumulation step. Caller invocation pattern mirrors sendJsonError call
  // shape: RestServer.readJsonObject<T>(req, res[, errorStatus]).
  private static async readJsonObject<T>(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    errorStatus: number = 400,
  ): Promise<T | null> {
    const body = await readJsonBody(req);
    try {
      return JSON.parse(body) as T;
    } catch (e: unknown) {
      RestServer.sendJsonError(res, errorStatus, errorMessage(e));
      return null;
    }
  }
}
