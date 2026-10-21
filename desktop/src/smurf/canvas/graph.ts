/** Server graph types and pure helpers for the Workflows editor. No React here. */

import type { Edge, Node } from '@xyflow/react';

export type GraphNode = {
  id: string;
  type: string;
  name?: string;
  params?: Record<string, unknown>;
  position?: [number, number];
};

export type GraphEdge = {
  from: string;
  port?: string;
  to: string;
};

export type Graph = {
  name: string;
  description?: string;
  start: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type NodeParamSpec = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default?: unknown;
  options?: string[];
  description: string;
};

export type NodeSpec = {
  type: string;
  label: string;
  group: string;
  description: string;
  ports: string[];
  params: NodeParamSpec[];
};

export type NodeStatus = 'running' | 'waiting' | 'completed' | 'pending';

export type GraphFlowNodeData = {
  graphNode: GraphNode;
  spec: NodeSpec | undefined;
  isStart: boolean;
  status?: NodeStatus;
};

export type GraphFlowNode = Node<GraphFlowNodeData, 'card'>;
export type GraphFlowEdge = Edge;

const LEVEL_WIDTH = 260;
const ROW_HEIGHT = 110;
const DEFAULT_PORT = 'out';

/** Breadth-first levels from `start`; unreachable nodes go in one trailing column. */
function layoutLevels(graph: Graph): Map<string, number> {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    const targets = outgoing.get(edge.from);
    if (targets) {
      targets.push(edge.to);
    } else {
      outgoing.set(edge.from, [edge.to]);
    }
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];
  if (ids.has(graph.start)) {
    queue.push(graph.start);
    levels.set(graph.start, 0);
  }
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const nextLevel = (levels.get(id) ?? 0) + 1;
    for (const target of outgoing.get(id) ?? []) {
      if (!levels.has(target)) {
        levels.set(target, nextLevel);
        queue.push(target);
      }
    }
  }

  let maxLevel = -1;
  for (const level of levels.values()) maxLevel = Math.max(maxLevel, level);
  for (const node of graph.nodes) {
    if (!levels.has(node.id)) levels.set(node.id, maxLevel + 1);
  }
  return levels;
}

export function toFlow(
  graph: Graph,
  specs: NodeSpec[],
): { nodes: GraphFlowNode[]; edges: GraphFlowEdge[] } {
  const levels = layoutLevels(graph);
  const rows = new Map<number, number>();

  const nodes: GraphFlowNode[] = graph.nodes.map((graphNode) => {
    const level = levels.get(graphNode.id) ?? 0;
    const row = rows.get(level) ?? 0;
    rows.set(level, row + 1);
    const position = graphNode.position
      ? { x: graphNode.position[0], y: graphNode.position[1] }
      : { x: level * LEVEL_WIDTH, y: row * ROW_HEIGHT };

    return {
      id: graphNode.id,
      type: 'card',
      position,
      data: {
        graphNode,
        spec: specs.find((spec) => spec.type === graphNode.type),
        isStart: graphNode.id === graph.start,
      },
    };
  });

  const edges: GraphFlowEdge[] = graph.edges.map((edge) => {
    const port = edge.port ?? DEFAULT_PORT;
    return {
      id: `${edge.from}:${port}->${edge.to}`,
      source: edge.from,
      target: edge.to,
      sourceHandle: port,
      label: port === DEFAULT_PORT ? undefined : port,
      type: 'smoothstep',
    };
  });

  return { nodes, edges };
}

export function fromFlow(nodes: GraphFlowNode[], edges: GraphFlowEdge[], base: Graph): Graph {
  return {
    name: base.name,
    description: base.description,
    start: base.start,
    nodes: nodes.map((node) => ({
      ...node.data.graphNode,
      id: node.id,
      position: [Math.round(node.position.x), Math.round(node.position.y)],
    })),
    edges: edges.map((edge) => {
      const port = edge.sourceHandle ?? DEFAULT_PORT;
      return port === DEFAULT_PORT
        ? { from: edge.source, to: edge.target }
        : { from: edge.source, port, to: edge.target };
    }),
  };
}

export function addNode(graph: Graph, spec: NodeSpec, position: [number, number]): Graph {
  const baseId = spec.type.split('.').filter(Boolean).pop() || 'node';
  const ids = new Set(graph.nodes.map((node) => node.id));
  let id = baseId;
  let suffix = 2;
  while (ids.has(id)) {
    id = `${baseId}${suffix}`;
    suffix += 1;
  }

  const params: Record<string, unknown> = {};
  for (const param of spec.params) {
    if (param.default !== undefined) params[param.name] = param.default;
  }

  const node: GraphNode = {
    id,
    type: spec.type,
    position: [Math.round(position[0]), Math.round(position[1])],
  };
  if (Object.keys(params).length > 0) node.params = params;

  return { ...graph, nodes: [...graph.nodes, node] };
}

export function removeNode(graph: Graph, id: string): Graph {
  const nodes = graph.nodes.filter((node) => node.id !== id);
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id),
    start: graph.start === id ? (nodes[0]?.id ?? '') : graph.start,
  };
}

export function connect(graph: Graph, from: string, port: string, to: string): Graph {
  const edges = graph.edges.filter(
    (edge) => !(edge.from === from && (edge.port ?? DEFAULT_PORT) === port),
  );
  edges.push(port === DEFAULT_PORT ? { from, to } : { from, port, to });
  return { ...graph, edges };
}

/** Mirrors the engine's validate() messages. */
export function validateLocal(graph: Graph, specs: NodeSpec[]): string[] {
  const problems: string[] = [];
  const ids = new Set(graph.nodes.map((node) => node.id));
  const byType = new Map(specs.map((spec) => [spec.type, spec]));

  if (!ids.has(graph.start)) problems.push(`start node ${graph.start} missing`);

  for (const node of graph.nodes) {
    if (!byType.has(node.type)) problems.push(`node ${node.id}: unknown type ${node.type}`);
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) problems.push(`edge from unknown node ${edge.from}`);
    if (!ids.has(edge.to)) problems.push(`edge to unknown node ${edge.to}`);
    const node = graph.nodes.find((item) => item.id === edge.from);
    const spec = node ? byType.get(node.type) : undefined;
    const port = edge.port ?? DEFAULT_PORT;
    if (spec && !spec.ports.includes(port)) {
      problems.push(
        `edge ${edge.from}.${port}: ${node?.type} has ports ${spec.ports.join(', ')}`,
      );
    }
  }

  return problems;
}
