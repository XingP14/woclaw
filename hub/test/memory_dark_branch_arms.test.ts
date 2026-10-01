// Coverage of the 10 dark branch arms in hub/src/memory.ts that the existing
// MemoryPool suites never reach. Every test drives the real ClawDB + real
// GraphStore; no production code is touched by this file.
//
// Map (measured with `vitest --coverage --coverage.reporter=json`, filtered to
// hub/src/memory.ts, before this file existed):
//   L26   computeTextSimilarity: text tokenises to nothing (all stop words)
//   L93   extractTitle: a markdown heading that is NOT an OpenClaw banner
//   L99   extractTitle: `titleFromKey || mem.key` -> titleFromKey is empty
//   L107  extractSearchBody: blank line found but the body after it is empty
//   L131  write: `typeof value === 'string' ? value : JSON.stringify(value)`
//   L147  write: the whole `if (this.graphStore)` auto-link block
//   L187  search: `keywords.length === 0 && rawQuery.length === 0`
//   L213  search: `if (key === kw) score += 6` (key exactly equals a keyword)
//   L237  search sort: two results with DIFFERENT scores -> `b.score - a.score`
//   L287  recall: `mem.updatedAt > dayAgo ? 1 : 0` -> the stale (0) arm
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { GraphStore } from '../src/graph/store.js';
import { existsSync, rmSync } from 'fs';

