// WoClaw Graph Memory — In-Memory Graph Store
// Provides Graph Memory with temporal/entity/causal/semantic edges
// No external graph DB dependency — pure TypeScript in-memory store

import { v4 as uuidv4 } from 'uuid';
import type {
  GraphNode, GraphEdge, EdgeType, GraphNodeType,
  GraphQueryOptions, TraversalResult, PathResult, RelatedNodesResult,
  IGraphStore
} from './types.js';

export class GraphStore implements IGraphStore {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  // Adjacency lists for fast traversal
  private outgoing: Map<string, Map<string, GraphEdge>> = new Map();  // source -> (target -> edge)
  private incoming: Map<string, Map<string, GraphEdge>> = new Map();  // target -> (source -> edge)

  // ═══════════════════════════════════════════════════════════
  // NODE OPERATIONS
  // ═══════════════════════════════════════════════════════════

  addNode(node: Omit<GraphNode, 'id' | 'createdAt' | 'updatedAt'>): GraphNode {
    const now = Date.now();
    const fullNode: GraphNode = {
      ...node,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(fullNode.id, fullNode);
    this.outgoing.set(fullNode.id, new Map());
    this.incoming.set(fullNode.id, new Map());
    return fullNode;
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;
    // Remove all connected edges
    for (const edge of this.edges.values()) {
      if (edge.source === id || edge.target === id) {
        this.removeEdge(edge.id);
      }
    }
    this.nodes.delete(id);
    this.outgoing.delete(id);
    this.incoming.delete(id);
    return true;
  }

  updateNode(id: string, updates: Partial<Omit<GraphNode, 'id' | 'createdAt'>>): GraphNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;
    const updated = {
      ...node,
      ...updates,
      id: node.id,  // preserve immutable fields
      createdAt: node.createdAt,
      updatedAt: Date.now(),
    };
    this.nodes.set(id, updated);
    return updated;
  }

  getNodes(type?: GraphNodeType): GraphNode[] {
    const all = Array.from(this.nodes.values());
    if (!type) return all;
    return all.filter(n => n.type === type);
  }

  // ═══════════════════════════════════════════════════════════
  // EDGE OPERATIONS
  // ═══════════════════════════════════════════════════════════

