import { ClawDB } from './db.js';
import { DBMemory, OutboundMessage } from './types.js';

export class MemoryPool {
  private db: ClawDB;
  private subscribers: Map<string, (msg: OutboundMessage) => void> = new Map();

  constructor(db: ClawDB) {
    this.db = db;
  }

  write(key: string, value: any, updatedBy: string): DBMemory {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    this.db.setMemory(key, serialized, updatedBy);
    return this.db.getMemory(key)!;
  }

  read(key: string): DBMemory | undefined {
    return this.db.getMemory(key);
  }

  delete(key: string): boolean {
    return this.db.deleteMemory(key);
  }

  getAll(): DBMemory[] {
    return this.db.getAllMemory();
  }

  // For agents that want to subscribe to memory changes
  subscribe(agentId: string, callback: (msg: OutboundMessage) => void): void {
    this.subscribers.set(agentId, callback);
  }

  unsubscribe(agentId: string): void {
    this.subscribers.delete(agentId);
  }

  notifySubscribers(message: OutboundMessage): void {
    for (const callback of this.subscribers.values()) {
      try {
        callback(message);
      } catch (e) {
        console.error('Error notifying subscriber:', e);
      }
    }
  }
}
