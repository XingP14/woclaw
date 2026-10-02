// plugin/test/channel-runtime.test.ts
// (2026-10-02 22:03 cron tick).
//
// Why this file exists. A scoped probe
// (`npx vitest run --config vitest.probe.config.js --coverage`) reports
// plugin/src/channel.ts at **0/42 dark branches but 18/25 dark functions** —
// 72% of the file's functions have never executed. Branch coverage alone would
// have read this file as finished. It is not.
//
// The 18 dark functions are not scattered edge cases. They are:
//
//   - the ENTIRE WoClawChannelInstance runtime: initialize, connect,
//     scheduleReconnect, send, resolveMemoryRead, handleMessage, sendMessage,
//     joinTopic, leaveTopic, writeMemory, readMemory, isConnected, shutdown
//   - all 5 of the plugin's OpenClaw lifecycle hooks: afterAccountConfigWritten,
//     destroyAccount, resolveAccountId, setChannelRuntime, register
//
// i.e. every line of code an OpenClaw host actually executes at runtime. What
// IS covered is only the pure config-adapter surface (listAccountIds /
// resolveAccount / inspectAccount / isConfigured / unconfiguredReason /
// applyAccountConfig) reached from adapter-config.test.ts and
// channel-credential-readiness.test.ts.
//
// The reason is a stale excuse, not a technical obstacle. plugin/test/channel.test.ts
// carries the comment "Since the actual import requires the OpenClaw SDK, we
// test the logic separately" — and then asserts on its own `ws` mock's
// properties (`expect(mockWs.on).toBeDefined()`) and on `vi.clearAllMocks()`.
// It imports ZERO production code. Its 2 tests would pass with
// plugin/src/channel.ts deleted. A file named after the module it claims to
// test is not evidence that it tests it.
//
// The obstacle it names is real but narrower than stated: the OpenClaw SDK is
// only needed for the `ChannelPlugin` *type* (a type-only import, erased at
// runtime). Every runtime path here is driven by `channelInstance` + the
// lifecycle hooks on the exported plugin object, both of which are plain
// values. `ws` is mocked, so no socket is opened.
//
// What is actually covered here, beyond counting functions:
//   - autoJoin/topics are unioned into the topic set and every one is joined
//     on open (L164-169, L193-195) — a duplicate topic is sent once, because
//     the accumulation target is a Set, not an array.
//   - the 10s startup fallback (L175-180) reconnects ONLY when the socket is
//     not OPEN, and is a no-op when it is.
//   - the 5s reconnect (L236-240) is guarded by `if (this.reconnectTimer)
//     return`, so N rapid closes schedule exactly ONE reconnect.
//   - a message the agent sent itself is never dispatched back (L270), and a
//     dispatched message preserves all 6 payload fields.
//   - readMemory resolves from the first queued memory_value and prunes the
//     empty key (L283-287, L256-260); the 5s timeout resolves null.
//   - a malformed frame is logged and does not throw (L215-217).
//   - `enabled: false` on either lifecycle hook skips initialize entirely
//     (L512, L527) — the plugin-off path, previously never executed.
//   - afterAccountConfigWritten builds a console-backed logger when the runtime
//     has none (L441-446) and skips initialize when the account is
//     unconfigured (L435).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => {
  const instances: any[] = [];
  const state = { throwOnConstruct: false };
  return { instances, state };
});

