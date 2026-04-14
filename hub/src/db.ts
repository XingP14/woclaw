import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import type { Config, DBMessage, DBMemory, DBMemoryVersion, MySqlStorageConfig, StorageConfig } from './types.js';

type LegacyDbShape = {
  messages?: DBMessage[];
  memory?: Array<Partial<DBMemory>>;
  memory_versions?: Array<Partial<DBMemoryVersion>>;
  topics?: Array<{ name: string; createdAt?: number; messageCount?: number }>;
};

type StorageKind = 'sqlite' | 'mysql';

interface DbStorage {
  init(): Promise<void>;
  saveMessage(msg: DBMessage): Promise<void>;
  getMessages(topic: string, limit?: number, before?: number): Promise<DBMessage[]>;
  setMemory(key: string, value: string, updatedBy: string, tags?: string[], ttl?: number): Promise<void>;
  getMemory(key: string): Promise<DBMemory | undefined>;
  deleteMemory(key: string): Promise<boolean>;
  getAllMemory(): Promise<DBMemory[]>;
  getMemoryVersions(key: string): Promise<DBMemoryVersion[]>;
  cleanupExpired(): Promise<number>;
  getTopicStats(): Promise<{ name: string; messageCount: number; createdAt: number }[]>;
  close(): Promise<void>;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.map(tag => String(tag));
}

function asNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function mapMemoryRow(row: any): DBMemory {
  return {
    key: row.key,
    value: row.value,
    tags: parseTags(row.tags),
    ttl: asNumber(row.ttl, 0),
    expireAt: asNumber(row.expire_at ?? row.expireAt, 0),
    updatedAt: asNumber(row.updated_at ?? row.updatedAt, 0),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
  };
}

function mapMemoryVersionRow(row: any): DBMemoryVersion {
  return {
    key: row.key,
    value: row.value,
    version: asNumber(row.version, 0),
    tags: parseTags(row.tags),
    ttl: asNumber(row.ttl, 0),
    expireAt: asNumber(row.expire_at ?? row.expireAt, 0),
    updatedAt: asNumber(row.updated_at ?? row.updatedAt, 0),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
  };
}

