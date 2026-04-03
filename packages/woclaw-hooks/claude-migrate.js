#!/usr/bin/env node
/**
 * WoClaw Claude Code Session Migrate Parser
 * 
 * Usage:
 *   node claude-migrate.js --session-dir <path> [--list] [--dry-run]
 *   node claude-migrate.js --all [--limit <n>]
 * 
 * Environment:
 *   CODEX_HOME        - (not used for Claude Code)
 *   WOCLAW_HUB_URL   - Hub REST URL (default: http://vm153:8083)
 *   WOCLAW_TOKEN     - Auth token (default: WoClaw2026)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const WOCLAW_HUB_URL = process.env.WOCLAW_HUB_URL || 'http://vm153:8083';
const WOCLAW_TOKEN = process.env.WOCLAW_TOKEN || 'WoClaw2026';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let mode = null;
let targetValue = null;
let limitCount = 10;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--list') mode = 'list';
  else if (arg === '--all') mode = 'all';
  else if (arg === '--session-dir' && i + 1 < args.length) {
    mode = 'session-dir';
    targetValue = args[++i];
  } else if (arg === '--limit' && i + 1 < args.length) {
    limitCount = parseInt(args[++i], 10) || 10;
  } else if (arg === '--dry-run') dryRun = true;
  else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

if (!mode) { printHelp(); process.exit(1); }

function printHelp() {
  console.log(`
WoClaw Claude Code Session Migrate Parser

Usage:
  node claude-migrate.js --list                    List available sessions
  node claude-migrate.js --session-dir <path>     Parse session directory
  node claude-migrate.js --all [--limit <n>]      Migrate all sessions

Environment:
  WOCLAW_HUB_URL   - Hub REST URL (default: http://vm153:8083)
  WOCLAW_TOKEN     - Auth token (default: WoClaw2026)
`);
}

// ─── Claude Code Session Format ──────────────────────────────────────────────

/**
 * Claude Code stores sessions under ~/.claude/sessions/
 * Format: sessions/<date>/<session-id>.jsonl
 */
function getSessionsDir() {
  return path.join(HOME, '.claude', 'sessions');
}

/**
 * List all Claude Code sessions
 */
async function listSessions(limit = 20) {
  const sessionsDir = getSessionsDir();
  if (!fs.existsSync(sessionsDir)) {
    console.log('No sessions directory found. Claude Code may not be installed.');
    return;
  }

  console.log(`\n📋 Available Claude Code Sessions (${sessionsDir})\n`);
  let count = 0;

  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dateDir = path.join(sessionsDir, entry.name);
    const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.jsonl')).slice(0, 3);
    for (const file of files) {
      if (count >= limit) break;
      const filePath = path.join(dateDir, file);
      const stats = fs.statSync(filePath);
      const sessionId = file.replace('.jsonl', '');
      console.log(`  ${entry.name}/${file}  (${Math.round(stats.size / 1024)}KB)  ${sessionId}`);
      count++;
    }
  }
  if (count === 0) console.log('  (no sessions found)');
  console.log('');
}

/**
 * Parse a Claude Code session file
 */
async function parseSessionFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return null;
  }

  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  const messages = [];
  let sessionMeta = {};

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line.trim());
      if (entry.type === 'session') {
        sessionMeta = entry;
      } else {
        messages.push(entry);
      }
    } catch { /* skip */ }
  }

  const insights = {
    session_id: path.basename(filePath, '.jsonl'),
    date: path.dirname(filePath).split('/').pop(),
    stats: { messages: messages.length },
    tools_used: [],
    files_modified: [],
    key_findings: [],
  };

  return insights;
}

/**
 * Build markdown summary from insights
 */
function buildSummary(insights) {
  return [
    `# Claude Code Session: ${insights.session_id}`,
    `**Date**: ${insights.date}`,
    `**Messages**: ${insights.stats.messages}`,
    insights.tools_used.length > 0 ? `**Tools**: ${insights.tools_used.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Write session summary to WoClaw Hub
 */
async function writeToHub(sessionId, summary) {
  if (dryRun) {
    console.log(`  [dry-run] Would write: codex:session:${sessionId}`);
    return;
  }
  const payload = JSON.stringify({
    key: `claude:session:${sessionId}`,
    value: summary,
    tags: ['claude-code', 'migrated'],
    updatedBy: 'claude-migrate',
  });
  try {
    const res = await fetch(`${WOCLAW_HUB_URL}/memory`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WOCLAW_TOKEN}`, 'Content-Type': 'application/json' },
      body: payload,
    });
    if (res.ok) console.log(`  ✅ codex:session:${sessionId}`);
    else console.log(`  ⚠️  ${res.status}`);
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

  if (mode === 'session-dir') {
    const insights = await parseSessionFile(targetValue);
    if (insights) {
      console.log(buildSummary(insights));
      await writeToHub(insights.session_id, buildSummary(insights));
    }
    return;
  }

  if (mode === 'all') {
    const sessionsDir = getSessionsDir();
    if (!fs.existsSync(sessionsDir)) {
      console.log('Claude Code sessions directory not found.');
      return;
    }
    console.log(`\n🔄 Migrating Claude Code sessions...\n`);
    let migrated = 0;
    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dateDir = path.join(sessionsDir, entry.name);
      const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.jsonl')).slice(0, limitCount);
      for (const file of files) {
        const insights = await parseSessionFile(path.join(dateDir, file));
        if (insights && insights.stats.messages > 0) {
          console.log(`  → ${insights.session_id} (${insights.stats.messages} msgs)`);
          await writeToHub(insights.session_id, buildSummary(insights));
          migrated++;
        }
      }
    }
    console.log(`\n✅ Migrated ${migrated} Claude Code sessions\n`);
  }
}

main().catch(console.error);
