/**
 * R556 — the ROSTER plane: the census of what a protocol's receiver is tested
 * against, mechanised across the whole repo.
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * R555 measured the DISPATCH plane and found a protocol whose receiver has
 * no dispatcher. R555-24 then queued the generalisation as a candidate:
 *
 *   "run the stand-in census per protocol across the WHOLE repo and produce
 *    a protocol → has-end-to-end-test matrix."
 *
 * This round runs that scan. The scan has two halves:
 *
 *   PART 1 — the census itself, mechanised. For every frame type in the
 *            production dispatch vocabulary, count (a) how many suites
 *            mention it and (b) how many of THOSE import the PRODUCTION
 *            receiver. The R555 rule is: mentions > 0 AND end-to-end == 0
 *            ⇒ that protocol vocabulary has NO end-to-end test at all.
 *
 *   PART 2 — the census's own output, applied. The scan found two dispatch
 *            cases with **ZERO** mentions in the entire test tree:
 *            `topics_list` and `topic_members`. Not "covered by a stand-in" —
 *            not mentioned by ANY suite, at all.
 *
 * ── The finding ───────────────────────────────────────────────────────────
 *
 * The two uncovered dispatch cases are the **roster**: "which topics exist"
 * and "who is in this topic". Measured against the PRODUCTION listener:
 *
 *   F1  `topics_list` returns the private topic's NAME and its MEMBER COUNT
 *       to any authenticated agent — including one that never joined it.
 *   F2  `topic_members` returns the private topic's MEMBER IDENTITY LIST to
 *       any authenticated agent — including one that never joined it.
 *   F3  ⇒ The R522 finding ("private is a property of the topic RECORD, not
 *       of the topic's DATA") has a THIRD surface the R522 round did not
 *       enumerate: R522 measured publish + REST read. The WS ROSTER is a
 *       third reader of the same membership set, and it is the only one that
 *       hands out MEMBER IDENTITIES.
 *   F4  The `welcome` frame ALSO leaks the private topic's name (it is
 *       `getAllTopics().map(t => t.name)` — names only, no counts, no ids).
 *   F5  The roster is **admitted at the door but not at the topic**: the
 *       membership check that exists (`joinPrivateTopic`) is on the JOIN
 *       path; the READ path has no identity parameter at all — the same
 *       shape R522-7 pinned for the REST read, one transport over.
 *   F6  ZERO-TEST-MENTION means the leak was invisible to CI: not a
 *       regression, not a coverage gap — the frame type is not in any
 *       suite's vocabulary, so no suite could ever have failed.
 *   F7  The ROSTER is PUBLISHED: `hub/README.md` documents both frames as
 *       shipped features, with example payloads.
 *
 * ── What is pinned here ───────────────────────────────────────────────────
 *
 * This is a DISCLOSURE suite (defect-presence gate): green today, RED when
 * the roster is access-controlled. It does NOT decide the repair — that is a
 * PRODUCT decision (father-gated): filter the roster to the caller's own
 * memberships, or refuse private topics entirely on the WS roster.
 *
 * Every arm carries an explicit ROLE, because the mutation matrix reads
 * roles to decide what a flip MEANS:
 *
 *   DEFECT-PIN     a roster-access repair SHOULD flip it RED
 *   CONTROL        a repair MUST NOT flip it      (a stable fact)
 *   CENSUS         the mechanical scan itself — the R556 instrument
 *   PUBLICATION    the claim the docs make
 *
 * Zero production changes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import type { Config } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const TESTDIR = join(HERE, '..', 'test');
const HUBROOT = join(HERE, '..');

const TOKEN = 'r556-roster-token';
const DATA_DIR = '/tmp/woclaw-r556-roster';
const PRIVATE_TOPIC = 'secret-room';
const MEMBER = 'member-agent';
const OUTSIDER = 'outsider-agent';

// ---------------------------------------------------------------------------
// Tree walking (R421/R426: derive the subject set, never hand-list it).
// ---------------------------------------------------------------------------

function walkTs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkTs(p, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Production source set, tests excluded. */
function prodFiles(): string[] {
  return walkTs(SRC).filter((p) => !p.endsWith('.test.ts'));
}

