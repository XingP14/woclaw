// R547 (part 2) — the two defects that lie UNDERNEATH the read-loop bug.
//
// Once the read loop is repaired, the bridge still cannot work, for two
// independent reasons. Both are pinned here so that fixing the read loop
// alone does not look like success.
//
// DEFECT 2 — the hub never echoes the request id.
//
//   The bridge's `send()`:
//     const id = msgId++;
//     pending.set(id, { resolve, reject });
//     ws.send(JSON.stringify({ id, type, ...data }));
//     setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(...) } }, 5000);
//
//   and its inbound handler resolves ONLY on `msg.id && pending.has(msg.id)`.
//
//   MEASURED 2026-11-17 against the LIVE hub (vm153:8082): of 5 reply frames
//   to 4 requests carrying ids 'ID-A'..'ID-D', **0** carried an `id` key.
//   So every `pending` entry can only be resolved by the 5000 ms timeout —
//   every WebSocket-backed tool call takes 5 s and then FAILS.
//
//   The hub's own code confirms it: `ws_server.ts` has 20 `this.send(...)`
//   call sites and NOT ONE of them echoes the inbound request's id. The
//   bridge's `id` is a wire-only artefact.
//
// DEFECT 3 — three of the seven message types the bridge sends do not exist
//   on the hub.
//
//   MEASURED 2026-11-17 against the LIVE hub:
//     memory.list    -> error / unknown_type
//     memory.read    -> error / unknown_type
//     topic_history  -> error / unknown_type
//     memory_write   -> memory_update      (OK)
//     topics_list    -> topics_list        (OK)
//     join           -> history            (OK)
//     message        -> message            (OK)
//
//   The hub implements `memory_read` (underscore), not `memory.read`; and it
//   has NO type for "list memories" or "topic history" at all — history is
//   delivered as a side effect of `join`.
//
// These arms are SOURCE-SHAPE arms plus a live-hub arm. The live-hub arm is
// marked `skip` unless WOCLAW_TEST_HUB is set, so the suite stays hermetic
// by default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SRC = readFileSync(join(__dirname, '..', 'src', 'index.js'), 'utf-8');
const HUB_SRC = readFileSync(
  join(__dirname, '..', '..', 'hub', 'src', 'ws_server.ts'), 'utf-8');

const LIVE_HUB = process.env.WOCLAW_TEST_HUB === '1';

// ---------------------------------------------------------------------------
// Arm F — DEFECT 2, source shape: the hub has no id echo.
//
// The bridge correlates on `msg.id`. The hub must therefore echo the id for
// the correlation to work. It does not: every `this.send(...)` site builds
// its payload without the request id.
//
// This is a SOURCE arm, so it is hermetic. The live confirmation is arm H.
// ---------------------------------------------------------------------------
test('R547/F — the hub never echoes the request id (source shape: no send site carries the inbound id)', () => {
  // Every outbound send site in the hub, with its payload body.
  const sendSites = [...HUB_SRC.matchAll(/this\.send\([^,]+,\s*\{([\s\S]*?)\}\s*\)/g)].map((m) => m[1]);
  assert.ok(sendSites.length >= 10,
    `expected at least 10 this.send(...) payload sites in ws_server.ts, found ${sendSites.length}`);

  // The NEGATIVE control inside this arm: the hub DOES have an `id` concept
  // in the file (delegation ids, uuidv4(), etc.), so a zero here is evidence
  // about the SEND SITES, not about the file's vocabulary.
  assert.ok(/\bid\s*:/g.test(HUB_SRC),
    'sanity: ws_server.ts must contain id: somewhere, or this arm proves nothing');

  // The precise claim: NO send site echoes the INBOUND request id. The hub
  // does use the `id` key for domain objects (a generated message uuid, a
  // delegation id) — those are NOT echoes of the caller's request id, so the
  // arm must distinguish them rather than count the key.
  //
  // The bridge's correlation needs `reply.id === request.id`. The request id
  // arrives as `msg.id`. So the claim is: no send site assigns `id` FROM
  // `msg.id`.
  const echoingMsgId = sendSites.filter((p) => /(?<![a-z_])id\s*:\s*msg\.id\b/.test(p));
  assert.strictEqual(echoingMsgId.length, 0,
    `a send site now echoes msg.id — the bridge's correlation may work now; ` +
    `re-measure before assuming the defect is still present (sites: ` +
    `${JSON.stringify(echoingMsgId)})`);

  // And the corroborating fact: the ids the hub DOES put on the wire are
  // domain ids it generated itself, never the caller's request id.
  //
  // NOTE the lookbehind: `run_id:` also ENDS in `id:`, so a plain /\bid:/ match
  // would count it. The key must be exactly `id`.
  const domainIdSites = sendSites.filter((p) => /(?<![a-z_])id\s*:/.test(p));
  for (const p of domainIdSites) {
    assert.ok(/(?<![a-z_])id\s*:\s*(uuidv4\(\)|[^,\n]*\.id\b|message\.id\b|delegation\.id\b)/.test(p),
      `an unexplained id assignment appeared in a send site — re-measure: ${JSON.stringify(p)}`);
  }
});

