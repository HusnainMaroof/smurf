import { SERVER_BASE as BASE, serverFetch } from './serverUrl';

export interface AiToolStatus {
  id: string;
  name: string;
  description: string;
  icon: string;
  kind: 'cli' | 'client';
  path: string;
  installed: boolean;
  connected: boolean;
  registered: boolean;
  recommended?: boolean;
  agentType?: string | null;
}

export async function fetchToolsStatus(): Promise<AiToolStatus[]> {
  const response = await serverFetch(`${BASE}/api/tools/status`);
  if (!response.ok) throw new Error(`tools status failed (${response.status})`);
  const body = (await response.json()) as { tools: AiToolStatus[] };
  return body.tools;
}

export async function connectTool(toolId: string): Promise<void> {
  const response = await serverFetch(`${BASE}/api/tools/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool_id: toolId }),
  });
  if (!response.ok) throw new Error(`connect tool failed (${response.status})`);
}

export async function disconnectTool(toolId: string): Promise<void> {
  const response = await serverFetch(`${BASE}/api/tools/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool_id: toolId }),
  });
  if (!response.ok) throw new Error(`disconnect tool failed (${response.status})`);
}

export async function autoConfigureTool(toolId: string): Promise<any> {
  const response = await serverFetch(`${BASE}/api/tools/auto-configure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool_id: toolId }),
  });
  if (!response.ok) throw new Error(`auto configure tool failed (${response.status})`);
  return response.json();
}
