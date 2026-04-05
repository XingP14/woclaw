// Type declarations for ws module
// This file provides TypeScript types for the ws package

export class WebSocket {
  constructor(address: string, options?: any);
  send(data: any, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: any[]) => void): void;
  once(event: string, listener: (...args: any[]) => void): void;
  removeListener(event: string, listener: (...args: any[]) => void): void;
  removeAllListeners(event?: string): void;
  readyState: number;
  static OPEN: number;
  static CLOSED: number;
  static CONNECTING: number;
  static CLOSING: number;
}

export class WebSocketServer {
  constructor(options?: any);
  on(event: string, listener: (...args: any[]) => void): void;
  close(cb?: () => void): void;
  address(): { port: number; family: string; address: string } | null;
}

export function createWebSocketStream(ws: WebSocket, options?: any): any;

export const WebSocketShard: {
  OPEN: number;
  CLOSED: number;
};
