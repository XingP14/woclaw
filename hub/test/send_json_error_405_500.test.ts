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

describe('RestServer.sendJsonError 405/500 migration', () => {
  it('rest_server.ts exists at expected path', () => {
    expect(existsSync(REST_SERVER)).toBe(true);
  });

  it('rest_server.ts has 0 inline writeHead(405) Method-Not-Allowed sites (any variant)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // After 798a0ba + this closure, all 13 405 sites route through sendJsonError.
    // Gate: any inline `res.writeHead(405, ...)` followed by `res.end(JSON.stringify({error: 'Method not allowed...'}))`
    // pattern is forbidden. Helper writeHead in sendJsonError does not match (it's in a private static method, not inline).
    const lines = text.split('\n');
    const sites: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m1 = lines[i].match(/^\s*res\.writeHead\(405(?:\s*,\s*\{[^}]*\})?\);?\s*$/);
      if (!m1) continue;
      // Skip the helper-body line (sendJsonError uses res.writeHead(status, ...) — not 405 literally because of `status` param)
      // Skip comment lines
      if (lines[i].trim().startsWith('//')) continue;
      if (i + 1 >= lines.length) continue;
      const m2 = lines[i + 1].match(/^\s*res\.end\(JSON\.stringify\(\{\s*error:/);
      if (!m2) continue;
      sites.push({ line: i + 1, text: lines[i].trim() });
    }
    expect(sites).toEqual([]);
  });

  it('rest_server.ts has 0 inline 500 Internal Server Error sites (including if-wrapper form)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // Gate 1: 2-line writeHead(500, app/json) + res.end({error: 'Internal server error'}) form
    const lines = text.split('\n');
    const sites1: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m1 = lines[i].match(/^\s*res\.writeHead\(500,\s*\{\s*'Content-Type':\s*'application\/json'\s*\}\);?\s*$/);
      if (!m1) continue;
      sites1.push({ line: i + 1, text: lines[i].trim() });
    }
    expect(sites1).toEqual([]);
    // Gate 2: residual res.end(JSON.stringify({ error: 'Internal server error' })) form
    const sites2 = (text.match(/res\.end\(JSON\.stringify\(\{\s*error:\s*'Internal server error'\s*\}\)\)/g) || []);
    expect(sites2).toEqual([]);
  });

  it('sendJsonError(res, 405, ...) is called for all 14 405 sites (12 generic + 2 path-specific)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const calls405 = (text.match(/RestServer\.sendJsonError\(res, 405, 'Method not allowed'\)/g) || []).length;
    expect(calls405).toBe(12); // generic-message sites (798a0ba + 1 added by R92.7 streams endpoint)
    const calls405Path = (text.match(/RestServer\.sendJsonError\(res, 405, 'Method not allowed for this path'\)/g) || []).length;
    expect(calls405Path).toBe(1); // handleRequest catch-all fallback
    const calls405Sessions = (text.match(/RestServer\.sendJsonError\(res, 405, 'Method not allowed for \/sessions'\)/g) || []).length;
    expect(calls405Sessions).toBe(1); // handleSessionRequest catch-all fallback
  });

  it('sendJsonError(res, 500, ...) is called for both 500 sites (TLS + non-TLS server bootstrap)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const calls500 = (text.match(/RestServer\.sendJsonError\(res, 500, 'Internal server error'\)/g) || []).length;
    expect(calls500).toBe(2);
  });

  it('all 500 sendJsonError calls remain wrapped in if(!res.headersSent) { ... } safety guard', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // Two regions: TLS branch (line ~125) and non-TLS branch (line ~139)
    // Each region must contain: if (!res.headersSent) { ... RestServer.sendJsonError(res, 500, 'Internal server error'); ... }
    const tscCall = /if\s*\(\s*!res\.headersSent\s*\)\s*\{\s*\n\s+RestServer\.sendJsonError\(res, 500, 'Internal server error'\);/g;
    const matches = text.match(tscCall) || [];
    expect(matches.length).toBe(2);
  });

  it('sendJsonError total call count >= 77 (was 75 after 798a0ba; +2 path-specific 405 in this closure = 77)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const calls = (text.match(/RestServer\.sendJsonError\(/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(77);
  });

  it('helper signature still accepts arbitrary status: number (status param is `number`, not `200|201|400|405|500`)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const m = text.match(/private static sendJsonError\(\s*res: http\.ServerResponse,\s*status: number,\s*msg: string,\s*\): void/);
    expect(m).not.toBeNull();
  });

  it('OPTIONS preflight carve-out at L137-138 (writeHead(200) + res.end(), no JSON body) remains preserved', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // The OPTIONS preflight is a 2-line writeHead(200); res.end(); with no body
    // It should remain inline because it has no JSON payload and is not a 4xx/5xx error.
    const lines = text.split('\n');
    let found = false;
    for (let i = 0; i < lines.length - 1; i++) {
      if (/res\.writeHead\(200\);?\s*$/.test(lines[i]) && /res\.end\(\);?\s*$/.test(lines[i + 1])) {
        // Verify it's inside the OPTIONS branch (preceded by `if (req.method === 'OPTIONS')`)
        // look back up to 3 lines
        for (let j = Math.max(0, i - 3); j < i; j++) {
          if (/req\.method\s*===\s*['"]OPTIONS['"]/.test(lines[j])) {
            found = true;
            break;
          }
        }
      }
    }
    expect(found).toBe(true);
  });

  it('handleReady carve-out at L488 (writeHead(allOk ? 200 : 503) + res.end({status, timestamp, checks})) remains preserved (dynamic status not in 200|201 union)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // The 503 dynamic-status handleReady is intentionally NOT migrated because
    // sendJsonSuccess's typed signature only accepts 200|201.
    // Confirm the inline 2-line form is still present.
    const m = text.match(/res\.writeHead\(allOk\s*\?\s*200\s*:\s*503,\s*\{\s*'Content-Type':\s*'application\/json'\s*\}\);?\s*\n\s*res\.end\(JSON\.stringify\(\{\s*\n\s*status:\s*allOk/);
    expect(m).not.toBeNull();
  });

  it('L1204 handleTopicMessages carve-out (parseInt(limit || "50") from function arg, not URL searchParams) remains preserved', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // parseInt on a function param (string | null), NOT url.searchParams.get
    const m = text.match(/const limitNum = Math\.min\(parseInt\(limit\s*\|\|\s*'50'\),\s*200\);/);
    expect(m).not.toBeNull();
  });

  it('L157-158 OPTIONS 200-no-body carve-out remains preserved (the original c6ccbc6 deliberately kept site)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // Confirm no JSON.stringify call inside the OPTIONS branch
    const lines = text.split('\n');
    let inOptions = false;
    let hasJsonInOptions = false;
    for (const line of lines) {
      if (/if\s*\(\s*req\.method\s*===\s*['"]OPTIONS['"]/.test(line)) inOptions = true;
      if (inOptions && /res\.end\(JSON\.stringify/.test(line)) hasJsonInOptions = true;
      if (inOptions && /^\s*\}\s*$/.test(line)) inOptions = false;
    }
    expect(hasJsonInOptions).toBe(false);
  });

  it('helper body remains canonical 2-line writeHead + end with JSON.stringify({error: msg})', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const helperMatch = text.match(/private static sendJsonError\([\s\S]*?\n  \}\n/);
    expect(helperMatch).not.toBeNull();
    const body = helperMatch![0];
    expect(body).toMatch(/res\.writeHead\(status, \{ 'Content-Type': 'application\/json' \}\)/);
    expect(body).toMatch(/res\.end\(JSON\.stringify\(\{ error: msg \}\)\)/);
  });

  it('handleRequest 405 fallback (L921, was inline) is now a sendJsonError call', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const m = text.match(/RestServer\.sendJsonError\(res, 405, 'Method not allowed for this path'\);/);
    expect(m).not.toBeNull();
  });

  it('handleSessionRequest 405 fallback (L1100, was inline) is now a sendJsonError call', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const m = text.match(/RestServer\.sendJsonError\(res, 405, 'Method not allowed for \/sessions'\);/);
    expect(m).not.toBeNull();
  });

  it('0 inline res.end(JSON.stringify({error: ...})) Method-not-allowed sites (all 13 routes via sendJsonError)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // Only allowed inside the helper itself; no inline sites
    const helperBody = text.match(/private static sendJsonError\([\s\S]*?\n  \}\n/);
    expect(helperBody).not.toBeNull();
    const outsideHelper = text.replace(helperBody![0], '');
    const sites = outsideHelper.match(/res\.end\(JSON\.stringify\(\{\s*error:\s*'Method not allowed/g) || [];
    expect(sites).toEqual([]);
  });
});