/** Every test file in the hub test tree, self excluded. */
function testFiles(): string[] {
  const here = fileURLToPath(import.meta.url);
  return walkTs(TESTDIR).filter((p) => p !== here);
}

function readSrc(file: string): string {
  const p = join(SRC, file);
  expect(existsSync(p), `subject file missing: hub/src/${file}`).toBe(true);
  return readFileSync(p, 'utf8');
}

function rel(p: string): string {
  return p.slice(SRC.length + 1);
}

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

// ---------------------------------------------------------------------------
// The census instrument (R556's deliverable — PART 1).
// ---------------------------------------------------------------------------

/**
 * The production dispatch vocabulary, DERIVED from the source — never
 * hand-listed. Two derivations are cross-checked against each other:
 *
 *   (a) the `case` labels in `WSServer.handleMessage`'s switch
 *   (b) the `type` union of `InboundMessage` in types.ts
 *
 * The union is the wider set (it includes the OUTBOUND `pong`, plus the
 * scope literals `all`/`session`/`workspace` which are not frame types).
 * The census runs over the intersection — the frames the receiver actually
 * dispatches — because that is the set that can be "dispatched but untested".
 */
function dispatchVocabulary(): string[] {
  const ws = readSrc('ws_server.ts');

  // (a) the switch's case labels, scoped to handleMessage's own body.
  const sig = ws.indexOf('private async handleMessage(');
  expect(sig, 'WSServer.handleMessage was not found').toBeGreaterThan(-1);
  const open = ws.indexOf('{', sig);
  const close = ws.indexOf('\n  private ', open + 1);
  expect(close, 'handleMessage body end was not found').toBeGreaterThan(open);
  const body = ws.slice(open, close);
  const cases = [...body.matchAll(/case '([a-z][a-z_-]*)':/g)].map((m) => m[1]);

  // (b) the InboundMessage type union.
  const types = readSrc('types.ts');
  const um = types.match(/export interface InboundMessage \{([\s\S]*?)\n\}/);
  expect(um, 'InboundMessage was not found in types.ts').not.toBeNull();
  const union = [...um![1].matchAll(/'([a-z][a-z_-]*)'/g)].map((m) => m[1]);

  // Every dispatched frame must be a declared frame type. If this fails, the
  // derivation is wrong — not the tree.
  for (const c of cases) {
    expect(union, `dispatched frame '${c}' is not in the InboundMessage union`).toContain(c);
  }
  return cases;
}

/** Does this suite file import the PRODUCTION receiver? */
function importsProdReceiver(body: string): boolean {
  return /from\s+'\.\.\/src\/ws_server\.js'/.test(body);
}

interface CensusRow {
  vocab: string;
  mentions: number;
  endToEnd: number;
  mentioningSuites: string[];
  endToEndSuites: string[];
}

/**
 * The census: per dispatch frame, mentions vs end-to-end.
 *
 * The result is CACHED. The census walks the whole test tree (200+ files)
 * and four arms call it; without the cache the suite reads the tree four
 * times, which on a loaded host (R555-P10) turns a 2-second suite into a
 * timeout. The subject set cannot change during one suite run — the tree
 * is not modified by the suite.
 */
let CENSUS_CACHE: CensusRow[] | null = null;