// ---------------------------------------------------------------------------
// Arm G — DEFECT 3, source shape: the bridge sends types the hub does not
// implement.
//
// The bridge's `send('memory.list', ...)` calls reach the hub's
// `default:` branch, which replies `unknown_type`.
// ---------------------------------------------------------------------------
test('R547/G — every message type the bridge sends is implemented by the hub', () => {
  // The types the hub implements (its switch cases).
  const hubTypes = new Set(
    [...HUB_SRC.matchAll(/case '([a-z_.]+)':/g)].map((m) => m[1]),
  );
  assert.ok(hubTypes.size >= 8,
    `expected at least 8 hub message types, found ${hubTypes.size}: ${[...hubTypes]}`);

  // The types the bridge sends.
  const bridgeTypes = new Set(
    [...BRIDGE_SRC.matchAll(/send\('([a-z_.]+)'/g)].map((m) => m[1]),
  );
  assert.ok(bridgeTypes.size >= 5,
    `expected at least 5 bridge message types, found ${bridgeTypes.size}: ${[...bridgeTypes]}`);

  const unsupported = [...bridgeTypes].filter((t) => !hubTypes.has(t)).sort();
  assert.deepStrictEqual(unsupported, [],
    `the bridge sends message types the hub does not implement — each one is ` +
    `answered with unknown_type: ${JSON.stringify(unsupported)}`);
});

// ---------------------------------------------------------------------------
// Arm H — DEFECT 2 and 3, LIVE hub confirmation (opt-in).
//
// Set WOCLAW_TEST_HUB=1 and WOCLAW_TEST_HUB_TOKEN=<token> to run it.
// ---------------------------------------------------------------------------
test('R547/H — LIVE hub: replies carry no id, and unsupported types get unknown_type', { skip: !LIVE_HUB }, async () => {
  const token = process.env.WOCLAW_TEST_HUB_TOKEN || '';
  const url = process.env.WOCLAW_TEST_HUB_URL || 'ws://vm153:8082';
  assert.ok(token, 'WOCLAW_TEST_HUB_TOKEN must be set for the live arm');

  const script = `
import { WebSocket } from 'ws';
const url = process.env.H_URL, token = process.env.H_TOKEN;
const ws = new WebSocket(url + '?agentId=r547-live-' + Date.now() + '&token=' + token);
const frames = [];
ws.on('message', (d) => { try { frames.push(JSON.parse(d.toString())); } catch (e) {} });
ws.on('open', () => {
  ws.send(JSON.stringify({ id: 'ID-A', type: 'topics_list' }));
  ws.send(JSON.stringify({ id: 'ID-B', type: 'memory.list', tags: '' }));
  ws.send(JSON.stringify({ id: 'ID-C', type: 'memory.read', key: 'k' }));
  ws.send(JSON.stringify({ id: 'ID-D', type: 'topic_history', topic: 'general' }));
  setTimeout(() => { console.log(JSON.stringify(frames)); process.exit(0); }, 2500);
});
ws.on('error', (e) => { console.log(JSON.stringify([{ error: e.message }])); process.exit(1); });
`;
  const res = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, H_URL: url, H_TOKEN: token },
      cwd: join(__dirname, '..', '..'),
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('exit', () => resolve(out));
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(out); }, 15000);
  });

  const frames = JSON.parse(res);
  const replies = frames.filter((f) => f && f.type && f.type !== 'welcome');
  assert.ok(replies.length >= 4, `expected at least 4 reply frames, got ${replies.length}`);

  // DEFECT 2: not one reply carries the request id.
  const withId = replies.filter((f) => 'id' in f);
  assert.strictEqual(withId.length, 0,
    `a reply now carries an id — re-measure before assuming the defect is still present: ` +
    `${JSON.stringify(withId)}`);

  // DEFECT 3: the three unsupported types get unknown_type.
  const unknown = replies.filter((f) => f.type === 'error' && f.code === 'unknown_type');
  assert.strictEqual(unknown.length, 3,
    `expected exactly 3 unknown_type replies (memory.list, memory.read, topic_history), ` +
    `got ${unknown.length}: ${JSON.stringify(unknown.map((u) => u.message))}`);
});