function mapMessageRow(row: any): DBMessage {
  return {
    id: row.id,
    topic: row.topic,
    from: row.from_agent ?? row.from,
    content: row.content,
    timestamp: asNumber(row.timestamp, 0),
  };
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeTags(value);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

function serializeTags(tags: string[] | undefined): string {
  return JSON.stringify(normalizeTags(tags));
}

function legacyStoragePath(dataDir: string): string {
  return join(dataDir, 'woclaw.json');
}

function resolveSqlitePath(config: Config): string {
  return config.storage?.sqlitePath || join(config.dataDir, 'woclaw.sqlite');
}

function resolveStorageKind(config: Config): StorageKind {
  return (config.storage?.type || 'sqlite').toLowerCase() as StorageKind;
}

function resolveMysqlConfig(config: Config): MySqlStorageConfig {
  const mysqlConfig = config.storage?.mysql;
  if (!mysqlConfig) {
    throw new Error('MySQL storage selected but storage.mysql config is missing');
  }
  if (!mysqlConfig.host || !mysqlConfig.user || !mysqlConfig.database) {
    throw new Error('MySQL storage requires host, user, and database');
  }
  return mysqlConfig;
}

function createStorage(config: Config): DbStorage {
  const kind = resolveStorageKind(config);
  if (kind === 'mysql') {
    return new MySqlStorage(config);
  }
  return new SqliteStorage(config);
}

export class ClawDB {
  private storage: DbStorage;
  private ready: Promise<void>;

  constructor(dataDirOrConfig: string | Config) {
    const config: Config = typeof dataDirOrConfig === 'string'
      ? {
          port: 0,
          restPort: 0,
          host: '127.0.0.1',
          dataDir: dataDirOrConfig,
          authToken: '',
        }
      : dataDirOrConfig;

    this.storage = createStorage(config);
    this.ready = this.storage.init();
  }

  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  async saveMessage(msg: DBMessage): Promise<void> {
    await this.ensureReady();
    await this.storage.saveMessage(msg);
  }

  async getMessages(topic: string, limit: number = 100, before?: number): Promise<DBMessage[]> {
    await this.ensureReady();
    return this.storage.getMessages(topic, limit, before);
  }

  async setMemory(key: string, value: string, updatedBy: string, tags: string[] = [], ttl: number = 0): Promise<void> {
    await this.ensureReady();
    await this.storage.setMemory(key, value, updatedBy, tags, ttl);
  }

  async getMemory(key: string): Promise<DBMemory | undefined> {
    await this.ensureReady();
    return this.storage.getMemory(key);
  }

  async deleteMemory(key: string): Promise<boolean> {
    await this.ensureReady();
    return this.storage.deleteMemory(key);
  }

  async getAllMemory(): Promise<DBMemory[]> {
    await this.ensureReady();
    return this.storage.getAllMemory();
  }

  async getMemoryVersions(key: string): Promise<DBMemoryVersion[]> {
    await this.ensureReady();
    return this.storage.getMemoryVersions(key);
  }

  async cleanupExpired(): Promise<number> {
    await this.ensureReady();
    return this.storage.cleanupExpired();
  }

  async getTopicStats(): Promise<{ name: string; messageCount: number; createdAt: number }[]> {
    await this.ensureReady();
    return this.storage.getTopicStats();
  }

  async close(): Promise<void> {
    await this.ensureReady();
    await this.storage.close();
  }

  // ─── Sessions (delegated to storage) ───────────────────────────────────────

  async setSession(session: DBSession): Promise<void> {
    await this.ensureReady();
    return (this.storage as any).setSession(session);
  }
  async getSession(id: string): Promise<DBSession | undefined> {
    await this.ensureReady();
    return (this.storage as any).getSession(id);
  }
  async getAllSessions(agentId?: string, framework?: string, limit = 50, offset = 0): Promise<DBSession[]> {
    await this.ensureReady();
    return (this.storage as any).getAllSessions(agentId, framework, limit, offset);
  }
  async deleteSession(id: string): Promise<boolean> {
    await this.ensureReady();
    return (this.storage as any).deleteSession(id);
  }
  async sessionSearch(query: string, limit = 20): Promise<DBSession[]> {
    await this.ensureReady();
    return (this.storage as any).sessionSearch(query, limit);
  }
  async addToExtractionQueue(sessionId: string, priority = 0): Promise<void> {
    await this.ensureReady();
    return (this.storage as any).addToExtractionQueue(sessionId, priority);
  }
  async getExtractionQueue(limit = 10): Promise<ExtractionQueueEntry[]> {
    await this.ensureReady();
    return (this.storage as any).getExtractionQueue(limit);
  }
  async updateExtractionQueueStatus(sessionId: string, status: string): Promise<void> {
    await this.ensureReady();
    return (this.storage as any).updateExtractionQueueStatus(sessionId, status);
  }
  async removeFromExtractionQueue(sessionId: string): Promise<void> {
    await this.ensureReady();
    return (this.storage as any).removeFromExtractionQueue(sessionId);
  }
  async addSessionFeedback(sessionId: string, agentId: string, adjustment: number, reason?: string): Promise<void> {
    await this.ensureReady();
    return (this.storage as any).addSessionFeedback(sessionId, agentId, adjustment, reason);
  }
  async getSessionFeedbackHistory(sessionId: string): Promise<DBSessionFeedback[]> {
    await this.ensureReady();
    return (this.storage as any).getSessionFeedbackHistory(sessionId);
  }
  async addMemoryFeedback(key: string, agentId: string, adjustment: number, reason?: string): Promise<void> {
    await this.ensureReady();
    return (this.storage as any).addMemoryFeedback(key, agentId, adjustment, reason);
  }
  async getMemoryFeedbackHistory(key: string): Promise<MemoryFeedback[]> {
    await this.ensureReady();
    return (this.storage as any).getMemoryFeedbackHistory(key);
  }
  async getEvictionCandidates(memoryThreshold: number, sessionThreshold: number, limit: number): Promise<{
    memories: Array<{key: string; importance: number; lastAccessedAt: number; accessCount: number}>;
    sessions: Array<{id: string; importance: number; lastAccessedAt: number; accessCount: number}>;
  }> {
    await this.ensureReady();
    return (this.storage as any).getEvictionCandidates(memoryThreshold, sessionThreshold, limit);
  }
}

class SqliteStorage implements DbStorage {
  private db!: any;
  private dataDir: string;
  private sqlitePath: string;

  constructor(config: Config) {
    this.dataDir = config.dataDir;
    this.sqlitePath = resolveSqlitePath(config);
  }

  async init(): Promise<void> {
    mkdirSync(dirname(this.sqlitePath), { recursive: true });
    this.db = new Database(this.sqlitePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_topic_timestamp
        ON messages(topic, timestamp);

      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        tags TEXT NOT NULL,
        ttl INTEGER NOT NULL,
        expire_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_expire_at
        ON memory(expire_at);

      CREATE TABLE IF NOT EXISTS memory_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        tags TEXT NOT NULL,
        ttl INTEGER NOT NULL,
        expire_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_versions_key_version
        ON memory_versions(key, version DESC);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        framework TEXT NOT NULL DEFAULT 'unknown',
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        transcript TEXT NOT NULL DEFAULT '',
        summary TEXT,
        importance REAL NOT NULL DEFAULT 5.0,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER,
        tags TEXT NOT NULL DEFAULT '[]',
        extracted INTEGER NOT NULL DEFAULT 0,
        flagged INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);

      CREATE TABLE IF NOT EXISTS extraction_queue (
        session_id TEXT PRIMARY KEY,
        queued_at INTEGER NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        adjustment REAL NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        adjustment REAL NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    // v1.0 migration: add importance/access_count/last_accessed_at to memory table
    this.addColumnIfNotExists('memory', 'importance_score', 'REAL NOT NULL DEFAULT 5.0');
    this.addColumnIfNotExists('memory', 'access_count', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfNotExists('memory', 'last_accessed_at', 'INTEGER');

    await this.maybeImportLegacyData();
  }

  private addColumnIfNotExists(table: string, column: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (e: any) {
      if (!e.message.includes('duplicate column name')) {
        throw e;
      }
    }
  }

  private async maybeImportLegacyData(): Promise<void> {
    const legacyPath = legacyStoragePath(this.dataDir);
    if (!existsSync(legacyPath)) return;

    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM messages) AS messageCount,
        (SELECT COUNT(*) FROM memory) AS memoryCount,
        (SELECT COUNT(*) FROM memory_versions) AS versionCount
    `).get() as any;

    if (asNumber(counts?.messageCount, 0) > 0 || asNumber(counts?.memoryCount, 0) > 0 || asNumber(counts?.versionCount, 0) > 0) {
      return;
    }

    try {
      const legacy = JSON.parse(readFileSync(legacyPath, 'utf-8')) as LegacyDbShape;
      await this.importLegacyData(legacy);
    } catch (e) {
      console.error('[ClawDB] Failed to import legacy JSON store:', e);
    }
  }

  private async importLegacyData(data: LegacyDbShape): Promise<void> {
    const insertMessage = this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, topic, from_agent, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertMemory = this.db.prepare(`
      INSERT OR REPLACE INTO memory (key, value, tags, ttl, expire_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertVersion = this.db.prepare(`
      INSERT INTO memory_versions (key, value, version, tags, ttl, expire_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction((legacy: LegacyDbShape) => {
      for (const message of legacy.messages || []) {
        if (!message?.id || !message?.topic) continue;
        insertMessage.run(
          message.id,
          message.topic,
          message.from ?? 'system',
          message.content ?? '',
          asNumber(message.timestamp, Date.now()),
        );
      }

      for (const mem of legacy.memory || []) {
        if (!mem?.key) continue;
        insertMemory.run(
          mem.key,
          mem.value ?? '',
          serializeTags(mem.tags as string[] | undefined),
          asNumber(mem.ttl, 0),
          asNumber(mem.expireAt, 0),
          asNumber(mem.updatedAt, Date.now()),
          mem.updatedBy ?? 'system',
        );
      }

      for (const version of legacy.memory_versions || []) {
        if (!version?.key || version.version === undefined || version.version === null) continue;
        insertVersion.run(
          version.key,
          version.value ?? '',
          asNumber(version.version, 0),
          serializeTags(version.tags as string[] | undefined),
          asNumber(version.ttl, 0),
          asNumber(version.expireAt, 0),
          asNumber(version.updatedAt, Date.now()),
          version.updatedBy ?? 'system',
        );
      }
    });

    tx(data);
  }

  async saveMessage(msg: DBMessage): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, topic, from_agent, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(msg.id, msg.topic, msg.from, msg.content, msg.timestamp);
    await this.trimMessagesIfNeeded();
  }

  private async trimMessagesIfNeeded(): Promise<void> {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM messages').get() as any;
    const count = asNumber(row?.count, 0);
    if (count <= 10000) return;

    const toRemove = count - 5000;
    const rows = this.db.prepare(`
      SELECT id
      FROM messages
      ORDER BY timestamp ASC, id ASC
      LIMIT ?
    `).all(toRemove) as Array<{ id: string }>;

    const ids = rows.map(row => row.id);
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    this.db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids);
  }

  async getMessages(topic: string, limit: number = 100, before?: number): Promise<DBMessage[]> {
    const safeLimit = Math.max(0, limit);
    let rows: any[];
    if (before === undefined) {
      rows = this.db.prepare(`
        SELECT id, topic, from_agent, content, timestamp
        FROM messages
        WHERE topic = ?
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      `).all(topic, safeLimit);
    } else {
      rows = this.db.prepare(`
        SELECT id, topic, from_agent, content, timestamp
        FROM messages
        WHERE topic = ? AND timestamp < ?
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      `).all(topic, before, safeLimit);
    }
    return rows.map(mapMessageRow);
  }

  async setMemory(key: string, value: string, updatedBy: string, tags: string[] = [], ttl: number = 0): Promise<void> {
    const now = Date.now();
    const expireAt = ttl > 0 ? now + ttl * 1000 : 0;
    const tx = this.db.transaction((payload: {
      key: string;
      value: string;
      updatedBy: string;
      tags: string[];
      ttl: number;
      now: number;
      expireAt: number;
    }) => {
      const existing = this.db.prepare(`
        SELECT key, value, tags, ttl, expire_at, updated_at, updated_by
        FROM memory
        WHERE key = ?
      `).get(payload.key);

      if (existing) {
        const versionRow = this.db.prepare(`
          SELECT COALESCE(MAX(version), 0) AS maxVersion
          FROM memory_versions
          WHERE key = ?
        `).get(payload.key) as any;
        const nextVersion = asNumber(versionRow?.maxVersion, 0) + 1;

        this.db.prepare(`
          INSERT INTO memory_versions (key, value, version, tags, ttl, expire_at, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          payload.key,
          existing.value,
          nextVersion,
          existing.tags,
          asNumber(existing.ttl, 0),
          asNumber(existing.expire_at, 0),
          asNumber(existing.updated_at, 0),
          existing.updated_by,
        );

        this.db.prepare(`
          UPDATE memory
          SET value = ?, tags = ?, ttl = ?, expire_at = ?, updated_at = ?, updated_by = ?
          WHERE key = ?
        `).run(
          payload.value,
          serializeTags(payload.tags),
          payload.ttl,
          payload.expireAt,
          payload.now,
          payload.updatedBy,
          payload.key,
        );
      } else {
        this.db.prepare(`
          INSERT INTO memory (key, value, tags, ttl, expire_at, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          payload.key,
          payload.value,
          serializeTags(payload.tags),
          payload.ttl,
          payload.expireAt,
          payload.now,
          payload.updatedBy,
        );
      }
    });

    tx({ key, value, updatedBy, tags, ttl, now, expireAt });
  }

  async getMemory(key: string): Promise<DBMemory | undefined> {
    const row = this.db.prepare(`
      SELECT key, value, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      WHERE key = ?
    `).get(key);
    if (!row) return undefined;

    const mem = mapMemoryRow(row);
    if (mem.expireAt > 0 && mem.expireAt < Date.now()) {
      await this.deleteMemory(key);
      return undefined;
    }
    return mem;
  }

  async deleteMemory(key: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memory WHERE key = ?').run(key);
    return result.changes > 0;
  }

  async getAllMemory(): Promise<DBMemory[]> {
    await this.cleanupExpired();
    const rows = this.db.prepare(`
      SELECT key, value, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      ORDER BY updated_at DESC, key ASC
    `).all() as any[];
    return rows.map(mapMemoryRow);
  }

  async getMemoryVersions(key: string): Promise<DBMemoryVersion[]> {
    const rows = this.db.prepare(`
      SELECT key, value, version, tags, ttl, expire_at, updated_at, updated_by
      FROM memory_versions
      WHERE key = ?
      ORDER BY version DESC
    `).all(key) as any[];
    return rows.map(mapMemoryVersionRow);
  }

  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const result = this.db.prepare(`
      DELETE FROM memory
      WHERE expire_at > 0 AND expire_at < ?
    `).run(now);
    return result.changes || 0;
  }

  async getTopicStats(): Promise<{ name: string; messageCount: number; createdAt: number }[]> {
    const rows = this.db.prepare(`
      SELECT topic AS name, COUNT(*) AS messageCount, MIN(timestamp) AS createdAt
      FROM messages
      GROUP BY topic
      ORDER BY MIN(timestamp) ASC, topic ASC
    `).all() as any[];
    return rows.map(row => ({
      name: row.name,
      messageCount: asNumber(row.messageCount, 0),
      createdAt: asNumber(row.createdAt, 0),
    }));
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }

  // ─── Sessions ────────────────────────────────────────────────────────────

  async setSession(session: DBSession): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO sessions
        (id, agent_id, framework, started_at, ended_at, transcript, summary, importance, access_count, last_accessed_at, tags, extracted, flagged, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id, session.agentId, session.framework, session.startedAt,
      session.endedAt ?? null, session.transcript, session.summary ?? null,
      session.importance, session.accessCount, session.lastAccessedAt ?? null,
      JSON.stringify(session.tags), session.extracted ? 1 : 0, session.flagged ? 1 : 0,
      session.createdAt
    );
  }

  async getSession(id: string): Promise<DBSession | undefined> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    return row ? this.mapSessionRow(row) : undefined;
  }

  async getAllSessions(agentId?: string, framework?: string, limit = 50, offset = 0): Promise<DBSession[]> {
    let sql = 'SELECT * FROM sessions';
    const params: any[] = [];
    if (agentId) { sql += ' WHERE agent_id = ?'; params.push(agentId); }
    if (framework) { sql += (agentId ? ' AND' : ' WHERE') + ' framework = ?'; params.push(framework); }
    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    return (this.db.prepare(sql).all(...params) as any[]).map(r => this.mapSessionRow(r));
  }

  async deleteSession(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async sessionSearch(query: string, limit = 20): Promise<DBSession[]> {
    const rows = this.db.prepare(`
      SELECT * FROM sessions WHERE transcript LIKE ? OR summary LIKE ?
      ORDER BY started_at DESC LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit) as any[];
    return rows.map(r => this.mapSessionRow(r));
  }

  private mapSessionRow(row: any): DBSession {
    return {
      id: row.id, agentId: row.agent_id, framework: row.framework,
      startedAt: row.started_at, endedAt: row.ended_at ?? undefined,
      transcript: row.transcript, summary: row.summary ?? undefined,
      importance: row.importance, accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at ?? undefined,
      tags: JSON.parse(row.tags || '[]'),
      extracted: !!row.extracted, flagged: !!row.flagged,
      createdAt: row.created_at,
    };
  }

  async addToExtractionQueue(sessionId: string, priority = 0): Promise<void> {
    this.db.prepare(`INSERT OR REPLACE INTO extraction_queue (session_id, queued_at, priority, status, retry_count) VALUES (?, ?, ?, 'pending', 0)`).run(sessionId, Date.now(), priority);
  }

  async getExtractionQueue(limit = 10): Promise<ExtractionQueueEntry[]> {
    const rows = this.db.prepare(`SELECT * FROM extraction_queue ORDER BY priority DESC, queued_at ASC LIMIT ?`).all(limit) as any[];
    return rows.map(r => ({ sessionId: r.session_id, queuedAt: r.queued_at, priority: r.priority, status: r.status, retryCount: r.retry_count }));
  }

  async updateExtractionQueueStatus(sessionId: string, status: string): Promise<void> {
    this.db.prepare(`UPDATE extraction_queue SET status = ? WHERE session_id = ?`).run(status, sessionId);
  }

  async removeFromExtractionQueue(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM extraction_queue WHERE session_id = ?').run(sessionId);
  }

  async addSessionFeedback(sessionId: string, agentId: string, adjustment: number, reason?: string): Promise<void> {
    this.db.prepare(`INSERT INTO session_feedback (session_id, agent_id, adjustment, reason, created_at) VALUES (?, ?, ?, ?, ?)`).run(sessionId, agentId, adjustment, reason ?? null, Date.now());
  }

  async getSessionFeedbackHistory(sessionId: string): Promise<DBSessionFeedback[]> {
    const rows = this.db.prepare(`SELECT * FROM session_feedback WHERE session_id = ? ORDER BY created_at DESC`).all(sessionId) as any[];
    return rows.map(r => ({ sessionId: r.session_id, agentId: r.agent_id, adjustment: r.adjustment, reason: r.reason, createdAt: r.created_at }));
  }

  async addMemoryFeedback(key: string, agentId: string, adjustment: number, reason?: string): Promise<void> {
    this.db.prepare(`INSERT INTO memory_feedback (key, agent_id, adjustment, reason, created_at) VALUES (?, ?, ?, ?, ?)`).run(key, agentId, adjustment, reason ?? null, Date.now());
  }

  async getMemoryFeedbackHistory(key: string): Promise<MemoryFeedback[]> {
    const rows = this.db.prepare(`SELECT * FROM memory_feedback WHERE key = ? ORDER BY created_at DESC`).all(key) as any[];
    return rows.map(r => ({ key: r.key, agentId: r.agent_id, adjustment: r.adjustment, reason: r.reason, createdAt: r.created_at }));
  }

  async getEvictionCandidates(memoryThreshold: number, sessionThreshold: number, limit: number): Promise<{
    memories: Array<{key: string; importance: number; lastAccessedAt: number; accessCount: number}>;
    sessions: Array<{id: string; importance: number; lastAccessedAt: number; accessCount: number}>;
  }> {
    const now = Date.now();
    const RECENCY_WINDOW = 90 * 24 * 60 * 60 * 1000;
    const memories = this.db.prepare(`
      SELECT m.key, COALESCE(m.importance_score, 5.0) + COALESCE(SUM(f.adjustment), 0) AS importance,
             COALESCE(m.last_accessed_at, m.updated_at) AS last_accessed_at,
             COALESCE(m.access_count, 0) AS access_count
      FROM memory m
      LEFT JOIN memory_feedback f ON m.key = f.key
      GROUP BY m.key
      HAVING importance < ?
      ORDER BY (importance * 0.5) + ((1.0 - MIN((COALESCE(m.last_accessed_at, m.updated_at) - ?), ?) / ?) * 0.3) + (LOG10(COALESCE(m.access_count, 0) + 1) / 2.0 * 0.2) ASC
      LIMIT ?
    `).all(memoryThreshold, now, RECENCY_WINDOW, RECENCY_WINDOW, limit) as any[];
    const sessRows = this.db.prepare(`
      SELECT id, importance, COALESCE(last_accessed_at, ended_at, created_at) as last_accessed_at, access_count
      FROM sessions WHERE importance < ?
      ORDER BY (importance * 0.5) + ((1.0 - MIN((COALESCE(last_accessed_at, ended_at, created_at) - ?), ?) / ?) * 0.3) + (LOG10(access_count + 1) / 2.0 * 0.2) ASC
      LIMIT ?
    `).all(sessionThreshold, now, RECENCY_WINDOW, RECENCY_WINDOW, limit) as any[];
    return {
      memories: memories.map(r => ({ key: r.key, importance: r.importance, lastAccessedAt: r.last_accessed_at, accessCount: r.access_count })),
      sessions: sessRows.map(r => ({ id: r.id, importance: r.importance, lastAccessedAt: r.last_accessed_at, accessCount: r.access_count })),
    };
  }
}

class MySqlStorage implements DbStorage {
  private pool: any;
  private config: MySqlStorageConfig;
  private dataDir: string;

  constructor(config: Config) {
    this.config = resolveMysqlConfig(config);
    this.dataDir = config.dataDir;
  }

  async init(): Promise<void> {
    this.pool = mysql.createPool({
      host: this.config.host,
      port: this.config.port || 3306,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      connectionLimit: this.config.connectionLimit || 10,
      waitForConnections: true,
      decimalNumbers: true,
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(191) PRIMARY KEY,
        topic VARCHAR(191) NOT NULL,
        from_agent VARCHAR(191) NOT NULL,
        content LONGTEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        INDEX idx_messages_topic_timestamp (topic, timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS memory (
        \`key\` VARCHAR(191) PRIMARY KEY,
        value LONGTEXT NOT NULL,
        tags LONGTEXT NOT NULL,
        ttl BIGINT NOT NULL,
        expire_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        updated_by VARCHAR(191) NOT NULL,
        INDEX idx_memory_expire_at (expire_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS memory_versions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(191) NOT NULL,
        value LONGTEXT NOT NULL,
        version BIGINT NOT NULL,
        tags LONGTEXT NOT NULL,
        ttl BIGINT NOT NULL,
        expire_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        updated_by VARCHAR(191) NOT NULL,
        INDEX idx_memory_versions_key_version (\`key\`, version DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(191) PRIMARY KEY,
        agent_id VARCHAR(191) NOT NULL,
        framework VARCHAR(191) NOT NULL DEFAULT 'unknown',
        started_at BIGINT NOT NULL,
        ended_at BIGINT,
        transcript LONGTEXT NOT NULL DEFAULT '',
        summary LONGTEXT,
        importance DOUBLE NOT NULL DEFAULT 5.0,
        access_count BIGINT NOT NULL DEFAULT 0,
        last_accessed_at BIGINT,
        tags LONGTEXT NOT NULL DEFAULT '[]',
        extracted TINYINT(1) NOT NULL DEFAULT 0,
        flagged TINYINT(1) NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        INDEX idx_sessions_agent_id (agent_id),
        INDEX idx_sessions_started_at (started_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS extraction_queue (
        session_id VARCHAR(191) PRIMARY KEY,
        queued_at BIGINT NOT NULL,
        priority BIGINT NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        retry_count BIGINT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS session_feedback (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(191) NOT NULL,
        agent_id VARCHAR(191) NOT NULL,
        adjustment DOUBLE NOT NULL,
        reason LONGTEXT,
        created_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS memory_feedback (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(191) NOT NULL,
        agent_id VARCHAR(191) NOT NULL,
        adjustment DOUBLE NOT NULL,
        reason LONGTEXT,
        created_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // v1.0 migration: add importance/access_count/last_accessed_at to memory table
    try {
      await this.pool.execute(`ALTER TABLE memory ADD COLUMN importance_score DOUBLE NOT NULL DEFAULT 5.0`);
    } catch (e: any) { if (!e.message.includes('Duplicate column')) throw e; }
    try {
      await this.pool.execute(`ALTER TABLE memory ADD COLUMN access_count INT NOT NULL DEFAULT 0`);
    } catch (e: any) { if (!e.message.includes('Duplicate column')) throw e; }
    try {
      await this.pool.execute(`ALTER TABLE memory ADD COLUMN last_accessed_at BIGINT`);
    } catch (e: any) { if (!e.message.includes('Duplicate column')) throw e; }

    await this.maybeImportLegacyData();
  }

  private async maybeImportLegacyData(): Promise<void> {
    const legacyPath = legacyStoragePath(this.dataDir);
    if (!existsSync(legacyPath)) return;

    const [countsRows] = await this.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM messages) AS messageCount,
        (SELECT COUNT(*) FROM memory) AS memoryCount,
        (SELECT COUNT(*) FROM memory_versions) AS versionCount
    `);
    const counts = (countsRows as any[])[0];
    if (
      asNumber(counts?.messageCount, 0) > 0 ||
      asNumber(counts?.memoryCount, 0) > 0 ||
      asNumber(counts?.versionCount, 0) > 0
    ) {
      return;
    }

    try {
      const legacy = JSON.parse(readFileSync(legacyPath, 'utf-8')) as LegacyDbShape;
      await this.importLegacyData(legacy);
    } catch (e) {
      console.error('[ClawDB] Failed to import legacy JSON store into MySQL:', e);
    }
  }

  private async importLegacyData(data: LegacyDbShape): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const message of data.messages || []) {
        if (!message?.id || !message?.topic) continue;
        await conn.execute(`
          INSERT INTO messages (id, topic, from_agent, content, timestamp)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            topic = VALUES(topic),
            from_agent = VALUES(from_agent),
            content = VALUES(content),
            timestamp = VALUES(timestamp)
        `, [
          message.id,
          message.topic,
          message.from ?? 'system',
          message.content ?? '',
          asNumber(message.timestamp, Date.now()),
        ]);
      }

      for (const mem of data.memory || []) {
        if (!mem?.key) continue;
        await conn.execute(`
          INSERT INTO memory (\`key\`, value, tags, ttl, expire_at, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            value = VALUES(value),
            tags = VALUES(tags),
            ttl = VALUES(ttl),
            expire_at = VALUES(expire_at),
            updated_at = VALUES(updated_at),
            updated_by = VALUES(updated_by)
        `, [
          mem.key,
          mem.value ?? '',
          serializeTags(mem.tags as string[] | undefined),
          asNumber(mem.ttl, 0),
          asNumber(mem.expireAt, 0),
          asNumber(mem.updatedAt, Date.now()),
          mem.updatedBy ?? 'system',
        ]);
      }

      for (const version of data.memory_versions || []) {
        if (!version?.key || version.version === undefined || version.version === null) continue;
        await conn.execute(`
          INSERT INTO memory_versions (\`key\`, value, version, tags, ttl, expire_at, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          version.key,
          version.value ?? '',
          asNumber(version.version, 0),
          serializeTags(version.tags as string[] | undefined),
          asNumber(version.ttl, 0),
          asNumber(version.expireAt, 0),
          asNumber(version.updatedAt, Date.now()),
          version.updatedBy ?? 'system',
        ]);
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async saveMessage(msg: DBMessage): Promise<void> {
    await this.pool.execute(`
      INSERT INTO messages (id, topic, from_agent, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        topic = VALUES(topic),
        from_agent = VALUES(from_agent),
        content = VALUES(content),
        timestamp = VALUES(timestamp)
    `, [msg.id, msg.topic, msg.from, msg.content, msg.timestamp]);
    await this.trimMessagesIfNeeded();
  }

  private async trimMessagesIfNeeded(): Promise<void> {
    const [rows] = await this.pool.query('SELECT COUNT(*) AS count FROM messages');
    const count = asNumber((rows as any[])[0]?.count, 0);
    if (count <= 10000) return;

    const toRemove = count - 5000;
    const [oldRows] = await this.pool.query(`
      SELECT id
      FROM messages
      ORDER BY timestamp ASC, id ASC
      LIMIT ?
    `, [toRemove]);
    const ids = (oldRows as any[]).map(row => row.id);
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    await this.pool.execute(`DELETE FROM messages WHERE id IN (${placeholders})`, ids);
  }

  async getMessages(topic: string, limit: number = 100, before?: number): Promise<DBMessage[]> {
    const safeLimit = Math.max(0, limit);
    let rows: any[];
    if (before === undefined) {
      const [result] = await this.pool.execute(`
        SELECT id, topic, from_agent, content, timestamp
        FROM messages
        WHERE topic = ?
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      `, [topic, safeLimit]);
      rows = result as any[];
    } else {
      const [result] = await this.pool.execute(`
        SELECT id, topic, from_agent, content, timestamp
        FROM messages
        WHERE topic = ? AND timestamp < ?
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      `, [topic, before, safeLimit]);
      rows = result as any[];
    }
    return rows.map(mapMessageRow);
  }

  async setMemory(key: string, value: string, updatedBy: string, tags: string[] = [], ttl: number = 0): Promise<void> {
    const conn = await this.pool.getConnection();
    const now = Date.now();
    const expireAt = ttl > 0 ? now + ttl * 1000 : 0;

    try {
      await conn.beginTransaction();

      const [existingRows] = await conn.execute(`
        SELECT \`key\`, value, tags, ttl, expire_at, updated_at, updated_by
        FROM memory
        WHERE \`key\` = ?
        FOR UPDATE
      `, [key]);
      const existing = (existingRows as any[])[0];

      if (existing) {
        const [versionRows] = await conn.execute(`
          SELECT COALESCE(MAX(version), 0) AS maxVersion
          FROM memory_versions
          WHERE \`key\` = ?
          FOR UPDATE
        `, [key]);
        const nextVersion = asNumber((versionRows as any[])[0]?.maxVersion, 0) + 1;

        await conn.execute(`
          INSERT INTO memory_versions (\`key\`, value, version, tags, ttl, expire_at, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          key,
          existing.value,
          nextVersion,
          existing.tags,
          asNumber(existing.ttl, 0),
          asNumber(existing.expire_at, 0),
          asNumber(existing.updated_at, 0),
          existing.updated_by,
        ]);

        await conn.execute(`
          UPDATE memory
          SET value = ?, tags = ?, ttl = ?, expire_at = ?, updated_at = ?, updated_by = ?
          WHERE \`key\` = ?
        `, [
          value,
          serializeTags(tags),
          ttl,
          expireAt,
          now,
          updatedBy,
          key,
        ]);
      } else {
        await conn.execute(`
          INSERT INTO memory (\`key\`, value, tags, ttl, expire_at, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          key,
          value,
          serializeTags(tags),
          ttl,
          expireAt,
          now,
          updatedBy,
        ]);
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async getMemory(key: string): Promise<DBMemory | undefined> {
    const [rows] = await this.pool.execute(`
      SELECT \`key\`, value, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      WHERE \`key\` = ?
    `, [key]);
    const row = (rows as any[])[0];
    if (!row) return undefined;

    const mem = mapMemoryRow(row);
    if (mem.expireAt > 0 && mem.expireAt < Date.now()) {
      await this.deleteMemory(key);
      return undefined;
    }
    return mem;
  }

  async deleteMemory(key: string): Promise<boolean> {
    const [result]: any = await this.pool.execute('DELETE FROM memory WHERE `key` = ?', [key]);
    return asNumber(result?.affectedRows, 0) > 0;
  }

  async getAllMemory(): Promise<DBMemory[]> {
    await this.cleanupExpired();
    const [rows] = await this.pool.query(`
      SELECT \`key\`, value, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      ORDER BY updated_at DESC, \`key\` ASC
    `);
    return (rows as any[]).map(mapMemoryRow);
  }

  async getMemoryVersions(key: string): Promise<DBMemoryVersion[]> {
    const [rows] = await this.pool.execute(`
      SELECT \`key\`, value, version, tags, ttl, expire_at, updated_at, updated_by
      FROM memory_versions
      WHERE \`key\` = ?
      ORDER BY version DESC
    `, [key]);
    return (rows as any[]).map(mapMemoryVersionRow);
  }

  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const [result]: any = await this.pool.execute(`
      DELETE FROM memory
      WHERE expire_at > 0 AND expire_at < ?
    `, [now]);
    return asNumber(result?.affectedRows, 0);
  }

  async getTopicStats(): Promise<{ name: string; messageCount: number; createdAt: number }[]> {
    const [rows] = await this.pool.query(`
      SELECT topic AS name, COUNT(*) AS messageCount, MIN(timestamp) AS createdAt
      FROM messages
      GROUP BY topic
      ORDER BY MIN(timestamp) ASC, topic ASC
    `);
    return (rows as any[]).map(row => ({
      name: row.name,
      messageCount: asNumber(row.messageCount, 0),
      createdAt: asNumber(row.createdAt, 0),
    }));
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }

  // ─── Sessions ────────────────────────────────────────────────────────────

  async setSession(session: DBSession): Promise<void> {
    await this.pool.execute(`
      INSERT INTO sessions
        (id, agent_id, framework, started_at, ended_at, transcript, summary, importance, access_count, last_accessed_at, tags, extracted, flagged, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        agent_id=VALUES(agent_id), framework=VALUES(framework), started_at=VALUES(started_at),
        ended_at=VALUES(ended_at), transcript=VALUES(transcript), summary=VALUES(summary),
        importance=VALUES(importance), access_count=VALUES(access_count),
        last_accessed_at=VALUES(last_accessed_at), tags=VALUES(tags),
        extracted=VALUES(extracted), flagged=VALUES(flagged)
    `, [
      session.id, session.agentId, session.framework, session.startedAt,
      session.endedAt ?? null, session.transcript, session.summary ?? null,
      session.importance, session.accessCount, session.lastAccessedAt ?? null,
      JSON.stringify(session.tags), session.extracted ? 1 : 0, session.flagged ? 1 : 0,
      session.createdAt
    ]);
  }

  async getSession(id: string): Promise<DBSession | undefined> {
    const [rows] = await this.pool.execute(`SELECT * FROM sessions WHERE id = ?`, [id]);
    const row = (rows as any[])[0];
    return row ? this.mapSessionRow(row) : undefined;
  }

  async getAllSessions(agentId?: string, framework?: string, limit = 50, offset = 0): Promise<DBSession[]> {
    let sql = 'SELECT * FROM sessions';
    const params: any[] = [];
    if (agentId) { sql += ' WHERE agent_id = ?'; params.push(agentId); }
    if (framework) { sql += (agentId ? ' AND' : ' WHERE') + ' framework = ?'; params.push(framework); }
    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const [rows] = await this.pool.query(sql, params);
    return (rows as any[]).map(r => this.mapSessionRow(r));
  }

  async deleteSession(id: string): Promise<boolean> {
    const [result]: any = await this.pool.execute(`DELETE FROM sessions WHERE id = ?`, [id]);
    return (result?.affectedRows ?? 0) > 0;
  }

  async sessionSearch(query: string, limit = 20): Promise<DBSession[]> {
    const [rows] = await this.pool.query(`
      SELECT * FROM sessions WHERE transcript LIKE ? OR summary LIKE ?
      ORDER BY started_at DESC LIMIT ?
    `, [`%${query}%`, `%${query}%`, limit]);
    return (rows as any[]).map(r => this.mapSessionRow(r));
  }

  private mapSessionRow(row: any): DBSession {
    return {
      id: row.id, agentId: row.agent_id, framework: row.framework,
      startedAt: row.started_at, endedAt: row.ended_at ?? undefined,
      transcript: row.transcript, summary: row.summary ?? undefined,
      importance: row.importance, accessCount: Number(row.access_count),
      lastAccessedAt: row.last_accessed_at ?? undefined,
      tags: JSON.parse(row.tags || '[]'),
      extracted: !!row.extracted, flagged: !!row.flagged,
      createdAt: row.created_at,
    };
  }

  async addToExtractionQueue(sessionId: string, priority = 0): Promise<void> {
    await this.pool.execute(`INSERT INTO extraction_queue (session_id, queued_at, priority, status, retry_count) VALUES (?, ?, ?, 'pending', 0) ON DUPLICATE KEY UPDATE queued_at=VALUES(queued_at), priority=VALUES(priority)`, [sessionId, Date.now(), priority]);
  }

  async getExtractionQueue(limit = 10): Promise<ExtractionQueueEntry[]> {
    const [rows] = await this.pool.query(`SELECT * FROM extraction_queue ORDER BY priority DESC, queued_at ASC LIMIT ?`, [limit]);
    return (rows as any[]).map(r => ({ sessionId: r.session_id, queuedAt: Number(r.queued_at), priority: Number(r.priority), status: r.status, retryCount: Number(r.retry_count) }));
  }

  async updateExtractionQueueStatus(sessionId: string, status: string): Promise<void> {
    await this.pool.execute(`UPDATE extraction_queue SET status = ? WHERE session_id = ?`, [status, sessionId]);
  }

  async removeFromExtractionQueue(sessionId: string): Promise<void> {
    await this.pool.execute(`DELETE FROM extraction_queue WHERE session_id = ?`, [sessionId]);
  }

  async addSessionFeedback(sessionId: string, agentId: string, adjustment: number, reason?: string): Promise<void> {
    await this.pool.execute(`INSERT INTO session_feedback (session_id, agent_id, adjustment, reason, created_at) VALUES (?, ?, ?, ?, ?)`, [sessionId, agentId, adjustment, reason ?? null, Date.now()]);
  }

  async getSessionFeedbackHistory(sessionId: string): Promise<DBSessionFeedback[]> {
    const [rows] = await this.pool.query(`SELECT * FROM session_feedback WHERE session_id = ? ORDER BY created_at DESC`, [sessionId]);
    return (rows as any[]).map(r => ({ sessionId: r.session_id, agentId: r.agent_id, adjustment: Number(r.adjustment), reason: r.reason, createdAt: Number(r.created_at) }));
  }

  async addMemoryFeedback(key: string, agentId: string, adjustment: number, reason?: string): Promise<void> {
    await this.pool.execute(`INSERT INTO memory_feedback (key, agent_id, adjustment, reason, created_at) VALUES (?, ?, ?, ?, ?)`, [key, agentId, adjustment, reason ?? null, Date.now()]);
  }

  async getMemoryFeedbackHistory(key: string): Promise<MemoryFeedback[]> {
    const [rows] = await this.pool.query(`SELECT * FROM memory_feedback WHERE key = ? ORDER BY created_at DESC`, [key]);
    return (rows as any[]).map(r => ({ key: r.key, agentId: r.agent_id, adjustment: Number(r.adjustment), reason: r.reason, createdAt: Number(r.created_at) }));
  }

  async getEvictionCandidates(memoryThreshold: number, sessionThreshold: number, limit: number): Promise<{
    memories: Array<{key: string; importance: number; lastAccessedAt: number; accessCount: number}>;
    sessions: Array<{id: string; importance: number; lastAccessedAt: number; accessCount: number}>;
  }> {
    const now = Date.now();
    const RECENCY_WINDOW = 90 * 24 * 60 * 60 * 1000;
    const [memRows]: any = await this.pool.query(`
      SELECT m.key, COALESCE(m.importance_score, 5.0) + COALESCE(SUM(f.adjustment), 0) AS importance,
             COALESCE(m.last_accessed_at, m.updated_at) AS last_accessed_at,
             COALESCE(m.access_count, 0) AS access_count
      FROM memory m
      LEFT JOIN memory_feedback f ON m.key = f.key
      GROUP BY m.key
      HAVING importance < ?
      ORDER BY (importance * 0.5) + ((1.0 - LEAST((COALESCE(m.last_accessed_at, m.updated_at) - ?), ?)) / ? * 0.3) + (LOG10(COALESCE(m.access_count, 0) + 1) / 2.0 * 0.2) ASC
      LIMIT ?
    `, [memoryThreshold, now, RECENCY_WINDOW, RECENCY_WINDOW, limit]);
    const [sessRows]: any = await this.pool.query(`
      SELECT id, importance, COALESCE(last_accessed_at, ended_at, created_at) as last_accessed_at, access_count
      FROM sessions WHERE importance < ?
      ORDER BY (importance * 0.5) + ((1.0 - LEAST((COALESCE(last_accessed_at, ended_at, created_at) - ?), ?)) / ? * 0.3) + (LOG10(access_count + 1) / 2.0 * 0.2) ASC
      LIMIT ?
    `, [sessionThreshold, now, RECENCY_WINDOW, RECENCY_WINDOW, limit]);
    return {
      memories: (memRows as any[]).map(r => ({ key: r.key, importance: r.importance, lastAccessedAt: Number(r.last_accessed_at), accessCount: Number(r.access_count) })),
      sessions: (sessRows as any[]).map(r => ({ id: r.id, importance: r.importance, lastAccessedAt: Number(r.last_accessed_at), accessCount: Number(r.access_count) })),
    };
  }
}