vi.mock('ws', () => {
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    sent: string[] = [];
    closeCalls: Array<[number, string]> = [];
    pongCalls = 0;
    on: (event: string, cb: () => void) => void;
    private handlers: Record<string, () => void> = {};

    constructor(public url: string) {
      if (h.state.throwOnConstruct) throw new Error('connect refused');
      h.instances.push(this);
      this.on = (event: string, cb: () => void) => {
        this.handlers[event] = cb;
        return this as any;
      };
    }

    send(data: string): void {
      this.sent.push(data);
    }
    close(code?: number, reason?: string): void {
      this.readyState = 3;
      this.closeCalls.push([code as number, reason as string]);
    }
    pong(): void {
      this.pongCalls += 1;
    }

    // --- test drivers ---
    open(): void {
      this.readyState = 1;
      (this as any).onopen?.();
    }
    feed(raw: unknown): void {
      (this as any).onmessage?.({
        data: typeof raw === 'string' ? raw : JSON.stringify(raw),
      });
    }
    serverPing(): void {
      this.handlers['ping']?.();
    }
    serverClose(code = 1006): void {
      this.readyState = 3;
      this.handlers['error']?.({ message: 'socket died' });
      ;(this as any).onerror?.({ error: new Error('socket died') });
      ;(this as any).onclose?.({ code });
    }
  }
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

type Sent = Record<string, any>;
const last = (ws: any): Sent =>
  JSON.parse(ws.sent[ws.sent.length - 1]);
const allSent = (ws: any): Sent[] => ws.sent.map((s: string) => JSON.parse(s));

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

// WoClawChannelInstance is not exported, so a fresh instance per test is
// obtained by reloading the module. The alternative — `Object.create(proto)` to
// dodge the singleton — silently produces an object whose TS *field
// initializers* never ran, so every `private topics = new Set()` and
// `pendingMemoryReads = new Map()` is `undefined` and the first `add()` throws.
// The class is not exported precisely so the singleton is the only handle,
// which makes module reload the correct seam rather than a workaround.
let inst: any;
let plugin: any;
let logger: ReturnType<typeof makeLogger>;
let dispatch: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  h.instances.length = 0;
  h.state.throwOnConstruct = false;
  vi.useFakeTimers();
  vi.resetModules();
  const mod = await import('../src/channel.js');
  inst = mod.channelInstance;
  plugin = mod.woclawChannelPlugin;
  logger = makeLogger();
  dispatch = vi.fn();
});

