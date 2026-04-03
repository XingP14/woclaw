import { ClawDB } from './db.js';
import { DBMemory, DBMemoryVersion, OutboundMessage } from './types.js';

// Semantic Recall - Option A: Keyword + Scoring (no external deps)
// Stop words to filter from queries
const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','must','shall','can','need','dare','ought','used',
  'to','of','in','for','on','with','at','by','from','as','into',
  'through','during','before','after','above','below','between','under',
  'again','further','then','once','here','there','when','where','why','how',
  'all','each','every','both','few','more','most','other','some','such',
  'no','nor','not','only','own','same','so','than','too','very','just',
  'also','now','and','but','or','yet','i','me','my','myself','we','our',
  'ours','ourselves','you','your','yours','yourself','yourselves',
  'he','him','his','himself','she','her','hers','herself','it','its',
  'itself','they','them','their','theirs','themselves','what','which',
  'who','whom','this','that','these','those','am','im',
]);

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

export class MemoryPool {
  private db: ClawDB;
  private subscribers: Map<string, (msg: OutboundMessage) => void> = new Map();

  constructor(db: ClawDB) {
    this.db = db;
  }

  write(key: string, value: any, updatedBy: string, tags: string[] = [], ttl: number = 0): DBMemory {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    this.db.setMemory(key, serialized, updatedBy, tags, ttl);
    const mem = this.db.getMemory(key)!;
    this.notifySubscribers({ type: 'memory_write', key, value: serialized, updatedBy });
    return mem;
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

  // v0.4: query memory by tag
  queryByTag(tag: string): DBMemory[] {
    return this.getAll().filter(m => m.tags.includes(tag));
  }

  // v0.4: Memory Versioning - get all historical versions for a key
  getVersions(key: string): DBMemoryVersion[] {
    return this.db.getMemoryVersions(key);
  }

  // v0.4: Semantic Recall - keyword + scoring approach
  recall(query: string, intent?: string, limit: number = 10): DBMemory[] {
    const keywords = tokenize(query);
    if (keywords.length === 0) return [];

    const all = this.getAll();

    // Score each entry
    const scored = all.map(mem => {
      let score = 0;
      const memText = (mem.value + ' ' + mem.key).toLowerCase();
      const memTokens = tokenize(mem.value + ' ' + mem.key);

      // Keyword match scoring
      for (const kw of keywords) {
        // Exact substring match in value+key (weight 1)
        if (memText.includes(kw)) score += 1;
        // Word token match (weight 2)
        if (memTokens.some(t => t.includes(kw) || kw.includes(t))) score += 2;
        // Tag match (weight 3)
        if (mem.tags.some(t => t.toLowerCase().includes(kw))) score += 3;
      }

      // Intent matching: boost entries with matching tags
      if (intent) {
        const intentTokens = tokenize(intent);
        for (const it of intentTokens) {
          if (mem.tags.some(t => t.toLowerCase().includes(it))) score += 5;
        }
      }

      // Recency boost: entries updated in last 24h get +1
      const dayAgo = Date.now() - 86400000;
      if (mem.updatedAt > dayAgo) score += 1;

      return { mem, score };
    });

    // Sort by score desc, then by updatedAt desc as tiebreaker
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.mem.updatedAt - a.mem.updatedAt;
    });

    return scored
      .filter(s => s.score > 0)
      .slice(0, limit)
      .map(s => s.mem);
  }

  cleanupExpired(): number {
    return this.db.cleanupExpired();
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
