import type { Agent } from '../types';
import { mergeAgentsWithBuiltin } from './builtinAgent';

import { SERVER_BASE as BASE, isUnsupported, serverFetch } from './serverUrl';

export async function fetchAgents(): Promise<Agent[]> {
  const response = await serverFetch(`${BASE}/api/agents`);
  if (isUnsupported(response)) return mergeAgentsWithBuiltin([]);
  if (!response.ok) throw new Error(`agents fetch failed (${response.status})`);
  // Clutch shape is `{agents: Agent[]}`. smurf-server returns a bare array of vault agent
  // profiles (different shape) — not mapped yet, so only the built-in agent is shown.
  const body = (await response.json()) as { agents?: Agent[] } | unknown[];
  const agents = !Array.isArray(body) && Array.isArray(body?.agents) ? body.agents : [];
  return mergeAgentsWithBuiltin(agents);
}

export async function saveAgents(agents: Agent[]): Promise<void> {
  const response = await serverFetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agents }),
  });
  if (!response.ok) throw new Error(`agents save failed (${response.status})`);
}

export interface GenerateAgentPromptResult {
  prompt: string;
  source: 'llm' | 'template';
}

export async function generateAgentPrompt(payload: {
  name: string;
  description?: string;
}): Promise<GenerateAgentPromptResult> {
  const response = await serverFetch(`${BASE}/api/agents/generate-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: { message?: string } };
    throw new Error(body.detail?.message ?? `prompt generation failed (${response.status})`);
  }
  return response.json() as Promise<GenerateAgentPromptResult>;
}

export type PromptAssemblyLayerSummary = {
  name: string;
  chars: number;
  injected: boolean;
};

export type PromptAssemblySummary = {
  agent_id: string;
  permission_mode: string;
  layer_count: number;
  total_chars: number;
  layers: PromptAssemblyLayerSummary[];
};

/** D53: runtime prompt layers (names + char counts, no full dump). */
export async function fetchPromptAssembly(agentId: string): Promise<PromptAssemblySummary> {
  const id = encodeURIComponent(agentId.trim() || 'clutch-agent');
  const response = await serverFetch(`${BASE}/api/agents/${id}/prompt-assembly`);
  if (!response.ok) {
    throw new Error(`prompt assembly fetch failed (${response.status})`);
  }
  return response.json() as Promise<PromptAssemblySummary>;
}
