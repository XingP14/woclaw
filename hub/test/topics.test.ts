import { describe, it, expect, beforeEach } from 'vitest';
import { TopicsManager } from '../src/topics.js';

describe('TopicsManager', () => {
  let tm: TopicsManager;

  beforeEach(() => {
    tm = new TopicsManager();
  });

  describe('createTopic / getTopic', () => {
    it('creates a new topic', () => {
      const topic = tm.createTopic('general');
      expect(topic).toBeDefined();
      expect(topic.name).toBe('general');
      expect(topic.agents.size).toBe(0);
      expect(topic.messageCount).toBe(0);
    });

    it('returns existing topic if already exists', () => {
      const t1 = tm.createTopic('general');
      const t2 = tm.createTopic('general');
      expect(t1).toBe(t2);
    });

    it('returns undefined for non-existent topic', () => {
      expect(tm.getTopic('nonexistent')).toBeUndefined();
    });
  });

  describe('joinTopic / leaveTopic', () => {
    it('agent can join a topic', () => {
      tm.joinTopic('agent1', 'general');
      const topic = tm.getTopic('general');
      expect(topic?.agents.has('agent1')).toBe(true);
    });

    it('agent can join multiple topics', () => {
      tm.joinTopic('agent1', 'general');
      tm.joinTopic('agent1', 'dev');
      const topics = tm.getAgentTopics('agent1');
      expect(topics).toContain('general');
      expect(topics).toContain('dev');
    });

    it('multiple agents can join same topic', () => {
      tm.joinTopic('agent1', 'general');
      tm.joinTopic('agent2', 'general');
      const agents = tm.getTopicAgents('general');
      expect(agents).toContain('agent1');
      expect(agents).toContain('agent2');
    });

    it('agent can leave a topic', () => {
      tm.joinTopic('agent1', 'general');
      tm.leaveTopic('agent1', 'general');
      expect(tm.getTopicAgents('general')).not.toContain('agent1');
    });

    it('leaveTopic returns false for non-existent topic', () => {
      expect(tm.leaveTopic('agent1', 'nonexistent')).toBe(false);
    });

    it('getTopicAgents returns empty array for non-existent topic', () => {
      expect(tm.getTopicAgents('nonexistent')).toEqual([]);
    });
  });

  describe('getAllTopics', () => {
    it('returns all created topics', () => {
      tm.createTopic('general');
      tm.createTopic('dev');
      tm.createTopic('random');
      const topics = tm.getAllTopics();
      expect(topics.length).toBe(3);
      expect(topics.map(t => t.name)).toContain('general');
      expect(topics.map(t => t.name)).toContain('dev');
      expect(topics.map(t => t.name)).toContain('random');
    });
  });

  describe('broadcast', () => {
    it('returns all agents except excluded', () => {
      tm.joinTopic('agent1', 'general');
      tm.joinTopic('agent2', 'general');
      tm.joinTopic('agent3', 'general');
      const recipients = tm.broadcast('general', { type: 'message', content: 'hello' }, 'agent1');
      expect(recipients).toContain('agent2');
      expect(recipients).toContain('agent3');
      expect(recipients).not.toContain('agent1');
      expect(recipients.length).toBe(2);
    });

    it('returns empty array for non-existent topic', () => {
      expect(tm.broadcast('nonexistent', { type: 'message' })).toEqual([]);
    });

    it('broadcasts to all if no excludeAgent', () => {
      tm.joinTopic('agent1', 'general');
      tm.joinTopic('agent2', 'general');
      const recipients = tm.broadcast('general', { type: 'message' });
      expect(recipients.length).toBe(2);
    });
  });

  describe('removeAgent', () => {
    it('removes agent from all topics', () => {
      tm.joinTopic('agent1', 'general');
      tm.joinTopic('agent1', 'dev');
      tm.joinTopic('agent1', 'random');
      const left = tm.removeAgent('agent1');
      expect(left).toContain('general');
      expect(left).toContain('dev');
      expect(left).toContain('random');
      expect(tm.getAgentTopics('agent1')).toEqual([]);
      expect(tm.getTopicAgents('general')).not.toContain('agent1');
    });
  });

  describe('getStats', () => {
    it('returns correct stats', () => {
      tm.joinTopic('agent1', 'general');
      tm.joinTopic('agent2', 'general');
      tm.joinTopic('agent1', 'dev');
      const stats = tm.getStats();
      expect(stats.totalTopics).toBe(2);
      expect(stats.totalAgents).toBe(2);
      expect(stats.topicDetails).toContainEqual({ name: 'general', agents: 2 });
      expect(stats.topicDetails).toContainEqual({ name: 'dev', agents: 1 });
    });
  });
});
