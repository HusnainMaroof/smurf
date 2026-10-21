import { describe, expect, it } from 'vitest';
import { stepStatus } from './stepStatus';

describe('stepStatus', () => {
  it('waiting when the active node awaits a human', () => {
    expect(
      stepStatus('plan', {
        visited_nodes: ['plan'],
        active_node_id: 'plan',
        status: 'awaiting_human',
      }),
    ).toBe('waiting');
  });

  it('running when the active node is running', () => {
    expect(
      stepStatus('plan', {
        visited_nodes: ['understand'],
        active_node_id: 'plan',
        status: 'running',
      }),
    ).toBe('running');
  });

  it('completed when the active node is neither running nor awaiting a human', () => {
    expect(stepStatus('plan', { active_node_id: 'plan', status: 'passed' })).toBe('completed');
    expect(stepStatus('plan', { active_node_id: 'plan', status: 'idle' })).toBe('completed');
  });

  it('never returns failed for the active node of a failed run', () => {
    expect(stepStatus('plan', { active_node_id: 'plan', status: 'failed' })).toBe('completed');
  });

  it('completed when a visited node is not active', () => {
    expect(
      stepStatus('understand', {
        visited_nodes: ['understand', 'plan'],
        active_node_id: 'plan',
        status: 'running',
      }),
    ).toBe('completed');
  });

  it('pending when the node was never visited and is not active', () => {
    expect(
      stepStatus('verify', {
        visited_nodes: ['understand', 'plan'],
        active_node_id: 'plan',
        status: 'running',
      }),
    ).toBe('pending');
  });

  it('pending when visited_nodes is absent', () => {
    expect(stepStatus('plan', { active_node_id: 'understand', status: 'running' })).toBe('pending');
  });

  it('active node wins over visited_nodes', () => {
    expect(
      stepStatus('plan', {
        visited_nodes: ['plan'],
        active_node_id: 'plan',
        status: 'running',
      }),
    ).toBe('running');
  });
});
