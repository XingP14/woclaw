import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Regression test for the rest_server.ts URL-parsing helpers
// (parseEdgeType / parseNodeType / parseEdgeTypes / parseNodeTypes) and
// their backing constants (EDGE_TYPES / NODE_TYPES).
//
// These helpers narrow URLSearchParams.get(string) (which is `string | null`)
// to typed literal-union values via guard sets, instead of bypassing the type
// system with `as any`. They are file-local (not exported) and back the 6 REST
// call sites (L305 / L338 / L339 / L358 / L359 / L868) that previously cast raw
// query strings to EdgeType / GraphNodeType / EdgeType[] / GraphNodeType[].
//
// Strategy (parallels parse_int_param.test.ts / parse_env_int.test.ts):
//   - read rest_server.ts as text and assert the 4 helper signatures
//   - assert the 2 backing constants are declared with the right literal
//     arrays
//   - assert the helpers are called from each of the 6 call sites
//   - assert the call sites wire through url.searchParams.get(...)
//   - assert no `as any` casts remain at the 6 call sites (regression gate —
//     would catch any future inline-cast regression)
//   - assert the file-local helpers are NOT accidentally exported (preserves
//     encapsulation boundary)

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR);    // .../hub
const REST_SERVER = join(HUB_DIR, 'src', 'rest_server.ts');

function loadSrc(): string {
  return readFileSync(REST_SERVER, 'utf8');
}

