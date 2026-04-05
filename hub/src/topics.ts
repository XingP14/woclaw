import { Agent, Topic, OutboundMessage } from './types.js';

export class TopicsManager {
  private topics: Map<string, Topic> = new Map();
  private agentTopics: Map<string, Set<string>> = new Map(); // agentId -> Set of topic names

  createTopic(name: string, isPrivate: boolean = false): Topic {
    if (!this.topics.has(name)) {
      const topic: Topic = {
        name,
        agents: new Set(),
        messageCount: 0,
        createdAt: Date.now(),
        isPrivate,
        invitedAgents: new Set(),
      };
      this.topics.set(name, topic);
    }
    return this.topics.get(name)!;
  }

  getTopic(name: string): Topic | undefined {
    return this.topics.get(name);
  }

  getAllTopics(): Topic[] {
    return Array.from(this.topics.values());
  }

  /**
   * Join a public topic (no invite required)
   */
  joinTopic(agentId: string, topicName: string): Topic {
    const topic = this.createTopic(topicName);
    if (topic.isPrivate) {
      throw new Error('Private topic: use joinPrivateTopic with invite token');
    }
    topic.agents.add(agentId);

    if (!this.agentTopics.has(agentId)) {
      this.agentTopics.set(agentId, new Set());
    }
    this.agentTopics.get(agentId)!.add(topicName);

    return topic;
  }

  /**
   * Join a private topic with an invite token
   */
  joinPrivateTopic(agentId: string, topicName: string, inviteToken: string): Topic {
    const topic = this.topics.get(topicName);
    if (!topic) throw new Error('Topic not found');
    if (!topic.isPrivate) throw new Error('Topic is not private');

    const isInvited = topic.invitedAgents.has(agentId) &&
      (!topic.inviteExpiresAt || Date.now() < topic.inviteExpiresAt);
    const tokenMatch = topic.inviteToken && topic.inviteToken === inviteToken;

    if (!isInvited && !tokenMatch) {
      throw new Error('Not invited to this private topic');
    }

    topic.agents.add(agentId);
    topic.inviteToken = undefined; // consume the token

    if (!this.agentTopics.has(agentId)) {
      this.agentTopics.set(agentId, new Set());
    }
    this.agentTopics.get(agentId)!.add(topicName);

    return topic;
  }

  /**
   * Create a private topic
   */
  createPrivateTopic(name: string): Topic {
    return this.createTopic(name, true);
  }

  /**
   * Invite an agent to a private topic
   * @returns invite token
   */
  inviteToTopic(topicName: string, agentId: string, ttlMs: number = 10 * 60 * 1000): string {
    const topic = this.topics.get(topicName);
    if (!topic) throw new Error('Topic not found');
    if (!topic.isPrivate) throw new Error('Topic is not private');

    topic.invitedAgents.add(agentId);
    topic.inviteExpiresAt = Date.now() + ttlMs;
    // Generate a random invite token
    topic.inviteToken = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    return topic.inviteToken;
  }

  leaveTopic(agentId: string, topicName: string): boolean {
    const topic = this.topics.get(topicName);
    if (!topic) return false;
    
    topic.agents.delete(agentId);
    
    const agentTopicSet = this.agentTopics.get(agentId);
    if (agentTopicSet) {
      agentTopicSet.delete(topicName);
    }
    
    // Remove empty topics after a grace period (could implement cleanup later)
    if (topic.agents.size === 0) {
      // Keep topic metadata for history, but mark as inactive
    }
    
    return true;
  }

  getTopicAgents(topicName: string): string[] {
    const topic = this.topics.get(topicName);
    return topic ? Array.from(topic.agents) : [];
  }

  getAgentTopics(agentId: string): string[] {
    const topics = this.agentTopics.get(agentId);
    return topics ? Array.from(topics) : [];
  }

  broadcast(topicName: string, message: OutboundMessage, excludeAgent?: string): string[] {
    const topic = this.topics.get(topicName);
    if (!topic) return [];
    
    const recipients: string[] = [];
    for (const agentId of topic.agents) {
      if (agentId !== excludeAgent) {
        recipients.push(agentId);
      }
    }
    return recipients;
  }

  removeAgent(agentId: string): string[] {
    const topics = this.agentTopics.get(agentId) || new Set();
    const leftTopics: string[] = [];
    
    for (const topicName of topics) {
      this.leaveTopic(agentId, topicName);
      leftTopics.push(topicName);
    }
    
    this.agentTopics.delete(agentId);
    return leftTopics;
  }

  getStats(): { totalTopics: number; totalAgents: number; topicDetails: { name: string; agents: number }[] } {
    return {
      totalTopics: this.topics.size,
      totalAgents: this.agentTopics.size,
      topicDetails: this.getAllTopics().map(t => ({
        name: t.name,
        agents: t.agents.size,
      })),
    };
  }
}
