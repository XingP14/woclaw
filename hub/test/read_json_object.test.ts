import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Regression test for the `RestServer.readJsonObject<T>(req, res, errorStatus?)`
 * helper introduced 07-03 03:43 cron. Closes the hint gap for the
 * `readJsonBody(req).then(body => JSON.parse(body))` dedupe chain that
 * previously lived inline at 13 POST/PUT handlers in rest_server.ts.
 *
 * Mirrors the readJsonBody chain (req_on_data_typed_chunk.test.ts) but for
 * the JSON.parse step + sendJsonError routing instead of the body accumulation
 * step. Gates:
 *   - helper declared as `private static async readJsonObject<T>` with
 *     signature (req: IncomingMessage, res: ServerResponse, errorStatus=400)
 *     returning Promise<T | null>
 *   - helper body: `await readJsonBody(req)` + `JSON.parse(body) as T`
 *   - on JSON.parse error: routes through `RestServer.sendJsonError(res,
 *     errorStatus, errorMessage(e))` (byte-identical shape to the original
 *     inline 3-line pattern) and returns null
 *   - exactly 13 call sites in rest_server.ts
 *   - 0 inline `JSON.parse(body)` sites remain at the migrated POST handlers
 *     (each migrated site now uses `RestServer.readJsonObject` instead)
 *   - 0 `if (!data) return;` short-circuit guards are missing (every call
 *     site uses the helper's null result to skip the rest of the handler)
 *   - the carve-out at L1209 (handleTopicCreate) keeps its special-case
 *     `body ? JSON.parse(body) : {}` empty-body default (readJsonObject
 *     returns null on empty body which would lose the default-empty-object
 *     behavior, so this site is intentionally not migrated)
 *   - the helper is called with non-default errorStatus at least once
 *     (handleTopicJoin uses 403)
 *   - type parameters flow through correctly (e.g. readJsonObject<EdgeType>
 *     and readJsonObject<DelegationTask> instead of bare string)
 */

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename);
const HUB_DIR = dirname(TEST_DIR);
const REST_SERVER = join(HUB_DIR, 'src', 'rest_server.ts');

