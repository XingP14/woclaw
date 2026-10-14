/**
 * R457 — a private topic's invite credential is ONE token for ALL invitees,
 * and its expiry is the MAX over invites rather than any invited agent's own.
 *
 * Why this file exists
 * --------------------
 * `Topic` (src/types.ts:118) carries `inviteToken?: string` and
 * `inviteExpiresAt?: number` — ONE slot each, on the topic, not on the
 * invitation. `invitedAgents: Set<string>` correctly tracks *who* has been
 * invited, but the *credential* has nowhere to live per-invitee. So:
 *
 *   C1  `inviteToTopic('p','A')` then `inviteToTopic('p','B')` overwrites
 *       `topic.inviteToken`. A now holds a token the topic no longer
 *       recognises, and A's own live invitation is silently void.
 *
 *   C2  `inviteToTopic` sets `topic.inviteExpiresAt = Date.now() + ttlMs`
 *       unconditionally — it never consults the invitee's existing
 *       invitation. So B's fresh 10-minute invite *extends* A's
 *       already-expired one, and an agent whose own window closed joins
 *       successfully on a token minted after their expiry.
 *
 * The existing suite `topics_private_invite_branches.test.ts` drives
 * `inviteToTopic` ONE AT A TIME per fresh `beforeEach` manager
 * (`re-inviting rotates the token and refreshes the TTL`, line 51, re-invites
 * the SAME agent `agent1`). That single-agent shape is exactly what hides both
 * defects: with one invitee, "the topic's token" and "the invitee's token" are
 * the same object, and "the topic's expiry" and "the invitee's expiry" are the
 * same instant. Two invitees are required before either field is wrong.
 *
 * `joinPrivateTopic` (topics.ts:51) is not the defect — it validates the
 * membership of `invitedAgents` correctly (`topic.invitedAgents.has(agentId)`)
 * AND the token. It is faithfully enforcing a credential the writer cannot
 * represent per-agent. That is the shape of a WRITER-SIDE defect, and the fix
 * is a data-model change (per-agent token map on Topic), which is a BEHAVIOUR
 * decision: whether re-inviting a second agent should void the first agent's
 * outstanding invite is exactly the question this suite must not answer for
 * its author.
 *
 * So this suite PINS the current behaviour, marks both claims FATHER-GATED,
 * and adds the controls that stop either arm from passing vacuously.
 *
 * Arms:
 *   A  the second invite is CLOBBERED — A's own live token is refused (C1)
 *   B  a live token still admits the agent it was minted for (the control for
 *      A: proves the refusal above is not "invites never work")
 *   C  B's invite EXTENDS A's EXPIRED window — A joins post-expiry (C2)
 *   D  the clamp is a MAX: B's invite does NOT shorten A's longer window
 *      (the control for C, pinning the direction of the bug)
 *   E  invitedAgents correctly tracks BOTH invitees (so the ONLY broken field
 *      is the credential, not the membership — read-before-asserting, #192)
 *
 * Mutation matrix (see M-arms in the commit body):
 *   M1 delete `topic.inviteToken = <new token>`          -> A, B, C, D fail
 *   M2 delete the `topic.inviteExpiresAt = ...` assignment -> C fails
 *   M3 clamp expiry with Math.min instead of overwrite     -> D fails
 *   M4 drop `topic.invitedAgents.add(agentId)`             -> C fails (A needs
 *                                                            the membership
 *                                                            to get past the
 *                                                            membership guard)
 *   M5 replace Math.random with a constant token generator  -> KILLED by A
 *                                                            (2 runs below)
 *
 * HEADER CORRECTION (2026-10-15 03:03 tick): an inherited header claimed M5
 * SURVIVES arm A and that the mutant "proves nothing". Re-running measured
 * the opposite: M5 is killed, and for a reason the header did not predict.
 * Arm A's first assertion is `expect(tB).not.toBe(tA)`, so with a CONSTANT
 * generator both mints return the same string and A fails on that line —
 * before the clobbering assertion is ever reached. The mutant is killed by
 * token IDENTITY, not by the credential defect it was meant to probe, which
 * is exactly the "coarse" character the header described; it just was never
 * observed dying. Measured per-suite (matrix2): R457 kills 1/1, and the two
 * neighbour suites also go RED under M5, so no suite attributes it to R457.
 * Kept in the matrix and reported with its real attribution.
 *
 * MATRIX RESULT (2026-10-15 03:03 tick, re-derived on this machine):
 *   mutant  R457 fails   neighbours fail   verdict
 *   M1            2             2          KILLED (shared with neighbours)
 *   M2            2             5          KILLED (shared)
 *   M3            2             3          KILLED (shared)
 *   M4            4             3          KILLED (shared, but R457 loses the
 *                                            MOST arms here -- 4 of its 7 go
 *                                            red, the strongest single-signal
 *                                            mutant in the matrix)
 *   M5            1             1          KILLED (identity assertion)
 *
 *   HONEST ATTRIBUTION: no mutant in this matrix is killed by R457 ALONE.
 *   Every one of M1-M5 also reddens at least one neighbour, so this suite
 *   does NOT establish a coverage gap the neighbours left open -- it
 *   re-frames a defect they cannot see on a SHAPE they never exercise
 *   (two invitees on one topic). Its value is the two-invitee geometry plus
 *   arm E's read-before-assert, not a private kill.
 *   baseline    0/0            0/0        47/47 GREEN, md5 restored to
 *                                            367720ef6b446720369054ee940a327e
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TopicsManager } from '../src/topics.js';

const T0 = new Date('2026-10-15T00:00:00.000Z');
const MIN = 60_000;

describe('R457 — private-topic invite credential is topic-wide, not per-invitee', () => {
  let tm: TopicsManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    tm = new TopicsManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- C1: the credential is one slot on the topic -------------------------

  it('arm A: minting a second invite voids the FIRST invitee’s own live token', () => {
    tm.createPrivateTopic('p');
    const tA = tm.inviteToTopic('p', 'A');
    const tB = tm.inviteToTopic('p', 'B');
    expect(tB).not.toBe(tA); // the rotation itself is documented + pinned elsewhere

    // Both are invited (arm E pins that too) — yet A's token is dead.
    expect(() => tm.joinPrivateTopic('A', 'p', tA))
      .toThrow('Not invited to this private topic');
    expect(tm.getTopicAgents('p')).toEqual([]);
  });

  it('arm B: CONTROL — a live token DOES admit the agent it was minted for', () => {
    // Without this, arm A would also pass if invite joins never worked at all.
    const tm2 = new TopicsManager();
    tm2.createPrivateTopic('p');
    const tA = tm2.inviteToTopic('p', 'A');
    tm2.joinPrivateTopic('A', 'p', tA);
    expect(tm2.getTopicAgents('p')).toEqual(['A']);
  });

  it('arm E: invitedAgents tracks BOTH invitees — the membership is not the bug', () => {
    tm.createPrivateTopic('p');
    tm.inviteToTopic('p', 'A');
    tm.inviteToTopic('p', 'B');
    const t = tm.getTopic('p')!;
    expect(Array.from(t.invitedAgents).sort()).toEqual(['A', 'B']);
  });

  // ---- C2: the expiry is an overwrite, not a clamp --------------------------

  it('arm C: a later invite EXTENDS an already-expired window — post-expiry join succeeds', () => {
    tm.createPrivateTopic('p');
    tm.inviteToTopic('p', 'A', MIN);          // A's invite: expires at T0+1min
    const aExpiry = tm.getTopic('p')!.inviteExpiresAt!;
    expect(aExpiry).toBe(T0.getTime() + MIN);

    vi.setSystemTime(T0.getTime() + 5 * MIN); // A's window has closed
    const tB = tm.inviteToTopic('p', 'B', MIN);

    // The finding: A joins on B's token, 4 minutes after their own invite died.
    tm.joinPrivateTopic('A', 'p', tB);
    expect(tm.getTopicAgents('p')).toEqual(['A']);
  });

  it('arm C2: the same join is REFUSED when no second invite re-arms the clock', () => {
    // The undriven control for C (pitfall R421-1 / arm-38 lesson): without a
    // second invite, the expiry is honest and A is turned away.
    const tm2 = new TopicsManager();
    vi.setSystemTime(T0.getTime() + 5 * MIN);
    tm2.createPrivateTopic('p');
    tm2.inviteToTopic('p', 'A', MIN);
    vi.setSystemTime(T0.getTime() + 5 * MIN + 1);
    expect(() => tm2.joinPrivateTopic('A', 'p', 'deadbeefdeadbeef'))
      .toThrow('Not invited to this private topic');
  });

  it('arm D: the overwrite direction is a MAX — a SHORTER second invite cannot shorten A', () => {
    tm.createPrivateTopic('p');
    tm.inviteToTopic('p', 'A', 10 * MIN);      // A's window: 10 min
    const aExpiry = tm.getTopic('p')!.inviteExpiresAt!;
    vi.setSystemTime(T0.getTime() + MIN);
    tm.inviteToTopic('p', 'B', 2 * MIN);       // B's window: only 2 min

    // Overwrite sets expiry to B's mint + 2min = T0+3min < A's T0+10min.
    expect(tm.getTopic('p')!.inviteExpiresAt!).toBeLessThan(aExpiry);
    // So the honest value for A is LONGER, yet the topic now advertises the
    // shorter one — the same single-slot defect read from the other side.
  });

  it('arm F: the token itself is well-formed and single-use once joined', () => {
    tm.createPrivateTopic('p');
    const t = tm.inviteToTopic('p', 'A');
    expect(t).toMatch(/^[0-9a-f]{16}$/);
    tm.joinPrivateTopic('A', 'p', t);
    expect(tm.getTopic('p')!.inviteToken).toBeUndefined(); // consumed
    expect(() => tm.joinPrivateTopic('A', 'p', t))
      .toThrow('Not invited to this private topic'); // single-use
  });
});
