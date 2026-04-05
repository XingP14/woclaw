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
    `);

    await this.maybeImportLegacyData();
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
}
