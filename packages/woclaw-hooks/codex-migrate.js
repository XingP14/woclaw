#!/usr/bin/env node
/**
 * WoClaw Codex Session Migrate Parser
 * 
 * Parses Codex session files and extracts key decisions/context
 * for migration to WoClaw Hub.
 * 
 * Usage:
 *   node codex-migrate.js --session-id <id> [--history]
 *   node codex-migrate.js --session-file <path>
 *   node codex-migrate.js --all [--limit <n>]
 * 
 * Environment:
 *   WOCLAW_HUB_URL   - Hub REST URL (default: http://vm153:8083)
 *   WOCLAW_TOKEN     - Auth token (default: WoClaw2026)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex');
const HISTORY_FILE = path.join(CODEX_HOME, 'history.jsonl');

const WOCLAW_HUB_URL = process.env.WOCLAW_HUB_URL || 'http://vm153:8083';
const WOCLAW_TOKEN = process.env.WOCLAW_TOKEN || 'WoClaw2026';

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2);
let mode = null;       // 'session-id' | 'session-file' | 'all' | 'list'
let targetValue = null;
let limitCount = 10;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--session-id' && i + 1 < args.length) {
    mode = 'session-id';
    targetValue = args[++i];
  } else if (arg === '--session-file' && i + 1 < args.length) {
    mode = 'session-file';
    targetValue = args[++i];
  } else if (arg === '--all') {
    mode = 'all';
  } else if (arg === '--list') {
    mode = 'list';
  } else if (arg === '--limit' && i + 1 < args.length) {
    limitCount = parseInt(args[++i], 10) || 10;
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

function printHelp() {
  console.log(`
WoClaw Codex Session Migrate Parser

Usage:
  node codex-migrate.js --list                          List available sessions
  node codex-migrate.js --session-id <id>              Parse single session
  node codex-migrate.js --session-file <path>          Parse rollout file
  node codex-migrate.js --all [--limit <n>]            Parse all sessions (default: 10)

Environment:
  CODEX_HOME        - Codex home dir (default: ~/.codex)
  WOCLAW_HUB_URL    - WoClaw Hub REST URL
  WOCLAW_TOKEN      - WoClaw auth token
`);
}

// ─── Core Parser ─────────────────────────────────────────────────────────────

function normalizeTimestampMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value < 1e12 ? value * 1000 : value;
}

/**
 * Parse a single history.jsonl line (one event in a session stream)
 * @param {string} line - JSON line from history.jsonl
 * @returns {object|null} parsed event or null
 */