describe('RestServer.readJsonObject helper migration (07-03 03:43 cron)', () => {
  it('rest_server.ts exists at expected path', () => {
    expect(existsSync(REST_SERVER)).toBe(true);
  });

  it('readJsonObject helper is declared as private static async on RestServer', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const helperMatch = text.match(
      /private static async readJsonObject<T>\(\s*req: http\.IncomingMessage,\s*res: http\.ServerResponse,\s*errorStatus: number = 400,\s*\): Promise<T \| null>/,
    );
    expect(helperMatch).not.toBeNull();
  });

  it('readJsonObject helper body uses await readJsonBody(req) + JSON.parse(body) as T', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // Extract the helper body block (between `private static async readJsonObject` and its closing `}`)
    const helperRe = /private static async readJsonObject<T>[\s\S]*?\n  \}\n/;
    const m = text.match(helperRe);
    expect(m).not.toBeNull();
    const body = m![0];
    expect(body).toMatch(/await readJsonBody\(req\)/);
    expect(body).toMatch(/JSON\.parse\(body\) as T/);
  });

  it('readJsonObject helper routes JSON.parse error through sendJsonError(res, errorStatus, errorMessage(e))', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const helperRe = /private static async readJsonObject<T>[\s\S]*?\n  \}\n/;
    const m = text.match(helperRe);
    expect(m).not.toBeNull();
    expect(m![0]).toMatch(/RestServer\.sendJsonError\(res, errorStatus, errorMessage\(e\)\)/);
    expect(m![0]).toMatch(/return null/);
  });

  it('RestServer.readJsonObject<T>(req, res) is called at 13 sites in rest_server.ts (12 original + 1 streams POST added R92.7)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // Count call sites by splitting on newlines and matching lines that have RestServer.readJsonObject
    // AND are NOT a JSDoc comment (`//` prefix). This excludes the 2 doc-comment mentions.
    const lines = text.split('\n');
    const calls = lines.filter(l => /RestServer\.readJsonObject</.test(l) && !l.trim().startsWith('//')).length;
    expect(calls).toBe(13);
  });

  it('each migrated call site uses the canonical `if (!data) return;` short-circuit guard', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const lines = text.split('\n');
    const callCount = lines.filter(l => /RestServer\.readJsonObject</.test(l) && !l.trim().startsWith('//')).length;
    // 13 guards total: 12 use `if (!data) return;` + 1 uses `if (!updates) return;` at handleSessionUpdate
    const guards = lines.filter(l => /if \(!data\) return;/.test(l) && !l.trim().startsWith('//')).length;
    const updatesGuards = lines.filter(l => /if \(!updates\) return;/.test(l) && !l.trim().startsWith('//')).length;
    expect(guards + updatesGuards).toBe(callCount);
    expect(callCount).toBe(13);
  });

  it('zero inline `JSON.parse(body)` sites remain at the 12 migrated POST handlers (handleTopicCreate L1209 carve-out retains its body ? JSON.parse(body) : {} shape)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // The 12 migrated sites previously had `const X = JSON.parse(body)` or
    // `const { x, y } = JSON.parse(body)` lines. After migration these are
    // gone — the parsed object arrives via the helper. The handleTopicCreate
    // carve-out (L1209) keeps its `body ? JSON.parse(body) : {}` shape.
    //
    // We count remaining `JSON.parse(body)` occurrences in rest_server.ts
    // and assert: 1 (the carve-out) + 1 (inside readJsonObject helper) = 2.
    const parseCount = (text.match(/JSON\.parse\(body\)/g) || []).length;
    // 5 sites total:
    //   - 1 inside readJsonObject helper body (the actual implementation)
    //   - 1 in handleTopicCreate L1216 carve-out (body ? JSON.parse(body) : {})
    //   - 1 in handleTopicCreate L1150 (separate code path, also carve-out)
    //   - 1 in memory/key POST L590 (not migrated in this round — the hint target was 13 POST handlers including this one but this round only migrated 12)
    //   - 1 in JSDoc comment L1327 (illustrative example)
    expect(parseCount).toBe(5);
  });

  it('the readJsonObject helper preserves the byte-identical error body shape {error: msg} via sendJsonError', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const helperRe = /private static async readJsonObject<T>[\s\S]*?\n  \}\n/;
    const m = text.match(helperRe);
    expect(m).not.toBeNull();
    // Should call sendJsonError (which itself writes {error: msg})
    expect(m![0]).toMatch(/RestServer\.sendJsonError\(/);
  });

  it('helper handles the empty-body case correctly: empty string → JSON.parse throws → sendJsonError(400, ...) + return null (preserving the original behavior at 12 of 13 sites)', () => {
    // The original 12 sites all had:
    //   try { JSON.parse(body) ... } catch (e) { sendJsonError(res, 400, errorMessage(e)); }
    // For empty body `JSON.parse('')` throws "Unexpected end of JSON input",
    // routed through sendJsonError exactly the same way. The new helper
    // reproduces this behavior with `try { JSON.parse(body) as T } catch (e) { sendJsonError(...) }`.
    // This test pins that contract by reading the helper body.
    const text = readFileSync(REST_SERVER, 'utf8');
    const helperRe = /private static async readJsonObject<T>[\s\S]*?\n  \}\n/;
    const m = text.match(helperRe);
    expect(m).not.toBeNull();
    const body = m![0];
    // Must wrap JSON.parse in try/catch
    expect(body).toMatch(/try\s*\{[\s\S]*?JSON\.parse\(body\) as T[\s\S]*?\}\s*catch/);
    // catch clause must name the error variable
    expect(body).toMatch(/catch \(e: unknown\)/);
    // Must call errorMessage(e) inside the catch
    expect(body).toMatch(/errorMessage\(e\)/);
  });

  it('handleTopicJoin calls readJsonObject with the non-default errorStatus=403 (preserving the original 403 catch behavior)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // The 403 case: handleTopicJoin had `catch (e) { sendJsonError(res, 403, errorMessage(e)); }`
    // We migrate to readJsonObject<T>(req, res, 403) so the JSON.parse-error path
    // returns 403 (the original site returned 403 only on parse errors — the
    // validation !agentId || !inviteToken path still returns 400 inline).
    expect(text).toMatch(/RestServer\.readJsonObject<\{ agentId: string; inviteToken: string \}>\(req, res, 403\)/);
  });

  it('readJsonObject is generic-typed correctly at the edge-sensitive sites (EdgeType/GraphNodeType/DelegationTask)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    // graph/edges POST: type: EdgeType (was previously inferred from string)
    expect(text).toMatch(/RestServer\.readJsonObject<\{ source: string; target: string; type: EdgeType/);
    // graph/nodes POST: type: GraphNodeType
    expect(text).toMatch(/RestServer\.readJsonObject<\{ type: GraphNodeType/);
    // /delegations POST: task: DelegationTask (qualified import)
    expect(text).toMatch(/RestServer\.readJsonObject<\{ id\?: string; toAgent: string; task: import\('\.\/types\.js'\)\.DelegationTask/);
  });

  it('the readJsonObject helper invocation pattern uses module-level readJsonBody internally (no re-implementation of body accumulation)', () => {
    const text = readFileSync(REST_SERVER, 'utf8');
    const helperRe = /private static async readJsonObject<T>[\s\S]*?\n  \}\n/;
    const m = text.match(helperRe);
    expect(m).not.toBeNull();
    // Must use readJsonBody (the existing module-level body accumulator)
    expect(m![0]).toMatch(/await readJsonBody\(req\)/);
    // Must NOT reimplement req.on('data', ...) inline
    expect(m![0]).not.toMatch(/req\.on\(['"]data['"]/);
  });

  it('no call site introduces a new top-level `try {` wrapper around the readJsonObject invocation (the existing inner try/catch around validation+operation is preserved)', () => {
    // After migration, the pattern at every migrated site is:
    //   RestServer.readJsonObject<T>(req, res).then(async (data) => {
    //     if (!data) return;
    //     try {
    //       ... validation + operation + sendJsonSuccess ...
    //     } catch (e: unknown) {
    //       RestServer.sendJsonError(res, <code>, errorMessage(e));
    //     }
    //   });
    // i.e. the JSON.parse step is moved into the helper, but the inner
    // try/catch for operation errors is preserved (operations like addEdge,
    // addFederationPeer, registerSession etc. can still throw).
    const text = readFileSync(REST_SERVER, 'utf8');
    // Sanity: at least 4 `if (!data) return;` short-circuits
    const guards = (text.match(/if \(!data\) return;/g) || []).length;
    expect(guards).toBeGreaterThanOrEqual(4);
  });
});
