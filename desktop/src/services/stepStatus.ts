/** Per-node status for the Overview workflow step list (Smurf engine runs). */

export type StepStatus = 'completed' | 'running' | 'waiting' | 'pending';

export interface StepStatusState {
  visited_nodes?: string[];
  active_node_id?: string;
  status?: string;
}

export function stepStatus(stepId: string, s: StepStatusState): StepStatus {
  if (stepId === s.active_node_id) {
    if (s.status === 'awaiting_human') return 'waiting';
    if (s.status === 'running') return 'running';
    return 'completed';
  }
  if (s.visited_nodes?.includes(stepId)) return 'completed';
  return 'pending';
}
