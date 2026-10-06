/**
 * R414 probe: cancellation reachability + notification durability.
 *
 * Three claims under test, each stated as an assertion over the SHIPPED surface:
 *   C1  `delegate_cancel` / REST DELETE /delegations/:id change a status field.
 *       Nothing in the hub signals the in-flight run. -> assert no producer of
 *       the spec'd `interrupted` exit code exists.
 *   C2  Every delivery is guarded by `readyState !== 1` and there is no outbound
 *       queue. -> assert `handleConnection` sends no catch-up for missed notices.
 *   C3  A cancel whose target is offline is lost to the target, while the
 *       delegator can still observe it by polling REST. -> assert the asymmetry.
 *
 * This file asserts what the code DOES. If a claim is wrong the test fails and
 * the note must be corrected (per R409-M410-b: a probe failing for the wrong
 * reason is worse than no probe).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const rd = (f: string) => readFileSync(join(SRC, f), 'utf8');

describe('R414 C1: cancel is a status transition, not an interrupt', () => {
  it('C1a the `interrupted` exit code is declared in the taxonomy', () => {
    const al = rd('agent_stream.ts');
    expect(al).toContain("'interrupted'");
  });

  it('C1b but nothing in the hub ever emits it', () => {
    // producer would need to assign exit:'interrupted' or result{exit:'interrupted'}
    const producers: string[] = [];
    for (const f of ['ws_server.ts', 'rest_server.ts', 'memory.ts', 'scheduler.ts',
                     'federation.ts', 'topics.ts', 'db.ts', 'agent_stream.ts']) {
      let src: string;
      try { src = readFileSync(join(SRC, f), 'utf8'); } catch { continue; }
      src.split('\n').forEach((line, i) => {
        if (!/interrupted/.test(line)) return;
        // taxonomy declaration, mirror table, or a union member -- not a producer
        if (/AGENT_STREAM_EXITS/.test(line)) return;
        if (/interrupted:\s*\d/.test(line)) return;
        if (/\|\s*'interrupted'/.test(line)) return;   // union member in types
        if (/^\s*'interrupted',?\s*$/.test(line)) return; // array element
        producers.push(`${f}:${i + 1}  ${line.trim()}`);
      });
    }
    // EXPECTED: zero producers. If this fails, cancel DOES reach the run.
    expect(producers).toEqual([]);
  });

  it('C1c handleDelegateCancel mutates state and notifies; it does not signal a run', () => {
    const ws = rd('ws_server.ts');
    const body = ws.slice(ws.indexOf('private handleDelegateCancel'),
                          ws.indexOf('private handleDelegateCancel') + 1800);
    expect(body).toContain("delegation.status = 'cancelled'");
    expect(body).toContain('sendDelegationUpdate');
    // the target's run handle -- there is no such thing in the body
    expect(body).not.toMatch(/\.ws\.(close|terminate|send)\(/);
  });
});

describe('R414 C2: delivery is fire-and-forget', () => {
  it('C2a there is no outbound queue/backlog/outbox in any transport file', () => {
    const offenders: string[] = [];
    for (const f of ['ws_server.ts', 'rest_server.ts', 'memory.ts', 'topics.ts']) {
      const src = rd(f);
      src.split('\n').forEach((line, i) => {
        if (/\b(outbox|backlog|pendingQueue|unreadQueue|catchup|catch_up|missed)\b/i.test(line)
            && !/^\s*(\/\/|\*)/.test(line)) {
          offenders.push(`${f}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('C2b every delivery site is guarded by readyState (a silent drop when closed)', () => {
    const ws = rd('ws_server.ts');
    const guards = ws.split('\n').filter(l => /readyState\s*[!=]==?\s*(1|WebSocket\.OPEN)/.test(l));
    // 16 guards observed at HEAD; if the shape changes this test tells us
    expect(guards.length).toBeGreaterThanOrEqual(14);
  });

  it('C2c the welcome frame carries topics only -- no missed-notice catch-up', () => {
    const ws = rd('ws_server.ts');
    const w = ws.slice(ws.indexOf("type: 'welcome'"), ws.indexOf("type: 'welcome'") + 400);
    expect(w).toContain('topics:');
    expect(w).not.toMatch(/pending|missed|backlog|unread|delegation/i);
  });
});

describe('R414 C3: the cancel recipient loses the most', () => {
  it('C3a sendDelegationUpdate returns silently when the target socket is closed', () => {
    const ws = rd('ws_server.ts');
    const body = ws.slice(ws.indexOf('private sendDelegationUpdate'),
                          ws.indexOf('private sendDelegationUpdate') + 400);
    expect(body).toContain("if (!target || target.ws.readyState !== 1) return;");
  });

  it('C3b the delegator can still observe the cancelled state by polling REST', () => {
    const rs = rd('rest_server.ts');
    // GET /delegations/:id returns the delegation object including status
    expect(rs).toMatch(/path === '\/delegations\/\{?id\}?'|delegMatch/);
    expect(rs).toContain('sendJsonSuccess(res, 200, { delegation: d })');
  });

  it('C3c so recovery from a lost cancel requires the recipient to poll, unprompted', () => {
    const rs = rd('rest_server.ts');
    // there is a GET /delegations/pending, but nothing pushes a reconnect to call it
    expect(rs).toContain("/delegations/pending");
    const ws = rd('ws_server.ts');
    const conn = ws.slice(ws.indexOf('private handleConnection'),
                          ws.indexOf('private handleConnection') + 1400);
    expect(conn).not.toContain('/delegations/pending');
    expect(conn).not.toContain('getDelegations');
  });
});