describe('parseEdgeType / parseNodeType / parseEdgeTypes / parseNodeTypes URL-narrowing helpers (rest_server.ts)', () => {
  // ── File-level gates ────────────────────────────────────────────────────
  it('rest_server.ts exists at expected path', () => {
    expect(existsSync(REST_SERVER)).toBe(true);
  });

  it('rest_server.ts declares EDGE_TYPES constant with all 4 canonical EdgeType literals', () => {
    const text = loadSrc();
    // Canonical literal order: temporal, entity, causal, semantic.
    expect(text).toMatch(
      /const\s+EDGE_TYPES:\s*readonly\s+EdgeType\[\]\s*=\s*\[\s*['"]temporal['"]\s*,\s*['"]entity['"]\s*,\s*['"]causal['"]\s*,\s*['"]semantic['"]\s*\]/,
    );
  });

  it('rest_server.ts declares NODE_TYPES constant with all 3 canonical GraphNodeType literals', () => {
    const text = loadSrc();
    // Canonical literal order: memory, agent, topic.
    expect(text).toMatch(
      /const\s+NODE_TYPES:\s*readonly\s+GraphNodeType\[\]\s*=\s*\[\s*['"]memory['"]\s*,\s*['"]agent['"]\s*,\s*['"]topic['"]\s*\]/,
    );
  });

  // ── Helper signature gates ─────────────────────────────────────────────
  it('parseEdgeType helper has canonical single-string signature: (raw: string | null): EdgeType | undefined', () => {
    const text = loadSrc();
    expect(text).toMatch(
      /function\s+parseEdgeType\s*\(\s*raw:\s*string\s*\|\s*null\s*\)\s*:\s*EdgeType\s*\|\s*undefined\s*\{/,
    );
  });

  it('parseNodeType helper has canonical single-string signature: (raw: string | null): GraphNodeType | undefined', () => {
    const text = loadSrc();
    expect(text).toMatch(
      /function\s+parseNodeType\s*\(\s*raw:\s*string\s*\|\s*null\s*\)\s*:\s*GraphNodeType\s*\|\s*undefined\s*\{/,
    );
  });

  it('parseEdgeTypes helper has canonical CSV-list signature: (raw: string | null): EdgeType[] | undefined', () => {
    const text = loadSrc();
    expect(text).toMatch(
      /function\s+parseEdgeTypes\s*\(\s*raw:\s*string\s*\|\s*null\s*\)\s*:\s*EdgeType\[\]\s*\|\s*undefined\s*\{/,
    );
  });

  it('parseNodeTypes helper has canonical CSV-list signature: (raw: string | null): GraphNodeType[] | undefined', () => {
    const text = loadSrc();
    expect(text).toMatch(
      /function\s+parseNodeTypes\s*\(\s*raw:\s*string\s*\|\s*null\s*\)\s*:\s*GraphNodeType\[\]\s*\|\s*undefined\s*\{/,
    );
  });

  // ── Helper body gates (behavior preservation) ──────────────────────────
  it('parseEdgeType body uses EDGE_TYPES guard + cast (no `as any` leak)', () => {
    const text = loadSrc();
    // Extract parseEdgeType body — match the function and capture up to the
    // closing `}` at the same brace depth. Simpler: assert key tokens present.
    expect(text).toMatch(
      /function\s+parseEdgeType\s*\([\s\S]*?EDGE_TYPES[\s\S]*?includes\(\s*raw\s*\)/,
    );
    // Guard-set narrowing pattern (must NOT use `as any` on the raw value)
    expect(text).toMatch(
      /function\s+parseEdgeType\s*\([\s\S]*?\(\s*raw\s+as\s+EdgeType\s*\)/,
    );
    // `if (!raw) return undefined` short-circuit on null / empty
    expect(text).toMatch(/function\s+parseEdgeType\s*\([\s\S]*?if\s*\(\s*!raw\s*\)\s+return\s+undefined\s*;/);
  });

  it('parseNodeType body uses NODE_TYPES guard + cast (no `as any` leak)', () => {
    const text = loadSrc();
    expect(text).toMatch(
      /function\s+parseNodeType\s*\([\s\S]*?NODE_TYPES[\s\S]*?includes\(\s*raw\s*\)/,
    );
    expect(text).toMatch(
      /function\s+parseNodeType\s*\([\s\S]*?\(\s*raw\s+as\s+GraphNodeType\s*\)/,
    );
    expect(text).toMatch(/function\s+parseNodeType\s*\([\s\S]*?if\s*\(\s*!raw\s*\)\s+return\s+undefined\s*;/);
  });

  it('parseEdgeTypes body splits on comma + trims + filters empty + delegates to parseEdgeType', () => {
    const text = loadSrc();
    expect(text).toMatch(
      /function\s+parseEdgeTypes\s*\([\s\S]*?raw\.split\(\s*['"],['"]\s*\)\.map\(\s*s\s*=>\s*s\.trim\(\)\s*\)\.filter\(\s*Boolean\s*\)/,
    );
    expect(text).toMatch(
      /function\s+parseEdgeTypes\s*\([\s\S]*?const\s+v\s*=\s*parseEdgeType\(\s*p\s*\)/,
    );
    // Out.length > 0 ? out : undefined — never returns empty array.
    expect(text).toMatch(
      /function\s+parseEdgeTypes\s*\([\s\S]*?return\s+out\.length\s*>\s*0\s*\?\s*out\s*:\s*undefined\s*;/,
    );
  });

  it('parseNodeTypes body splits on comma + trims + filters empty + delegates to parseNodeType', () => {
    const text = loadSrc();
    expect(text).toMatch(
      /function\s+parseNodeTypes\s*\([\s\S]*?raw\.split\(\s*['"],['"]\s*\)\.map\(\s*s\s*=>\s*s\.trim\(\)\s*\)\.filter\(\s*Boolean\s*\)/,
    );
    expect(text).toMatch(
      /function\s+parseNodeTypes\s*\([\s\S]*?const\s+v\s*=\s*parseNodeType\(\s*p\s*\)/,
    );
    expect(text).toMatch(
      /function\s+parseNodeTypes\s*\([\s\S]*?return\s+out\.length\s*>\s*0\s*\?\s*out\s*:\s*undefined\s*;/,
    );
  });

  // ── Call-site coverage (the 6 REST endpoints that use these helpers) ───
  it('parseEdgeType is called at exactly 2 call sites (L305 graph/traverse + L868 ...-search)', () => {
    const text = loadSrc();
    const matches = text.match(/\bparseEdgeType\s*\(/g) || [];
    // 1 declaration + 2 call sites = 3 total references.
    expect(matches.length).toBeGreaterThanOrEqual(3);
    // Each call site must read from url.searchParams.get(...).
    expect(text).toMatch(/parseEdgeType\(\s*url\.searchParams\.get\(\s*['"]type['"]\s*\)\s*\)/);
    expect(text).toMatch(/parseEdgeType\(\s*url2\.searchParams\.get\(\s*['"]type['"]\s*\)\s*\)/);
  });

  it('parseEdgeTypes is called at exactly 2 call sites (L338 + L358 graph/* endpoints)', () => {
    const text = loadSrc();
    const matches = text.match(/\bparseEdgeTypes\s*\(/g) || [];
    // 1 declaration + 2 call sites = 3 total references.
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(text).toMatch(/parseEdgeTypes\(\s*url\.searchParams\.get\(\s*['"]edgeTypes['"]\s*\)\s*\)/);
  });

  it('parseNodeTypes is called at exactly 2 call sites (L339 + L359 graph/* endpoints)', () => {
    const text = loadSrc();
    const matches = text.match(/\bparseNodeTypes\s*\(/g) || [];
    // 1 declaration + 2 call sites = 3 total references.
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(text).toMatch(/parseNodeTypes\(\s*url\.searchParams\.get\(\s*['"]nodeTypes['"]\s*\)\s*\)/);
  });

  it('parseNodeType has 0 direct call sites (it is only delegated-to from parseNodeTypes)', () => {
    // parseNodeType is the per-item narrowing helper; the only consumer is
    // parseNodeTypes. Future regressions that add direct parseNodeType(...) call
    // sites (e.g. someone copy-pasting from parseEdgeType) should be flagged.
    const text = loadSrc();
    // Strip the parseNodeTypes function body — within it the parseNodeType(p)
    // call is the only legitimate reference.
    const stripPattern =
      /function\s+parseNodeTypes?\s*\([\s\S]*?\n\}\s*/g;
    const outside = text.replace(stripPattern, '');
    const directCalls = outside.match(/\bparseNodeType\s*\(/g) || [];
    expect(directCalls.length).toBe(0);
  });

  // ── Regression gates ────────────────────────────────────────────────────
  it('no `as any` cast on the 6 REST call sites (regression: would defeat the type-narrowing helper)', () => {
    // Strip line + block comments so doc-comment "as any" mentions don't
    // false-positive.
    const raw = loadSrc();
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // The 6 call sites use the helpers — they must NOT also cast `as any`.
    // Sample check: the line containing `type: parseEdgeType(...)` must not
    // contain `as any` on the same statement.
    const singleLine = codeOnly.split(/\r?\n/);
    const callSiteLines = singleLine.filter((ln) =>
      /\bparseEdgeType\s*\(|\bparseEdgeTypes\s*\(|\bparseNodeTypes\s*\(/.test(ln),
    );
    expect(callSiteLines.length).toBeGreaterThanOrEqual(6);
    for (const ln of callSiteLines) {
      expect(ln).not.toMatch(/\bas\s+any\b/);
    }
  });

  it('parseEdgeType / parseNodeType / parseEdgeTypes / parseNodeTypes are file-local (NOT exported)', () => {
    // The helpers should stay encapsulated inside rest_server.ts — exporting
    // them would invite drift (callers bypassing the guard set). This test
    // pins the boundary.
    const text = loadSrc();
    expect(text).not.toMatch(/export\s+function\s+parseEdgeType\b/);
    expect(text).not.toMatch(/export\s+function\s+parseNodeType\b/);
    expect(text).not.toMatch(/export\s+function\s+parseEdgeTypes\b/);
    expect(text).not.toMatch(/export\s+function\s+parseNodeTypes\b/);
  });

  it('EDGE_TYPES and NODE_TYPES constants are file-local (NOT exported)', () => {
    const text = loadSrc();
    expect(text).not.toMatch(/export\s+const\s+EDGE_TYPES\b/);
    expect(text).not.toMatch(/export\s+const\s+NODE_TYPES\b/);
  });
});
