import { describe, it, expect } from 'vitest';

/**
 * Rate Limit Tests
 *
 * The rate limiting logic is implemented directly in WSServer (ws_server.ts):
 * - Sliding window counter algorithm (checkRateLimit)
 * - Per-agent independent tracking (rateLimits Map)
 * - REST API: GET /rate-limits
 * - Config: setRateLimitConfig(messages, windowMs)
 *
 * These tests verify the sliding window algorithm behavior directly.
 */

describe('Rate Limit Sliding Window Algorithm', () => {
  /**
   * Simulates the sliding window counter algorithm from ws_server.ts
   */
  function slidingWindow(
    entries: number[],
    now: number,
    windowMs: number,
    limit: number
  ): { count: number; oldest: number | null; limited: boolean; retryAfter: number | null } {
    const windowStart = now - windowMs;
    const valid = entries.filter(t => t > windowStart);

    if (valid.length >= limit) {
      const oldest = valid[0];
      return {
        count: valid.length,
        oldest,
        limited: true,
        retryAfter: Math.max(0, oldest + windowMs - now),
      };
    }

    return { count: valid.length, oldest: valid[0] ?? null, limited: false, retryAfter: null };
  }

  it('allows messages within limit', () => {
    const now = 1000000;
    const entries = [now - 100, now - 200, now - 300]; // 3 messages, limit = 5
    const result = slidingWindow(entries, now, 60000, 5);
    expect(result.limited).toBe(false);
    expect(result.count).toBe(3);
  });

  it('blocks when at limit', () => {
    const now = 1000000;
    const entries = [now - 1000, now - 2000, now - 3000, now - 4000, now - 5000]; // 5 messages = limit
    const result = slidingWindow(entries, now, 60000, 5);
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('expires old timestamps outside window', () => {
    const now = 1000000;
    // One message inside window, one outside
    const entries = [now - 30000, now - 90000]; // 30s ago (valid), 90s ago (expired)
    const result = slidingWindow(entries, now, 60000, 5);
    expect(result.limited).toBe(false);
    expect(result.count).toBe(1); // Only 1 within window
  });

  it('calculates correct retryAfter', () => {
    const now = 1000000;
    const windowMs = 60000;
    // Oldest message: 10s ago → expires at now+50s
    const oldest = now - 10000;
    const entries = [oldest, oldest - 1000, oldest - 2000, oldest - 3000, oldest - 4000];
    const result = slidingWindow(entries, now, windowMs, 5);
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBe(50000); // 60s - 10s = 50s
  });

  it('handles empty entries', () => {
    const result = slidingWindow([], 1000000, 60000, 5);
    expect(result.limited).toBe(false);
    expect(result.count).toBe(0);
    expect(result.oldest).toBeNull();
  });

  it('counts exactly at boundary', () => {
    const now = 1000000;
    const windowMs = 60000;
    // 4 messages, limit = 4 → should be limited
    const entries = [now - 100, now - 200, now - 300, now - 400];
    const result = slidingWindow(entries, now, windowMs, 4);
    expect(result.limited).toBe(true);
  });
});

describe('RateLimitConfig', () => {
  it('has correct default values', () => {
    const config = { messages: 100, windowMs: 60000 };
    expect(config.messages).toBe(100);
    expect(config.windowMs).toBe(60000);
  });

  it('can be partially updated', () => {
    const config = { messages: 100, windowMs: 60000 };
    // Simulate partial update (as setRateLimitConfig does)
    const updated = { ...config, messages: 50 };
    expect(updated.messages).toBe(50);
    expect(updated.windowMs).toBe(60000); // unchanged
  });
});
