import { describe, expect, it } from 'vitest';
import { layoutOrder } from './SmurfGraphView';
import type { CompilerWorkflow } from '../services/workflowFormat';

function workflow(nodeIds: string[], edges: Array<[string, string]>): CompilerWorkflow {
  return {
    id: 'test-workflow',
    name: 'Test workflow',
    version: 1,
    nodes: nodeIds.map((id) => ({ id, type: 'agent_task', data: {} })),
    edges: edges.map(([source, target], index) => ({
      id: `e${index + 1}`,
      source,
      target,
    })),
  };
}

describe('layoutOrder', () => {
  it('starts at start and follows breadth-first order', () => {
    const result = layoutOrder(
      workflow(
        ['start', 'a', 'b', 'c', 'd'],
        [
          ['start', 'a'],
          ['start', 'b'],
          ['a', 'c'],
          ['c', 'd'],
        ],
      ),
    );

    expect(result).toEqual(['start', 'a', 'b', 'c', 'd']);
  });

  it('appends unreachable nodes at the end in declaration order', () => {
    const result = layoutOrder(
      workflow(
        ['start', 'a', 'orphan', 'island'],
        [['start', 'a']],
      ),
    );

    expect(result).toEqual(['start', 'a', 'orphan', 'island']);
  });

  it('visits each node once even when loops exist', () => {
    const result = layoutOrder(
      workflow(
        ['start', 'a', 'b'],
        [
          ['start', 'a'],
          ['a', 'b'],
          ['b', 'a'],
        ],
      ),
    );

    expect(result).toEqual(['start', 'a', 'b']);
  });
});