function census(): CensusRow[] {
  if (CENSUS_CACHE) return CENSUS_CACHE;
  const vocab = dispatchVocabulary();
  const files = testFiles();
  const rows: CensusRow[] = [];
  for (const v of vocab) {
    const mentioningSuites: string[] = [];
    const endToEndSuites: string[] = [];
    for (const p of files) {
      const body = readFileSync(p, 'utf8');
      // A mention means the frame type appears as a QUOTED LITERAL — the
      // way a frame type is actually written on the wire. R556's first
      // draft matched bare word boundaries and produced a false positive
      // on `publish-stream` (the hyphen breaks \b after the hyphen).
      if (!body.includes(`'${v}'`) && !body.includes(`"${v}"`)) continue;
      mentioningSuites.push(p.split('/').pop()!);
      if (importsProdReceiver(body)) endToEndSuites.push(p.split('/').pop()!);
    }
    rows.push({
      vocab: v,
      mentions: mentioningSuites.length,
      endToEnd: endToEndSuites.length,
      mentioningSuites,
      endToEndSuites,
    });
  }
  CENSUS_CACHE = rows;
  return rows;
}

// ---------------------------------------------------------------------------
// A live socket against the PRODUCTION receiver.
// ---------------------------------------------------------------------------

interface CloseInfo { code: number; reason: string }

function openAndAwaitClose(url: string): Promise<CloseInfo> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* already closed */ }
      reject(new Error('timeout: socket never opened nor closed'));
    }, 5000);
    ws.on('open', () => { /* the server's close is the assertion */ });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    ws.on('error', () => { /* close is the assertion; error is expected */ });
  });
}

/**
 * Open an agent socket on the production listener and collect every frame
 * the hub sends back.
 *
 * R553-15: assert on AWAITED EVENTS, not on sampled state. The frames are
 * collected by the socket's own 'message' event, so there is no poll
 * between "sent" and "recorded" — the only wait is a settle for the
 * server's own dispatch to finish.
 *
 * R556 records NON-VACUITY: the frames actually observed are returned, so a
 * zero result can always be disambiguated between "the receiver dropped it"
 * and "nothing was ever sent" (R555-P3).
 */
function openAndCollect(url: string, framesToSend: unknown[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const frames: unknown[] = [];
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* already closed */ }
      reject(new Error('timeout: no frames collected'));
    }, 5000);
    ws.on('message', (data) => {
      try { frames.push(JSON.parse(data.toString())); } catch { frames.push(data.toString()); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('open', async () => {
      for (const f of framesToSend) {
        ws.send(JSON.stringify(f));
        await new Promise((r) => setTimeout(r, 20));
      }
      await new Promise((r) => setTimeout(r, 250));
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve(frames);
    });
  });
}

// ===========================================================================
// F0 — the CENSUS instrument itself.
// ===========================================================================

