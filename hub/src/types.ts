// WoClaw Type Definitions

export interface Config {
  port: number;
  restPort: number;
  host: string;
  dataDir: string;
  authToken: string;
  tlsKey?: string;   // TLS key file path (enables wss://)
  tlsCert?: string;  // TLS cert file path (enables wss://)
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

// Config defaults (can be overridden via env)
export const DEFAULT_RATE_LIMIT_MESSAGES = 100;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000;
