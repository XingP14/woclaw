// WoClaw Graph Memory — Type Definitions
// Graph Memory: temporal/entity/causal/semantic edges between Memory, Agent, Topic nodes

export type GraphNodeType = 'memory' | 'agent' | 'topic';

export type EdgeType = 'temporal' | 'entity' | 'causal' | 'semantic';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;           // human-readable name
  metadata: Record<string, any>;  // flexible attributes
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  source: string;    // source node id
  target: string;    // target node id
  type: EdgeType;
  weight?: number;   // semantic similarity (0-1), causal strength, etc.
  metadata: Record<string, any>;  // flexible attributes
  createdAt: number;
}

export interface GraphQueryOptions {
  depth?: number;         // max traversal depth (default: 1)
  edgeTypes?: EdgeType[]; // filter by edge types
  nodeTypes?: GraphNodeType[];  // filter by node types
  limit?: number;         // max results (default: 50)
}

export interface TraversalResult {
  node: GraphNode;
  path: string[];    // node ids from source to this node
  edgeTypes: EdgeType[];  // edge types along the path
  depth: number;
}

export interface PathResult {
  from: string;
  to: string;
  path: string[];    // node ids
  edges: GraphEdge[];
  length: number;
}

export interface RelatedNodesResult {
  node: GraphNode;
  incoming: { edge: GraphEdge; source: GraphNode }[];
  outgoing: { edge: GraphEdge; target: GraphNode }[];
}

// Graph Store Interface (for dependency injection)
export interface IGraphStore {
  // Node operations
  addNode(node: Omit<GraphNode, 'id' | 'createdAt' | 'updatedAt'>): GraphNode;
  getNode(id: string): GraphNode | undefined;
  removeNode(id: string): boolean;
  updateNode(id: string, updates: Partial<Omit<GraphNode, 'id' | 'createdAt'>>): GraphNode | undefined;
  getNodes(type?: GraphNodeType): GraphNode[];

  // Edge operations
  addEdge(edge: Omit<GraphEdge, 'id' | 'createdAt'>): GraphEdge;
  getEdge(id: string): GraphEdge | undefined;
  removeEdge(id: string): boolean;
  getEdges(options?: { source?: string; target?: string; type?: EdgeType }): GraphEdge[];

  // Traversal operations
  traverse(startNodeId: string, options?: GraphQueryOptions): TraversalResult[];
  findPath(from: string, to: string, maxDepth?: number): PathResult | null;
  getRelated(nodeId: string, options?: GraphQueryOptions): RelatedNodesResult;

  // Auto-linking helpers
  linkMemoryToAgent(memoryId: string, agentId: string): void;
  linkMemoryToTopic(memoryId: string, topic: string): void;
  findSimilarMemories(memoryId: string, threshold?: number): GraphNode[];
}