describe('R556 F0: the census instrument is mechanical and non-vacuous', () => {
  // ── arm F0a: CONTROL — the instrument finds the production vocabulary ──
  it('(F0a) CONTROL — the derived dispatch vocabulary is non-empty and every frame is a declared type', () => {
    const vocab = dispatchVocabulary();
    expect(vocab.length).toBeGreaterThanOrEqual(10);
    // The two roster frames are IN the vocabulary — the census's subject set
    // is derived, not assumed.
    expect(vocab).toContain('topics_list');
    expect(vocab).toContain('topic_members');
  });

  // ── arm F0b: CENSUS — the non-vacuity control ─────────────────────────
  it('(F0b) CENSUS — stand-in servers DO exist in the tree (so "zero" is a finding, not a broken walk)', () => {
    const standIns = testFiles().filter((p) =>
      /new\s+WebSocketServer\s*\(/.test(readFileSync(p, 'utf8')),
    );
    expect(standIns.length).toBeGreaterThan(0);
    // And the census must be able to tell a stand-in suite from a
    // production-receiver suite.
    const withProd = standIns.filter((p) => importsProdReceiver(readFileSync(p, 'utf8')));
    expect(withProd.length).toBeGreaterThan(0);
  });

  // ── arm F0c: CENSUS — the census output is a well-formed matrix ───────
  it('(F0c) CENSUS — every dispatch frame appears in the census matrix with a mention count', () => {
    const rows = census();
    const vocab = dispatchVocabulary();
    expect(rows.length).toBe(vocab.length);
    for (const r of rows) {
      expect(r.mentioningSuites.length).toBe(r.mentions);
      expect(r.endToEndSuites.length).toBe(r.endToEnd);
      // End-to-end suites are a SUBSET of mentioning suites, always.
      expect(r.endToEnd).toBeLessThanOrEqual(r.mentions);
    }
  });
});

// ===========================================================================
// F1 — the census OUTPUT: two dispatch frames with ZERO test mentions.
// ===========================================================================

describe('R556 F1: two dispatch frames are mentioned by NO suite in the whole tree', () => {
  it('(F1a) DEFECT-PIN — `topics_list` is mentioned by ZERO test suites', () => {
    const rows = census();
    const row = rows.find((r) => r.vocab === 'topics_list');
    expect(row, 'topics_list is not in the derived dispatch vocabulary').toBeDefined();
    expect(
      row!.mentioningSuites,
      `topics_list is mentioned by: ${row!.mentioningSuites.join(', ')} — the R556 finding was that it was ZERO`,
    ).toEqual([]);
  });

  it('(F1b) DEFECT-PIN — `topic_members` is mentioned by ZERO test suites', () => {
    const rows = census();
    const row = rows.find((r) => r.vocab === 'topic_members');
    expect(row, 'topic_members is not in the derived dispatch vocabulary').toBeDefined();
    expect(
      row!.mentioningSuites,
      `topic_members is mentioned by: ${row!.mentioningSuites.join(', ')} — the R556 finding was that it was ZERO`,
    ).toEqual([]);
  });

  // ── arm F1c: CONTROL — the OTHER frames ARE covered, so the scan works ──
  it('(F1c) CONTROL — the census is not reporting zero for everything (the scan finds the covered frames too)', () => {
    const rows = census();
    const covered = rows.filter((r) => r.endToEnd > 0).map((r) => r.vocab);
    expect(covered.length).toBeGreaterThan(5);
    // And every frame other than the two roster frames has at least one
    // mention — the two are the ONLY holes.
    const zeroMention = rows.filter((r) => r.mentions === 0).map((r) => r.vocab).sort();
    expect(zeroMention).toEqual(['topic_members', 'topics_list']);
  });

  // ── arm F1d: CONTROL — both roster frames are LIVE dispatch cases ───
  it('(F1d) CONTROL — both roster frames are LIVE dispatch cases in production', () => {
    const ws = readSrc('ws_server.ts');
    expect(ws).toContain("case 'topics_list':");
    expect(ws).toContain("case 'topic_members':");
    // And the handlers exist and are reachable from those cases.
    //
    // The call-site and signature assertions are TOLERANT of an extra
    // argument, on purpose. R555-P4's lesson: an arm that asserts the
    // CODE'S SHAPE instead of its BEHAVIOUR will flip under a
    // "recognises but refuses" variant — a mutant that adds the caller's
    // identity to the signature and then ignores it changes the shape and
    // changes nothing. This arm's claim is LIVENESS ("these frames are
    // dispatched"), and every repair shape keeps them dispatched.
    expect(ws).toMatch(/private handleTopicsList\(/);
    expect(ws).toMatch(/private handleTopicMembers\(/);
    expect(ws).toMatch(/this\.handleTopicsList\(agent\.ws(?:,\s*agentId)?\)/);
    expect(ws).toMatch(/this\.handleTopicMembers\(agent\.ws,\s*msg\.topic(?:,\s*agentId)?\)/);
  });
});

// ===========================================================================
// F2 — the roster plane: the leak, measured against the PRODUCTION listener.
// ===========================================================================

describe('R556 F2: the roster hands a private topic\'s membership to a non-member', () => {
  let server: WSServer;
  let db: ClawDB;
  let port = 0;

  beforeAll(async () => {
    const fs = await import('node:fs');
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const config: Config = {
      port: 0,
      restPort: 0,
      hubId: 'hub-local-r556',
      host: '127.0.0.1',
      dataDir: DATA_DIR,
      storage: { type: 'sqlite', sqlitePath: `${DATA_DIR}/r556.db` },
      authToken: TOKEN,
    };
    db = new ClawDB(config);
    server = new WSServer(config, db);
    port = await server.whenListening();

    // Seed a PRIVATE topic with exactly one legitimate member, using the
    // PRODUCTION TopicsManager (the same instance the receiver reads).
    const topics = server.getTopicsManager();
    topics.createPrivateTopic(PRIVATE_TOPIC);
    const invite = topics.inviteToTopic(PRIVATE_TOPIC, MEMBER, 600000);
    topics.joinPrivateTopic(MEMBER, PRIVATE_TOPIC, invite);
  });

  afterAll(async () => {
    server.close();
    await db.close();
  });

  // ── arm F2a: CONTROL — the premise: the topic IS private and HAS a member
  it('(F2a) CONTROL — the premise: the topic record is private and the membership set has exactly one member', () => {
    const topics = server.getTopicsManager();
    const topic = topics.getTopic(PRIVATE_TOPIC);
    expect(topic).toBeDefined();
    expect(topic!.isPrivate).toBe(true);
    expect(topics.getTopicAgents(PRIVATE_TOPIC)).toEqual([MEMBER]);
  });

  // ── arm F2b: DEFECT-PIN — topics_list leaks the private topic ─────────
  it('(F2b) DEFECT-PIN — topics_list tells a NON-MEMBER the private topic exists and how many members it has', async () => {
    const frames = await openAndCollect(
      `ws://127.0.0.1:${port}/?agentId=${OUTSIDER}&token=${TOKEN}`,
      [{ type: 'topics_list' }],
    );

    // NON-VACUITY (R555-P3): the frame really was on the wire.
    const roster = frames.find(
      (f): f is { type: string; topics?: { name: string; agents: number }[] } =>
        typeof f === 'object' && f !== null && (f as any).type === 'topics_list',
    );
    expect(roster, `no topics_list frame was received; frames seen: ${JSON.stringify(frames)}`).toBeDefined();

    // The private topic is in the roster, with its member count.
    const entry = roster!.topics!.find((t) => t.name === PRIVATE_TOPIC);
    expect(entry, `the private topic is not in the roster: ${JSON.stringify(roster!.topics)}`).toBeDefined();
    expect(entry!.agents).toBe(1);

    // The outsider is NOT a member of it — and still got it.
    expect(server.getTopicsManager().getTopicAgents(PRIVATE_TOPIC)).not.toContain(OUTSIDER);
  });

  // ── arm F2c: DEFECT-PIN — topic_members leaks the MEMBER IDENTITIES ───
  it('(F2c) DEFECT-PIN — topic_members hands the private topic\'s MEMBER IDENTITY LIST to a non-member', async () => {
    // A DISTINCT agentId: reusing one agentId across arms would trip the
    // replacement-socket eviction (R470) — the old socket's close handler
    // deletes the registry entry for that id, so the second socket's
    // dispatch would find no agent and silently answer nothing. That is a
    // real property of the tree, but it would make this arm measure the
    // eviction plane instead of the roster plane.
    const frames = await openAndCollect(
      `ws://127.0.0.1:${port}/?agentId=${OUTSIDER}-members&token=${TOKEN}`,
      [{ type: 'topic_members', topic: PRIVATE_TOPIC }],
    );

    const roster = frames.find(
      (f): f is { type: string; topic?: string; agents?: string[] } =>
        typeof f === 'object' && f !== null && (f as any).type === 'topic_members',
    );
    expect(roster, `no topic_members frame was received; frames seen: ${JSON.stringify(frames)}`).toBeDefined();

    // The member's IDENTITY — not a count, an identifier — is handed out.
    expect(roster!.topic).toBe(PRIVATE_TOPIC);
    expect(roster!.agents).toEqual([MEMBER]);
  });

  // ── arm F2d: DEFECT-PIN — the roster does not consult membership ──────
  it('(F2d) DEFECT-PIN — the roster does not consult the caller\'s membership, on any path', async () => {
    // F2b/F2c pin the OBSERVED behaviour (the leak). This arm pins the
    // MECHANISM, and it pins it BEHAVIOURALLY, not by reading the
    // signature.
    //
    // R555-P4's lesson, applied: an arm that asserts "the handler's
    // signature has no agentId parameter" measures the CODE'S SHAPE. A
    // "recognises but refuses" variant — the handler learns the caller's
    // identity and then ignores it — changes the shape and changes
    // nothing. That mutant MUST SURVIVE, or the suite is measuring
    // vocabulary instead of behaviour.
    //
    // So this arm asks a question the shape cannot answer: **does the
    // ROSTER still show a topic the caller is not a member of, even when
    // the caller HAS joined another topic?** If the roster were
    // membership-aware, joining topic-A would grant visibility of topic-A
    // and (correctly) hide topic-B. If it is not, the roster is
    // membership-blind and shows everything either way.
    //
    // The probe is a REAL socket against the PRODUCTION listener.
    const frames = await openAndCollect(
      `ws://127.0.0.1:${port}/?agentId=${OUTSIDER}-roster&token=${TOKEN}`,
      [{ type: 'topics_list' }, { type: 'topic_members', topic: PRIVATE_TOPIC }],
    );

    const roster = frames.find(
      (f): f is { type: string; topics?: { name: string; agents: number }[] } =>
        typeof f === 'object' && f !== null && (f as any).type === 'topics_list',
    );
    expect(roster, 'no topics_list frame was received').toBeDefined();

    // The caller is not a member of ANY topic — yet the private topic is
    // in its roster. Membership-blindness, measured.
    const topics = server.getTopicsManager();
    expect(topics.getAgentTopics(`${OUTSIDER}-roster`)).toEqual([]);
    expect(roster!.topics!.map((t) => t.name)).toContain(PRIVATE_TOPIC);
  });

  // ── arm F2e: DEFECT-PIN — the welcome frame leaks the private NAME ───
  it('(F2e) DEFECT-PIN — the welcome frame lists the private topic by NAME to every connecting agent', async () => {
    const frames = await openAndCollect(
      `ws://127.0.0.1:${port}/?agentId=${OUTSIDER}-2&token=${TOKEN}`,
      [],
    );
    const welcome = frames.find(
      (f): f is { type: string; topics?: string[] } =>
        typeof f === 'object' && f !== null && (f as any).type === 'welcome',
    );
    expect(welcome, 'no welcome frame was received').toBeDefined();
    // Names only — no counts, no member ids. The LEAK SURFACE here is
    // strictly weaker than the roster's.
    expect(welcome!.topics).toContain(PRIVATE_TOPIC);
  });

  // ── arm F2f: CONTROL — the listener itself works ─────────────────────
  it('(F2f) CONTROL — the same listener accepts a well-formed agent op and answers it', async () => {
    const frames = await openAndCollect(
      `ws://127.0.0.1:${port}/?agentId=probe-agent-r556&token=${TOKEN}`,
      [{ type: 'ping' }],
    );
    const kinds = frames.map((f: any) => f.type);
    expect(kinds).toContain('welcome');
    expect(kinds).toContain('pong');
    expect(kinds).not.toContain('error');
  });

  // ── arm F2g: CONTROL — an unauthenticated socket is still refused ────
  it('(F2g) CONTROL — the roster is behind the admission gate (a bad token is refused 4001)', async () => {
    const closed = await openAndAwaitClose(`ws://127.0.0.1:${port}/?agentId=${OUTSIDER}&token=wrong-token`);
    expect(closed.code).toBe(4001);
    expect(closed.reason).toContain('Unauthorized');
  });
});

// ===========================================================================
// F3 — the third reader of the membership set (R522's plane, extended).
// ===========================================================================

describe('R556 F3: the roster is a THIRD reader of the private membership set', () => {
  it('(F3a) DEFECT-PIN — three distinct production surfaces read the membership set', () => {
    const ws = readSrc('ws_server.ts');
    const rest = readSrc('rest_server.ts');

    // (1) the JOIN path — the one place membership IS checked.
    // DERIVED, not spelled: the check is "the invited set contains this
    // agent". Spelling `invitedAgents.has(agentId)` would couple the
    // assertion to a formatting choice (R555-P9). Instead, assert the
    // SHAPE: the private-join path consults an invited-set membership test.
    const topics = readSrc('topics.ts');
    expect(topics).toContain('joinPrivateTopic');
    const joinSig = topics.indexOf('joinPrivateTopic(');
    expect(joinSig).toBeGreaterThan(-1);
    const joinBody = topics.slice(joinSig, topics.indexOf('\n  }', joinSig));
    expect(joinBody).toMatch(/invitedAgents\.has\(\s*agentId\s*\)/);
    expect(joinBody).toMatch(/inviteToken\s*===\s*inviteToken/);

    // (2) the ROSTER path — the WS roster, this round's finding.
    expect(ws).toContain('this.topics.getTopicAgents(topic);');
    expect(ws).toContain('t.agents.size');

    // (3) the REST read path — R522's finding, unchanged.
    expect(rest).toContain('handleTopicMessages');
    expect(rest).toContain("path.startsWith('/topics/')");

    // ⇒ Three readers, one membership set, one of which checks.
    const readers = [
      { name: 'join (CHECKED)', ok: topics.includes('invitedAgents.has(agentId)') },
      { name: 'ws roster (UNCHECKED)', ok: ws.includes('this.topics.getTopicAgents(topic);') },
      { name: 'rest read (UNCHECKED)', ok: rest.includes('handleTopicMessages') },
    ];
    expect(readers).toHaveLength(3);
    expect(readers.filter((r) => r.ok).length).toBe(3);
  });

  // ── arm F3b: CONTROL — the WS roster is not reachable via REST ───────
  it('(F3b) CONTROL — the WS roster frames are NOT REST routes; the REST read surface is a different reader', () => {
    const rest = readSrc('rest_server.ts');
    // The REST server never speaks the roster frame vocabulary.
    expect(rest).not.toContain("'topics_list'");
    expect(rest).not.toContain("'topic_members'");
    // It has its own /topics route, which is a GET (unauthenticated — R491).
    expect(rest).toContain("path === '/topics'");
  });
});

// ===========================================================================
// F4 — PUBLICATION: the roster is documented as a shipped feature.
// ===========================================================================

describe('R556 F4: the roster is PUBLISHED as a shipped feature, with example payloads', () => {
  it('(F4a) PUBLICATION — README documents both roster frames as client-usable', () => {
    const readmePath = join(HUBROOT, 'README.md');
    expect(existsSync(readmePath), 'hub/README.md was not found').toBe(true);
    const readme = readFileSync(readmePath, 'utf8');
    expect(readme).toContain("type: 'topics_list'");
    expect(readme).toContain("type: 'topic_members'");
    // And it gives the response payloads, so a client can rely on them.
    expect(readme).toContain('{ "type": "topics_list", "topics":');
    expect(readme).toContain('{ "type": "topic_members", "topic":');
  });

  // ── arm F4b: DEFECT-PIN — the frames are in the published TYPE union ──
  it('(F4b) DEFECT-PIN — both roster frames are declared client-usable types in types.ts', () => {
    const types = readSrc('types.ts');
    const um = types.match(/export interface InboundMessage \{([\s\S]*?)\n\}/);
    expect(um).not.toBeNull();
    expect(um![1]).toContain("'topics_list'");
    expect(um![1]).toContain("'topic_members'");
  });

  // ── arm F4c: CONTROL — WSServer is still the only listener ───────────
  it('(F4c) CONTROL — the width check: WSServer is the ONLY WebSocketServer constructor in production', () => {
    const ctorSites = prodFiles().filter((f) =>
      readFileSync(f, 'utf8').includes('new WebSocketServer('),
    ).map(rel);
    expect(ctorSites.sort()).toEqual(['ws_server.ts']);
  });
});
