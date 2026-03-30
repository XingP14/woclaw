import BetterSqlite3 from 'better-sqlite3';
import { DBMessage, DBMemory } from './types.js';
import { existsSync, mkdirSync } from 'fs';

export class ClawDB {
  private db: BetterSqlite3.Database;
  private dbPath: string;

  constructor(dataDir: string) {
    this.dbPath = `${dataDir}/clawlink.db`;
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.db = new BetterSqlite3(this.dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      
      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS topics (
        name TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0
      );
    `);
  }

  saveMessage(msg: DBMessage): void {
    const stmt = this.db.prepare(
      'INSERT INTO messages (id, topic, from_agent, content, timestamp) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run(msg.id, msg.topic, msg.from, msg.content, msg.timestamp);
    
    const upsertTopic = this.db.prepare(
      `INSERT INTO topics (name, created_at, message_count) VALUES (?, ?, 1)
       ON CONFLICT(name) DO UPDATE SET message_count = message_count + 1`
    );
    upsertTopic.run(msg.topic, Date.now());
  }

  getMessages(topic: string, limit: number = 100, before?: number): DBMessage[] {
    let query = 'SELECT id, topic, from_agent as from, content, timestamp FROM messages WHERE topic = ?';
    const params: (string | number)[] = [topic];
    
    if (before) {
      query += ' AND timestamp < ?';
      params.push(before);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params) as DBMessage[];
  }

  setMemory(key: string, value: string, updatedBy: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO memory (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    );
    stmt.run(key, value, Date.now(), updatedBy);
  }

  getMemory(key: string): DBMemory | undefined {
    const stmt = this.db.prepare(
      'SELECT key, value, updated_at as updatedAt, updated_by as updatedBy FROM memory WHERE key = ?'
    );
    return stmt.get(key) as DBMemory | undefined;
  }

  deleteMemory(key: string): boolean {
    const stmt = this.db.prepare('DELETE FROM memory WHERE key = ?');
    const result = stmt.run(key);
    return result.changes > 0;
  }

  getAllMemory(): DBMemory[] {
    const stmt = this.db.prepare(
      'SELECT key, value, updated_at as updatedAt, updated_by as updatedBy FROM memory ORDER BY updated_at DESC'
    );
    return stmt.all() as DBMemory[];
  }

  getTopicStats(): { name: string; messageCount: number; createdAt: number }[] {
    const stmt = this.db.prepare('SELECT name, message_count as messageCount, created_at as createdAt FROM topics ORDER BY message_count DESC');
    return stmt.all() as { name: string; messageCount: number; createdAt: number }[];
  }

  close(): void {
    this.db.close();
  }
}