afterEach(() => {
  inst.shutdown();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('channel instance: connection lifecycle', () => {
  it('initialize opens a socket carrying agentId and token, and joins topics on open', () => {
    inst.initialize(
      { hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1', autoJoin: ['x', 'y'] },
      dispatch,
      logger,
    );
    expect(h.instances).toHaveLength(1);
    const url = h.instances[0].url as string;
    expect(url.startsWith('ws://hub:1?')).toBe(true);
    expect(url).toContain('agentId=a1');
    expect(url).toContain('token=t1');

    h.instances[0].open();
    expect(allSent(h.instances[0]).map((m) => m.topic)).toEqual(['x', 'y']);
    expect(logger.info).toHaveBeenCalledWith('[WoClaw] Connected to hub: ws://hub:1');
  });

  it('unions autoJoin and topics without double-joining a shared topic', () => {
    inst.initialize(
      { hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1', autoJoin: ['shared'], topics: ['shared', 'other'] },
      dispatch,
      logger,
    );
    h.instances[0].open();
    // 'shared' appears in BOTH lists; the Set accumulator sends it once.
    expect(allSent(h.instances[0]).map((m) => m.topic).sort()).toEqual(['other', 'shared']);
  });

  it('joins autoJoin topics when the host supplies autoJoin and NO topics', () => {
    // Isolates L164-166. The union test above cannot: with a shared name the
    // `topics` loop still contributes the same members, so dropping the
    // `autoJoin` loop entirely is invisible there (mutation M01/M12 survived
    // the first round of the suite because of exactly this).
    inst.initialize(
      { hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1', autoJoin: ['only-auto'] },
      dispatch,
      logger,
    );
    h.instances[0].open();
    expect(allSent(h.instances[0]).map((m) => m.topic)).toEqual(['only-auto']);
  });

  it('joins topics when the host supplies topics and NO autoJoin', () => {
    inst.initialize(
      { hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1', topics: ['only-topics'] },
      dispatch,
      logger,
    );
    h.instances[0].open();
    expect(allSent(h.instances[0]).map((m) => m.topic)).toEqual(['only-topics']);
  });

  it('connects with an empty topic set when the host supplies neither', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    expect(h.instances[0].sent).toHaveLength(0);
  });

  it('skips re-initialization when the config signature is unchanged and the socket is open', () => {
    const cfg = { hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' };
    inst.initialize(cfg, dispatch, logger);
    h.instances[0].open();
    inst.initialize(cfg, dispatch, logger);
    expect(h.instances).toHaveLength(1);
    expect(logger.debug).toHaveBeenCalledWith('[WoClaw] initialize skipped: connection already active');
  });

  it('re-initialization with a changed signature closes the old socket before reconnecting', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    inst.initialize({ hubUrl: 'ws://hub:2', agentId: 'a1', token: 't1' }, dispatch, logger);
    expect(h.instances[0].closeCalls).toEqual([[1000, 'Reconnecting']]);
    expect(h.instances).toHaveLength(2);
    expect(h.instances[1].url).toContain('ws://hub:2');
  });

  it('connect() is a no-op when initialize never ran', () => {
    inst.connect();
    expect(h.instances).toHaveLength(0);
  });

  it('logs and schedules a reconnect when the socket constructor throws', () => {
    h.state.throwOnConstruct = true;
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    expect(logger.error).toHaveBeenCalledWith('[WoClaw] Failed to connect:', 'connect refused');

    h.state.throwOnConstruct = false;
    vi.advanceTimersByTime(5000);
    expect(h.instances).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith('[WoClaw] Attempting to reconnect...');
  });

  it('the 10s startup fallback reconnects only when the socket is not OPEN', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    vi.advanceTimersByTime(10000);
    // Never opened -> retry.
    expect(h.instances).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledWith('[WoClaw] Startup check: not connected, retrying...');

    // Now open the second socket and let another fallback elapse.
    h.instances[1].open();
    const before = h.instances.length;
    vi.advanceTimersByTime(10000);
    expect(h.instances).toHaveLength(before);
  });

  it('collapses rapid closes into a single scheduled reconnect', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    h.instances[0].serverClose();
    h.instances[0].serverClose();
    h.instances[0].serverClose();
    expect(h.instances).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(h.instances).toHaveLength(2);
  });

  it('logs a socket error and schedules a reconnect on close', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    h.instances[0].serverClose(1006);
    expect(logger.error).toHaveBeenCalledWith('[WoClaw] WebSocket error:', expect.anything());
    expect(logger.warn).toHaveBeenCalledWith('[WoClaw] Disconnected (code: 1006)');
  });
});

describe('channel instance: protocol level ping/pong', () => {
  it('answers a hub ping frame with a protocol pong, not a JSON message', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    const sentBefore = h.instances[0].sent.length;
    h.instances[0].serverPing();
    expect(h.instances[0].pongCalls).toBe(1);
    // No protocol frame was queued — pong() is a frame, not a payload.
    expect(h.instances[0].sent).toHaveLength(sentBefore);
    expect(logger.debug).toHaveBeenCalledWith('[WoClaw] WebSocket ping received, sending pong');
  });

  it('does not pong a socket that is not OPEN', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].serverPing();
    expect(h.instances[0].pongCalls).toBe(0);
  });

  it('sends a JSON pong in reply to an application-level ping message', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    h.instances[0].feed({ type: 'ping' });
    expect(last(h.instances[0])).toEqual({ type: 'pong' });
  });
});

