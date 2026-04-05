#!/usr/bin/env node
/**
 * WoClaw OpenClaw Migration Tool
 *
 * Imports OpenClaw workspace memory files and session-store metadata into
 * WoClaw Hub.
 *
 * Usage:
 *   node openclaw-migrate.js --list
 *   node openclaw-migrate.js --agent-id <id>
 *   node openclaw-migrate.js --all
 *
 * Environment:
 *   OPENCLAW_STATE_DIR   - OpenClaw state dir (default: ~/.openclaw)
 *   OPENCLAW_CONFIG      - Path to openclaw.json
 *   OPENCLAW_WORKSPACE   - Override workspace root
 *   WOCLAW_HUB_URL       - WoClaw Hub REST URL (default: http://vm153:8083)
 *   WOCLAW_TOKEN         - Auth token (default: WoClaw2026)
 */

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '/root';
const STATE_DIR = process.env.OPENCLAW_STATE_DIR || path.join(HOME, '.openclaw');
const OPENCLAW_CONFIG = process.env.OPENCLAW_CONFIG || path.join(STATE_DIR, 'openclaw.json');
const WORKSPACE_OVERRIDE = process.env.OPENCLAW_WORKSPACE || null;
const PROFILE = process.env.OPENCLAW_PROFILE || '';
const WOCLAW_HUB_URL = process.env.WOCLAW_HUB_URL || 'http://vm153:8083';
const WOCLAW_TOKEN = process.env.WOCLAW_TOKEN || 'WoClaw2026';

const args = process.argv.slice(2);
let mode = null;
let targetAgent = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--list') mode = 'list';
  else if (arg === '--all') mode = 'all';
  else if (arg === '--agent-id' && i + 1 < args.length) {
    mode = 'agent-id';
    targetAgent = args[++i];
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
WoClaw OpenClaw Migration Tool

Usage:
  node openclaw-migrate.js --list             Inspect discovered workspace memory
  node openclaw-migrate.js --agent-id <id>    Migrate workspace memory and session store for one agent
  node openclaw-migrate.js --all              Migrate all discovered workspace memory + session stores

Environment:
  OPENCLAW_STATE_DIR  - OpenClaw state dir (default: ~/.openclaw)
  OPENCLAW_CONFIG     - openclaw.json path (default: <state-dir>/openclaw.json)
  OPENCLAW_WORKSPACE  - workspace root override
  WOCLAW_HUB_URL      - Hub REST URL (default: http://vm153:8083)
  WOCLAW_TOKEN        - Auth token (default: WoClaw2026)
`);
}

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveWorkspaceRoot() {
  const config = loadJson(OPENCLAW_CONFIG);
  const cfgWorkspace = config?.agents?.defaults?.workspace;
  const defaultWorkspace = PROFILE && PROFILE !== 'default'
    ? `workspace-${PROFILE}`
    : 'workspace';
  return expandHome(WORKSPACE_OVERRIDE || cfgWorkspace || path.join(STATE_DIR, defaultWorkspace));
}

function discoverWorkspaceRoots() {
  if (WORKSPACE_OVERRIDE) {
    return [{
      label: path.basename(WORKSPACE_OVERRIDE),
      root: expandHome(WORKSPACE_OVERRIDE),
    }];
  }

  const roots = [];
  const defaultRoot = resolveWorkspaceRoot();
  roots.push({
    label: path.basename(defaultRoot),
    root: defaultRoot,
  });

  if (!fs.existsSync(STATE_DIR)) return roots;

  for (const entry of fs.readdirSync(STATE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('workspace')) continue;
    const root = path.join(STATE_DIR, entry.name);
    if (roots.some(r => r.root === root)) continue;
    roots.push({ label: entry.name, root });
  }

  return roots.sort((a, b) => a.label.localeCompare(b.label));
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function isMarkdownFile(filePath) {
  return filePath.endsWith('.md') || filePath.endsWith('.markdown');
}

function walkFiles(rootDir, predicate, out = []) {
  if (!fs.existsSync(rootDir)) return out;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, predicate, out);
    } else if (!predicate || predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function getWorkspaceMemoryFiles(workspaceRoot) {
  const files = [];
  for (const candidate of ['MEMORY.md', 'memory.md']) {
    const p = path.join(workspaceRoot, candidate);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) files.push(p);
  }

  const memoryDir = path.join(workspaceRoot, 'memory');
  if (fs.existsSync(memoryDir) && fs.statSync(memoryDir).isDirectory()) {
    walkFiles(memoryDir, (filePath) => fs.statSync(filePath).isFile() && isMarkdownFile(filePath), files);
  }

  return files
    .filter((file, idx, arr) => arr.indexOf(file) === idx)
    .sort((a, b) => a.localeCompare(b));
}

function findSessionStores() {
  const agentRoot = path.join(STATE_DIR, 'agents');
  const stores = [];
  if (!fs.existsSync(agentRoot)) return stores;

  for (const agentDir of fs.readdirSync(agentRoot, { withFileTypes: true })) {
    if (!agentDir.isDirectory()) continue;
    const sessionStore = path.join(agentRoot, agentDir.name, 'sessions', 'sessions.json');
    if (fs.existsSync(sessionStore)) {
      stores.push({ agentId: agentDir.name, path: sessionStore });
    }
  }
  const legacyStore = path.join(STATE_DIR, 'sessions', 'sessions.json');
  if (fs.existsSync(legacyStore)) {
    stores.push({ agentId: 'legacy', path: legacyStore });
  }
  return stores.sort((a, b) => a.agentId.localeCompare(b.agentId));
}

function summarizeWorkspaceFile(workspaceLabel, workspaceRoot, filePath) {
  const relPath = path.relative(workspaceRoot, filePath).split(path.sep).join(':');
  const content = readText(filePath).trimEnd();
  const stat = fs.statSync(filePath);
  const header = [
    `# OpenClaw Workspace Memory`,
    `- Workspace Label: ${workspaceLabel}`,
    `- Source: ${path.relative(HOME, filePath).startsWith('..') ? filePath : path.relative(HOME, filePath)}`,
    `- Workspace: ${workspaceRoot}`,
    `- Updated: ${stat.mtime.toISOString()}`,
    '',
  ].join('\n');

  return {
    key: `openclaw:workspace:${workspaceLabel}:${relPath}`,
    value: `${header}${content ? `${content}\n` : ''}`,
    tags: ['openclaw', 'migrated', 'workspace-memory'],
    updatedBy: 'openclaw-migrate',
  };
}

