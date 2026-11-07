/**
 * R534 wedge probe — the external leg (R74 out-of-cluster discipline).
 *
 * THE PLANE: "semantic similarity" that compares IDENTIFIERS instead of
 * CONTENT. An entity-resolution / dedup / memory-linkage step that computes
 * similarity over the key (or the name) rather than over the payload.
 *
 * Control first (R404-M1): if the control queries are not large, a zero below
 * is not evidence.
 *
 * Then a precision leg, and a WIDENING leg (R449-5 / R454-4 / R475-3
 * discipline): existing mechanisms in adjacent fields mean this is a MIGRATION
 * GAP, never a greenfield.
 */
const UA = { 'User-Agent': 'r534-wedge' };

async function hn(query: string, days: number) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=20`;
  const r = await fetch(url, { headers: UA });
  const j = await r.json() as any;
  return { n: j.nbHits ?? 0, titles: (j.hits ?? []).slice(0, 4).map((h: any) => (h.title || h.story_title || '').slice(0, 80)) };
}

async function gh(query: string) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=8`;
  const r = await fetch(url, { headers: { ...UA, Accept: 'application/vnd.github+json' } });
  const j = await r.json() as any;
  if (j.message) return { total: j.message, top: [] };
  return {
    total: j.total_count,
    top: (j.items ?? []).slice(0, 5).map((x: any) => `${x.full_name} ${x.stargazers_count}* ${x.license?.spdx_id ?? 'license:None'}`),
  };
}

async function main() {
  console.log('=== R534 wedge: the "compare the identifier, not the content" plane ===');

  console.log('--- CONTROL (HN, 60d) ---');
  for (const c of ['agent', 'AI agent', 'LLM', 'vector database']) {
    const r = await hn(c, 60);
    console.log(`  CTRL "${c}" = ${r.n}`);
  }

  console.log('--- PRECISION LEG (HN, 120d) ---');
  const precision = [
    'entity resolution compare identifier not content',
    'dedup compare key instead of payload',
    'semantic similarity computed on identifier',
    'entity resolution wrong field compared',
    'duplicate detection compares names not records',
  ];
  for (const q of precision) {
    const r = await hn(q, 120);
    console.log(`  "${q}" = ${r.n}${r.n > 0 ? '  -> ' + r.titles.join(' | ') : '  (TRUE ZERO)'}`);
  }

  console.log('--- PRECISION LEG (GitHub) ---');
  for (const q of ['entity resolution identifier similarity bug', 'dedup compare key not value']) {
    const r = await gh(q);
    console.log(`  GH "${q}" = ${JSON.stringify(r.total)}`);
    for (const t of r.top) console.log('      ', t);
  }

  console.log('--- WIDENING LEG (existing mechanisms in adjacent fields) ---');
  for (const q of [
    'entity resolution blocking candidate pairs',
    'record linkage cosine similarity embeddings',
    'knowledge graph entity alignment',
  ]) {
    const r = await gh(q);
    console.log(`  GH "${q}" = ${JSON.stringify(r.total)}`);
    for (const t of r.top) console.log('      ', t);
  }
}

main().catch((e) => { console.error('WEDGE ERROR', e); process.exit(1); });
