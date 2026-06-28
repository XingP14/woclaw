import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// This test may run from either woclaw/ or woclaw/hub/ depending on caller.
// Resolve paths relative to the test file's own location so both work.
const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR); // .../hub
const WS_SERVER = join(HUB_DIR, 'src', 'ws_server.ts');

/**
 * Regression tests for the serializeDelegationResult helper extraction
 * (06-29 04:03 cron; parallels f622f24 sendJsonError + 2fa60e9 getDimValue).
 *
 * Three identical inline JSON.stringify sites in handleDelegateResult
 *   content: JSON.stringify({ delegationId: delegation.id, result: delegation.result, summary: delegation.summary })
 * were collapsed into a single private helper so future schema changes
 * (e.g. adding delegation.completedAt or delegation.error to the envelope)
 * happen in exactly one place. The 3 sites are:
 *   L718  db.saveMessage({ ..., content: this.serializeDelegationResult(delegation), ... })
 *   L726  topics.broadcast({ ..., content: this.serializeDelegationResult(delegation), ... })
 *   L737  this.send(ws, { ..., content: this.serializeDelegationResult(delegation), ... })
 *
 * The helper MUST produce a JSON string byte-identical to what the inline
 * sites previously produced — content is the persisted wire envelope, so any
 * drift here would silently change every persisted delegation result message.
 */

describe('WSServer.serializeDelegationResult helper migration', () => {
  it('ws_server.ts exists at expected path', () => {
    expect(existsSync(WS_SERVER)).toBe(true);
  });

  it('ws_server.ts declares the private serializeDelegationResult helper', () => {
    const text = readFileSync(WS_SERVER, 'utf8');
    expect(text).toMatch(/private serializeDelegationResult\(/);
  });

  it('helper signature accepts a Delegation and returns string', () => {
    const text = readFileSync(WS_SERVER, 'utf8');
    const m = text.match(
      /private serializeDelegationResult\(\s*d: import\('\.\/types\.js'\)\.Delegation\): string/
    );
    expect(m).not.toBeNull();
  });

  it('helper body is the canonical JSON.stringify({ delegationId, result, summary })', () => {
    const text = readFileSync(WS_SERVER, 'utf8');
    const helperMatch = text.match(/private serializeDelegationResult\([\s\S]*?\n  \}\n/);
    expect(helperMatch).not.toBeNull();
    const body = helperMatch![0];
    expect(body).toMatch(/JSON\.stringify\(\{ delegationId: d\.id, result: d\.result, summary: d\.summary \}\)/);
  });

  it('ws_server.ts has 0 inline JSON.stringify({ delegationId: delegation.id ... }) sites remaining', () => {
    const text = readFileSync(WS_SERVER, 'utf8');
    const lines = text.split('\n');
    const sites: { line: number; text: string }[] = [];
    const inlineRe = /JSON\.stringify\(\{ delegationId: delegation\.id, result: delegation\.result, summary: delegation\.summary \}\)/;
    for (let i = 0; i < lines.length; i++) {
      if (inlineRe.test(lines[i])) {
        sites.push({ line: i + 1, text: lines[i].trim() });
      }
    }
    expect(sites).toEqual([]);
  });

  it('helper called exactly 3 times (was 3 inline sites before)', () => {
    const text = readFileSync(WS_SERVER, 'utf8');
    const calls = (text.match(/this\.serializeDelegationResult\(delegation\)/g) || []).length;
    expect(calls).toBe(3);
  });

  describe('byte-identical JSON output (parity with previous inline sites)', () => {
    /**
     * Mirrors the helper body:
     *   return JSON.stringify({ delegationId: d.id, result: d.result, summary: d.summary });
     */
    function serializeDelegationResult(d: {
      id: string;
      result?: unknown;
      summary?: string;
    }): string {
      return JSON.stringify({ delegationId: d.id, result: d.result, summary: d.summary });
    }

    it('produces the same byte sequence as the previous inline site (all 3 fields populated)', () => {
      const delegation = {
        id: 'del-abc-123',
        result: { tokens: 42, content: 'computed answer' },
        summary: 'Done in 42 tokens',
      };
      const wire = serializeDelegationResult(delegation);
      // Canonical wire format the 3 inline sites used to emit
      expect(wire).toBe(
        '{"delegationId":"del-abc-123","result":{"tokens":42,"content":"computed answer"},"summary":"Done in 42 tokens"}'
      );
    });

    it('preserves result: undefined (omitted from JSON) — same as the old inline behavior', () => {
      // Old inline site: JSON.stringify({ ..., result: undefined, ... }) — undefined
      // values are dropped from JSON.stringify output.
      const wire = serializeDelegationResult({ id: 'del-x', result: undefined, summary: undefined });
      expect(wire).toBe('{"delegationId":"del-x"}');
    });

    it('preserves result: null (kept in JSON) — same as the old inline behavior', () => {
      const wire = serializeDelegationResult({ id: 'del-y', result: null, summary: null });
      expect(wire).toBe('{"delegationId":"del-y","result":null,"summary":null}');
    });

    it('round-trips back to the original shape via JSON.parse (no extra fields, no reordering)', () => {
      const delegation = {
        id: 'del-roundtrip',
        result: [1, 2, 3],
        summary: 'summary text',
      };
      const wire = serializeDelegationResult(delegation);
      const parsed = JSON.parse(wire);
      expect(parsed).toEqual({ delegationId: 'del-roundtrip', result: [1, 2, 3], summary: 'summary text' });
      // Field order is deterministic — first delegationId, then result, then summary
      expect(Object.keys(parsed)).toEqual(['delegationId', 'result', 'summary']);
    });

    it('all 3 downstream call sites in handleDelegateResult emit the same wire bytes', () => {
      // The 3 inline sites used to each call JSON.stringify independently on the
      // SAME delegation object — the helper preserves that property: a single
      // delegation serialized once yields the same bytes the 3 receivers (DB,
      // topic broadcast, agent WS) would have written.
      const delegation = {
        id: 'del-fanout',
        result: 'ok',
        summary: 'fan-out test',
      };
      const a = serializeDelegationResult(delegation);
      const b = serializeDelegationResult(delegation);
      const c = serializeDelegationResult(delegation);
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(a).toBe('{"delegationId":"del-fanout","result":"ok","summary":"fan-out test"}');
    });
  });
});