function summarizeSessionStore(agentId, storePath, filterSessionId = null) {
  const store = loadJson(storePath);
  if (!store || typeof store !== 'object') return [];

  const entries = [];
  for (const [sessionKey, data] of Object.entries(store)) {
    if (filterSessionId && !sessionKey.includes(filterSessionId) && !agentId.includes(filterSessionId)) continue;

    const lines = [
      `# OpenClaw Session Store`,
      `- Agent: ${agentId}`,
      `- Session Key: ${sessionKey}`,
      `- Session ID: ${data.sessionId || 'unknown'}`,
      `- Chat Type: ${data.chatType || 'unknown'}`,
      `- Status: ${data.status || 'unknown'}`,
      `- Updated: ${data.updatedAt ? new Date(data.updatedAt).toISOString() : 'unknown'}`,
      `- Compactions: ${data.compactionCount ?? 0}`,
      `- Context Tokens: ${data.contextTokens ?? 'unknown'}`,
    ];

    if (data.lastTo) lines.push(`- Last To: ${data.lastTo}`);
    if (data.sessionFile) lines.push(`- Transcript: ${data.sessionFile}`);
    if (data.model) lines.push(`- Model: ${data.model}`);
    if (data.provider) lines.push(`- Provider: ${data.provider}`);
    lines.push('');

    entries.push({
      key: `openclaw:session:${agentId}:${sessionKey.replace(/[\\/]/g, ':')}`,
      value: lines.join('\n'),
      tags: ['openclaw', 'migrated', 'session-store'],
      updatedBy: 'openclaw-migrate',
    });
  }

  return entries;
}

async function writeToHub(entry) {
  const payload = JSON.stringify(entry);
  try {
    const res = await fetch(`${WOCLAW_HUB_URL}/memory`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WOCLAW_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    console.log(res.ok ? `  ✅ ${entry.key}` : `  ⚠️  ${entry.key} -> ${res.status}`);
  } catch (e) {
    console.log(`  ⚠️  ${entry.key} -> ${e.message}`);
  }
}

function printList(workspaceRoot, files, stores) {
  console.log(`\n📋 OpenClaw Workspace (${workspaceRoot})\n`);
  if (files.length === 0) {
    console.log('  No workspace memory files found.');
  } else {
    console.log('  Workspace memory files:');
    for (const file of files) {
      console.log(`    - ${path.relative(workspaceRoot, file)}`);
    }
  }

  if (stores.length === 0) {
    console.log('\n  No session stores found.');
  } else {
    console.log('\n  Session stores:');
    for (const store of stores) {
      const data = loadJson(store.path) || {};
      const count = Object.keys(data).length;
      console.log(`    - ${store.agentId} (${count} session key(s))`);
    }
  }
  console.log('');
}

async function main() {
  const workspaceRoots = discoverWorkspaceRoots();
  const sessionStores = findSessionStores();

  if (mode === 'list') {
    for (const workspace of workspaceRoots) {
      const workspaceFiles = getWorkspaceMemoryFiles(workspace.root);
      printList(workspace.root, workspaceFiles, sessionStores);
    }
    return;
  }

  const fileEntries = [];
  for (const workspace of workspaceRoots) {
    const workspaceFiles = getWorkspaceMemoryFiles(workspace.root);
    for (const filePath of workspaceFiles) {
      fileEntries.push(summarizeWorkspaceFile(workspace.label, workspace.root, filePath));
    }
  }
  const storeEntries = [];
  for (const store of sessionStores) {
    if (mode === 'agent-id' && targetAgent && store.agentId !== targetAgent) continue;
    storeEntries.push(...summarizeSessionStore(store.agentId, store.path, mode === 'agent-id' ? targetAgent : null));
  }

  const entries = [...fileEntries, ...storeEntries];
  if (mode === 'agent-id') {
    console.log(`\n🔄 Migrating OpenClaw agent scope: ${targetAgent}\n`);
  } else {
    console.log(`\n🔄 Migrating OpenClaw workspace memory and session stores...\n`);
  }

  if (entries.length === 0) {
    console.log('  No OpenClaw workspace memory or session data found.');
    return;
  }

  let migrated = 0;
  for (const entry of entries) {
    const shortValue = entry.value.length > 140 ? `${entry.value.slice(0, 140)}...` : entry.value;
    console.log(`  → ${entry.key}`);
    console.log(`    ${shortValue.split('\n')[0] || ''}`);
    await writeToHub(entry);
    migrated++;
  }

  console.log(`\n✅ Migrated ${migrated} OpenClaw memory entries\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
