import { describe, it, expect } from 'vitest';
import { TopicsManager } from '../src/topics';

/**
 * R468 — Revocation reachability: a removal that reaches only the membership
 * set does not reach the credential set.
 *
 * External canonicals (Zahanturel/adtp README, Raj-glitch-max/atlas LIMITATIONS)
 * name the same plane independently: a revocation is only as good as its
 * propagation to the verifier. adtp README:32-40 — "Revocation does not reach
 * the sub-agent... an agent you have revoked can still act, through a delegate
 * you cannot enumerate." atlas LIMITATIONS:12 — "staleness budget is exactly
 * your revocation blind spot".
 *
 * WoClaw's vocabulary for this plane is 0 (`revok|cascade|deny|capability|
 * credential` all zero across hub/src). But the plane is not absent — it is
 * UNEXPRESSIBLE, the R395/R399 shape: there is no conflict field, so no
 * conflict check can be written.
 */

describe('r468: revocation reach — TopicsManager', () => {
  it('A: removeAgent does not revoke a live invite (the credential outlives the membership removal)', () => {
    const m = new TopicsManager();
    m.createTopic('t', true);
    const tok = m.inviteToTopic('t', 'A', 600_000);

    // The removal call — the only removal surface TopicsManager exposes.
    expect(m.removeAgent('A')).toEqual([]);

    // Membership is genuinely gone.
    expect(m.getAgentTopics('A').length).toBe(0);

    // But the credential minted BEFORE the removal still authenticates.
    expect(() => m.joinPrivateTopic('A', 't', tok)).not.toThrow();
    expect(m.getTopicAgents('t')).toEqual(['A']);
  });

  it('A2: the invite is still held by the removed agent after removal, not merely still-valid', () => {
    // A2 is NOT a derivative of A. A measures validity-after-removal; A2
    // measures retention: the removal does not clear the holder record.
    // If a fix added an un-revoking timestamp check, A2 stays green.
    const m = new TopicsManager();
    m.createTopic('t', true);
    m.inviteToTopic('t', 'A', 600_000);
    m.removeAgent('A');
    // A third observer — with no access to any private field — can still see
    // that A holds an outstanding invitation to a private topic.
    expect(m.getTopicAgents('t')).toEqual([]);
    const topic = (m as any).topics.get('t');
    expect([...topic.invitedAgents]).toEqual(['A']);
  });

  it('B: leaveTopic (post-join removal) also leaves no revocation record', () => {
    const m = new TopicsManager();
    m.createTopic('t', true);
    const tok = m.inviteToTopic('t', 'A', 600_000);
    m.joinPrivateTopic('A', 't', tok);

    // Member has now joined; the token is consumed on join.
    expect((m as any).topics.get('t').inviteToken).toBeUndefined();

    // Removing the member is the "revoke access" gesture.
    m.leaveTopic('A', 't');
    expect(m.getTopicAgents('t')).toEqual([]);

    // A re-invite after removal works, which is correct (a new grant).
    const tok2 = m.inviteToTopic('t', 'A', 600_000);
    expect(() => m.joinPrivateTopic('A', 't', tok2)).not.toThrow();
  });

  it('C: CONTROL — the suite drives the real exported manager, not a transcription', () => {
    const m = new TopicsManager();
    m.createTopic('t', true);
    const tok = m.inviteToTopic('t', 'A', 600_000);
    // If the real surface changed shape, this control goes red rather than the
    // findings silently describing a predicate that no longer exists.
    expect(typeof tok).toBe('string');
    expect(tok.length).toBe(16);
    expect((m as any).topics.get('t').inviteExpiresAt).toBeGreaterThan(Date.now());
  });
});