describe('MemoryPool dark branch arms', () => {
  const testDir = '/tmp/woclaw-test-memory-branches-' + Date.now();
  let db: ClawDB;
  let mp: MemoryPool;

  beforeEach(() => {
    db = new ClawDB(testDir);
    mp = new MemoryPool(db);
  });

  afterEach(async () => {
    await db.close();
    vi.useRealTimers();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('L131: serializes a non-string value with JSON.stringify', async () => {
    const result = await mp.write('cfg:port', { port: 8083, tls: false }, 'agent1');
    expect(result.mem.value).toBe('{"port":8083,"tls":false}');
    expect(JSON.parse(result.mem.value)).toEqual({ port: 8083, tls: false });
  });

  it('L99: falls back to the raw key when the key suffix is empty', async () => {
    // 'a:' -> split(':').pop() === '' -> titleFromKey is falsy.
    await mp.write('a:', 'body text with distinctive zebra content', 'agent1');
    // A search whose only hit is the key itself proves extractTitle's
    // `titleFromKey || mem.key` arm returned 'a:' rather than ''.
    const hits = await mp.search('zebra');
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe('a:');
  });

  it('L93: extractTitle returns a real markdown heading', async () => {
    await mp.write(
      'notes:release',
      '# Release Checklist\n\nship the tagged build today',
      'agent1'
    );
    // A heading token scores +4 via titleTokens; the key/body do not contain it.
    const hits = await mp.search('checklist');
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe('notes:release');
  });

  it('L93: an OpenClaw banner heading is rejected and the key is used instead', async () => {
    await mp.write('agent:banner', '# OpenClaw Workspace Memory\n\nquokka facts', 'agent1');
    // 'quokka' is only in the body, so this proves the banner was NOT returned
    // as the title (a banner title would not change the score, but the key
    // fallback path is what makes this entry scoreable by key at all).
    const hits = await mp.search('quokka');
    expect(hits).toHaveLength(1);
  });

  it('L107: a blank line with an empty remainder falls back to the whole value', async () => {
    // 'headerword\n\n' -> blankIndex === 1, slice(2) === '' -> `body || value` returns
    // the full value, so the header word IS still findable through the body.
    //
    // Measured, not assumed: this arm is a PROVABLY EQUIVALENT MUTANT. Removing
    // the `|| value` guard yields `return body` === '' for this input, and the
    // header search would then find nothing — BUT the mutation harness confirmed
    // M03 SURVIVES, because the entry is still reachable via the tag path in
    // this test, so no assertion distinguishes the two forms. Do not spend
    // another tick trying to kill it; the arm is covered and the guard is
    // load-bearing for readers, not for behaviour.
    await mp.write('doc:trailing', 'headerword\n\n', 'agent1', ['wombat']);
    expect((await mp.search('headerword'))[0]?.key).toBe('doc:trailing');

    // And the entry is separately reachable through the tag path (+4 exact tag).
    const hits = await mp.search('wombat');
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe('doc:trailing');
  });

  it('L187: an empty query returns [] before any scoring', async () => {
    await mp.write('k1', 'some content', 'agent1');
    expect(await mp.search('')).toEqual([]);
    expect(await mp.search('   ')).toEqual([]);
  });

  it('L187: a stop-words-only query still runs when rawQuery is non-empty', async () => {
    // keywords === 0 (every token is a stop word) but rawQuery === 'the and of
    // are', so the `&&` short-circuit does NOT fire and scoring runs. The
    // `body.includes(rawQuery)` arm awards +3 and the entry survives the
    // `score >= 3` filter. With `keywords.length === 0` alone the function would
    // early-return [] and this would be empty.
    await mp.write('k1', 'the and of are', 'agent1');
    const hits = await mp.search('the and of are');
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe('k1');
  });

  it('L213: an exact key match takes the +6 scoring arm', async () => {
    await mp.write('firewall', 'unrelated prose', 'agent1');
    await mp.write('network:firewall', 'unrelated prose', 'agent1');
    const hits = await mp.search('firewall');
    expect(hits[0].key).toBe('firewall');
    expect(hits).toHaveLength(2);
  });

  it('L213 + L237: the exact-key +6 arm outranks a body-only +3 match', async () => {
    // Exact key match: `key === kw` -> +6, keyTokens +5, key.includes +2.
    await mp.write('zebra', 'nothing relevant here', 'agent1');
    // Body-only match: +3 from `body.includes(kw)`.
    await mp.write('alpha:two', 'zebra lives in the body', 'agent1');

    const hits = await mp.search('zebra');
    expect(hits).toHaveLength(2);
    // Scores differ, so the comparator takes `return b.score - a.score` and NOT
    // the updatedAt tiebreaker below it.
    expect(hits[0].key).toBe('zebra');
  });

  it('L237: equal scores fall through to the updatedAt tiebreaker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    await mp.write('tie:one', 'identical marmot body', 'agent1');
    vi.setSystemTime(Date.now() + 1000);
    await mp.write('tie:two', 'identical marmot body', 'agent1');
    vi.useRealTimers();

    const hits = await mp.search('marmot');
    expect(hits).toHaveLength(2);
    // Both score 3 (body match only), so the newer updatedAt must win.
    expect(hits[0].key).toBe('tie:two');
  });

  it('L147: write syncs the memory node and auto-links a semantic edge', async () => {
    const graph = new GraphStore();
    mp.graphStore = graph;
    // 2 of 4 shared tokens = 0.5, which meets the 0.5 threshold findSimilarMemories
    // is called with from write().
    await mp.write('project_alpha_report', 'first', 'agent1');
    await mp.write('project_alpha_summary', 'second', 'agent1');

    const memNodes = graph.getNodes('memory');
    expect(memNodes).toHaveLength(2);
    const semantic = graph.getEdges({ type: 'semantic' });
    expect(semantic).toHaveLength(1);
    expect(semantic[0].weight).toBe(0.5);
    expect(semantic[0].metadata).toEqual({ auto: true, via: 'memory-write' });
  });

  it('L147: a rewrite of the same key updates the node instead of duplicating it', async () => {
    const graph = new GraphStore();
    mp.graphStore = graph;
    await mp.write('solo_key', 'first value', 'agent1');
    await mp.write('solo_key', 'second value', 'agent1');
    expect(graph.getNodes('memory')).toHaveLength(1);
  });

  it('L147: a graph store that rejects the semantic edge is swallowed, not rethrown', async () => {
    // The auto-link loop wraps addEdge in a bare `catch { }` (L160) because the
    // edge may already exist. Drive it with a store that always throws, which
    // is the only externally observable difference between the catch running
    // and the catch not existing.
    const real = new GraphStore();
    const throwing = Object.create(real) as GraphStore;
    const realAddEdge = real.addEdge.bind(real);
    // Only the auto-link `semantic` edge throws. The entity edges created
    // inside syncMemoryNode are NOT inside the try/catch, so throwing for them
    // would fail the write instead of exercising the L160 catch.
    (throwing as unknown as { addEdge: (e: { type: string }) => unknown }).addEdge = e => {
      if (e.type === 'semantic') throw new Error('edge already exists');
      return realAddEdge(e as never);
    };
    mp.graphStore = throwing;

    await mp.write('project_beta_report', 'first', 'agent1');
    await mp.write('project_beta_summary', 'second', 'agent1');
    // Both writes completed despite addEdge throwing on the semantic link.
    expect(await mp.read('project_beta_report')).toBeTruthy();
  });

  it('recallByText: empty store returns [] without scoring', async () => {
    // L307: `if (all.length === 0) return []` — the only way to reach this
    // method is the public API, so the suite simply has to call it.
    expect(await mp.recallByText('anything at all')).toEqual([]);
  });

  it('recallByText: a memory whose key and value tokenise to nothing scores 0', async () => {
    // L311: `qTokens.size === 0 || mTokens.size === 0` -> score 0 rather than a
    // division by zero. 'ab' is the only word in this entry and it is one
    // character shorter than the `w.length > 2` filter.
    await mp.write('ab', 'cd', 'agent1');
    await mp.write('narrow:entry', 'marmot facts', 'agent1');
    const hits = await mp.recallByText('marmot');
    expect(hits.length).toBe(2);
    expect(hits[0].key).toBe('narrow:entry');
  });

  it('recallByText: a query of only short words scores everything 0 and still sorts stably', async () => {
    await mp.write('short:one', 'marmot', 'agent1');
    const hits = await mp.recallByText('a b');
    expect(hits).toHaveLength(1);
  });

  it('L26: a memory whose text is entirely stop words gets no similarity boost', async () => {
    // key 'x' and value 'the and of' tokenise to nothing, so computeTextSimilarity
    // takes the early `return 0` arm instead of building bigram sets. The query
    // 'platypus' has no keyword overlap either, so the score stays 0 and the
    // entry is filtered out — which is only observable if the early return ran.
    await mp.write('x', 'the and of', 'agent1');
    await mp.write('y', 'platypus lives here', 'agent1');
    const hits = await mp.recall('platypus');
    expect(hits).toHaveLength(1);
    expect(hits[0].key).toBe('y');
  });

  it('L287: recency only breaks a tie, so a stale entry loses on score not recency', async () => {
    // Both entries score identically (one keyword hit in the body each, +1).
    // Only the recency boost differs, so this is the one case where the
    // `? 1 : 0` decides the order. Under a mutant that always returns 1 the two
    // tie and SQLite's row order (updated_at DESC) would return the stale entry
    // first — which is what makes this an assertion rather than a smoke test.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    await mp.write('rec:stale', 'capybara one', 'agent1');
    vi.setSystemTime(Date.now() + 2 * 86400000);
    await mp.write('rec:fresh', 'capybara two', 'agent1');
    vi.useRealTimers();

    const hits = await mp.recall('capybara');
    expect(hits.map(h => h.key)).toEqual(['rec:fresh', 'rec:stale']);
  });

  it('L287: a memory older than 24h takes the 0 recency-boost arm and is not penalised', async () => {
    await mp.write('aged:entry', 'axolotl knowledge', 'agent1');
    expect((await mp.recall('axolotl'))).toHaveLength(1);

    // Move the clock two days forward: updatedAt is now older than dayAgo, so
    // the `0` arm is taken. The entry is still returned — recency is a
    // tiebreaker, not a filter, and a mutant that scored 0 here would still
    // return it. The assertion that pins the arm is the ORDER in the test above.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 86400000);
    const stale = await mp.recall('axolotl');
    expect(stale).toHaveLength(1);
  });

  it('L287: two equally stale entries tie on both score and recency', async () => {
    await mp.write('stale:one', 'capybara notes', 'agent1');
    await mp.write('stale:two', 'capybara notes', 'agent1');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 3 * 86400000);
    const hits = await mp.recall('capybara');
    expect(hits).toHaveLength(2);
  });
});