function parseHistoryEntry(line) {
  try {
    const entry = JSON.parse(line.trim());
    return {
      session_id: entry.session_id || null,
      created_at: entry.created_at || (entry.ts ? new Date(normalizeTimestampMs(entry.ts)).toISOString() : null),
      updated_at: entry.updated_at || (entry.ts ? new Date(normalizeTimestampMs(entry.ts)).toISOString() : null),
      model: entry.model || null,
      messages: [{
        role: entry.role || 'user',
        content: typeof entry.text === 'string' ? entry.text : (typeof entry.content === 'string' ? entry.content : ''),
        ts: entry.ts || null,
      }],
      message_count: 1,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a rollout-*.jsonl event line
 * @param {string} line - JSON line from rollout file
 * @returns {object|null} parsed event or null
 */
function parseRolloutEvent(line) {
  try {
    const event = JSON.parse(line.trim());
    // Event types: action, observation, tool_call, tool_output, assistant, etc.
    return {
      type: event.type || event.event_type || 'unknown',
      timestamp: event.timestamp || null,
      data: event.data || event,
    };
  } catch {
    return null;
  }
}

/**
 * Extract key decisions and context from a session's messages
 * @param {object} session - parsed session object
 * @returns {object} extracted data
 */
function extractSessionInsights(session) {
  const messages = session.messages || [];
  const insights = {
    decisions: [],
    files_modified: new Set(),
    tools_used: new Set(),
    commands_run: [],
    key_findings: [],
    project_context: [],
  };

  for (const msg of messages) {
    const role = msg.role || '';
    const content = typeof msg.content === 'string' ? msg.content : '';

    // Track tool usage
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name || tc.name || 'unknown';
        insights.tools_used.add(name);
        if (name === 'write' || name === 'edit') {
          const file = tc.function?.arguments?.file || tc.arguments?.file || '';
          if (file) insights.files_modified.add(file);
        }
        if (name === 'bash' || name === 'shell') {
          const cmd = tc.function?.arguments?.command || tc.arguments?.command || '';
          if (cmd) insights.commands_run.push(cmd.slice(0, 120));
        }
      }
    }

    // Extract decisions from assistant messages (looking for decision patterns)
    if (role === 'assistant' && content) {
      const lines = content.split('\n');
      for (const line of lines) {
        const dMatch = line.match(/^(?:decided?|choice|选择|决定)[:：]\s*(.+)/i);
        if (dMatch) insights.decisions.push(dMatch[1].trim());
        const fMatch = line.match(/^(?:found|discovered|发现)[:：]\s*(.+)/i);
        if (fMatch) insights.key_findings.push(fMatch[1].trim());
      }
    }

    // Extract project context (CLAUDE.md, README mentions)
    if (role === 'user' || role === 'system') {
      if (/CLAUDE\.md|README|ARCHITECTURE|SPEC/i.test(content)) {
        const snippet = content.slice(0, 200).replace(/\s+/g, ' ').trim();
        insights.project_context.push(snippet);
      }
    }
  }

  return {
    session_id: session.session_id,
    created_at: session.created_at,
    model: session.model,
    stats: {
      messages: messages.length,
      tools_used: insights.tools_used.size,
      files_modified: insights.files_modified.size,
      commands_run: insights.commands_run.length,
    },
    decisions: insights.decisions.slice(0, 20),
    files_modified: Array.from(insights.files_modified).slice(0, 50),
    tools_used: Array.from(insights.tools_used),
    key_findings: insights.key_findings.slice(0, 10),
    project_context: insights.project_context.slice(0, 5),
    commands_run: insights.commands_run.slice(-20),
  };
}

/**
 * Build a markdown summary from extracted session insights
 */
function buildSessionSummary(insights) {
  const lines = [
    `# Codex Session: ${insights.session_id}`,
    `**Date**: ${insights.created_at || 'unknown'}  |  **Model**: ${insights.model || 'unknown'}`,
    '',
    '## Stats',
    `- Messages: ${insights.stats.messages}`,
    `- Tools used: ${insights.stats.tools_used}`,
    `- Files modified: ${insights.stats.files_modified}`,
    `- Commands run: ${insights.stats.commands_run}`,
    '',
  ];

  if (insights.decisions.length > 0) {
    lines.push('## Decisions');
    for (const d of insights.decisions) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  if (insights.key_findings.length > 0) {
    lines.push('## Key Findings');
    for (const f of insights.key_findings) {
      lines.push(`- ${f}`);
    }
    lines.push('');
  }

  if (insights.files_modified.length > 0) {
    lines.push('## Files Modified');
    for (const f of insights.files_modified) {
      lines.push(`- \`${f}\``);
    }
    lines.push('');
  }

  if (insights.tools_used.length > 0) {
    lines.push('## Tools Used');
    lines.push('```');
    lines.push(insights.tools_used.join(', '));
    lines.push('```');
    lines.push('');
  }

  if (insights.commands_run.length > 0) {
    lines.push('## Commands Run');
    lines.push('```bash');
    for (const c of insights.commands_run) {
      lines.push(c);
    }
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── File Readers ─────────────────────────────────────────────────────────────

/**
 * Stream-parse history.jsonl and return sessions
 * @param {function} filterFn - return true to include session
 * @param {number} limit - max sessions to return
 * @yields {object} session objects
 */
async function* streamHistorySessions(filterFn = () => true, limit = 10) {
  if (!fs.existsSync(HISTORY_FILE)) return;

  const rl = readline.createInterface({
    input: fs.createReadStream(HISTORY_FILE),
  });

  const sessions = new Map();

  for await (const line of rl) {
    if (!line.trim()) continue;
    const event = parseHistoryEntry(line);
    if (!event || !event.session_id) continue;

    const existing = sessions.get(event.session_id) || {
      session_id: event.session_id,
      created_at: event.created_at,
      updated_at: event.updated_at,
      model: event.model,
      messages: [],
    };

    if (!existing.created_at && event.created_at) existing.created_at = event.created_at;
    if (event.updated_at) existing.updated_at = event.updated_at;
    if (!existing.model && event.model) existing.model = event.model;
    existing.messages.push(...event.messages);
    sessions.set(event.session_id, existing);
  }

  let count = 0;
  const ordered = [...sessions.values()].sort((a, b) => {
    const aTs = a.updated_at || a.created_at || '';
    const bTs = b.updated_at || b.created_at || '';
    return String(bTs).localeCompare(String(aTs));
  });

  for (const session of ordered) {
    session.message_count = session.messages.length;
    if (filterFn(session)) {
      yield session;
      count++;
      if (count >= limit) break;
    }
  }
}

/**
 * List all sessions from history.jsonl
 * @param {number} limit
 */
async function listSessions(limit = 20) {
  console.log(`\n📋 Available Codex Sessions (${HISTORY_FILE})\n`);
  console.log('  Session ID                                  | Created            | Messages | Model');
  console.log('  --------------------------------------------|---------------------|----------|------');

  let count = 0;
  for await (const session of streamHistorySessions(() => true, limit)) {
    const id = (session.session_id || 'unknown').slice(0, 42);
    const date = session.created_at ? session.created_at.slice(0, 19) : 'unknown';
    const msgs = String(session.message_count || 0).padStart(7);
    const model = (session.model || 'unknown').padEnd(30).slice(0, 30);
    console.log(`  ${id} | ${date} | ${msgs} | ${model}`);
    count++;
  }

  if (count === 0) {
    console.log('  (no sessions found)');
  }
  console.log('');
}

/**
 * Parse session by ID from history.jsonl
 * @param {string} sessionId
 */
async function parseSessionById(sessionId) {
  const lowerId = sessionId.toLowerCase();

  for await (const session of streamHistorySessions(
    s => (s.session_id || '').toLowerCase().includes(lowerId),
    5
  )) {
    if ((session.session_id || '').toLowerCase().includes(lowerId)) {
      const insights = extractSessionInsights(session);
      const summary = buildSessionSummary(insights);
      console.log(summary);
      return insights;
    }
  }

  console.error(`Session not found: ${sessionId}`);
  return null;
}

/**
 * Parse a rollout-*.jsonl file directly
 * @param {string} filePath
 */
async function parseRolloutFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return null;
  }

  const events = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const event = parseRolloutEvent(line);
    if (event) events.push(event);
  }

  // Extract tool calls from events
  const toolCalls = events
    .filter(e => e.type === 'tool_call' || e.type === 'function_call')
    .map(e => e.data?.name || e.data?.function?.name || 'unknown')
    .filter(n => n !== 'unknown');

  console.log(`\n📄 Rollout: ${path.basename(filePath)}`);
  console.log(`   Events: ${events.length}`);
  console.log(`   Tool calls: ${toolCalls.length}`);
  if (toolCalls.length > 0) {
    const uniqueTools = [...new Set(toolCalls)];
    console.log(`   Tools: ${uniqueTools.join(', ')}`);
  }
  console.log('');

  return { events, toolCalls };
}

// ─── WoClaw Hub Integration ───────────────────────────────────────────────────

/**
 * Write session summary to WoClaw Hub
 * @param {string} sessionId
 * @param {string} summary
 * @param {object} extra - extra metadata
 */
async function writeToHub(sessionId, summary, extra = {}) {
  const payload = JSON.stringify({
    key: `codex:session:${sessionId}`,
    value: summary,
    tags: ['codex', 'migrated', 'session-summary'],
    updatedBy: `codex-migrate:${process.env.USER || 'node'}`,
    ...extra,
  });

  const req = await fetch(`${WOCLAW_HUB_URL}/memory`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WOCLAW_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: payload,
  });

  if (req.ok) {
    console.log(`✅ Written to WoClaw Hub: codex:session:${sessionId}`);
  } else {
    console.error(`⚠️  Failed to write to Hub: ${req.status}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!mode) {
    printHelp();
    process.exit(1);
  }

  switch (mode) {
    case 'list':
      await listSessions(limitCount);
      break;

    case 'session-id':
      if (!targetValue) {
        console.error('--session-id requires a value');
        process.exit(1);
      }
      const insights = await parseSessionById(targetValue);
      if (insights) {
        await writeToHub(insights.session_id, buildSessionSummary(insights), {
          model: insights.model,
          created_at: insights.created_at,
        });
      }
      break;

    case 'session-file':
      if (!targetValue) {
        console.error('--session-file requires a path');
        process.exit(1);
      }
      await parseRolloutFile(targetValue);
      break;

    case 'all':
      console.log(`\n🔄 Migrating up to ${limitCount} Codex sessions...\n`);
      let migrated = 0;
      for await (const session of streamHistorySessions(() => true, limitCount)) {
        const si = extractSessionInsights(session);
        if (si.stats.messages > 0) {
          const summary = buildSessionSummary(si);
          console.log(`  → ${si.session_id} (${si.stats.messages} msgs)`);
          await writeToHub(si.session_id, summary, {
            model: si.model,
            created_at: si.created_at,
          });
          migrated++;
        }
      }
      console.log(`\n✅ Migrated ${migrated} sessions to WoClaw Hub\n`);
      break;
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
