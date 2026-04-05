#!/usr/bin/env node
/**
 * WoClaw Gemini CLI Migration Tool
 *
 * Imports Gemini chat files from ~/.gemini/tmp/<project>/chats/*.json into WoClaw Hub.
 *
 * Usage:
 *   node gemini-migrate.js --list
 *   node gemini-migrate.js --session-id <id>
 *   node gemini-migrate.js --all [--limit <n>]
 *
 * Environment:
 *   GEMINI_HOME     - Gemini home dir (default: ~/.gemini)
 *   WOCLAW_HUB_URL  - Hub REST URL (default: http://vm153:8083)
 *   WOCLAW_TOKEN    - Auth token (default: WoClaw2026)
 */

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const GEMINI_HOME = process.env.GEMINI_HOME || path.join(HOME, '.gemini');
const WOCLAW_HUB_URL = process.env.WOCLAW_HUB_URL || 'http://vm153:8083';
const WOCLAW_TOKEN = process.env.WOCLAW_TOKEN || 'WoClaw2026';

const args = process.argv.slice(2);
let mode = null;
let targetValue = null;
let limitCount = 10;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--list') mode = 'list';
  else if (arg === '--all') mode = 'all';
  else if (arg === '--session-id' && i + 1 < args.length) {
    mode = 'session-id';
    targetValue = args[++i];
  } else if (arg === '--limit' && i + 1 < args.length) {
    limitCount = parseInt(args[++i], 10) || 10;
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

if (!mode) {
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log(`
WoClaw Gemini CLI Migration Tool

Usage:
  node gemini-migrate.js --list                    List available Gemini chat sessions
  node gemini-migrate.js --session-id <id>         Import a specific Gemini session
  node gemini-migrate.js --all [--limit <n>]       Import all Gemini sessions (default: 10)

Environment:
  GEMINI_HOME     - Gemini home dir (default: ~/.gemini)
  WOCLAW_HUB_URL  - Hub REST URL (default: http://vm153:8083)
  WOCLAW_TOKEN    - Auth token (default: WoClaw2026)
`);
}

function normalizeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        if (typeof item.description === 'string') return item.description;
        return JSON.stringify(item);
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function discoverSessionFiles() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && full.endsWith('.json') && path.basename(path.dirname(full)) === 'chats') {
        files.push(full);
      }
    }
  };

  walk(path.join(GEMINI_HOME, 'tmp'));
  return files.sort((a, b) => a.localeCompare(b));
}

function loadSession(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const messages = Array.isArray(data.messages) ? data.messages : [];
    return {
      sessionId: data.sessionId || path.basename(filePath, '.json'),
      projectHash: data.projectHash || null,
      startTime: data.startTime || null,
      lastUpdated: data.lastUpdated || null,
      kind: data.kind || 'unknown',
      filePath,
      messages: messages.map((message) => ({
        id: message.id || null,
        timestamp: message.timestamp || null,
        type: message.type || 'unknown',
        text: normalizeText(message.content),
        thoughts: Array.isArray(message.thoughts) ? message.thoughts.map((t) => ({
          subject: t.subject || null,
          description: t.description || null,
          timestamp: t.timestamp || null,
        })) : [],
        tokens: message.tokens || null,
        model: message.model || null,
      })),
    };
  } catch {
    return null;
  }
}

function loadAllSessions() {
  return discoverSessionFiles()
    .map(loadSession)
    .filter(Boolean);
}

function buildSummary(session) {
  const lines = [
    `# Gemini CLI Session: ${session.sessionId}`,
    `- File: ${session.filePath}`,
    `- Project hash: ${session.projectHash || 'unknown'}`,
    `- Kind: ${session.kind}`,
    `- Start: ${session.startTime || 'unknown'}`,
    `- Last updated: ${session.lastUpdated || 'unknown'}`,
    `- Messages: ${session.messages.length}`,
    '',
    '## Transcript',
  ];

  for (const message of session.messages) {
    lines.push(`### ${message.timestamp || 'unknown'} · ${message.type}`);
    if (message.model) lines.push(`- Model: ${message.model}`);
    if (message.text) {
      lines.push('```text');
      lines.push(message.text);
      lines.push('```');
    }
    if (message.thoughts.length > 0) {
      lines.push('- Thoughts:');
      for (const thought of message.thoughts) {
        lines.push(`  - ${thought.timestamp || 'unknown'} · ${thought.subject || 'thought'}: ${thought.description || ''}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function writeToHub(sessionId, summary) {
  const payload = JSON.stringify({
    key: `gemini:session:${sessionId}`,
    value: summary,
    tags: ['gemini-cli', 'migrated', 'history'],
    updatedBy: 'gemini-migrate',
  });
  try {
    const res = await fetch(`${WOCLAW_HUB_URL}/memory`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WOCLAW_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    console.log(res.ok ? `  ✅ gemini:session:${sessionId}` : `  ⚠️  gemini:session:${sessionId} -> ${res.status}`);
  } catch (e) {
    console.log(`  ⚠️  gemini:session:${sessionId} -> ${e.message}`);
  }
}

async function listSessions(limit = 20) {
  const sessions = loadAllSessions();
  console.log(`\n📋 Available Gemini CLI Sessions (${GEMINI_HOME})\n`);
  if (sessions.length === 0) {
    console.log('  No Gemini sessions found.');
    console.log('');
    return;
  }

  for (const session of sessions.slice(0, limit)) {
    console.log(`  - ${session.sessionId}  (${session.messages.length} messages)  ${session.startTime || 'unknown'}`);
  }
  console.log('');
}

async function main() {
  const sessions = loadAllSessions();

  if (mode === 'list') {
    await listSessions(limitCount);
    return;
  }

  if (mode === 'session-id') {
    const session = sessions.find((s) => s.sessionId.includes(targetValue) || targetValue.includes(s.sessionId));
    if (!session) {
      console.log(`Session not found: ${targetValue}`);
      return;
    }
    const summary = buildSummary(session);
    console.log(summary);
    await writeToHub(session.sessionId, summary);
    return;
  }

  if (mode === 'all') {
    console.log(`\n🔄 Migrating Gemini CLI sessions from ${GEMINI_HOME}...\n`);
    let migrated = 0;
    for (const session of sessions.slice(0, limitCount)) {
      const summary = buildSummary(session);
      console.log(`  → ${session.sessionId} (${session.messages.length} messages)`);
      await writeToHub(session.sessionId, summary);
      migrated++;
    }
    console.log(`\n✅ Migrated ${migrated} Gemini CLI sessions\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