describe('channel instance: inbound dispatch', () => {
  it('dispatches a message from another agent with all six payload fields', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    h.instances[0].feed({
      type: 'message', id: 'm9', from: 'a2',
      content: 'hi', topic: 'x', timestamp: 1700000000,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      channel: 'woclaw', id: 'm9', from: 'a2',
      text: 'hi', topic: 'x', timestamp: 1700000000,
    });
  });

  it('never dispatches the agent its own message back to it', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    h.instances[0].feed({ type: 'message', from: 'a1', content: 'echo', topic: 'x', timestamp: 1 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('drops an inbound message when no dispatch function was supplied', () => {
    // initialize() types dispatchFn as required, but the lifecycle hooks build
    // their own closure over an api that may have no `dispatch` at all — see
    // L513-515 and L528-530, where the guard is `if (runtime?.dispatch)`. So the
    // falsy-dispatchFn arm of L270 is a live production shape, not a defensive
    // leftover.
    //
    // Asserting only `not.toThrow()` is NOT enough: with the guard removed the
    // call throws a TypeError that onmessage's own try/catch (L212-217) swallows
    // and re-logs as a parse failure, so the test passed against a broken
    // guard. The assertion has to be on the LOG — a correctly-guarded drop is
    // silent, a mis-guarded one is reported as '[WoClaw] Failed to parse
    // message:'.
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, undefined as any, logger);
    h.instances[0].open();
    expect(() =>
      h.instances[0].feed({ type: 'message', from: 'a2', content: 'c', topic: 'x', timestamp: 1 }),
    ).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('a malformed frame IS reported as a parse failure, proving the log is the observable', () => {
    // Counterpart to the test above: this is what the swallowed TypeError
    // would otherwise have looked like. Without it, "not.toThrow" plus an
    // empty error log would not distinguish a guarded drop from a caught crash.
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    h.instances[0].feed('{not json');
    expect(logger.error).toHaveBeenCalledWith(
      '[WoClaw] Failed to parse message:',
      expect.any(String),
    );
  });

  it('logs welcome and server error frames', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    h.instances[0].feed({ type: 'welcome', agentId: 'a1' });
    expect(logger.info).toHaveBeenCalledWith('[WoClaw] Authenticated as a1');
    h.instances[0].feed({ type: 'error', code: 'E1', message: 'nope' });
    expect(logger.error).toHaveBeenCalledWith('[WoClaw] Server error: E1 - nope');
  });

  it('accepts join/leave/pong frames as no-ops', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    const before = h.instances[0].sent.length;
    for (const type of ['join', 'leave', 'pong']) h.instances[0].feed({ type });
    expect(h.instances[0].sent).toHaveLength(before);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('logs a malformed frame instead of throwing', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    expect(() => h.instances[0].feed('{not json')).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      '[WoClaw] Failed to parse message:',
      expect.any(String),
    );
  });
});

describe('channel instance: public messaging API', () => {
  beforeEach(() => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
  });

  it('sendMessage, joinTopic, leaveTopic and writeMemory emit the right frames', async () => {
    await inst.sendMessage('t', 'body');
    expect(last(h.instances[0])).toEqual({ type: 'message', topic: 't', content: 'body' });

    await inst.joinTopic('t2');
    expect(last(h.instances[0])).toEqual({ type: 'join', topic: 't2' });

    await inst.leaveTopic('t2');
    expect(last(h.instances[0])).toEqual({ type: 'leave', topic: 't2' });

    await inst.writeMemory('k', { n: 1 });
    expect(last(h.instances[0])).toEqual({ type: 'memory_write', key: 'k', value: { n: 1 } });
  });

  it('drops every outbound frame while the socket is not OPEN', async () => {
    h.instances[0].readyState = 0;
    const before = h.instances[0].sent.length;
    await inst.sendMessage('t', 'body');
    await inst.joinTopic('t2');
    await inst.writeMemory('k', 1);
    expect(h.instances[0].sent).toHaveLength(before);
  });
});

