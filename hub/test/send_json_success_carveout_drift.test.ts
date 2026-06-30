import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// This test pins the sendJsonSuccess helper comment block against drift.
// Background: the comment block at the bottom of RestServer lists deliberate
// carve-out sites that intentionally stayed inline (OPTIONS preflight,
// handleMemoryWrite custom headers, 405 sites, multi-line body literals).
//
// As follow-up migrations close each carve-out category, the comment block
// must be updated in lockstep — otherwise the comment block drifts from
// reality and future maintainers get misled.
//
// Drift history (this round catches):
//   - L568 → L579 (handleMemoryWrite) drift post 798a0ba + 0eb893c 405 migrations
//     (each added inline writeHead shifted all later lines down)
//   - "multi-line body literals (token rotate, health, etc.): left inline for
//      readability until a follow-up step collapses them" stale entry — closed
//      by 39e7ba4 (06-30 02:43 cron, 10-site migration: token rotate +
//      handleHealth + memory list/stats + memory get/versions/recall/byTag +
//      delegation accept + topic messages)
//
// This test fails if either:
//   (a) the comment block still mentions "L568 handleMemoryWrite"
//   (b) the comment block still mentions "left inline for readability until
//        a follow-up step collapses them" (the closed-by-39e7ba4 marker must
//        be present)
//   (c) the comment block does not mention "closed by 39e7ba4"
//   (d) the comment block does not reference L579 handleMemoryWrite
//
// If a future migration closes another carve-out, update both the comment
// block AND this test in the same commit.

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR); // .../hub
const REST_SERVER = join(HUB_DIR, 'src', 'rest_server.ts');

describe('RestServer.sendJsonSuccess comment block (carve-out drift gating)', () => {
  it('rest_server.ts exists at expected path', () => {
    expect(existsSync(REST_SERVER)).toBe(true);
  });

  it('comment block does NOT reference stale "L568 handleMemoryWrite"', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).not.toMatch(/L568 handleMemoryWrite/);
  });

  it('comment block DOES reference current "L579 handleMemoryWrite"', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/L579 handleMemoryWrite/);
  });

  it('comment block does NOT mention stale "left inline for readability until a follow-up step collapses them"', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).not.toMatch(/left inline for readability until a follow-up step collapses them/);
  });

  it('comment block DOES reference "closed by 39e7ba4" multi-line closure marker', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/closed by 39e7ba4/);
  });

  it('comment block still preserves L137 OPTIONS preflight carve-out', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/L137 OPTIONS preflight/);
  });

  it('comment block still preserves 405 Method-not-allowed parity carve-out', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/405 Method-not-allowed sites: all routed through sendJsonError/);
  });

  it('multi-line closure marker references all 10 sites from 39e7ba4 migration', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // All 10 sites from 39e7ba4 commit msg should be in the closure marker:
    // token rotate + handleHealth + memory list/stats + memory get/versions/
    // recall/byTag + delegation accept + topic messages
    expect(text).toMatch(/token rotate/);
    expect(text).toMatch(/handleHealth/);
    expect(text).toMatch(/memory list/);
    expect(text).toMatch(/memory get/);
    expect(text).toMatch(/versions\/recall\/byTag/);
    expect(text).toMatch(/delegation accept/);
    expect(text).toMatch(/topic messages/);
  });

  it('comment block helpfully notes "now only carve-outs above remain"', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/now\s*\n\s*\/\/\s+only carve-outs above remain/);
  });

  it('sendJsonSuccess helper still defined as private static method', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    expect(text).toMatch(/private static sendJsonSuccess\(/);
  });

  it('sendJsonSuccess helper body unchanged (canonical 2-line writeHead + end)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const helperMatch = text.match(/private static sendJsonSuccess\([\s\S]*?\n  \}\n/);
    expect(helperMatch).not.toBeNull();
    const body = helperMatch![0];
    expect(body).toMatch(/res\.writeHead\(status, \{ 'Content-Type': 'application\/json' \}\)/);
    expect(body).toMatch(/res\.end\(JSON\.stringify\(body\)\)/);
  });
});
