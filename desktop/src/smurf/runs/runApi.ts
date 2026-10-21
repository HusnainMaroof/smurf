/** Typed wrappers for the smurf-server run APIs used by the Runs view. */

import { serverFetch, serverJson, serverWebSocketUrl } from '../../services/serverUrl';
import { stepStatus, type StepStatus } from '../../services/stepStatus';
import type { Graph, NodeSpec } from '../canvas/graph';

export interface Workspace {
  id: string;
  name?: string;
  workspace_path?: string;
}

export interface RunSession {
  run_id: string;
  title?: string;
  status?: string;
  workspace_id?: string;
  created_at?: string;
  updated_at?: string;
}

export type RunStatus = 'idle' | 'running' | 'awaiting_human' | 'passed' | 'failed';

export interface RunMessage {
  id: string;
  agent: string;
  time: string;
  text: string;
}

export interface RunSubtask {
  id: string;
  title: string;
  status: string;
  summary?: string;
}

export interface RunWaiting {
  kind: string;
  question: string;
  options: string[];
}

/** The part of the server's UiState the Runs view reads. */
export interface RunState {
  status: RunStatus;
  workflow_id: string;
  active_node_id: string;
  visited_nodes?: string[];
  messages: RunMessage[];
  terminal_logs: string[];
  pending_subtasks: RunSubtask[];
  waiting?: RunWaiting | null;
  session_cost_usd: number;
  error?: string;
}

export interface SeniorOption {
  key: string;
  tier?: string;
  billing?: string;
  cooling?: boolean;
}

export interface SeniorsResult {
  default: string[];
  options: SeniorOption[];
}

export type WorkflowItem = Graph & { id: string };

/** Payload the run WebSocket accepts. */
export type RunPayload =
  | { text: string; senior?: string; workflow_id?: string }
  | { action: 'human_decision'; decision: string }
  | { action: 'stop_run' };

export function emptyRunState(runId: string): RunState {
  return {
    status: 'idle',
    workflow_id: '',
    active_node_id: '',
    messages: [],
    terminal_logs: [],
    pending_subtasks: [],
    waiting: null,
    session_cost_usd: 0,
  };
}

export async function fetchWorkspaces(): Promise<{ workspaces: Workspace[]; active_id: string | null }> {
  const data = await serverJson<{ workspaces?: Workspace[]; active_id?: string | null }>(
    '/api/workspaces',
    {},
  );
  return {
    workspaces: Array.isArray(data.workspaces) ? data.workspaces : [],
    active_id: data.active_id ?? null,
  };
}

export async function fetchRunHistory(workspaceId: string): Promise<RunSession[]> {
  const query = encodeURIComponent(workspaceId);
  const data = await serverJson<{ sessions?: RunSession[] }>(
    `/api/runs/history?workspace_id=${query}`,
    {},
  );
  return Array.isArray(data.sessions) ? data.sessions : [];
}

/** Creates a session and returns its run id. */
export async function createSession(input: {
  workspace_id: string;
  title: string;
}): Promise<string> {
  const response = await serverFetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: input.workspace_id, title: input.title }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create session (${response.status})`);
  }
  const body = (await response.json()) as { run_id?: string };
  if (!body.run_id) {
    throw new Error('The server did not return a run id');
  }
  return body.run_id;
}

export async function fetchSeniors(): Promise<SeniorsResult> {
  const data = await serverJson<{ default?: string[]; options?: SeniorOption[] }>(
    '/api/seniors',
    {},
  );
  return {
    default: Array.isArray(data.default) ? data.default : [],
    options: Array.isArray(data.options) ? data.options : [],
  };
}

/** Picks the senior of a session. Only allowed before the first message. */
export async function setSessionSenior(runId: string, key: string): Promise<boolean> {
  const response = await serverFetch(`/api/sessions/${encodeURIComponent(runId)}/senior`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senior: key }),
  });
  return response.ok;
}

export async function fetchRunState(runId: string): Promise<RunState> {
  return serverJson<RunState>(
    `/api/runs/${encodeURIComponent(runId)}/state`,
    emptyRunState(runId),
  );
}

export async function fetchUserWorkflows(): Promise<WorkflowItem[]> {
  const data = await serverJson<{ workflows?: WorkflowItem[] }>('/api/workflows/user', {});
  return Array.isArray(data.workflows) ? data.workflows : [];
}

export async function fetchUserWorkflow(id: string): Promise<Graph | null> {
  const data = await serverJson<{ graph?: Graph }>(
    `/api/workflows/user/${encodeURIComponent(id)}`,
    {},
  );
  return data.graph ?? null;
}

export async function fetchNodeSpecs(): Promise<NodeSpec[]> {
  const specs = await serverJson<NodeSpec[]>('/api/nodes', []);
  return Array.isArray(specs) ? specs : [];
}

/**
 * Sends one JSON payload to a run and closes the socket.
 * Resolves once the payload is sent, rejects on socket error or a 5s timeout.
 */
export async function sendToRun(runId: string, payload: RunPayload): Promise<void> {
  const url = await serverWebSocketUrl(`/ws/runs/${encodeURIComponent(runId)}`);
  await new Promise<void>((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let sent = false;
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      reject(new Error(`Timed out sending to run ${runId}`));
    }, 5000);
    const settle = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    socket.onopen = () => {
      sent = true;
      try {
        socket.send(JSON.stringify(payload));
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          /* already closed */
        }
      }, 500);
      settle();
    };
    socket.onerror = () => {
      if (!sent) settle(new Error(`Could not reach run ${runId}`));
    };
    socket.onclose = () => {
      if (!sent) settle(new Error(`Connection to run ${runId} closed`));
    };
  });
}

/** Node status per workflow node: every visited node plus the active one. */
export function nodeStatuses(state: RunState): Record<string, StepStatus> {
  const statuses: Record<string, StepStatus> = {};
  for (const id of state.visited_nodes ?? []) {
    statuses[id] = stepStatus(id, state);
  }
  if (state.active_node_id) {
    statuses[state.active_node_id] = stepStatus(state.active_node_id, state);
  }
  return statuses;
}

/** True while the run is still working or waiting for a human. */
export function isLive(status: RunStatus | string | undefined): boolean {
  return status === 'running' || status === 'awaiting_human';
}
