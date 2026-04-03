#!/usr/bin/env node
/**
 * WoClaw CLI v0.4 - Interactive CLI for WoClaw Hub
 * REST API + WebSocket support, interactive shell, JSON mode
 */
import WebSocket from 'ws';
import readline from 'readline';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';

// === CONFIG ===
const HUB_REST = process.env.WOCLAW_REST_URL
  || (process.env.WOCLAW_HUB_URL ? process.env.WOCLAW_HUB_URL.replace('ws://', 'http://').replace('wss://', 'https://') : null)
  || 'http://localhost:8083';
const HUB_WS = process.env.WOCLAW_WS_URL || process.env.WOCLAW_HUB_URL || 'ws://localhost:8082';
const HUB_TOKEN = process.env.WOCLAW_TOKEN || 'WoClaw2026';
const AGENT_ID = process.env.WOCLAW_AGENT_ID || 'woclaw-cli-' + Math.random().toString(36).slice(2, 7);
const HISTORY_FILE = path.join(os.homedir(), '.woclaw', 'cli-history');

// === FLAGS ===
const args = process.argv.slice(2);
let i = 0;
let JSON_MODE = false;
let SHOW_HELP = false;
while (i < args.length && args[i]?.startsWith('--')) {
  const flag = args[i++];
  if (flag === '--hub' && args[i]) HUB_REST = args[i++];
  else if (flag === '--ws' && args[i]) HUB_WS = args[i++];
  else if (flag === '--token' && args[i]) HUB_TOKEN = args[i++];
  else if (flag === '--json') JSON_MODE = true;
  else if (flag === '--help' || flag === '-h') SHOW_HELP = true;
}
const command = args[i];
const cmdArgs = args.slice(i + 1);
const INTERACTIVE = !command && process.stdin.isTTY;

// === COLORS ===
const dim = s => JSON_MODE ? '' : `\x1b[2m${s}\x1b[0m`;
const bold = s => JSON_MODE ? '' : `\x1b[1m${s}\x1b[0m`;
const green = s => JSON_MODE ? '' : `\x1b[32m${s}\x1b[0m`;
const red = s => JSON_MODE ? '' : `\x1b[31m${s}\x1b[0m`;
const cyan = s => JSON_MODE ? '' : `\x1b[36m${s}\x1b[0m`;
const yellow = s => JSON_MODE ? '' : `\x1b[33m${s}\x1b[0m`;

const log = (...a) => { if (!JSON_MODE) console.log(...a); };
const err = (...a) => { if (!JSON_MODE) console.error(...a); else console.error(JSON.stringify({error: a[0]})); };
const out = (d) => { JSON_MODE ? console.log(JSON.stringify(d, null, 2)) : null; };

// === USAGE ===
function usage() {
  log(bold('WoClaw CLI') + ' v0.4.0 \u2014 Connect to WoClaw Hub');
  log('');
  log(bold('REST API Commands:'));
  log('  ' + cyan('status') + '                Hub health check');
  log('  ' + cyan('topics') + '                List topics');
  log('  ' + cyan('topics <name> [n]') + '     Topic messages (default n=50)');
  log('  ' + cyan('memory') + '                List memory keys');
  log('  ' + cyan('memory <key>') + '           Read memory value');
  log('  ' + cyan('memory write <k> <v>') + '  Write memory');
  log('  ' + cyan('memory delete <key>') + '   Delete memory');
  log('  ' + cyan('agents') + '                 Connected agents');
  log('');
  log(bold('WebSocket Commands:'));
  log('  ' + cyan('send <topic> <msg>') + '      Send message');
  log('  ' + cyan('join <topic>') + '            Join topic and listen');
  log('');
  log(bold('Modes:'));
  log('  (no args)' + dim('            Interactive shell'));
  log('  ' + cyan('--json') + dim('                 JSON output'));
  log('');
  log(bold('Options:'));
  log('  ' + dim('--hub <url>') + '   REST URL');
  log('  ' + dim('--ws <url>') + '    WebSocket URL');
  log('  ' + dim('--token <t>') + '   Auth token');
  log('  ' + dim('--json') + '        JSON mode');
  log('');
  log(bold('Env:') + dim(' WOCLAW_REST_URL, WOCLAW_WS_URL, WOCLAW_TOKEN'));
}

// === REST ===
async function rest(p, opts = {}) {
  const url = HUB_REST + p;
  const h = { 'Content-Type': 'application/json' };
  if (HUB_TOKEN) h['Authorization'] = 'Bearer ' + HUB_TOKEN;
  const r = await fetch(url, { ...opts, headers: { ...h, ...(opts.headers||{}) } });
  if (!r.ok) throw new Error(r.status + ' ' + r.statusText + ': ' + await r.text());
  return r.json();
}

