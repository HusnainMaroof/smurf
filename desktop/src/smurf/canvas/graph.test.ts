import { describe, expect, it } from 'vitest';

import {
  addNode,
  connect,
  fromFlow,
  removeNode,
  toFlow,
  validateLocal,
  type Graph,
  type NodeSpec,
} from './graph';

const PLAN: NodeSpec = {
  type: 'senior.plan',
  label: 'Plan tasks',
  group: 'senior',
  description: 'Break the work into tasks.',
  ports: ['out'],
  params: [{ name: 'maxTasks', type: 'number', default: 8, description: 'Task limit.' }],
};

const APPROVAL: NodeSpec = {
  type: 'human.approval',
  label: 'Owner approval',
  group: 'human',
  description: 'Ask the owner.',
  ports: ['approved', 'rejected'],
  params: [],
};

const SPECS = [PLAN, APPROVAL];

function sampleGraph(): Graph {
  return {
    name: 'Ship it',
    description: 'Plan then approve.',
    start: 'plan',
    nodes: [
      { id: 'plan', type: 'senior.plan', name: 'Plan', params: { maxTasks: 4 }, position: [20, 40] },
      { id: 'approve', type: 'human.approval', position: [280, 40] },
      { id: 'verify', type: 'senior.plan', position: [540, 40] },
    ],
    edges: [
      { from: 'plan', to: 'approve' },
      { from: 'approve', port: 'approved', to: 'verify' },
    ],
  };
}

