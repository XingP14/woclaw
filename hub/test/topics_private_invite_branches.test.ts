import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TopicsManager } from '../src/topics.js';

describe('TopicsManager private topic invite happy path + error branches', () => {
  let tm: TopicsManager;

  beforeEach(() => {
    tm = new TopicsManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('inviteToTopic error branches', () => {
    it('throws Topic not found for a non-existent topic', () => {
      expect(() => tm.inviteToTopic('nonexistent', 'agent1'))
        .toThrow('Topic not found');
    });

    it('throws Topic is not private when target is a public topic', () => {
      tm.createTopic('general');
      expect(() => tm.inviteToTopic('general', 'agent1'))
        .toThrow('Topic is not private');
    });

    it('generates a 16-hex-character invite token', () => {
      tm.createPrivateTopic('private');
      const token = tm.inviteToTopic('private', 'agent1');
      expect(token).toMatch(/^[0-9a-f]{16}$/);
    });

    it('applies the default 10 minute TTL', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-28T15:00:00.000Z'));
      tm.createPrivateTopic('private');
      tm.inviteToTopic('private', 'agent1');
      const before = tm.getTopic('private')!.inviteExpiresAt!;
      expect(before).toBe(new Date('2026-09-28T15:10:00.000Z').getTime());
    });

    it('honours a custom ttlMs override', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-28T15:00:00.000Z'));
      tm.createPrivateTopic('private');
      tm.inviteToTopic('private', 'agent1', 5000);
      expect(tm.getTopic('private')!.inviteExpiresAt)
        .toBe(new Date('2026-09-28T15:00:05.000Z').getTime());
    });

    it('re-inviting rotates the token and refreshes the TTL', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-28T15:00:00.000Z'));
      tm.createPrivateTopic('private');
      const first = tm.inviteToTopic('private', 'agent1');
      vi.setSystemTime(new Date('2026-09-28T15:05:00.000Z'));
      const second = tm.inviteToTopic('private', 'agent1');
      expect(second).not.toBe(first);
      expect(second).toMatch(/^[0-9a-f]{16}$/);
      expect(tm.getTopic('private')!.inviteExpiresAt)
        .toBe(new Date('2026-09-28T15:15:00.000Z').getTime());
    });
  });

  describe('joinPrivateTopic happy path', () => {
    it('invited agent joins with a valid token', () => {
      tm.createPrivateTopic('private');
      const token = tm.inviteToTopic('private', 'agent1');
      const topic = tm.joinPrivateTopic('agent1', 'private', token);
      expect(topic.agents.has('agent1')).toBe(true);
      expect(tm.getAgentTopics('agent1')).toContain('private');
    });

    it('consumes the token so it cannot be replayed', () => {
      tm.createPrivateTopic('private');
      const token = tm.inviteToTopic('private', 'agent1');
      tm.joinPrivateTopic('agent1', 'private', token);

      expect(() => tm.joinPrivateTopic('agent1', 'private', token))
        .toThrow('Not invited to this private topic');

      const topic = tm.getTopic('private')!;
      expect(topic.invitedAgents.has('agent1')).toBe(false);
      expect(topic.inviteToken).toBeUndefined();
      expect(topic.inviteExpiresAt).toBeUndefined();
    });

    it('rejects an expired invite', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-28T15:00:00.000Z'));
      tm.createPrivateTopic('private');
      const token = tm.inviteToTopic('private', 'agent1', 1000);

      vi.setSystemTime(new Date('2026-09-28T15:00:02.000Z'));
      expect(() => tm.joinPrivateTopic('agent1', 'private', token))
        .toThrow('Not invited to this private topic');
      expect(tm.getTopicAgents('private')).not.toContain('agent1');
    });

    it('accepts an invite exactly at the expiry boundary instant is rejected', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-28T15:00:00.000Z'));
      tm.createPrivateTopic('private');
      const token = tm.inviteToTopic('private', 'agent1', 1000);

      // Date.now() < inviteExpiresAt is strict, so equal => expired
      vi.setSystemTime(new Date('2026-09-28T15:00:01.000Z'));
      expect(() => tm.joinPrivateTopic('agent1', 'private', token))
        .toThrow('Not invited to this private topic');
    });

    it('throws Topic not found for a non-existent private topic', () => {
      expect(() => tm.joinPrivateTopic('agent1', 'nonexistent', 'token'))
        .toThrow('Topic not found');
    });

    it('throws Topic is not private when target is a public topic', () => {
      tm.createTopic('general');
      expect(() => tm.joinPrivateTopic('agent1', 'general', 'token'))
        .toThrow('Topic is not private');
    });
  });

  describe('joinTopic on a private topic', () => {
    it('rejects joining a private topic through the public path', () => {
      tm.createPrivateTopic('private');
      expect(() => tm.joinTopic('agent1', 'private'))
        .toThrow('Private topic: use joinPrivateTopic with invite token');
      expect(tm.getTopicAgents('private')).not.toContain('agent1');
    });
  });

  describe('createPrivateTopic idempotency', () => {
    it('does not downgrade an existing public topic to private', () => {
      tm.createTopic('general');
      tm.createPrivateTopic('general');
      expect(tm.getTopic('general')!.isPrivate).toBe(false);
    });

    it('does not downgrade an existing private topic to public', () => {
      tm.createPrivateTopic('private');
      tm.createTopic('private');
      expect(tm.getTopic('private')!.isPrivate).toBe(true);
    });
  });

  describe('leaveTopic grace-period metadata retention', () => {
    it('keeps topic metadata for history after the last agent leaves', () => {
      tm.joinTopic('agent1', 'general');
      expect(tm.leaveTopic('agent1', 'general')).toBe(true);
      expect(tm.getTopicAgents('general')).toEqual([]);
      expect(tm.getTopic('general')).toBeDefined();
      expect(tm.getStats().totalTopics).toBe(1);
      expect(tm.getStats().topicDetails).toContainEqual({ name: 'general', agents: 0 });
    });

    it('leaving twice is safe and leaves the agentTopics index empty', () => {
      tm.joinTopic('agent1', 'general');
      tm.leaveTopic('agent1', 'general');
      expect(tm.leaveTopic('agent1', 'general')).toBe(true);
      expect(tm.getAgentTopics('agent1')).toEqual([]);
    });
  });

  describe('removeAgent edge cases', () => {
    it('returns an empty list for an unknown agent', () => {
      expect(tm.removeAgent('ghost')).toEqual([]);
      expect(tm.getAgentTopics('ghost')).toEqual([]);
    });

    it('removes a private-topic membership as well', () => {
      tm.createPrivateTopic('private');
      const token = tm.inviteToTopic('private', 'agent1');
      tm.joinPrivateTopic('agent1', 'private', token);
      tm.joinTopic('agent1', 'general');

      const left = tm.removeAgent('agent1');
      expect(left.sort()).toEqual(['general', 'private']);
      expect(tm.getTopicAgents('private')).not.toContain('agent1');
      expect(tm.getAgentTopics('agent1')).toEqual([]);
      // getStats counts the agentTopics index, not the topic roster
      expect(tm.getStats().totalAgents).toBe(0);
    });
  });

  describe('getStats with zero state', () => {
    it('returns zeroes for a fresh manager', () => {
      expect(tm.getStats()).toEqual({
        totalTopics: 0,
        totalAgents: 0,
        topicDetails: [],
      });
    });
  });

  describe('broadcast with excludeAgent not in the topic', () => {
    it('still returns every member when the excluded agent never joined', () => {
      tm.joinTopic('agent1', 'general');
      tm.joinTopic('agent2', 'general');
      const recipients = tm.broadcast('general', { type: 'message', content: 'hi' }, 'nobody');
      expect(recipients.sort()).toEqual(['agent1', 'agent2']);
    });

    it('returns an empty list when excluding the only member', () => {
      tm.joinTopic('agent1', 'general');
      expect(tm.broadcast('general', { type: 'message' }, 'agent1')).toEqual([]);
    });
  });

  describe('getAgentTopics for an agent that never joined', () => {
    it('returns an empty array', () => {
      expect(tm.getAgentTopics('ghost')).toEqual([]);
    });
  });
});
