import { describe, expect, it } from 'vitest';
import { compilerToGraph, graphToCompiler, type Graph } from './workflowApi';

describe('graphToCompiler', () => {
  it('adds a start node with an edge to the graph start', () => {
    const graph: Graph = {
      name: 'Linear',
      start: 'a',
      nodes: [{ id: 'a', type: 'agent.run', name: 'Run agent' }],
      edges: [{ from: 'a', to: 'b' }],
    };

    const workflow = graphToCompiler('linear', graph);

    const start = workflow.nodes.find((n) => n.id === 'start');
    expect(start?.type).toBe('start');
    expect(workflow.edges[0]).toMatchObject({ source: 'start', target: 'a' });
  });

  it('maps human.* to human_gate and verify.* to check, other types to agent_task', () => {
    const graph: Graph = {
      name: 'Mixed',
      start: 'gate',
      nodes: [
        { id: 'gate', type: 'human.approval', name: 'Approve' },
        { id: 'verify', type: 'verify.evidence' },
        { id: 'work', type: 'agent.build' },
      ],
      edges: [],
    };

    const workflow = graphToCompiler('mixed', graph);

    expect(workflow.nodes.find((n) => n.id === 'gate')?.type).toBe('human_gate');
    expect(workflow.nodes.find((n) => n.id === 'verify')?.type).toBe('check');
    expect(workflow.nodes.find((n) => n.id === 'work')?.type).toBe('agent_task');
    expect(workflow.nodes.find((n) => n.id === 'gate')?.data).toMatchObject({
      agent: 'human.approval',
      instruction: 'Approve',
      params: {},
    });
  });

  it('keeps a non-out port as edge when data and drops the default out port', () => {
    const graph: Graph = {
      name: 'Branches',
      start: 'a',
      nodes: [{ id: 'a', type: 'agent.run' }],
      edges: [
        { from: 'a', port: 'retry', to: 'b' },
        { from: 'a', to: 'b' },
      ],
    };

    const workflow = graphToCompiler('branches', graph);

    expect(workflow.edges.find((e) => e.data?.when === 'retry')).toMatchObject({
      source: 'a',
      target: 'b',
      data: { when: 'retry' },
    });
    const plain = workflow.edges.find((e) => e.source === 'a' && !e.data);
    expect(plain).toBeDefined();
    expect(plain?.target).toBe('b');
  });
});

describe('compilerToGraph', () => {
  it('round-trips a graph with a loop, human gate, params and positions', () => {
    const graph: Graph = {
      name: 'Approval loop',
      description: 'Run, approve, retry',
      start: 'work',
      nodes: [
        {
          id: 'work',
          type: 'agent.run',
          name: 'Run agent',
          params: { model: 'fast' },
          position: [10, 20],
        },
        {
          id: 'gate',
          type: 'human.approval',
          name: 'Approve result',
          params: { timeoutMin: 5 },
          position: [30, 40],
        },
      ],
      edges: [
        { from: 'work', to: 'gate' },
        { from: 'gate', port: 'retry', to: 'work' },
        { from: 'gate', port: 'approve', to: 'work' },
      ],
    };

    expect(compilerToGraph(graphToCompiler('approval-loop', graph))).toEqual(graph);
  });

  it('detects start from the edge leaving the start node', () => {
    const graph: Graph = {
      name: 'Linear',
      start: 'b',
      nodes: [
        { id: 'a', type: 'agent.run' },
        { id: 'b', type: 'agent.run' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    };

    const converted = compilerToGraph(graphToCompiler('linear', graph));

    expect(converted.start).toBe('b');
    expect(converted.nodes.map((node) => node.id)).toEqual(['a', 'b']);
  });

  it('falls back to the base start and then the first node when there is no start edge', () => {
    const workflow = {
      id: 'manual',
      name: 'Manual',
      version: 1,
      nodes: [{ id: 'a', type: 'agent_task', data: { agent: 'agent.run' } }],
      edges: [],
    };
    const base: Graph = { name: 'Base', start: 'base', nodes: [], edges: [] };

    expect(compilerToGraph(workflow, base).start).toBe('base');
    expect(compilerToGraph(workflow).start).toBe('a');
  });
});