describe('toFlow', () => {
  it('maps graph nodes and edges, using stored positions', () => {
    const flow = toFlow(sampleGraph(), SPECS);

    expect(flow.nodes).toHaveLength(3);
    expect(flow.nodes[0]).toMatchObject({
      id: 'plan',
      type: 'card',
      position: { x: 20, y: 40 },
      data: { graphNode: { id: 'plan' }, spec: PLAN, isStart: true },
    });
    expect(flow.nodes[1].data.isStart).toBe(false);

    expect(flow.edges[0]).toMatchObject({
      id: 'plan:out->approve',
      source: 'plan',
      target: 'approve',
      sourceHandle: 'out',
      type: 'smoothstep',
    });
    expect(flow.edges[0].label).toBeUndefined();
    expect(flow.edges[1]).toMatchObject({
      id: 'approve:approved->verify',
      sourceHandle: 'approved',
      label: 'approved',
    });
  });

  it('lays out breadth-first, 260px per level and 110px per row', () => {
    const graph: Graph = {
      name: 'Auto',
      start: 'a',
      nodes: [
        { id: 'a', type: 'senior.plan' },
        { id: 'b', type: 'senior.plan' },
        { id: 'c', type: 'senior.plan' },
        { id: 'lost', type: 'senior.plan' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    };

    const flow = toFlow(graph, SPECS);
    const positions = Object.fromEntries(flow.nodes.map((node) => [node.id, node.position]));

    expect(positions.a).toEqual({ x: 0, y: 0 });
    expect(positions.b).toEqual({ x: 260, y: 0 });
    expect(positions.c).toEqual({ x: 260, y: 110 });
    expect(positions.lost).toEqual({ x: 520, y: 0 });
  });
});

describe('fromFlow', () => {
  it('round trips nodes, params, edges and ports', () => {
    const graph = sampleGraph();

    const roundTripped = fromFlow(toFlow(graph, SPECS).nodes, toFlow(graph, SPECS).edges, graph);

    expect(roundTripped).toEqual(graph);
  });

  it('rounds positions and keeps name, description and start', () => {
    const graph = sampleGraph();
    const flow = toFlow(graph, SPECS);
    flow.nodes[0].position = { x: 10.6, y: 20.2 };

    const next = fromFlow(flow.nodes, flow.edges, graph);

    expect(next.name).toBe('Ship it');
    expect(next.description).toBe('Plan then approve.');
    expect(next.start).toBe('plan');
    expect(next.nodes[0].position).toEqual([11, 20]);
  });
});

describe('addNode', () => {
  it('creates a unique id from the type and defaults params', () => {
    const graph: Graph = {
      name: 'G',
      start: 'plan',
      nodes: [{ id: 'plan', type: 'senior.plan' }],
      edges: [],
    };

    const next = addNode(graph, PLAN, [100, 200]);

    expect(next.nodes.map((node) => node.id)).toEqual(['plan', 'plan2']);
    expect(next.nodes[1]).toMatchObject({
      type: 'senior.plan',
      position: [100, 200],
      params: { maxTasks: 8 },
    });
  });

  it('skips params without a default', () => {
    const spec: NodeSpec = {
      ...PLAN,
      type: 'flow.flag',
      params: [
        { name: 'note', type: 'string', description: 'No default.' },
        { name: 'enabled', type: 'boolean', default: false, description: 'Flag.' },
      ],
    };
    const graph: Graph = { name: 'G', start: '', nodes: [], edges: [] };

    const node = addNode(graph, spec, [0, 0]).nodes[0];

    expect(node.params).toEqual({ enabled: false });
  });
});

describe('removeNode', () => {
  it('removes the node and its edges', () => {
    const next = removeNode(sampleGraph(), 'approve');

    expect(next.nodes.map((node) => node.id)).toEqual(['plan', 'verify']);
    expect(next.edges).toEqual([]);
  });

  it('moves start to the first remaining node', () => {
    const next = removeNode(sampleGraph(), 'plan');

    expect(next.start).toBe('approve');
  });

  it('empties start when the last node is removed', () => {
    const graph: Graph = {
      name: 'G',
      start: 'only',
      nodes: [{ id: 'only', type: 'senior.plan' }],
      edges: [],
    };

    expect(removeNode(graph, 'only').start).toBe('');
  });
});

describe('connect', () => {
  it('replaces an edge from the same node and port', () => {
    const next = connect(sampleGraph(), 'plan', 'out', 'verify');

    expect(next.edges.filter((edge) => edge.from === 'plan')).toEqual([
      { from: 'plan', to: 'verify' },
    ]);
  });

  it('keeps edges from other ports', () => {
    const next = connect(sampleGraph(), 'approve', 'rejected', 'verify');

    expect(next.edges).toEqual([
      { from: 'plan', to: 'approve' },
      { from: 'approve', port: 'approved', to: 'verify' },
      { from: 'approve', port: 'rejected', to: 'verify' },
    ]);
  });
});

describe('validateLocal', () => {
  const base: Graph = { name: 'G', start: 'a', nodes: [], edges: [] };

  it('catches a missing start', () => {
    const graph: Graph = { ...base, start: 'nope', nodes: [{ id: 'a', type: 'senior.plan' }] };

    expect(validateLocal(graph, SPECS)).toEqual(['start node nope missing']);
  });

  it('catches an unknown type', () => {
    const graph: Graph = { ...base, nodes: [{ id: 'a', type: 'nope.nope' }] };

    expect(validateLocal(graph, SPECS)).toEqual(['node a: unknown type nope.nope']);
  });

  it('catches an edge to or from a missing node', () => {
    const graph: Graph = {
      ...base,
      nodes: [{ id: 'a', type: 'senior.plan' }],
      edges: [
        { from: 'a', to: 'gone' },
        { from: 'gone', to: 'a' },
      ],
    };

    expect(validateLocal(graph, SPECS)).toEqual([
      'edge to unknown node gone',
      'edge from unknown node gone',
    ]);
  });

  it('catches a port the type does not have', () => {
    const graph: Graph = {
      ...base,
      nodes: [
        { id: 'a', type: 'senior.plan' },
        { id: 'b', type: 'human.approval' },
      ],
      edges: [{ from: 'a', port: 'approved', to: 'b' }],
    };

    expect(validateLocal(graph, SPECS)).toEqual([
      'edge a.approved: senior.plan has ports out',
    ]);
  });

  it('accepts a valid graph', () => {
    expect(validateLocal(sampleGraph(), SPECS)).toEqual([]);
  });
});
