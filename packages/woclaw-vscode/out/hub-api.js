"use strict";
// packages/woclaw-vscode/src/hub-api.ts
//
// R534 — the REST CONTRACT module for the woclaw-vscode extension.
//
// WHY THIS FILE EXISTS
// --------------------
// The extension used to declare its payload types inline in extension.ts and
// assign the RAW response body straight into them:
//
//     this.topics = await httpGet<Topic[]>('/topics') || [];
//     this.agents = await httpGet<Agent[]>('/agents') || [];
//     this.entries = (await httpGet<MemoryEntry[]>('/memory?limit=50')) || [];
//
// Those declarations were never checked against the Hub that actually serves
// them. Measured against the REAL RestServer (R534), every one of the four
// consumed endpoints disagrees with the extension's shape:
//
//   | endpoint | REAL body (measured)                              | extension expected        |
//   |----------|----------------------------------------------------|---------------------------|
//   | /health  | {status,uptime,timestamp,agents,topics} (flat)    | flat — CORRECT            |
//   | /topics  | {topics:[{name,agents:NUMBER}]} (ENVELOPE)       | Topic[] (bare array)      |
//   | /agents  | {agents:[...],count:N} (ENVELOPE)                 | Agent[] (bare array)      |
//   | /memory  | {memory:[...]} (ENVELOPE)                         | MemoryEntry[] (bare array)|
//
// And the FIELD shapes disagree too:
//
//   Topic:      real {name, agents:number}   — extension expected {name, agents:string[], messageCount, type}
//   Agent:      real {agentId, connectedAt, topics, lastSeen} — extension expected {id, ...} (id does not exist)
//   MemoryEntry:real {key,value,tags,ttl,expireAt,updatedAt:number,updatedBy} — extension expected updatedAt:string
//
// The consequence is not a degraded UI, it is a hard crash: the tree
// providers call `.map()` / `.filter()` on what is really an OBJECT.
//
//     topics.map is not a function
//     agents.map is not a function
//     (httpGet(...) || []).filter is not a function
//
// The sibling clients in this same repo already unwrap the envelope
// correctly — `plugin/bin/woclaw.js` reads `d.topics` / `d.memory`,
// `packages/opencode-woclaw-plugin/index.js` reads `data.topics` — so the
// extension was the ONLY client treating the envelope as the payload.
//
// This module is the single place where the contract lives. It is PURE (no
// vscode / http imports) so that it can be executed by a test against the
// REAL Hub's responses instead of against hand-transcribed shapes.
//
// CONTRACT SOURCES (the authority, in order):
//   1. hub/src/rest_server.ts — handleHealth / handleTopicsList /
//      handleAgentsList / handleMemoryList.
//   2. hub/src/ws_server.ts    — getAgentsInfo() (the agent row shape).
//   3. hub/src/topics.ts       — TopicsManager.getStats() (the topic row shape).
// The shapes are additionally pinned by
// integration-test/vscode-hub-contract.test.ts, which boots the REAL Hub and
// feeds its REAL responses through these functions.
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTopics = extractTopics;
exports.extractAgents = extractAgents;
exports.extractMemory = extractMemory;
exports.topicMembers = topicMembers;
// ─── Unwrapping ─────────────────────────────────────────────────────────────
//
// Each extractor accepts the enveloped body (canonical) and a bare array
// (tolerated, so a future Hub that flattens the envelope does not turn into
// a crash). In BOTH cases the result is a real array, so a caller can always
// call .map()/.filter() on it. A body that is neither yields [].
//
// The parameter type is `unknown` on purpose: this is a WIRE BOUNDARY. The
// response arrives as JSON with no compile-time type, so the narrowing has to
// happen at runtime, here — not by asserting a type at the call site (which
// is exactly the bug this module exists to fix: the old code asserted
// `httpGet<Topic[]>('/topics')` and the assertion was silently wrong).
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
/** GET /topics → the topic rows. */
function extractTopics(body) {
    if (!body || typeof body !== 'object')
        return [];
    if (Array.isArray(body))
        return asArray(body);
    return asArray(body.topics);
}
/** GET /agents → the agent rows. */
function extractAgents(body) {
    if (!body || typeof body !== 'object')
        return [];
    if (Array.isArray(body))
        return asArray(body);
    return asArray(body.agents);
}
/** GET /memory → the memory rows. */
function extractMemory(body) {
    if (!body || typeof body !== 'object')
        return [];
    if (Array.isArray(body))
        return asArray(body);
    return asArray(body.memory);
}
/**
 * The agents that belong to a topic.
 *
 * The Hub's REST surface has NO topic-members endpoint — member lists are
 * only available over the WebSocket (`topic_members` frames). GET /agents
 * DOES carry each agent's topic list, so the extension derives the members
 * client-side instead of pretending the topic row carries them.
 */
function topicMembers(topicName, agents) {
    return asArray(agents).filter((a) => asArray(a.topics).indexOf(topicName) !== -1);
}