function uptime(s) {
  const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60), sec = Math.floor(s%60);
  if (d) return d+'d '+h+'h '+m+'m';
  if (h) return h+'h '+m+'m '+sec+'s';
  return m+'m '+sec+'s';
}

// === COMMANDS ===
async function cmdStatus() {
  const d = await rest('/health');
  if (JSON_MODE) return out(d);
  log(bold('WoClaw Hub') + ' \u2014 ' + green('\u25cf Online'));
  log('  URL:      ' + HUB_REST);
  log('  Uptime:   ' + uptime(d.uptime));
  log('  Agents:   ' + d.agents);
  log('  Topics:   ' + d.topics);
}

async function cmdTopics() {
  const d = await rest('/topics');
  if (JSON_MODE) return out(d);
  if (!d.topics?.length) return log('No topics yet.');
  for (const t of d.topics) log('  ' + cyan(t.name) + '  \u2014 ' + t.agents + ' agent' + (t.agents!==1?'s':''));
}

async function cmdTopicMsgs(topic, limit=50) {
  const d = await rest('/topics/' + encodeURIComponent(topic) + '?limit=' + limit);
  if (JSON_MODE) return out(d);
  log(bold('Topic: ' + cyan(topic)) + ' (' + d.count + ' msgs)');
  if (!d.messages?.length) return log('  No messages.');
  for (const m of d.messages) {
    const t = new Date(m.timestamp).toISOString().replace('T',' ').slice(0,19);
    log('  ' + dim(t) + ' ' + yellow(m.from||'system') + ': ' + m.content);
  }
}

async function cmdMemoryList() {
  const d = await rest('/memory');
  if (JSON_MODE) return out(d);
  if (!d.memory?.length) return log('No memory entries.');
  for (const m of d.memory) {
    const pv = typeof m.value=='string'&&m.value.length>60 ? m.value.slice(0,60)+'...' : m.value;
    log('  ' + cyan(m.key) + ' = ' + pv + ' ' + dim('('+(m.tags?.join(',')||'no tags')+') by '+(m.updatedBy||'?')));
  }
}

async function cmdMemoryRead(key) {
  const d = await rest('/memory/' + encodeURIComponent(key));
  if (JSON_MODE) return out(d);
  log(bold('Memory: ' + cyan(key)));
  log('  Value:   ' + d.value);
  log('  Tags:    ' + (d.tags?.join(', ') || '(none)'));
  log('  TTL:     ' + (d.ttl||'none'));
  log('  Updated: ' + (d.updatedBy||'?') + ' @ ' + (d.updatedAt ? new Date(d.updatedAt).toISOString() : '?'));
}

async function cmdMemoryWrite(key, value) {
  const d = await rest('/memory', { method:'POST', body: JSON.stringify({key,value}) });
  if (JSON_MODE) return out({success:true,...d});
  log(green('\u2713 Memory written: ' + key));
}

async function cmdMemoryDelete(key) {
  await rest('/memory/' + encodeURIComponent(key), { method:'DELETE' });
  if (JSON_MODE) return out({success:true,deleted:key});
  log(green('\u2713 Memory deleted: ' + key));
}

async function cmdAgents() {
  const d = await rest('/health');
  if (JSON_MODE) return out({agents:d.agents});
  log(bold('Connected Agents:') + ' ' + d.agents);
}

async function wsSend(topic, content) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(HUB_WS + '?agentId=' + AGENT_ID + '&token=' + HUB_TOKEN);
    const t = setTimeout(() => { ws.close(); res(); }, 2000);
    ws.on('open', () => ws.send(JSON.stringify({type:'message',topic,content})));
    ws.on('msg', (data) => { const m = JSON.parse(data); if (!JSON_MODE && (m.type==='ack'||m.type==='message')) log(green('\u2713 Sent to ' + topic)); });
    ws.on('error', (e) => { err(e.message); rej(e); });
    ws.on('close', () => { clearTimeout(t); res(); });
  });
}

async function wsJoin(topic) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(HUB_WS + '?agentId=' + AGENT_ID + '&token=' + HUB_TOKEN);
    if (!JSON_MODE) log(dim('[WS] Connecting...'));
    ws.on('open', () => {
      if (!JSON_MODE) log(green('\u2713 Joined: ' + topic));
      ws.send(JSON.stringify({type:'join',topic}));
      setTimeout(() => { ws.close(); res(); }, 5000);
    });
    ws.on('message', (data) => {
      const m = JSON.parse(data);
      if (JSON_MODE) return out(m);
      if (m.type === 'message') log(dim('['+m.topic+']') + ' ' + yellow(m.from||'?') + ': ' + m.content);
      else if (m.type === 'join' || m.type === 'leave') log(dim('['+m.topic+']') + ' ' + (m.agent||m.from) + ' ' + (m.type==='join'?'joined':'left'));
      else if (m.type === 'welcome') log(dim('[WS] Welcome! ' + m.agentId));
    });
    ws.on('error', (e) => { err(e.message); rej(e); });
    ws.on('close', () => res());
  });
}