  addEdge(edge: Omit<GraphEdge, 'id' | 'createdAt'>): GraphEdge {
    // Validate nodes exist
    if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) {
      throw new Error(`Edge source/target node must exist`);
    }
    const fullEdge: GraphEdge = {
      ...edge,
      id: uuidv4(),
      createdAt: Date.now(),
    };
    this.edges.set(fullEdge.id, fullEdge);
    // Update adjacency lists
    this.outgoing.get(edge.source)!.set(edge.target, fullEdge);
    this.incoming.get(edge.target)!.set(edge.source, fullEdge);
    return fullEdge;
  }

  getEdge(id: string): GraphEdge | undefined {
    return this.edges.get(id);
  }

  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;
    this.outgoing.get(edge.source)?.delete(edge.target);
    this.incoming.get(edge.target)?.delete(edge.source);
    this.edges.delete(id);
    return true;
  }

  getEdges(options?: { source?: string; target?: string; type?: EdgeType }): GraphEdge[] {
    let all = Array.from(this.edges.values());
    if (options?.source) all = all.filter(e => e.source === options.source);
    if (options?.target) all = all.filter(e => e.target === options.target);
    if (options?.type) all = all.filter(e => e.type === options.type);
    return all;
  }

  // ═══════════════════════════════════════════════════════════
  // TRAVERSAL OPERATIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * BFS traversal from a starting node
   */
  traverse(startNodeId: string, options: GraphQueryOptions = {}): TraversalResult[] {
    const { depth = 1, edgeTypes, nodeTypes, limit = 50 } = options;
    const results: TraversalResult[] = [];
    const visited = new Set<string>();

    type QueueItem = { nodeId: string; path: string[]; edgeTypes: EdgeType[]; currentDepth: number };
    const queue: QueueItem[] = [{ nodeId: startNodeId, path: [startNodeId], edgeTypes: [], currentDepth: 0 }];
    visited.add(startNodeId);

    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()!;
      const currentNode = this.nodes.get(current.nodeId);
      if (!currentNode) continue;

      // Add result (except for start node itself at depth 0)
      if (current.currentDepth > 0) {
        results.push({
          node: currentNode,
          path: current.path,
          edgeTypes: current.edgeTypes,
          depth: current.currentDepth,
        });
      }

      if (current.currentDepth >= depth) continue;

      // Explore neighbors
      const neighbors = this.getEdges({ source: current.nodeId });
      for (const edge of neighbors) {
        if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
        if (visited.has(edge.target)) continue;
        const targetNode = this.nodes.get(edge.target);
        if (!targetNode) continue;
        if (nodeTypes && !nodeTypes.includes(targetNode.type)) continue;

        visited.add(edge.target);
        queue.push({
          nodeId: edge.target,
          path: [...current.path, edge.target],
          edgeTypes: [...current.edgeTypes, edge.type],
          currentDepth: current.currentDepth + 1,
        });
      }
    }

    return results;
  }

  /**
   * Find shortest path between two nodes (BFS)
   */
  findPath(from: string, to: string, maxDepth: number = 5): PathResult | null {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;
    if (from === to) return { from, to, path: [from], edges: [], length: 0 };

    type QueueItem = { nodeId: string; path: string[]; edges: GraphEdge[] };
    const queue: QueueItem[] = [{ nodeId: from, path: [from], edges: [] }];
    const visited = new Set<string>([from]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = this.getEdges({ source: current.nodeId });

      for (const edge of neighbors) {
        if (visited.has(edge.target)) continue;
        const newPath = [...current.path, edge.target];
        const newEdges = [...current.edges, edge];

        if (edge.target === to) {
          return { from, to, path: newPath, edges: newEdges, length: newPath.length - 1 };
        }
        if (newPath.length >= maxDepth) continue;

        visited.add(edge.target);
        queue.push({ nodeId: edge.target, path: newPath, edges: newEdges });
      }
    }

    return null;
  }

  /**
   * Get all nodes related to a given node (incoming + outgoing edges)
   */
  getRelated(nodeId: string, options: GraphQueryOptions = {}): RelatedNodesResult {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const { edgeTypes, nodeTypes } = options;
    const incoming: RelatedNodesResult['incoming'] = [];
    const outgoing: RelatedNodesResult['outgoing'] = [];

    for (const edge of this.getEdges({ target: nodeId })) {
      if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
      const sourceNode = this.nodes.get(edge.source);
      if (!sourceNode) continue;
      if (nodeTypes && !nodeTypes.includes(sourceNode.type)) continue;
      incoming.push({ edge, source: sourceNode });
    }

    for (const edge of this.getEdges({ source: nodeId })) {
      if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
      const targetNode = this.nodes.get(edge.target);
      if (!targetNode) continue;
      if (nodeTypes && !nodeTypes.includes(targetNode.type)) continue;
      outgoing.push({ edge, target: targetNode });
    }

    return { node, incoming, outgoing };
  }

  // ═══════════════════════════════════════════════════════════
  // AUTO-LINKING HELPERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Create entity edge from memory node to agent node
   */
  linkMemoryToAgent(memoryId: string, agentId: string): void {
    if (!this.nodes.has(memoryId) || !this.nodes.has(agentId)) return;
    const existing = this.getEdges({ source: memoryId, target: agentId, type: 'entity' });
    if (existing.length === 0) {
      this.addEdge({ source: memoryId, target: agentId, type: 'entity', metadata: {} });
    }
  }

  /**
   * Create entity edge from memory node to topic node
   */
  linkMemoryToTopic(memoryId: string, topicName: string): void {
    // Find or create topic node
    let topicNode = Array.from(this.nodes.values()).find(n => n.type === 'topic' && n.label === topicName);
    if (!topicNode) {
      topicNode = this.addNode({ type: 'topic', label: topicName, metadata: { name: topicName } });
    }
    const existing = this.getEdges({ source: memoryId, target: topicNode.id, type: 'entity' });
    if (existing.length === 0) {
      this.addEdge({ source: memoryId, target: topicNode.id, type: 'entity', metadata: {} });
    }
  }

  /**
   * Find memories with semantic similarity (for auto semantic edge creation)
   */
  findSimilarMemories(memoryId: string, threshold: number = 0.7): GraphNode[] {
    const memory = this.nodes.get(memoryId);
    if (!memory || memory.type !== 'memory') return [];

    const memories = this.getNodes('memory').filter(m => m.id !== memoryId);
    const similar: { node: GraphNode; score: number }[] = [];

    for (const other of memories) {
      const existing = this.getEdges({ source: memoryId, target: other.id, type: 'semantic' });
      if (existing.length > 0) {
        // Already linked
        const weight = existing[0].weight || 0;
        if (weight >= threshold) similar.push({ node: other, score: weight });
      } else {
        // Simple keyword-based similarity (placeholder — can be replaced with embeddings)
        const score = this.computeTextSimilarity(memory.label, other.label);
        if (score >= threshold) {
          similar.push({ node: other, score });
        }
      }
    }

    return similar.map(s => s.node);
  }

  /**
   * Simple text similarity (Jaccard index on words) — placeholder for embedding-based similarity
   */
  private computeTextSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return intersection.size / union.size;
  }

  // ═══════════════════════════════════════════════════════════
  // STATS
  // ═══════════════════════════════════════════════════════════

  getStats() {
    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      byType: {
        nodes: {
          memory: this.getNodes('memory').length,
          agent: this.getNodes('agent').length,
          topic: this.getNodes('topic').length,
        },
        edges: {
          temporal: this.getEdges({ type: 'temporal' }).length,
          entity: this.getEdges({ type: 'entity' }).length,
          causal: this.getEdges({ type: 'causal' }).length,
          semantic: this.getEdges({ type: 'semantic' }).length,
        },
      },
    };
  }
}
