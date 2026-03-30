// ClawLink Type Definitions

export interface Config {
  port: number;
  restPort: number;
  host: string;
  dataDir: string;
  authToken: string;
}

export interface Agent {
  agentId: string;
  ws: WebSocket;
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
  type: 'message' | 'join' | 'leave' | 'memory_write' | 'memory_read' | 'topics_list' | 'topic_members' | 'ping';
  topic?: string;
  content?: string;
  key?: string;
  value?: any;
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
  updatedAt: number;
  updatedBy: string;
}