// === INTERACTIVE SHELL ===
async function shell() {
  const histDir = path.dirname(HISTORY_FILE);
  if (!existsSync(histDir)) try { mkdirSync(histDir, {recursive:true}); } catch {}
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line) => {
      const cmds = ['status','topics','memory','agents','send','join','help','exit','quit','clear','set'];
      const hits = cmds.filter(c => c.startsWith(line.trim()));
      return [hits.length ? hits : [], line];
    },
    path: HISTORY_FILE,
  });
  if (!JSON_MODE) {
    console.log(bold('WoClaw CLI') + ' v0.4.0 \u2014 Interactive (type ' + cyan('help') + dim(' for commands)'));
    console.log(dim('Hub: ' + HUB_REST + ' | Token: ' + HUB_TOKEN.slice(0,4) + '***'));
    console.log('');
  }
  const prompt = JSON_MODE ? '' : cyan('woclaw') + '> ';
  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    const a = parts.slice(1);
    if (!cmd || cmd.startsWith('#')) return;
    try {
      if (cmd==='help'||cmd==='?') usage();
      else if (cmd==='status') await cmdStatus();
      else if (cmd==='topics') { if (!a[0]) await cmdTopics(); else await cmdTopicMsgs(a[0], parseInt(a[1]||'50')); }
      else if (cmd==='memory') { if (!a[0]) await cmdMemoryList(); else if (a[0]==='write') await cmdMemoryWrite(a[1], a.slice(2).join(' ')); else if (a[0]==='delete') await cmdMemoryDelete(a[1]); else await cmdMemoryRead(a[0]); }
      else if (cmd==='agents') await cmdAgents();
      else if (cmd==='send') { if (!a[0]||!a[1]) err('Usage: send <topic> <msg>'); else await wsSend(a[0], a.slice(1).join(' ')); }
      else if (cmd==='join') { if (!a[0]) err('Usage: join <topic>'); else await wsJoin(a[0]); }
      else if (cmd==='exit'||cmd==='quit'||cmd==='q') { if (!JSON_MODE) log(dim('Goodbye!')); rl.close(); process.exit(0); }
      else if (cmd==='clear'||cmd==='cls') console.clear();
      else if (cmd==='set') { if (a[0]==='hub'&&a[1]) process.env.WOCLAW_REST_URL=a[1]; else if (a[0]==='ws'&&a[1]) process.env.WOCLAW_WS_URL=a[1]; else err('Usage: set hub|ws <url>'); }
      else err('Unknown: ' + cmd + '. Type ' + cyan('help'));
    } catch(e) { err(e.message); }
  });
  rl.on('close', () => process.exit(0));
}

// === MAIN ===
async function main() {
  if (SHOW_HELP) { usage(); return; }
  if (INTERACTIVE) { await shell(); return; }
  if (!command || command==='help'||command==='shell') { if (command==='shell') await shell(); else usage(); return; }
  try {
    if (command==='status') await cmdStatus();
    else if (command==='topics') { if (!cmdArgs[0]) await cmdTopics(); else await cmdTopicMsgs(cmdArgs[0], parseInt(cmdArgs[1]||'50')); }
    else if (command==='memory') { if (!cmdArgs[0]) await cmdMemoryList(); else if (cmdArgs[0]==='write') { if (!cmdArgs[1]||!cmdArgs[2]) { err('Usage: memory write <key> <value>'); process.exit(1); } await cmdMemoryWrite(cmdArgs[1], cmdArgs.slice(2).join(' ')); } else if (cmdArgs[0]==='delete') { if (!cmdArgs[1]) { err('Usage: memory delete <key>'); process.exit(1); } await cmdMemoryDelete(cmdArgs[1]); } else await cmdMemoryRead(cmdArgs[0]); }
    else if (command==='agents') await cmdAgents();
    else if (command==='send') { if (!cmdArgs[0]||!cmdArgs[1]) { err('Usage: send <topic> <msg>'); process.exit(1); } await wsSend(cmdArgs[0], cmdArgs.slice(1).join(' ')); }
    else if (command==='join') { if (!cmdArgs[0]) { err('Usage: join <topic>'); process.exit(1); } await wsJoin(cmdArgs[0]); }
    else { err('Unknown: ' + command); usage(); process.exit(1); }
  } catch(e) { err(e.message); process.exit(1); }
}

main();
