#!/usr/bin/env node
/**
 * WoClaw Gemini CLI Session Migrate Parser
 * 
 * Usage:
 *   node gemini-migrate.js --list
 *   node gemini-migrate.js --session-id <id>
 *   node gemini-migrate.js --all [--limit <n>]
 * 
 * Environment:
 *   GEMINI_HOME        - Gemini CLI config dir (default: ~/.gemini)
 *   WOCLAW_HUB_URL    - Hub REST URL (default: http://vm153:8083)
 *   WOCLAW_TOKEN      - Auth token (default: WoClaw2026)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const GEMINI_HOME = process.env.GEMINI_HOME || path.join(HOME, '.gemini');
const WOCLAW_HUB_URL = process.env.WOCLAW_HUB_URL || 'http://vm153:8083';
const WOCLAW_TOKEN = process.env.WOCLAW_TOKEN || 'WoClaw2026';

// ─── CLI ─────────────────────────────────────────────────────────────────────

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

if (!mode) { printHelp(); process.exit(1); }

function printHelp() {
  console.log(`
WoClaw Gemini CLI Session Migrate Parser

Usage:
  node gemini-migrate.js --list                    List available sessions
  node gemini-migrate.js --session-id <id>        Parse specific session
  node gemini-migrate.js --all [--limit <n>]       Migrate all sessions

Environment:
  GEMINI_HOME        - Gemini CLI config (default: ~/.gemini)
  WOCLAW_HUB_URL    - Hub REST URL (default: http://vm153:8083)
  WOCLAW_TOKEN      - Auth token (default: WoClaw2026)
`);
}

// ─── Gemini CLI Session Format ────────────────────────────────────────────────

/**
 * Gemini CLI session storage:
 * - ~/.gemini/sessions/  (per-session JSON files)
 * - ~/.gemini/history.jsonl  (global history)
 * 
 * Ref: S15-1 research doc when available
 */
function getSessionsDir() {
  return path.join(GEMINI_HOME, 'sessions');
}

function getHistoryFile() {
  return path.join(GEMINI_HOME, 'history.jsonl');
}

/**
 * List available Gemini CLI sessions
 */
async function listSessions(limit = 20) {
  const sessionsDir = getSessionsDir();
  const historyFile = getHistoryFile();

  console.log(`\n📋 Available Gemini CLI Sessions\n`);
  console.log(`  Sessions dir: ${sessionsDir}`);
  console.log(`  History file: ${historyFile}`);
  console.log('');

  if (fs.existsSync(historyFile)) {
    let count = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(historyFile) });
    for await (const line of rl) {
      if (!line.trim() || count >= limit) break;
      try {
        const entry = JSON.parse(line.trim());
        const id = entry.session_id || entry.id || 'unknown';
        const date = entry.created_at || entry.timestamp || 'unknown';
        console.log(`  ${id}  ${date}`);
        count++;
      } catch { /* skip */ }
    }
  }

  if (fs.existsSync(sessionsDir)) {
    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (limit <= 0) break;
      console.log(`  [dir] ${entry.name}`);
      limit--;
    }
  }

  console.log('');
}

/**
 * Parse a Gemini CLI session
 */
async function parseSession(sessionId) {
  // Try history file first
  const historyFile = getHistoryFile();
  if (fs.existsSync(historyFile)) {
    const rl = readline.createInterface({ input: fs.createReadStream(historyFile) });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line.trim());
        const id = entry.session_id || entry.id || '';
        if (id.includes(sessionId) || sessionId.includes(id)) {
          return extractInsights(entry);
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

function extractInsights(entry) {
  return {
    session_id: entry.session_id || entry.id || 'unknown',
    created_at: entry.created_at || entry.timestamp || null,
    stats: { messages: entry.messages?.length || 0 },
    tools_used: [],
    key_findings: [],
  };
}

function buildSummary(insights) {
  return [
    `# Gemini CLI Session: ${insights.session_id}`,
    `**Created**: ${insights.created_at || 'unknown'}`,
    `**Messages**: ${insights.stats.messages}`,
    insights.tools_used.length > 0 ? `**Tools**: ${insights.tools_used.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

async function writeToHub(sessionId, summary) {
  const payload = JSON.stringify({
    key: `gemini:session:${sessionId}`,
    value: summary,
    tags: ['gemini-cli', 'migrated'],
    updatedBy: 'gemini-migrate',
  });
  try {
    const res = await fetch(`${WOCLAW_HUB_URL}/memory`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WOCLAW_TOKEN}`, 'Content-Type': 'application/json' },
      body: payload,
    });
    console.log(res.ok ? `  ✅ gemini:session:${sessionId}` : `  ⚠️  ${res.status}`);
  } catch (e) {
    console.log(`  ⚠️  ${e.message}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (mode === 'list') {
    await listSessions(limitCount);
    return;
  }

  if (mode === 'session-id') {
    const insights = await parseSession(targetValue);
    if (insights) {
      console.log(buildSummary(insights));
      await writeToHub(insights.session_id, buildSummary(insights));
    } else {
      console.log(`Session not found: ${targetValue}`);
    }
    return;
  }

  if (mode === 'all') {
    console.log('\n🔄 Migrating Gemini CLI sessions...\n');
    const historyFile = getHistoryFile();
    if (!fs.existsSync(historyFile)) {
      console.log('No history file found. Gemini CLI may not be installed.');
      return;
    }
    let migrated = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(historyFile) });
    for await (const line of rl) {
      if (!line.trim() || migrated >= limitCount) continue;
      try {
        const entry = JSON.parse(line.trim());
        const insights = extractInsights(entry);
        if (insights.stats.messages > 0) {
          console.log(`  → ${insights.session_id} (${insights.stats.messages} msgs)`);
          await writeToHub(insights.session_id, buildSummary(insights));
          migrated++;
        }
      } catch { /* skip */ }
    }
    console.log(`\n✅ Migrated ${migrated} Gemini CLI sessions\n`);
  }
}

main().catch(console.error);
