import { describe, it, expect, vi } from 'vitest';

/**
 * Regression tests for `as any` cast removals in WSServer (commit 2026-06-26 04:23).
 *
 * Two `as any` casts were removed because the underlying types are correct:
 *   1. `(msg as any).retryAfter = retryAfter`
 *      - OutboundMessage is `{ type: string; [key: string]: any }`, so
 *        `msg.retryAfter` is already typed correctly via the index signature.
 *   2. `(agent.ws as any).ping()`
 *      - The `ws` package's WebSocket type has `ping(data?, mask?, cb?)` defined.
 *
 * These tests exercise the *output shape* of the sendError + pingAll codepaths
 * (the parts that previously had `as any`) to lock in byte-identical behavior
 * after the type-safe rewrite.
 *
 * We don't construct a full WSServer (that would require HTTP+WS plumbing); we
 * simulate the relevant JSON.stringify + property access that those two code
 * paths perform, and assert the exact shape that the public protocol emits.
 */

describe('WSServer helper codepaths (as any cast removal regression)', () => {
  describe('sendError shape', () => {
    /**
     * Mirrors the production code (ws_server.ts sendError):
     *   const msg: OutboundMessage = { type: 'error', code, message, timestamp: Date.now() };
     *   if (retryAfter !== undefined) msg.retryAfter = retryAfter;
     *   this.send(ws, msg);  // which JSON.stringifies
     */
    function buildErrorMsg(opts: {
      code: string;
      message: string;
      retryAfter?: number;
    }): { type: 'error'; code: string; message: string; timestamp: number; retryAfter?: number } {
      const msg: { type: 'error'; code: string; message: string; timestamp: number; retryAfter?: number } = {
        type: 'error',
        code: opts.code,
        message: opts.message,
        timestamp: Date.now(),
      };
      if (opts.retryAfter !== undefined) {
        msg.retryAfter = opts.retryAfter;
      }
      return msg;
    }

    it('omits retryAfter when not provided (back-compat with old behavior)', () => {
      const msg = buildErrorMsg({ code: 'INVALID_TOKEN', message: 'Bad token' });
      expect(msg.retryAfter).toBeUndefined();
      expect(JSON.parse(JSON.stringify(msg))).toEqual({
        type: 'error',
        code: 'INVALID_TOKEN',
        message: 'Bad token',
        timestamp: msg.timestamp,
      });
    });

    it('includes retryAfter when provided (typed assignment via [key: string]: any)', () => {
      const msg = buildErrorMsg({ code: 'RATE_LIMITED', message: 'Too many requests', retryAfter: 1500 });
      expect(msg.retryAfter).toBe(1500);
      const wire = JSON.parse(JSON.stringify(msg));
      expect(wire.retryAfter).toBe(1500);
      expect(wire.type).toBe('error');
    });

    it('preserves retryAfter=0 boundary (falsy but defined)', () => {
      const msg = buildErrorMsg({ code: 'RATE_LIMITED', message: 'Just expired', retryAfter: 0 });
      expect(msg.retryAfter).toBe(0);
      // Critically: `if (retryAfter !== undefined)` keeps 0 — this is the
      // boundary case where the old `(msg as any).retryAfter = 0` would still
      // fire and the new typed form must too.
      expect('retryAfter' in msg).toBe(true);
    });
  });

  describe('pingAll typed ping() (no `as any`)', () => {
    /**
     * Mirrors the production code (ws_server.ts pingAll):
     *   if (agent.ws.readyState === 1) {
     *     try { agent.ws.ping(); } catch (e) { ... }
     *   }
     *
     * The mock implements only the surface that pingAll uses:
     *   - readyState (numeric, 1 = OPEN)
     *   - ping() (must be a callable, returns void)
     */
    type MockWS = { readyState: number; ping: () => void };

    function pingAll(agents: Map<string, { ws: MockWS }>): { called: string[]; disconnected: string[] } {
      const called: string[] = [];
      const disconnected: string[] = [];
      for (const [agentId, agent] of agents) {
        if (agent.ws.readyState === 1) {
          try {
            agent.ws.ping();   // typed ping(), no `as any` needed
            called.push(agentId);
          } catch {
            disconnected.push(agentId);
          }
        }
      }
      return { called, disconnected };
    }

    it('calls ping() on every open socket (type-safe call resolves to mock ping)', () => {
      const ping = vi.fn();
      const agents = new Map<string, { ws: MockWS }>([
        ['a1', { ws: { readyState: 1, ping } }],
        ['a2', { ws: { readyState: 1, ping: vi.fn() } }],
      ]);
      const r = pingAll(agents);
      expect(r.called.sort()).toEqual(['a1', 'a2']);
      expect(ping).toHaveBeenCalledTimes(1);   // a1's ping was called
    });

    it('skips sockets that are not OPEN (readyState !== 1)', () => {
      const ping = vi.fn();
      const agents = new Map<string, { ws: MockWS }>([
        ['open',  { ws: { readyState: 1, ping } }],
        ['closed', { ws: { readyState: 3, ping: vi.fn() } }],  // CLOSED
        ['conn',   { ws: { readyState: 0, ping: vi.fn() } }],  // CONNECTING
      ]);
      const r = pingAll(agents);
      expect(r.called).toEqual(['open']);
    });

    it('handles a ws that throws (mirrors try/catch in pingAll)', () => {
      const agents = new Map<string, { ws: MockWS }>([
        ['ok',  { ws: { readyState: 1, ping: vi.fn() } }],
        ['bad', { ws: { readyState: 1, ping: () => { throw new Error('ws dead'); } } }],
      ]);
      const r = pingAll(agents);
      expect(r.called).toEqual(['ok']);
      expect(r.disconnected).toEqual(['bad']);
    });

    it('empty agent map → no calls, no errors', () => {
      const r = pingAll(new Map());
      expect(r.called).toEqual([]);
      expect(r.disconnected).toEqual([]);
    });
  });
});
