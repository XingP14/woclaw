#!/usr/bin/env node
/**
 * WoClaw Claude Code Migration Tool
 *
 * Imports Claude Code history.jsonl into WoClaw Hub.
 *
 * Usage:
 *   node claude-migrate.js --list
 *   node claude-migrate.js --session-id <id>
 *   node claude-migrate.js --all [--limit <n>]
 *
 * Environment:
 *   CLAUDE_HISTORY_FILE - Claude history file (default: ~/.claude/history.jsonl)
 *   WOCLAW_HUB_URL      - Hub REST URL (default: http://vm153:8083)
 *   WOCLAW_TOKEN        - Auth token (default: WoClaw2026)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const CLAUDE_HISTORY_FILE = process.env.CLAUDE_HISTORY_FILE || path.join(HOME, '.claude', 'history.jsonl');
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
WoClaw Claude Code Migration Tool

Usage:
  node claude-migrate.js --list                    List available history sessions
  node claude-migrate.js --session-id <id>         Import a specific history session
  node claude-migrate.js --all [--limit <n>]       Import all sessions (default: 10)

Environment:
  CLAUDE_HISTORY_FILE - history.jsonl path (default: ~/.claude/history.jsonl)
  WOCLAW_HUB_URL      - Hub REST URL (default: http://vm153:8083)
  WOCLAW_TOKEN        - Auth token (default: WoClaw2026)
`);
}

function extractEntryText(entry) {
  const parts = [];
  if (entry.display) parts.push(entry.display);
  if (entry.pastedContents && typeof entry.pastedContents === 'object') {
    for (const pasted of Object.values(entry.pastedContents)) {
      if (pasted?.content) parts.push(pasted.content);
    }
  }
  return parts.filter(Boolean).join('\n');
}

async function loadHistorySessions() {
  if (!fs.existsSync(CLAUDE_HISTORY_FILE)) return new Map();

  const rl = readline.createInterface({ input: fs.createReadStream(CLAUDE_HISTORY_FILE) });
  const sessions = new Map();

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line.trim());
      const sessionId = entry.sessionId || 'unknown';
      const existing = sessions.get(sessionId) || {
        sessionId,
        project: entry.project || null,
        firstTimestamp: entry.timestamp || null,
        lastTimestamp: entry.timestamp || null,
        entries: [],
      };

      if (!existing.project && entry.project) existing.project = entry.project;
      if (!existing.firstTimestamp && entry.timestamp) existing.firstTimestamp = entry.timestamp;
      if (entry.timestamp) existing.lastTimestamp = entry.timestamp;
      existing.entries.push({
        timestamp: entry.timestamp || null,
        display: entry.display || '',
        text: extractEntryText(entry),
      });
      sessions.set(sessionId, existing);
    } catch {
      // skip malformed lines
    }
  }

  return sessions;
}

function buildSummary(session) {
  const lines = [
    `# Claude Code Session: ${session.sessionId}`,
    `- History file: ${CLAUDE_HISTORY_FILE}`,
    `- Project: ${session.project || 'unknown'}`,
    `- Entries: ${session.entries.length}`,
    `- First seen: ${session.firstTimestamp || 'unknown'}`,
    `- Last seen: ${session.lastTimestamp || 'unknown'}`,
    '',
    '## Timeline',
  ];

  for (const entry of session.entries) {
    lines.push(`### ${entry.timestamp || 'unknown'}`);
    if (entry.display) lines.push(`- Display: ${entry.display}`);
    if (entry.text) {
      lines.push('```text');
      lines.push(entry.text);
      lines.push('```');
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function writeToHub(sessionId, summary) {
  const payload = JSON.stringify({
    key: `claude:session:${sessionId}`,
    value: summary,
    tags: ['claude-code', 'migrated', 'history'],
    updatedBy: 'claude-migrate',
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
    console.log(res.ok ? `  ✅ claude:session:${sessionId}` : `  ⚠️  claude:session:${sessionId} -> ${res.status}`);
  } catch (e) {
    console.log(`  ⚠️  claude:session:${sessionId} -> ${e.message}`);
  }
}

async function listSessions(limit = 20) {
  const sessions = await loadHistorySessions();
  console.log(`\n📋 Available Claude Code Sessions (${CLAUDE_HISTORY_FILE})\n`);
  if (sessions.size === 0) {
    console.log('  No sessions found.');
    console.log('');
    return;
  }

  const ordered = [...sessions.values()].sort((a, b) => String(b.lastTimestamp || '').localeCompare(String(a.lastTimestamp || '')));
  for (const session of ordered.slice(0, limit)) {
    console.log(`  - ${session.sessionId}  (${session.entries.length} entries)  ${session.project || 'no-project'}`);
  }
  console.log('');
}

async function main() {
  const sessions = await loadHistorySessions();

  if (mode === 'list') {
    await listSessions(limitCount);
    return;
  }

  if (mode === 'session-id') {
    const session = [...sessions.values()].find((s) => s.sessionId.includes(targetValue) || targetValue.includes(s.sessionId));
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
    const ordered = [...sessions.values()].sort((a, b) => String(b.lastTimestamp || '').localeCompare(String(a.lastTimestamp || '')));
    console.log(`\n🔄 Migrating Claude Code sessions from ${CLAUDE_HISTORY_FILE}...\n`);
    let migrated = 0;
    for (const session of ordered.slice(0, limitCount)) {
      const summary = buildSummary(session);
      console.log(`  → ${session.sessionId} (${session.entries.length} entries)`);
      await writeToHub(session.sessionId, summary);
      migrated++;
    }
    console.log(`\n✅ Migrated ${migrated} Claude Code sessions\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
