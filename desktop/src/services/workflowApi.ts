/** Server workflow persistence API (M1-09). */

import type { CompilerEdge, CompilerNode, CompilerWorkflow } from './workflowFormat';

import { SERVER_BASE as BASE, serverFetch } from './serverUrl';

export type WorkflowListItem = {
  id: string;
  name: string;
  source: 'template' | 'user';
  readOnly: boolean;
  description?: string;
};

export type GraphNode = {
  id: string;
  type: string;
  name?: string;
  params?: Record<string, unknown>;
  position?: [number, number];
};

export type GraphEdge = { from: string; port?: string; to: string };

export type Graph = {
  id?: string;
  name: string;
  description?: string;
  start: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type ApiError = { detail?: { message?: string; errors?: string[] } };

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiError;
    const msg = body.detail?.message ?? 'Request failed';
    const errs = body.detail?.errors?.join(', ') ?? '';
    return errs ? `${msg}: ${errs}` : msg;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** Map a smurf-server workflow graph onto the canvas/compiler shape. */
export function graphToCompiler(id: string, g: Graph): CompilerWorkflow {
  const nodes: CompilerNode[] = [
    { id: 'start', type: 'start', data: {} },
    ...g.nodes.map((node): CompilerNode => {
      const type = node.type.startsWith('human.')
        ? 'human_gate'
        : node.type.startsWith('verify.')
          ? 'check'
          : 'agent_task';
      return {
        id: node.id,
        type,
        position: node.position ? { x: node.position[0], y: node.position[1] } : undefined,
        data: {
          agent: node.type,
          instruction: node.name ?? node.type,
          params: node.params ?? {},
        },
      };
    }),
  ];

  let edgeIdx = 1;
  const edges: CompilerEdge[] = [{ id: `e${edgeIdx++}`, source: 'start', target: g.start }];
  for (const edge of g.edges) {
    const compilerEdge: CompilerEdge = {
      id: `e${edgeIdx++}`,
      source: edge.from,
      target: edge.to,
    };
    const port = edge.port ?? 'out';
    if (port !== 'out') {
      compilerEdge.data = { when: port };
    }
    edges.push(compilerEdge);
  }

  return {
    id,
    name: g.name,
    version: 1,
    nodes,
    edges,
    description: g.description,
  };
}

export async function fetchTemplateIds(): Promise<string[]> {
  return [];
}

export async function fetchUserIds(): Promise<string[]> {
  const res = await serverFetch(`${BASE}/api/workflows/user`);
  if (!res.ok) throw new Error(await parseError(res));
  const body = (await res.json()) as { workflows: Graph[] };
  return body.workflows.map((wf) => wf.id ?? '');
}

export async function loadTemplateWorkflow(_id: string): Promise<CompilerWorkflow> {
  throw new Error('no templates');
}

export async function loadUserWorkflow(id: string): Promise<CompilerWorkflow> {
  const res = await serverFetch(`${BASE}/api/workflows/user/${id}`);
  if (!res.ok) throw new Error(await parseError(res));
  const body = (await res.json()) as { graph: Graph };
  return graphToCompiler(id, body.graph);
}

export async function loadWorkflowById(id: string): Promise<CompilerWorkflow> {
  return loadUserWorkflow(id);
}

export async function saveUserWorkflow(_workflow: CompilerWorkflow): Promise<void> {
  throw new Error('Editing workflows from the app is not available yet; edit workflows/*.json');
}

export async function validateWorkflow(_workflow: CompilerWorkflow): Promise<void> {
  // smurf-server validates on save; nothing to check from the app.
}

export async function deleteUserWorkflow(_id: string): Promise<void> {
  throw new Error('Editing workflows from the app is not available yet; edit workflows/*.json');
}

export async function listWorkflowItems(): Promise<WorkflowListItem[]> {
  const res = await serverFetch(`${BASE}/api/workflows/user`);
  if (!res.ok) throw new Error(await parseError(res));
  const body = (await res.json()) as { workflows: Graph[] };
  return body.workflows.map((graph) => ({
    id: graph.id ?? '',
    name: graph.name,
    source: 'user',
    readOnly: true,
    description: graph.description,
  }));
}