describe('channel instance: memory read protocol', () => {
  beforeEach(() => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
  });

  it('resolves from the hub reply and prunes the drained key', async () => {
    const p = inst.readMemory('k');
    expect(last(h.instances[0])).toEqual({ type: 'memory_read', key: 'k' });
    h.instances[0].feed({ type: 'memory_value', key: 'k', exists: true, value: { hit: true } });
    await expect(p).resolves.toEqual({ hit: true });
    expect(inst.pendingMemoryReads.size).toBe(0);
  });

  it('resolves null when the hub reports the key does not exist', async () => {
    const p = inst.readMemory('missing');
    h.instances[0].feed({ type: 'memory_value', key: 'missing', exists: false });
    await expect(p).resolves.toBeNull();
  });

  it('resolves null on the 5s timeout and clears the pending entry', async () => {
    const p = inst.readMemory('slow');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBeNull();
    expect(inst.pendingMemoryReads.size).toBe(0);
  });

  it('serves two concurrent reads of the same key FIFO, one reply each', async () => {
    const first = inst.readMemory('k');
    const second = inst.readMemory('k');
    expect(inst.pendingMemoryReads.get('k')).toHaveLength(2);

    h.instances[0].feed({ type: 'memory_value', key: 'k', exists: true, value: 'v1' });
    await expect(first).resolves.toBe('v1');
    expect(inst.pendingMemoryReads.get('k')).toHaveLength(1);

    h.instances[0].feed({ type: 'memory_value', key: 'k', exists: true, value: 'v2' });
    await expect(second).resolves.toBe('v2');
    expect(inst.pendingMemoryReads.size).toBe(0);
  });

  it('a reply that arrives after the timeout does not resolve an already-settled read', async () => {
    // The `pending.resolved` guard at L250 is what makes this a no-op. Without
    // it, the late frame re-enters resolveMemoryRead on an already-cleared
    // timer and re-splices a settled entry out of a queue the timeout path
    // already pruned — a double-settle on an already-resolved promise.
    const p = inst.readMemory('k');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBeNull();
    const queueAfterTimeout = inst.pendingMemoryReads.get('k');
    h.instances[0].feed({ type: 'memory_value', key: 'k', exists: true, value: 'late' });
    // Still settled on null, and the map is not re-populated by the late frame.
    await expect(p).resolves.toBeNull();
    expect(inst.pendingMemoryReads.get('k')).toEqual(queueAfterTimeout);
    expect(inst.pendingMemoryReads.size).toBe(0);
  });

  it('a second reply for a settled key leaves the drained map empty', async () => {
    const p = inst.readMemory('k');
    h.instances[0].feed({ type: 'memory_value', key: 'k', exists: true, value: 'first' });
    await expect(p).resolves.toBe('first');
    // Duplicate delivery from the hub — must not resurrect the key or re-settle.
    h.instances[0].feed({ type: 'memory_value', key: 'k', exists: true, value: 'second' });
    await expect(p).resolves.toBe('first');
    expect(inst.pendingMemoryReads.size).toBe(0);
  });

  it('ignores a memory_value for a key nobody is waiting on', async () => {
    expect(() => h.instances[0].feed({ type: 'memory_value', key: 'ghost', exists: true, value: 1 })).not.toThrow();
    expect(inst.pendingMemoryReads.size).toBe(0);
  });

  it('resolveMemoryRead tolerates a pending entry whose key was already pruned', async () => {
    // The `if (!queue) return;` guard at L256-257 is the ONLY thing standing
    // between a settled pending entry whose key has been removed from
    // pendingMemoryReads and a TypeError on `queue.indexOf`. Proven, not
    // assumed: mutation M18 (guard -> `if (false)`) is killed by this test
    // and by nothing else in the suite.
    //
    // The state is reachable — resolveMemoryRead sets `pending.resolved = true`
    // and clears the timer BEFORE the queue lookup, so any second settle of an
    // entry whose key has just been drained reaches the guard with a stale
    // queue handle. Here the entry was never registered at all, which is the
    // same observable: `pendingMemoryReads.get(key)` is undefined.
    const orphan = { resolve: () => {}, resolved: false, timer: setTimeout(() => {}, 60_000) as any };
    expect(() => inst.resolveMemoryRead('never-registered', orphan, 'v')).not.toThrow();
    expect(orphan.resolved).toBe(true);
    // And the key is not created as a side effect of the failed lookup.
    expect(inst.pendingMemoryReads.has('never-registered')).toBe(false);
  });
});

describe('channel instance: connection state and shutdown', () => {
  it('isConnected tracks the socket readyState', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    expect(inst.isConnected()).toBe(false);
    h.instances[0].open();
    expect(inst.isConnected()).toBe(true);
    h.instances[0].readyState = 3;
    expect(inst.isConnected()).toBe(false);
  });

  it('shutdown leaves every topic and closes the socket', async () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1', autoJoin: ['a', 'b'] }, dispatch, logger);
    h.instances[0].open();
    h.instances[0].sent.length = 0;
    inst.shutdown();
    expect(allSent(h.instances[0])).toEqual([
      { type: 'leave', topic: 'a' },
      { type: 'leave', topic: 'b' },
    ]);
    expect(h.instances[0].closeCalls).toEqual([[1000, 'Agent shutting down']]);
  });

  it('shutdown clears the three timers so nothing fires afterwards', () => {
    inst.initialize({ hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' }, dispatch, logger);
    h.instances[0].open();
    inst.shutdown();
    const before = h.instances.length;
    vi.advanceTimersByTime(60000);
    expect(h.instances).toHaveLength(before);
  });

  it('shutdown is safe before any connection exists', () => {
    expect(() => inst.shutdown()).not.toThrow();
  });
});

