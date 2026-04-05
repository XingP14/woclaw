import { ClawDB } from './db.js';
import { DBMemory, DBMemoryVersion, OutboundMessage } from './types.js';

// v1.0: Deduplication — write result with conflict detection
export interface WriteResult {
  mem: DBMemory;
  duplicate: boolean;   // true if key existed with identical value
  conflict: boolean;     // true if key existed with different value
  previousValue?: any;   // previous value if duplicate or conflict
  previousUpdatedAt?: number;
  previousUpdatedBy?: string;
}

// Semantic Recall - Option A: Keyword + Scoring (no external deps)
// Stop words to filter from queries
// Simple text similarity: Jaccard index on word bigrams (no external deps)
// Returns score from 0 (no similarity) to ~1 (very similar)
function computeTextSimilarity(query: string, text: string): number {
  const tokenize = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));

  const qTokens = tokenize(query);
  const tTokens = tokenize(text);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;

  // Bigram set for better semantic matching
  const bigrams = (tokens: string[]) => {
    const set = new Set<string>();
    for (let i = 0; i < tokens.length - 1; i++) set.add(tokens[i] + '|' + tokens[i + 1]);
    return set;
  };

  const qBigrams = bigrams(qTokens);
  const tBigrams = bigrams(tTokens);

  let intersection = 0;
  for (const bg of qBigrams) if (tBigrams.has(bg)) intersection++;
  if (intersection === 0) return 0;

  const union = qBigrams.size + tBigrams.size - intersection;
  return intersection / union;
}

const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','am',
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

function normalizeScope(scope?: string): 'all' | 'workspace' | 'session' {
  if (scope === 'workspace' || scope === 'session') return scope;
  return 'all';
}

function extractTitle(mem: DBMemory): string {
  const titleFromKey = mem.key
    .split(':')
    .pop()
    ?.replace(/[._-]+/g, ' ')
    .trim();

  const firstLine = mem.value
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0);

  if (firstLine) {
    const heading = firstLine.match(/^#{1,6}\s+(.+)$/);
    if (heading?.[1]) {
      const candidate = heading[1].trim();
      if (
        !candidate.toLowerCase().includes('openclaw workspace memory') &&
        !candidate.toLowerCase().includes('openclaw session store')
      ) {
        return candidate;
      }
    }
  }

  return titleFromKey || mem.key;
}

function extractSearchBody(value: string): string {
  const lines = value.split('\n');
  const blankIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '');
  if (blankIndex < 0) return value;
  const body = lines.slice(blankIndex + 1).join('\n').trim();
  return body || value;
}

function isVisibleInScope(mem: DBMemory, scope: 'all' | 'workspace' | 'session'): boolean {
  if (scope === 'all') return true;
  const key = mem.key.toLowerCase();
  if (scope === 'workspace') {
    return key.includes('openclaw:workspace:') || mem.tags.some(tag => tag.toLowerCase().includes('workspace'));
  }
  return key.includes('openclaw:session:') || mem.tags.some(tag => tag.toLowerCase().includes('session'));
}

export class MemoryPool {
  private db: ClawDB;
  private subscribers: Map<string, (msg: OutboundMessage) => void> = new Map();
  // v1.0: optional GraphStore for auto-linking memory → graph edges
  public graphStore: import('./graph/store.js').GraphStore | null = null;

  constructor(db: ClawDB) {
    this.db = db;
  }

  // v1.0: Deduplication — check for existing value before writing
  async write(key: string, value: any, updatedBy: string, tags: string[] = [], ttl: number = 0): Promise<WriteResult> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const existing = await this.db.getMemory(key);
    const duplicate = !!existing && existing.value === serialized;
    const conflict = !!existing && existing.value !== serialized;
    const previousValue = (duplicate || conflict) ? existing.value : undefined;
    const previousUpdatedAt = (duplicate || conflict) ? existing.updatedAt : undefined;
    const previousUpdatedBy = (duplicate || conflict) ? existing.updatedBy : undefined;

    await this.db.setMemory(key, serialized, updatedBy, tags, ttl);
    const mem = (await this.db.getMemory(key))!;
    // Skip notification for duplicate writes (no actual change)
    if (!duplicate) {
      this.notifySubscribers({ type: 'memory_write', key, value: serialized, updatedBy });
    }

    // v1.0: Auto-create graph edges for this memory
    if (this.graphStore) {
      const memNode = this.graphStore.syncMemoryNode(key, serialized, updatedBy, tags);
      // Auto-link semantically similar memories
      const similar = this.graphStore.findSimilarMemories(memNode.id, 0.5);
      for (const sim of similar) {
        try {
          this.graphStore.addEdge({
            source: memNode.id,
            target: sim.id,
            type: 'semantic',
            weight: 0.5,
            metadata: { auto: true, via: 'memory-write' },
          });
        } catch { /* edge may already exist */ }
      }
    }

