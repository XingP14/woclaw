import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const MIGRATOR_PATH = path.resolve(process.cwd(), '..', 'packages/woclaw-hooks/openclaw-migrate.js');
const ORIGINAL_ENV = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
  OPENCLAW_CONFIG: process.env.OPENCLAW_CONFIG,
  OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE,
  OPENCLAW_PROFILE: process.env.OPENCLAW_PROFILE,
  WOCLAW_OPENCLAW_MIGRATE_SKIP_MAIN: process.env.WOCLAW_OPENCLAW_MIGRATE_SKIP_MAIN,
};

function writeFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function makeTempState() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'woclaw-openclaw-'));
  const home = path.join(root, 'home');
  const stateDir = path.join(home, '.openclaw');
  const workspace = path.join(stateDir, 'workspace');
  const workspace1000003 = path.join(stateDir, 'workspace-1000003');

  mkdirSync(workspace, { recursive: true });
  mkdirSync(workspace1000003, { recursive: true });

  writeFile(
    path.join(stateDir, 'openclaw.json'),
    JSON.stringify({
      agents: {
        defaults: {
          workspace,
        },
      },
    }),
  );

  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.OPENCLAW_CONFIG = path.join(stateDir, 'openclaw.json');
  delete process.env.OPENCLAW_WORKSPACE;
  delete process.env.OPENCLAW_PROFILE;
  process.env.WOCLAW_OPENCLAW_MIGRATE_SKIP_MAIN = '1';

  delete require.cache[MIGRATOR_PATH];
  const migrator = require(MIGRATOR_PATH);

  return { root, home, stateDir, workspace, workspace1000003, migrator };
}

afterEach(() => {
  const restore = (key: keyof typeof ORIGINAL_ENV) => {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  restore('HOME');
  restore('USERPROFILE');
  restore('OPENCLAW_STATE_DIR');
  restore('OPENCLAW_CONFIG');
  restore('OPENCLAW_WORKSPACE');
  restore('OPENCLAW_PROFILE');
  restore('WOCLAW_OPENCLAW_MIGRATE_SKIP_MAIN');
});

describe('OpenClaw migrator', () => {
  it('discovers workspace roots, session stores, and transcripts without scanning dependency trees', () => {
    const env = makeTempState();
    try {
      writeFile(path.join(env.workspace, 'MEMORY.md'), '# root memory');
      writeFile(path.join(env.workspace, 'SOUL.md'), '# soul');
      writeFile(path.join(env.workspace, 'memory', '2026-04-01.md'), '# memory note');
      writeFile(path.join(env.workspace, 'agents', 'p14', 'SOUL.md'), '# agent soul');
      writeFile(path.join(env.workspace, 'agents', 'main', 'sessions', 'sessions.json'), '{"session":1}');
      writeFile(
        path.join(env.workspace, '_tmp', 'imgvenv', 'lib', 'python3.14', 'site-packages', 'pip', '_vendor', 'idna', 'LICENSE.md'),
        'do not import me',
      );
      writeFile(path.join(env.workspace, 'node_modules', 'pkg', 'README.md'), 'nope');
      writeFile(
        path.join(env.workspace, 'agents', 'main', 'sessions', 'abc123.jsonl'),
        [
          '{"type":"session","id":"abc123","timestamp":"2026-04-01T00:00:00.000Z"}',
          '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}',
        ].join('\n'),
      );

      writeFile(path.join(env.workspace1000003, 'MEMORY.md'), '# workspace 1000003');
      writeFile(path.join(env.stateDir, 'agents', 'main', 'sessions', 'sessions.json'), '{"session":1}');
      writeFile(path.join(env.stateDir, 'agents', '1000003', 'sessions', 'sessions.json'), '{"session":1}');
      writeFile(
        path.join(env.stateDir, 'agents', 'main', 'sessions', 'abc123.jsonl'),
        [
          '{"type":"session","id":"abc123","timestamp":"2026-04-01T00:00:00.000Z"}',
          '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}',
        ].join('\n'),
      );
      writeFile(
        path.join(env.stateDir, 'agents', '1000003', 'sessions', 'xyz999.jsonl'),
        '{"type":"session","id":"xyz999","timestamp":"2026-04-02T00:00:00.000Z"}\n',
      );

      const roots = env.migrator.discoverWorkspaceRoots();
      expect(roots.map((r: any) => r.label)).toEqual(['workspace', 'workspace-1000003']);

      const workspaceFiles = env.migrator.getWorkspaceMemoryFiles(env.workspace);
      expect(workspaceFiles).toContain(path.join(env.workspace, 'MEMORY.md'));
      expect(workspaceFiles).toContain(path.join(env.workspace, 'SOUL.md'));
      expect(workspaceFiles).toContain(path.join(env.workspace, 'memory', '2026-04-01.md'));
      expect(workspaceFiles).toContain(path.join(env.workspace, 'agents', 'p14', 'SOUL.md'));
      expect(workspaceFiles.some((file: string) => file.includes('imgvenv'))).toBe(false);
      expect(workspaceFiles.some((file: string) => file.includes('node_modules'))).toBe(false);
      expect(workspaceFiles.some((file: string) => file.endsWith('sessions.json'))).toBe(false);
      expect(workspaceFiles.some((file: string) => file.endsWith('.jsonl'))).toBe(false);

      const stores = env.migrator.findSessionStores();
      expect(stores.map((store: any) => store.agentId)).toEqual(['1000003', 'main']);

      const transcriptFiles = env.migrator.getSessionTranscriptFiles();
      expect(transcriptFiles).toEqual([
        path.join(env.stateDir, 'agents', '1000003', 'sessions', 'xyz999.jsonl'),
        path.join(env.stateDir, 'agents', 'main', 'sessions', 'abc123.jsonl'),
      ]);
    } finally {
      rmSync(env.root, { recursive: true, force: true });
    }
  });

  it('summarizes transcript metadata and ignores malformed lines', () => {
    const env = makeTempState();
    try {
      const transcriptPath = path.join(env.stateDir, 'agents', 'main', 'sessions', 'session-1.jsonl');
      writeFile(
        transcriptPath,
        [
          '{"type":"session","id":"session-1","timestamp":"2026-04-05T00:00:00.000Z"}',
          '{"type":"model_change","provider":"anthropic","modelId":"claude-3"}',
          '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"first question"}]}}',
          'this is not json',
          '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"final answer"}]}}',
        ].join('\n'),
      );

      const entry = env.migrator.summarizeSessionTranscript('main', transcriptPath);
      expect(entry.key).toBe('openclaw:sessionlog:main:session-1');
      expect(entry.tags).toContain('session-log');
      expect(entry.value).toContain('# OpenClaw Session Transcript');
      expect(entry.value).toContain('- Agent: main');
      expect(entry.value).toContain('- Session ID: session-1');
      expect(entry.value).toContain('- Events: 4');
      expect(entry.value).toContain('- Provider: anthropic');
      expect(entry.value).toContain('- Model: claude-3');
      expect(entry.value).toContain('- First user: first question');
      expect(entry.value).toContain('- Last assistant: final answer');
      expect(entry.value).toContain('"type":"session"');
      expect(entry.value).toContain('this is not json');
    } finally {
      rmSync(env.root, { recursive: true, force: true });
    }
  });
});
