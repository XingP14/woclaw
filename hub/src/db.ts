// WoClaw Database - Simple JSON File Store
// No native compilation required!

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { DBMessage, DBMemory } from './types.js';

export class ClawDB {
  private dbPath: string;
  private data: {
    messages: DBMessage[];
    memory: { key: string; value: string; tags: string[]; ttl: number; expireAt: number; updatedAt: number; updatedBy: string }[];
    topics: { name: string; createdAt: number; messageCount: number }[];
  };

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = `${dataDir}/woclaw.json`;
    this.data = this.load();
  }

  private load() {
    if (existsSync(this.dbPath)) {
      try {
        const data = JSON.parse(readFileSync(this.dbPath, 'utf-8'));
        // v0.4 migration: add tags/ttl/expireAt to legacy memory entries
        if (data.memory && Array.isArray(data.memory)) {
          for (const m of data.memory) {
            if (m.tags === undefined) m.tags = [];
            if (m.ttl === undefined) m.ttl = 0;
            if (m.expireAt === undefined) m.expireAt = 0;
          }
        }
        return data;
      } catch (e) {
        console.error('[ClawDB] Failed to load DB, starting fresh');
      }
    }
    return {
      messages: [],
      memory: [],
      topics: [],
    };
  }

  private save() {
    try {
      writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('[ClawDB] Failed to save:', e);
    }
  }

  // Messages
  saveMessage(msg: DBMessage): void {
    this.data.messages.push(msg);
    // Keep last 1000 messages per topic (simple cleanup)
    if (this.data.messages.length > 10000) {
      this.data.messages = this.data.messages.slice(-5000);
    }
    
    // Update topic stats
    const topic = this.data.topics.find(t => t.name === msg.topic);
    if (topic) {
      topic.messageCount++;
    } else {
      this.data.topics.push({ name: msg.topic, createdAt: Date.now(), messageCount: 1 });
    }
    this.save();
  }

  getMessages(topic: string, limit: number = 100, before?: number): DBMessage[] {
    let msgs = this.data.messages.filter(m => m.topic === topic);
    if (before) {
      msgs = msgs.filter(m => m.timestamp < before);
    }
    return msgs.slice(-limit).reverse();
  }

  // Memory
  setMemory(key: string, value: string, updatedBy: string, tags: string[] = [], ttl: number = 0): void {
    const now = Date.now();
    const expireAt = ttl > 0 ? now + ttl * 1000 : 0;
    const existing = this.data.memory.find(m => m.key === key);
    if (existing) {
      existing.value = value;
      existing.tags = tags;
      existing.ttl = ttl;
      existing.expireAt = expireAt;
      existing.updatedAt = now;
      existing.updatedBy = updatedBy;
    } else {
      this.data.memory.push({ key, value, tags, ttl, expireAt, updatedAt: now, updatedBy });
    }
    this.save();
  }

  getMemory(key: string): DBMemory | undefined {
    const m = this.data.memory.find(mem => mem.key === key);
    if (!m) return undefined;
    const now = Date.now();
    if (m.expireAt > 0 && m.expireAt < now) {
      // Expired — remove it
      this.deleteMemory(key);
      return undefined;
    }
    return {
      key: m.key,
      value: m.value,
      tags: m.tags,
      ttl: m.ttl,
      expireAt: m.expireAt,
      updatedAt: m.updatedAt,
      updatedBy: m.updatedBy,
    };
  }

  deleteMemory(key: string): boolean {
    const idx = this.data.memory.findIndex(m => m.key === key);
    if (idx >= 0) {
      this.data.memory.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  getAllMemory(): DBMemory[] {
    const now = Date.now();
    const valid: DBMemory[] = [];
    const expired: string[] = [];
    for (const m of this.data.memory) {
      if (m.expireAt > 0 && m.expireAt < now) {
        expired.push(m.key);
      } else {
        valid.push({
          key: m.key,
          value: m.value,
          tags: m.tags,
          ttl: m.ttl,
          expireAt: m.expireAt,
          updatedAt: m.updatedAt,
          updatedBy: m.updatedBy,
        });
      }
    }
    // Remove expired silently
    if (expired.length > 0) {
      this.data.memory = this.data.memory.filter(m => !expired.includes(m.key));
      this.save();
    }
    return valid;
  }

  cleanupExpired(): number {
    const now = Date.now();
    const before = this.data.memory.length;
    this.data.memory = this.data.memory.filter(m => m.expireAt === 0 || m.expireAt >= now);
    const removed = before - this.data.memory.length;
    if (removed > 0) this.save();
    return removed;
  }

  // Topics
  getTopicStats(): { name: string; messageCount: number; createdAt: number }[] {
    return this.data.topics.map(t => ({
      name: t.name,
      messageCount: t.messageCount,
      createdAt: t.createdAt,
    }));
  }

  close(): void {
    this.save();
  }
}
