import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// This test may run from either woclaw/ or woclaw/hub/ depending on caller.
// Resolve paths relative to the test file's own location so both work.
const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR); // .../hub
const REST_SERVER = join(HUB_DIR, 'src', 'rest_server.ts');

describe('RestServer.sendJsonSuccess helper migration', () => {
  it('rest_server.ts exists at expected path', () => {
    expect(existsSync(REST_SERVER)).toBe(true);
  });

  it('rest_server.ts declares the private static sendJsonSuccess helper', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/private static sendJsonSuccess\(/);
  });

  it('rest_server.ts has 0 inline 2-line 200/201 success response sites (single-line body only)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const lines = text.split('\n');
    const sites: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m1 = lines[i].match(/^\s*res\.writeHead\((200|201), \{ 'Content-Type': 'application\/json' \}\);?\s*$/);
      if (!m1) continue;
      if (i + 1 >= lines.length) continue;
      // Only catch single-line-body sites (the multi-line ones are deliberately
      // left for a follow-up step per the helper's comment block).
      const m2 = lines[i+1].match(/^\s*res\.end\(JSON\.stringify\(.+\)\);?\s*$/);
      if (!m2) continue;
      // Skip comment lines
      if (lines[i].trim().startsWith('//')) continue;
      sites.push({ line: i + 1, text: lines[i].trim() });
    }
    expect(sites).toEqual([]);
  });

  it('sendJsonSuccess called at least 40 times (was 48 single-line inline before)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const calls = (text.match(/RestServer\.sendJsonSuccess\(/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(40);
  });

  it('helper signature is canonical (res, status: 200|201, body: unknown, void)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const m = text.match(/private static sendJsonSuccess\(\s*res: http\.ServerResponse,\s*status: 200 \| 201,\s*body: unknown,\s*\): void/);
    expect(m).not.toBeNull();
  });

  it('helper body is the canonical 2-line writeHead + end with JSON.stringify(body)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const helperMatch = text.match(/private static sendJsonSuccess\([\s\S]*?\n  \}\n/);
    expect(helperMatch).not.toBeNull();
    const body = helperMatch![0];
    expect(body).toMatch(/res\.writeHead\(status, \{ 'Content-Type': 'application\/json' \}\)/);
    expect(body).toMatch(/res\.end\(JSON\.stringify\(body\)\)/);
  });

  it('OPTIONS preflight L137 deliberately NOT migrated (writeHead(200) + end() no body)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // Find the OPTIONS handling block — its writeHead(200) is the only 200
    // site remaining outside the helper (besides L568 custom-headers).
    const hasInlineOptions = /res\.writeHead\(200\);\s*\n\s*res\.end\(\);/.test(text);
    expect(hasInlineOptions).toBe(true);
  });

  it('handleMemoryWrite L568 deliberately NOT migrated (custom X-WoClaw-Conflict/Duplicate headers)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const hasCustomHeaders = /res\.writeHead\(200, headers\)/.test(text);
    expect(hasCustomHeaders).toBe(true);
  });
});
