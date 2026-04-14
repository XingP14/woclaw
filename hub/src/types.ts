// WoClaw Type Definitions

export interface Config {
  port: number;
  restPort: number;
  host: string;
  dataDir: string;
  storage?: StorageConfig;
  authToken: string;
  nextAuthToken?: string;   // v1.0: Token rotation — new token during grace period
  tokenGracePeriodMs?: number;  // v1.0: Grace period before old token expires (default: 5min)
  tlsKey?: string;   // TLS key file path (enables wss://)
  tlsCert?: string;  // TLS cert file path (enables wss://)
  // v1.0: Multi-Hub Federation
  hubId?: string;          // Unique ID for this hub (auto-generated if not set)
  federationPeers?: FederationPeer[];  // List of peer hubs to connect to
  federationPingIntervalMs?: number;  // Ping interval for federation connections (default: 30s)
}

export interface StorageConfig {
  type?: 'sqlite' | 'mysql';
  sqlitePath?: string;
  mysql?: MySqlStorageConfig;
}

export interface MySqlStorageConfig {
  host: string;
  port?: number;
  user: string;
  password?: string;
  database: string;
  connectionLimit?: number;
}

export interface Agent<T = any> {
  agentId: string;
  ws: T;
  topics: Set<string>;
  connectedAt: number;
}

export interface Message {
  id: string;
  type: 'message' | 'join' | 'leave' | 'memory_write' | 'memory_read' | 'ping' | 'pong' | 'error';
  topic?: string;
  from?: string;
  content?: string;
  key?: string;
  value?: any;
  timestamp: number;
  raw?: any;
}

// Inbound messages from clients
export interface InboundMessage {
  type: 'message' | 'join' | 'leave' | 'memory_write' | 'memory_read' | 'topics_list' | 'topic_members' | 'ping' | 'pong'
       | 'delegate_request' | 'delegate_response' | 'delegate_progress' | 'delegate_result' | 'delegate_cancel';
  topic?: string;
  content?: string;
  key?: string;
  value?: any;
  tags?: string[];  // v0.4: optional tags for memory entries
  ttl?: number;    // v0.4: optional TTL in seconds (0 = no expiry)
  // delegation fields
  id?: string;
  task?: DelegationTask;
  toAgent?: string;
  status?: 'accepted' | 'rejected' | 'done' | 'failed';
  note?: string;
  progress?: number;
  message?: string;
  result?: any;
  error?: string;
  summary?: string;
  reason?: string;
}

// Outbound messages to clients
export interface OutboundMessage {
  type: string;
  [key: string]: any;
}

export interface Topic {
  name: string;
  agents: Set<string>;
  messageCount: number;
  createdAt: number;
  // v1.0: Private topics
  isPrivate: boolean;            // true = private (invite-only), false = public
  inviteToken?: string;          // one-time or time-limited invite token
  inviteExpiresAt?: number;      // Unix timestamp when invite token expires
  invitedAgents: Set<string>;    // agentIds that have been invited (can join with token)
}

export interface DBMessage {
  id: string;
  topic: string;
  from: string;
  content: string;
  timestamp: number;
}

export interface DBMemory {
  key: string;
  value: string;
  tags: string[];
  ttl: number;        // TTL in seconds, 0 = no expiry
  expireAt: number;   // Unix timestamp when this entry expires, 0 = no expiry
  updatedAt: number;
  updatedBy: string;
}

export interface DBMemoryVersion {
  key: string;
  value: string;
  version: number;
  tags: string[];
  ttl: number;
  expireAt: number;
  updatedAt: number;
  updatedBy: string;
}

// ─── v0.4: Delegation Types ────────────────────────────────────────────────

export type DelegationStatus =
  | 'requested'
  | 'accepted'
  | 'rejected'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface DelegationTask {
  description: string;
  payload?: any;
  priority?: 'low' | 'normal' | 'high';
}

