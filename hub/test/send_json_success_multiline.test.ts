import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// This test is a follow-up to send_json_success.test.ts (c6ccbc6).
// That round migrated 48 single-line-body 200/201 sites. This round
// migrates 10 multi-line-body 200 sites (L431/442 token rotate +
// handleHealth, L520/543 memory list/stats, L600/624/644/663 memory
// get/versions/recall/byTag, L748 delegation accept, L1195 topic
// messages) to RestServer.sendJsonSuccess.
//
// Net effect: rest_server.ts has ZERO inline `res.writeHead(200, { 'Content-Type':
// 'application/json' }); ... res.end(JSON.stringify({...}))` patterns
// (any form — single or multi-line body).
//
// Carve-outs (test asserts these remain):
// - L137 OPTIONS preflight: writeHead(200) + end() no body (no Content-Type set)
// - L572 handleMemoryWrite: writeHead(200, headers) with custom X-WoClaw-Conflict/Duplicate headers
// - L470 handleReady: dynamic writeHead(200|503, ...) — status depends on check pass
// - L1001 handleSessionDelete: dynamic writeHead(200|404, ...) — depends on delete result
// - All 405 sites: writeHead(405) carve-out per sendJsonError parity
// - All 500 sites: handled via sendJsonError
// - sendJsonError/sendJsonSuccess helper definitions themselves (comment lines)

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR); // .../hub
const REST_SERVER = join(HUB_DIR, 'src', 'rest_server.ts');

describe('RestServer.sendJsonSuccess multi-line body migration', () => {
  it('rest_server.ts exists at expected path', () => {
    expect(existsSync(REST_SERVER)).toBe(true);
  });

  it('rest_server.ts has 0 raw writeHead(200, { Content-Type app/json }) sites', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const lines = text.split('\n');
    const sites: { line: number; text: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.trim().startsWith('//')) continue;
      // Match any raw writeHead(200, { 'Content-Type': 'application/json' }) line
      if (/^\s*res\.writeHead\(200, \{ 'Content-Type': 'application\/json' \}\);?\s*$/.test(ln)) {
        sites.push({ line: i + 1, text: ln.trim() });
      }
    }
    expect(sites).toEqual([]);
  });

  it('rest_server.ts sendJsonSuccess call count is at least 55 (was 49 after c6ccbc6 + 10 multi-line migrated)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const calls = (text.match(/RestServer\.sendJsonSuccess\(/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(55);
  });

  it('all 10 multi-line body 200 sites now use sendJsonSuccess (counting new calls)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // These 10 sites are: handleTokenRotate, handleHealth, handleMemoryList,
    // handleMemoryStats, handleMemoryGet, handleMemoryVersions,
    // handleMemoryRecall, handleMemoryByTag, handleDelegationAccept, handleTopicMessages
    // (L431 / L442 / L520 / L543 / L600 / L624 / L644 / L663 / L748 / L1195)
    // All should now invoke RestServer.sendJsonSuccess(res, 200, { ... });
    // We can't pin the exact count to 10 because other refactors might add/remove
    // call sites, but a regression that drops the 10 multi-line migrations
    // would drop the count from ≥59 (49 + 10) to ≤49.
    const calls = (text.match(/RestServer\.sendJsonSuccess\(/g) || []).length;
    // Total: 49 (pre-this-round single-line) + 10 (this round multi-line) = 59
    expect(calls).toBeGreaterThanOrEqual(58);
  });

  it('handleTokenRotate (L431) body is canonical — gracePeriodEnd is ISO string + gracePeriodMs numeric', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/RestServer\.sendJsonSuccess\(res, 200, \{[\s\S]*?newToken: result\.newToken,[\s\S]*?gracePeriodEnd: new Date\(result\.gracePeriodEnd\)\.toISOString\(\),[\s\S]*?gracePeriodMs: graceMs,[\s\S]*?\}\);/);
  });

  it('handleHealth (L442) body is canonical — status ok + uptime + timestamp + agents + topics', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/RestServer\.sendJsonSuccess\(res, 200, \{[\s\S]*?status: 'ok',[\s\S]*?uptime: process\.uptime\(\),[\s\S]*?timestamp: Date\.now\(\),[\s\S]*?agents: stats\.totalAgents,[\s\S]*?topics: stats\.totalTopics,[\s\S]*?\}\);/);
  });

  it('handleMemoryList (L520) body is canonical — memory: allMemory.map(...)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/RestServer\.sendJsonSuccess\(res, 200, \{[\s\S]*?memory: allMemory\.map\(m => \(\{[\s\S]*?key: m\.key,[\s\S]*?value: m\.value,[\s\S]*?tags: m\.tags,[\s\S]*?ttl: m\.ttl,[\s\S]*?expireAt: m\.expireAt,[\s\S]*?updatedAt: m\.updatedAt,[\s\S]*?updatedBy: m\.updatedBy,[\s\S]*?\}\)\)[\s\S]*?\}\);/);
  });

  it('handleMemoryVersions (L624) body is canonical — versions: versions.map(v => ({...}))', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/RestServer\.sendJsonSuccess\(res, 200, \{[\s\S]*?versions: versions\.map\(v => \(\{[\s\S]*?version: v\.version,[\s\S]*?\}\)\)[\s\S]*?\}\);/);
  });

  it('handleTopicMessages (L1195) body is canonical — messages: messages.reverse() + count: messages.length', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/RestServer\.sendJsonSuccess\(res, 200, \{[\s\S]*?messages: messages\.reverse\(\),[\s\S]*?count: messages\.length,[\s\S]*?\}\);/);
  });

  it('OPTIONS preflight L137 still uses raw writeHead(200) + end() no body (carve-out)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/res\.writeHead\(200\);\s*\n\s*res\.end\(\);/);
  });

  it('handleMemoryWrite L572 still uses raw writeHead(200, headers) with custom X-WoClaw headers (carve-out)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/res\.writeHead\(200, headers\)/);
  });

  it('handleReady L470 still uses dynamic writeHead(200|503, ...) — not migratable to 200|201 helper', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/res\.writeHead\(allOk \? 200 : 503, \{ 'Content-Type': 'application\/json' \}\)/);
  });

  it('handleSessionDelete L1001 still uses dynamic writeHead(deleted ? 200 : 404, ...) — not migratable', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/res\.writeHead\(deleted \? 200 : 404, \{ 'Content-Type': 'application\/json' \}\)/);
  });
});
