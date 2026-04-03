#!/usr/bin/env node
/**
 * WoClaw OpenClaw Agent Migration Tool
 * 
 * Reads OpenClaw agent memory/sessions and migrates to WoClaw Hub.
 * 
 * Usage:
 *   node openclaw-migrate.js --agent-id <id>       Migrate specific agent
 *   node openclaw-migrate.js --list                List OpenClaw agents
 *   node openclaw-migrate.js --all                 Migrate all accessible agents
 * 
 * Environment:
 *   OPENCLAW_CONFIG   - Path to openclaw.json (default: ~/.openclaw/openclaw.json)
 *   WOCLAW_HUB_URL  - WoClaw Hub REST URL (default: http://vm153:8083)
 *   WOCLAW_TOKEN    - Auth token (default: WoClaw2026)
 */

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const OPENCLAW_CONFIG = process.env.OPENCLAW_CONFIG || path.join(HOME, '.openclaw', 'openclaw.json');
const WOCLAW_HUB_URL = process.env.WOCLAW_HUB_URL || 'http://vm153:8083';
const WOCLAW_TOKEN = process.env.WOCLAW_TOKEN || 'WoClaw2026';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let mode = null;
let targetValue = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--list') mode = 'list';
  else if (arg === '--all') mode = 'all';
  else if (arg === '--agent-id' && i + 1 < args.length) {
    mode = 'agent-id';
    targetValue = args[++i];
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

if (!mode) { printHelp(); process.exit(1); }

function printHelp() {
  console.log(`
WoClaw OpenClaw Agent Migration Tool

Usage:
  node openclaw-migrate.js --list             List OpenClaw agents from config
  node openclaw-migrate.js --agent-id <id>   Migrate specific agent memory
  node openclaw-migrate.js --all             Migrate all accessible agents

Environment:
  OPENCLAW_CONFIG  - openclaw.json path (default: ~/.openclaw/openclaw.json)
  WOCLAW_HUB_URL  - Hub REST URL (default: http://vm153:8083)
  WOCLAW_TOKEN    - Auth token (default: WoClaw2026)
`);
}

// ─── OpenClaw Config ──────────────────────────────────────────────────────────

/**
 * Read OpenClaw agent config to discover agents
 */
function listAgents() {
  if (!fs.existsSync(OPENCLAW_CONFIG)) {
    console.log(`OpenClaw config not found: ${OPENCLAW_CONFIG}`);
    return [];
  }
  try {
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    const agents = [];
    
    // Check agents section
    if (config.agents) {
      for (const [id, agent] of Object.entries(config.agents)) {
        agents.push({ id, ...agent });
      }
    }
    
    // Check memory entries
    if (config.memory?.entries) {
      const memCount = Object.keys(config.memory.entries).length;
      if (memCount > 0) console.log(`Memory entries: ${memCount}`);
    }
    
    return agents;
  } catch (e) {
    console.error(`Failed to read config: ${e.message}`);
    return [];
  }
}

/**
 * Read memory entries from OpenClaw config
 */
function getMemoryEntries() {
  if (!fs.existsSync(OPENCLAW_CONFIG)) return {};
  try {
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf8'));
    return config.memory?.entries || {};
  } catch {
    return {};
  }
}

/**
 * Extract agent insights from OpenClaw config
 */
function extractAgentInsights(agentId) {
  const entries = getMemoryEntries();
  const agentEntries = {};
  
  for (const [key, val] of Object.entries(entries)) {
    if (key.includes(agentId) || key.startsWith('agent:')) {
      agentEntries[key] = val;
    }
  }
  
  return {
    agent_id: agentId,
    memory_entries: Object.keys(agentEntries).length,
    entries: agentEntries,
  };
}

function buildSummary(insights) {
  const lines = [
    `# OpenClaw Agent: ${insights.agent_id}`,
    `**Memory Entries**: ${insights.memory_entries}`,
    '',
  ];
  
  for (const [key, val] of Object.entries(insights.entries)) {
    const snippet = typeof val === 'string' ? val.slice(0, 100) : JSON.stringify(val).slice(0, 100);
    lines.push(`**${key}**: ${snippet}...`);
  }
  
  return lines.join('\n');
}

async function writeToHub(agentId, summary, entries) {
  const payload = JSON.stringify({
    key: `openclaw:agent:${agentId}`,
    value: summary,
    tags: ['openclaw', 'migrated', 'agent-memory'],
    updatedBy: 'openclaw-migrate',
  });
  try {
    const res = await fetch(`${WOCLAW_HUB_URL}/memory`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WOCLAW_TOKEN}`, 'Content-Type': 'application/json' },
      body: payload,
    });
    console.log(res.ok ? `  ✅ openclaw:agent:${agentId}` : `  ⚠️  ${res.status}`);
  } catch (e) {
    console.log(`  ⚠️  ${e.message}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (mode === 'list') {
    const agents = listAgents();
    console.log(`\n📋 OpenClaw Agents (${OPENCLAW_CONFIG})\n`);
    if (agents.length === 0) {
      console.log('  No agents found in config.');
    } else {
      for (const agent of agents) {
        console.log(`  - ${agent.id}${agent.name ? ' (' + agent.name + ')' : ''}`);
      }
    }
    console.log('');
    return;
  }

  if (mode === 'agent-id') {
    const insights = extractAgentInsights(targetValue);
    console.log(`\n🔄 Migrating OpenClaw agent: ${targetValue}\n`);
    if (insights.memory_entries === 0) {
      console.log('  No memory entries found for this agent.');
      return;
    }
    console.log(buildSummary(insights));
    await writeToHub(targetValue, buildSummary(insights), insights.entries);
    return;
  }

  if (mode === 'all') {
    const agents = listAgents();
    console.log(`\n🔄 Migrating ${agents.length} OpenClaw agents...\n`);
    let migrated = 0;
    for (const agent of agents) {
      const insights = extractAgentInsights(agent.id);
      if (insights.memory_entries > 0) {
        console.log(`  → ${agent.id} (${insights.memory_entries} entries)`);
        await writeToHub(agent.id, buildSummary(insights), insights.entries);
        migrated++;
      }
    }
    console.log(`\n✅ Migrated ${migrated} agents\n`);
  }
}

main().catch(console.error);
