// R480 probe — bounded-execution / runaway-containment plane.
// Question: what bounds ONE admission (one run, one envelope) in the hub?
// Method: drive the REAL validator + the REAL db write path, then read the
// production surfaces that could have bounded them.
import { validateAgentStream } from '../src/agent_stream.js';
import type { StreamEvent, StreamEnvelope } from '../src/agent_stream.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB = join(dirname(fileURLToPath(import.meta.url)), '..');

function envelope(nEvents: number): StreamEnvelope {
  const events: StreamEvent[] = [
    { event: 'start', ts: 1737000000010, schema_version: '1.0', model: 'probe', mode: 'single' },
  ];
  for (let i = 1; i < nEvents; i++) {
    events.push({ event: 'assistant_text', ts: 1737000000010 + i, role: 'single', text: 'x'.repeat(512) });
  }
  events.push({ event: 'result', ts: 1737000009999, exit: 'ok' });
  return {
    schema_version: '1.0',
    run_id: '0190f1b6-3f9b-7c8d-9e0a-1b2c3d4e5f60',
    agent_id: 'probe',
    started_at: 1737000000000,
    events,
  };
}

console.log('--- A: how many events does the REAL validator accept? ---');
for (const n of [3, 1000, 100_000]) {
  const env = envelope(n);
  const issues = validateAgentStream(env);
  const bytes = Buffer.byteLength(JSON.stringify(env.events));
  console.log(`events=${n} issues=${issues.length} bytes=${bytes} (${(bytes / 1048576).toFixed(1)} MiB)`);
}

console.log('\n--- B: does a repeat/cycle detector exist anywhere in prod src? ---');
const srcFiles = ['ws_server.ts', 'rest_server.ts', 'topics.ts', 'agent_stream.ts', 'scheduler.ts', 'memory.ts', 'federation.ts', 'db.ts'];
const families: Array<[string, RegExp]> = [
  ['run/step cap', /\bmax_?steps?\b|\bmax_?events\b|\bmax_?runs?\b/i],
  ['budget cap', /max_?(usd|token|budget|cost)|budget_?cap|quota/i],
  ['wall-clock cap', /max_?(seconds|ms|duration)|deadline|timed_?out/i],
  ['loop/repeat detect', /repeat|circular|cycle|seen_?(call|tool)|fingerprint/i],
  ['backpressure', /bufferedAmount|drain|back_?pressure/i],
  ['kill switch', /kill_?switch|emergency_?stop|halt/i],
];
for (const [name, re] of families) {
  const hits: string[] = [];
  for (const f of srcFiles) {
    const text = readFileSync(join(HUB, 'src', f), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  console.log(`${name.padEnd(18)} hits=${hits.length} ${hits.slice(0, 6).join(' ')}`);
}

console.log('\n--- C: is the ws maxPayload bounded by the hub or inherited from ws? ---');
const wsText = readFileSync(join(HUB, 'src', 'ws_server.ts'), 'utf8');
const m = wsText.match(/new WebSocketServer\([^)]*\)/);
console.log('hub construction:', m ? m[0] : 'NOT FOUND');
console.log('hub sets maxPayload anywhere:', /maxPayload/.test(wsText));

console.log('\n--- D: REST body accumulation cap? ---');
const restText = readFileSync(join(HUB, 'src', 'rest_server.ts'), 'utf8');
console.log('rest_server.ts sets any byte cap:', /maxBody|maxBytes|content-length|bodyLimit|\d{6,}/.test(restText));
