import { describe, expect, it } from 'vitest';

import { isLive, nodeStatuses, type RunState } from './runApi';

function state(overrides: Partial<RunState> = {}): RunState {
  return {
    status: 'running',
    workflow_id: 'default',
    active_node_id: 'plan',
    messages: [],
    terminal_logs: [],
    pending_subtasks: [],
    session_cost_usd: 0,
    ...overrides,
  };
}

describe('nodeStatuses', () => {
  it('marks visited nodes completed and the active node running', () => {
    const statuses = nodeStatuses(
      state({ visited_nodes: ['understand', 'plan'], active_node_id: 'build' }),
    );

    expect(statuses).toEqual({ understand: 'completed', plan: 'completed', build: 'running' });
  });

  it('marks the active node waiting while the run awaits a human', () => {
    const statuses = nodeStatuses(
      state({
        status: 'awaiting_human',
        visited_nodes: ['understand'],
        active_node_id: 'approve',
      }),
    );

    expect(statuses.approve).toBe('waiting');
    expect(statuses.understand).toBe('completed');
  });

  it('omits nodes the run never visited', () => {
    const statuses = nodeStatuses(state({ visited_nodes: ['understand'], active_node_id: 'plan' }));

    expect(Object.keys(statuses).sort()).toEqual(['plan', 'understand']);
    expect(statuses.verify).toBeUndefined();
  });

  it('works without visited nodes and without an active node', () => {
    expect(nodeStatuses(state({ visited_nodes: undefined, active_node_id: '' }))).toEqual({});
  });
});

describe('isLive', () => {
  it('is true while running or awaiting a human', () => {
    expect(isLive('running')).toBe(true);
    expect(isLive('awaiting_human')).toBe(true);
  });

  it('is false for every other status', () => {
    expect(isLive('idle')).toBe(false);
    expect(isLive('passed')).toBe(false);
    expect(isLive('failed')).toBe(false);
    expect(isLive(undefined)).toBe(false);
  });
});
