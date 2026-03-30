// ClawLink Database - Simple JSON File Store
// No native compilation required!

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { DBMessage, DBMemory } from './types.js';

export class ClawDB {
  private dbPath: string;
  private data: {
    messages: DBMessage[];
    memory: { key: string; value: string; updatedAt: number; updatedBy: string }[];
    topics: { name: string; createdAt: number; messageCount: number }[];
  };

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.dbPath = `${dataDir}/clawlink.json`;
    this.data = this.load();
  }

  private load() {
    if (existsSync(this.dbPath)) {
      try {
        return JSON.parse(readFileSync(this.dbPath, 'utf-8'));
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
  setMemory(key: string, value: string, updatedBy: string): void {
    const existing = this.data.memory.find(m => m.key === key);
    if (existing) {
      existing.value = value;
      existing.updatedAt = Date.now();
      existing.updatedBy = updatedBy;
    } else {
      this.data.memory.push({ key, value, updatedAt: Date.now(), updatedBy });
    }
    this.save();
  }

  getMemory(key: string): DBMemory | undefined {
    const m = this.data.memory.find(mem => mem.key === key);
    if (!m) return undefined;
    return {
      key: m.key,
      value: m.value,
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
    return this.data.memory.map(m => ({
      key: m.key,
      value: m.value,
      updatedAt: m.updatedAt,
      updatedBy: m.updatedBy,
    }));
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