    return { mem, duplicate, conflict, previousValue, previousUpdatedAt, previousUpdatedBy };
  }

  async read(key: string): Promise<DBMemory | undefined> {
    return this.db.getMemory(key);
  }

  async delete(key: string): Promise<boolean> {
    return this.db.deleteMemory(key);
  }

  async getAll(): Promise<DBMemory[]> {
    return this.db.getAllMemory();
  }

  // v0.4: query memory by tag
  async queryByTag(tag: string): Promise<DBMemory[]> {
    return (await this.getAll()).filter(m => m.tags.includes(tag));
  }

  async search(query: string, limit: number = 10, scope: string = 'all'): Promise<DBMemory[]> {
    const rawQuery = query.trim().toLowerCase();
    const keywords = tokenize(query);
    if (keywords.length === 0 && rawQuery.length === 0) return [];

    const normalizedScope = normalizeScope(scope);
    const all = (await this.getAll()).filter(mem => isVisibleInScope(mem, normalizedScope));

    const scored = all.map(mem => {
      const title = extractTitle(mem);
      const body = extractSearchBody(mem.value).toLowerCase();
      const key = mem.key.toLowerCase();
      const lowerTitle = title.toLowerCase();
      const lowerTags = mem.tags.map(tag => tag.toLowerCase());
      const keyTokens = tokenize(mem.key);
      const titleTokens = tokenize(title);
      const tagTokens = mem.tags.flatMap(tag => tokenize(tag));
      let score = 0;

      if (rawQuery.length > 0 && body.includes(rawQuery)) {
        score += 3;
      }
      if (rawQuery.length > 0) {
        if (key.includes(rawQuery)) score += 2;
        if (lowerTitle.includes(rawQuery)) score += 2;
        if (lowerTags.some(tag => tag.includes(rawQuery))) score += 1;
      }

      for (const kw of keywords) {
        if (key === kw) score += 6;
        if (keyTokens.includes(kw)) score += 5;
        if (titleTokens.includes(kw)) score += 4;
        if (lowerTags.some(tag => tag === kw)) score += 4;
        if (tagTokens.includes(kw)) score += 3;
        if (key.includes(kw)) score += 2;
        if (lowerTitle.includes(kw)) score += 2;
        if (lowerTags.some(tag => tag.includes(kw))) score += 1;
        if (body.includes(kw)) score += 3;
      }

      const phrase = keywords.join(' ');
      if (phrase.length > 0) {
        const keyTitle = `${key} ${lowerTitle}`;
        if (keyTitle.includes(phrase)) score += 3;
        if (body.includes(phrase)) score += 1;
      }

      return { mem, score };
    });

    return scored
      .filter(entry => entry.score >= 3)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.mem.updatedAt - a.mem.updatedAt;
      })
      .slice(0, limit)
      .map(entry => entry.mem);
  }

  // v0.4: Memory Versioning - get all historical versions for a key
  async getVersions(key: string): Promise<DBMemoryVersion[]> {
    return this.db.getMemoryVersions(key);
  }

  // v0.4: Semantic Recall - keyword + scoring approach
  async recall(query: string, intent?: string, limit: number = 10): Promise<DBMemory[]> {
    const keywords = tokenize(query);
    if (keywords.length === 0) return [];

    const all = await this.getAll();

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

      // Semantic similarity boost: results similar to query score above threshold
      const textForSim = (mem.value + ' ' + mem.key + ' ' + mem.tags.join(' '));
      const similarity = computeTextSimilarity(query, textForSim);
      if (similarity > 0.15) score += Math.round(similarity * 10);

      // Recency boost: entries updated in last 24h get +1 (tiebreaker only)
      const dayAgo = Date.now() - 86400000;
      const recencyBoost = mem.updatedAt > dayAgo ? 1 : 0;

      return { mem, score, recencyBoost };
    });

    // Sort by score desc, then by recency desc as tiebreaker
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.recencyBoost - a.recencyBoost;
    });

    return scored
      .filter(s => s.score > 0)
      .slice(0, limit)
      .map(s => s.mem);
  }

  // v1.0: Semantic Recall - pure text similarity search (Jaccard)
  async recallByText(query: string, limit: number = 10): Promise<DBMemory[]> {
    const all = await this.getAll();
    if (all.length === 0) return [];
    const qTokens = new Set(query.toLowerCase().split(/[\s\W_]+/).filter((w: string) => w.length > 2));
    const scored = all.map((mem: any) => {
      const mTokens = new Set((mem.key + ' ' + mem.value).toLowerCase().split(/[\s\W_]+/).filter((w: string) => w.length > 2));
      if (qTokens.size === 0 || mTokens.size === 0) return { mem, score: 0 };
      const inter = new Set([...qTokens].filter((w: string) => mTokens.has(w)));
      const union = new Set([...qTokens, ...mTokens]);
      return { mem, score: inter.size / union.size };
    });
    scored.sort((a: any, b: any) => b.score - a.score);
    return scored.slice(0, limit).map((s: any) => s.mem);
  }

  async cleanupExpired(): Promise<number> {
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
