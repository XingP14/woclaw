#!/usr/bin/env node
/**
 * WoClaw Hooks Installer for Claude Code
 * 
 * Usage:
 *   npx woclaw-hooks                    # Interactive setup
 *   npx woclaw-hooks --install         # Install with defaults
 *   npx woclaw-hooks --uninstall       # Remove hooks
 *   npx woclaw-hooks --configure       # Reconfigure
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOKS_SOURCE = path.join(__dirname);
const HOOKS_DIR = path.join(os.homedir(), '.claude', 'hooks');
const ENV_FILE = path.join(os.homedir(), '.claude', '.env.woclaw');

const HOOK_NAMES = ['session-start', 'session-stop', 'precompact'];

const DEFAULT_CONFIG = {
  WOCLAW_HUB_URL: process.env.WOCLAW_HUB_URL || 'http://localhost:8083',
  WOCLAW_TOKEN: process.env.WOCLAW_TOKEN || 'WoClaw2026',
  WOCLAW_PROJECT_KEY: process.env.WOCLAW_PROJECT_KEY || 'project:context',
};

function getClaudeDir() {
  return path.join(os.homedir(), '.claude');
}

function getHooksDir() {
  return path.join(getClaudeDir(), 'hooks');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readLine(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.once('data', (d) => {
      resolve(d.toString().trim());
    });
  });
}

async function interactiveConfig() {
  console.log('\n🔧 WoClaw Hooks Configuration\n');
  
  const hubUrl = await readLine(`Hub URL [${DEFAULT_CONFIG.WOCLAW_HUB_URL}]: `) || DEFAULT_CONFIG.WOCLAW_HUB_URL;
  const token = await readLine(`Hub Token [${DEFAULT_CONFIG.WOCLAW_TOKEN}]: `) || DEFAULT_CONFIG.WOCLAW_TOKEN;
  const projectKey = await readLine(`Project Key [${DEFAULT_CONFIG.WOCLAW_PROJECT_KEY}]: `) || DEFAULT_CONFIG.WOCLAW_PROJECT_KEY;
  
  return { WOCLAW_HUB_URL: hubUrl, WOCLAW_TOKEN: token, WOCLAW_PROJECT_KEY: projectKey };
}

function installHooks(config) {
  ensureDir(getHooksDir());
  
  for (const hook of HOOK_NAMES) {
    const src = path.join(HOOKS_SOURCE, `${hook}.sh`);
    const dst = path.join(getHooksDir(), `woclaw-${hook}.sh`);
    
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      fs.chmodSync(dst, 0o755);
      console.log(`✅ Installed: ${path.basename(dst)}`);
    } else {
      console.log(`⚠️  Missing hook: ${hook}.sh`);
    }
  }
  
  // Write .env file
  const envContent = Object.entries(config)
    .map(([k, v]) => `${k}="${v}"`)
    .join('\n') + '\n';
  
  fs.writeFileSync(ENV_FILE, envContent);
  console.log(`\n✅ Config written to: ${ENV_FILE}`);
  console.log('\n📝 Add this to your ~/.claude/settings.json:');
  console.log('   { "hooks": { "onEnter": ["bash ~/.claude/hooks/woclaw-session-start.sh"] } }');
  console.log('\n   Or set WOCLAW_HUB_URL/WOCLAW_TOKEN in your shell environment.');
}

function uninstallHooks() {
  for (const hook of HOOK_NAMES) {
    const dst = path.join(getHooksDir(), `woclaw-${hook}.sh`);
    if (fs.existsSync(dst)) {
      fs.unlinkSync(dst);
      console.log(`🗑️  Removed: ${path.basename(dst)}`);
    }
  }
  if (fs.existsSync(ENV_FILE)) {
    fs.unlinkSync(ENV_FILE);
    console.log(`🗑️  Removed: ${ENV_FILE}`);
  }
  console.log('\n✅ Uninstallation complete.');
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--uninstall')) {
    uninstallHooks();
    return;
  }
  
  if (args.includes('--install')) {
    installHooks(DEFAULT_CONFIG);
    return;
  }
  
  // Interactive mode
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   WoClaw Hooks for Claude Code  v0.1.0     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\nThis will install hooks that share context between');
  console.log('Claude Code and your WoClaw Hub.\n');
  
  const config = await interactiveConfig();
  installHooks(config);
  
  console.log('\n🎉 Installation complete!');
  console.log('\nNext steps:');
  console.log('  1. Restart Claude Code');
  console.log('  2. Your Claude Code sessions will now share context via WoClaw Hub');
  console.log('\nTo update config later: npx woclaw-hooks --configure');
}

main().catch(console.error);