describe('plugin lifecycle hooks', () => {
  it('setChannelRuntime initializes the channel using runtime.dispatch and logger', () => {
    plugin.setChannelRuntime!({
      dispatch, logger,
      cfg: { hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' },
    } as any);
    expect(h.instances).toHaveLength(1);
    h.instances[0].open();
    h.instances[0].feed({ type: 'message', from: 'a2', content: 'c', topic: 'x', timestamp: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('register reaches dispatch through the nested api.runtime shape', () => {
    plugin.register!({
      logger,
      cfg: { hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' },
      runtime: { dispatch },
    } as any);
    expect(h.instances).toHaveLength(1);
    h.instances[0].open();
    h.instances[0].feed({ type: 'message', from: 'a2', content: 'c', topic: 'x', timestamp: 1 });
    // The nested runtime.dispatch, not a top-level one.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('enabled: false skips initialization on both hooks', () => {
    plugin.setChannelRuntime!({ dispatch, logger, cfg: { enabled: false } } as any);
    plugin.register!({ logger, cfg: { enabled: false }, runtime: { dispatch } } as any);
    expect(h.instances).toHaveLength(0);
  });

  it('a missing runtime cfg is treated as an empty config, not a crash', () => {
    expect(() => plugin.register!({ logger } as any)).not.toThrow();
    expect(() => plugin.setChannelRuntime!({ logger } as any)).not.toThrow();
    // Empty cfg still connects — to the env/default hub URL.
    expect(h.instances.length).toBeGreaterThan(0);
  });

  it('resolveAccountId defaults a null accountId', () => {
    const resolve = plugin.setup!.resolveAccountId! as any;
    expect(resolve({ accountId: null })).toBe('default');
    expect(resolve({ accountId: 'acct-7' })).toBe('acct-7');
  });

  it('afterAccountConfigWritten initializes a configured account through the real instance', async () => {
    plugin.setup!.afterAccountConfigWritten!({
      cfg: { accounts: { main: { hubUrl: 'ws://hub:9', agentId: 'a9', token: 't9' } } },
      accountId: 'main',
      runtime: { dispatch, logger },
    } as any);
    expect(h.instances).toHaveLength(1);
    expect(h.instances[0].url).toContain('ws://hub:9');
  });

  it('afterAccountConfigWritten skips initialize for an unconfigured account', () => {
    plugin.setup!.afterAccountConfigWritten!({
      cfg: { accounts: { main: { agentId: 'a9' } } }, // no token
      accountId: 'main',
      runtime: { dispatch, logger },
    } as any);
    expect(h.instances).toHaveLength(0);
  });

  it('afterAccountConfigWritten falls back to a console-backed logger', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
    plugin.setup!.afterAccountConfigWritten!({
      cfg: { hubUrl: 'ws://hub:9', agentId: 'a9', token: 't9' },
      accountId: 'default',
      runtime: undefined,
    } as any);
    h.instances[0].open();
    expect(spies[0]).toHaveBeenCalledWith('[WoClaw] Connected to hub: ws://hub:9');
    spies.forEach((s) => s.mockRestore());
  });

  it('destroyAccount shuts the shared instance down', async () => {
    plugin.setChannelRuntime!({
      dispatch, logger, cfg: { hubUrl: 'ws://hub:1', agentId: 'a1', token: 't1' },
    } as any);
    const ws = h.instances[0];
    ws.open();
    expect(() => plugin.setup!.destroyAccount!()).not.toThrow();
    expect(ws.closeCalls.length).toBeGreaterThan(0);
  });
});