export interface Delegation {
  id: string;
  fromAgent: string;
  toAgent: string;
  task: DelegationTask;
  topic?: string;         // optional topic for result broadcast
  status: DelegationStatus;
  progress: number;       // 0-100
  createdAt: number;
  updatedAt: number;
  acceptedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
  summary?: string;
  note?: string;          // accept/reject/cancel reason
}

// Inbound delegation messages from clients
export interface InboundDelegateRequest {
  type: 'delegate_request';
  id: string;
  task: DelegationTask;
  toAgent: string;
  topic?: string;
}

export interface InboundDelegateResponse {
  type: 'delegate_response';
  id: string;
  status: 'accepted' | 'rejected';
  note?: string;
}

export interface InboundDelegateProgress {
  type: 'delegate_progress';
  id: string;
  progress: number;
  message?: string;
}

export interface InboundDelegateResult {
  type: 'delegate_result';
  id: string;
  status: 'done' | 'failed';
  result?: any;
  error?: string;
  summary?: string;
}

export interface InboundDelegateCancel {
  type: 'delegate_cancel';
  id: string;
  reason?: string;
}

export type InboundDelegationMessage =
  | InboundDelegateRequest
  | InboundDelegateResponse
  | InboundDelegateProgress
  | InboundDelegateResult
  | InboundDelegateCancel;

// Extend InboundMessage to include delegation types
export type InboundMessageWithDelegation = InboundMessage | InboundDelegationMessage;

// ─── v1.0: Rate Limiting Types ──────────────────────────────────────────────

export interface RateLimitConfig {
  messages: number;    // max messages per window
  windowMs: number;     // window size in milliseconds
}

export interface RateLimitEntry {
  timestamps: number[]; // timestamps of recent messages within the window
}

export interface RateLimitStatus {
  agentId: string;
  limit: number;
  windowMs: number;
  currentCount: number;
  oldestTimestamp: number | null;
}

// v1.0: Session Store — episodic memory
export interface DBSession {
  id: string; agentId: string; framework: string;
  startedAt: number; endedAt?: number; transcript: string;
  summary?: string; importance: number; accessCount: number;
  lastAccessedAt?: number; tags: string[]; extracted: boolean; flagged: boolean; createdAt: number;
}
export interface DBSessionFeedback { sessionId: string; agentId: string; adjustment: number; reason?: string; createdAt: number; }
export interface ExtractionQueueEntry { sessionId: string; queuedAt: number; priority: number; status: 'pending'|'processing'|'done'|'failed'; retryCount: number; }
export interface ImportanceResult { score: number; labels?: string[]; reasoning?: string; }
export interface ExtractionResult { summary: string; keyDecisions: string[]; importantFacts: string[]; preferences: string[]; filesModified: string[]; topics: string[]; importanceScore: number; suggestedTags: string[]; }
export interface MemoryFeedback { key: string; agentId: string; adjustment: number; reason?: string; createdAt: number; }
export interface AIProviderConfig { provider: 'openai'|'anthropic'|'ollama'|'custom'; model?: string; apiKey?: string; baseUrl?: string; }
export interface ExtractionConfig { mode: 'sync'|'batch'; batchSize: number; batchIntervalMs: number; provider: AIProviderConfig; }
export interface ForgettingConfig { enabled: boolean; schedule: 'daily'|'weekly'|'manual'; timeOfDay?: string; dayOfWeek?: number; importanceThreshold: number; dryRun: boolean; maxEvictPerRun: number; }

// v1.0: Federation Types
export interface FederationPeer {
  hubId: string;
  wsUrl: string;
  federationToken: string;
  status: 'disconnected' | 'connecting' | 'connected';
  lastSeen: number;
  connectedAgents: number;
}

export interface FederationMessage {
  type: 'hub_info' | 'agent_message' | 'relay';
  fromHubId: string;
  toHubId: string;
  agentId?: string;
  payload?: any;
}

// Config defaults (can be overridden via env)
export const DEFAULT_RATE_LIMIT_MESSAGES = 100;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000;
