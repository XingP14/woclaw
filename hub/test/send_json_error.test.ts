import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// This test may run from either woclaw/ or woclaw/hub/ depending on caller.
// Resolve paths relative to the test file's own location so both work.
const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR); // .../hub
const REPO_ROOT = dirname(HUB_DIR); // .../woclaw
const REST_SERVER = join(HUB_DIR, 'src', 'rest_server.ts');

describe('RestServer.sendJsonError helper migration', () => {
  it('rest_server.ts exists at expected path', () => {
    expect(existsSync(REST_SERVER)).toBe(true);
  });

  it('rest_server.ts declares the private static sendJsonError helper', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/private static sendJsonError\(/);
  });

  it('rest_server.ts has 0 inline 2-line 400/401/403/404/500/503 error response sites', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const lines = text.split('\n');
    const sites: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m1 = lines[i].match(/^\s*res\.writeHead\((\d+), \{ 'Content-Type': 'application\/json' \}\);?\s*$/);
      if (!m1) continue;
      const status = parseInt(m1[1], 10);
      if (![400, 401, 403, 404, 500, 503].includes(status)) continue;
      if (i + 1 >= lines.length) continue;
      const m2 = lines[i+1].match(/^\s*res\.end\(JSON\.stringify\(\{ error: .* \}\)\);?\s*$/);
      if (!m2) continue;
      // Skip comment lines
      if (lines[i].trim().startsWith('//')) continue;
      sites.push({ line: i + 1, text: lines[i].trim() });
    }
    expect(sites).toEqual([]);
  });

  it('sendJsonError called at least 50 times (was 63 inline before)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const calls = (text.match(/RestServer\.sendJsonError\(/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(50);
  });

  it('helper signature is canonical (res, status: number, msg: string, void)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const m = text.match(/private static sendJsonError\(\s*res: http\.ServerResponse,\s*status: number,\s*msg: string,\s*\): void/);
    expect(m).not.toBeNull();
  });

  it('helper body is the canonical 2-line writeHead + end with JSON.stringify({error: msg})', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const helperMatch = text.match(/private static sendJsonError\([\s\S]*?\n  \}\n/);
    expect(helperMatch).not.toBeNull();
    const body = helperMatch![0];
    expect(body).toMatch(/res\.writeHead\(status, \{ 'Content-Type': 'application\/json' \}\)/);
    expect(body).toMatch(/res\.end\(JSON\.stringify\(\{ error: msg \}\)\)/);
  });
});
