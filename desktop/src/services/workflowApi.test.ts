import { describe, expect, it } from 'vitest';
import { graphToCompiler, type Graph } from './workflowApi';

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
