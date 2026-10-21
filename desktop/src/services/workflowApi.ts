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

async function parseError(response: Response, body?: ApiError): Promise<string> {
  try {
    const parsed = body ?? ((await response.json()) as ApiError);
    const msg = parsed.detail?.message ?? 'Request failed';
    const errs = parsed.detail?.errors?.join(', ') ?? '';
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

/** Map a canvas/compiler workflow back onto the smurf-server graph shape. */
export function compilerToGraph(w: CompilerWorkflow, base?: Graph): Graph {
  const endNodeIds = new Set(w.nodes.filter((node) => node.type === 'end').map((node) => node.id));

  const nodes: GraphNode[] = w.nodes
    .filter((node) => node.id !== 'start' && node.type !== 'end')
    .map((node) => {
      const b = base?.nodes.find((n) => n.id === node.id);
      const agent = String(node.data.agent);
      const dataAgent = node.data.agent;
      const type =
        typeof dataAgent === 'string' && dataAgent.length > 0 ? dataAgent : b?.type;
      if (type === undefined) {
        throw new Error(`Node ${node.id} has no Smurf node type`);
      }
      const graphNode: GraphNode = { id: node.id, type };
      const instruction = node.data.instruction;
      if (instruction !== undefined && instruction !== agent) {
        graphNode.name = String(instruction);
      }
      const params = node.data.params as Record<string, unknown> | undefined;
      if (params && typeof params === 'object' && Object.keys(params).length > 0) {
        graphNode.params = params;
      } else if (b?.params) {
        graphNode.params = b.params;
      }
      if (node.position) {
        graphNode.position = [Math.round(node.position.x), Math.round(node.position.y)];
      } else if (b?.position) {
        graphNode.position = b.position;
      }
      return graphNode;
    });

  const edges: GraphEdge[] = w.edges
    .filter(
      (edge) =>
        edge.source !== 'start' &&
        edge.target !== 'start' &&
        !endNodeIds.has(edge.source) &&
        !endNodeIds.has(edge.target),
    )
    .map((edge) => {
      const graphEdge: GraphEdge = { from: edge.source, to: edge.target };
      if (edge.data?.when !== undefined) {
        graphEdge.port = edge.data.when;
      }
      return graphEdge;
    });

  const startEdgeTarget = w.edges.find((edge) => edge.source === 'start')?.target;
  const start =
    startEdgeTarget && startEdgeTarget !== 'start' && !endNodeIds.has(startEdgeTarget)
      ? startEdgeTarget
      : base?.start ?? nodes[0]?.id ?? '';

  return {
    name: w.name,
    description: w.description ?? base?.description,
    start,
    nodes,
    edges,
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
  const res = await serverFetch(`${BASE}/api/workflows/user/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(await parseError(res));
  const body = (await res.json()) as { graph: Graph };
  return graphToCompiler(id, body.graph);
}

export async function loadWorkflowById(id: string): Promise<CompilerWorkflow> {
  return loadUserWorkflow(id);
}

export async function saveUserWorkflow(workflow: CompilerWorkflow): Promise<void> {
  let base: Graph | undefined;
  try {
    const current = await serverFetch(`${BASE}/api/workflows/user/${encodeURIComponent(workflow.id)}`);
    if (current.ok) {
      base = ((await current.json()) as { graph?: Graph }).graph;
    }
  } catch {
    // Unreachable server or unreadable body: save without a base graph.
    base = undefined;
  }

  const res = await serverFetch(`${BASE}/api/workflows/user/${encodeURIComponent(workflow.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph: compilerToGraph(workflow, base) }),
  });
  const body = (await res.json().catch(() => null)) as (ApiError & {
    status?: 'saved' | 'invalid';
    problems?: string[];
  }) | null;
  if (body?.status === 'invalid') {
    throw new Error('Workflow is invalid: ' + (body.problems ?? []).join('; '));
  }
  if (!res.ok) throw new Error(await parseError(res, body ?? undefined));
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
    readOnly: false,
    description: graph.description,
  }));
}
