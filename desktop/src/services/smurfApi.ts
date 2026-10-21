import { serverFetch, serverJson } from './serverUrl';

export type SmurfModel = {
  key: string;
  adapter: string;
  model: string;
  tier: 'light' | 'standard' | 'strong' | 'premium';
  free: boolean;
  billing?: string;
  contextLength?: number;
  modes: string[];
  cooling?: { reason: string; until: string };
};

export type BenchmarkRow = {
  task: string;
  category: string;
  model: string;
  pass: boolean;
  sec: number;
};

export type BenchmarkRun = {
  id: string;
  date: string;
  passed: number;
  total: number;
  rows: BenchmarkRow[];
};

export type RouteCandidate = {
  key: string;
  score: number;
  why: string;
  parts: Record<string, number>;
};

export type ModelsResult = {
  models: SmurfModel[];
  skipped: string[];
  refreshed?: string;
};

export type RouteResult = {
  candidates: RouteCandidate[];
  dropped: Record<string, number>;
};

export type SeniorOption = {
  key: string;
  tier: 'strong' | 'premium';
  billing: 'free' | 'subscription' | 'metered';
  cooling: boolean;
};

export type SeniorsResult = {
  default: string[];
  options: SeniorOption[];
};

export async function fetchSeniors(): Promise<SeniorsResult> {
  return serverJson<SeniorsResult>('/api/seniors', { default: [], options: [] });
}

export async function setSessionSenior(runId: string, key: string): Promise<boolean> {
  const response = await serverFetch(`/api/sessions/${encodeURIComponent(runId)}/senior`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senior: key }),
  });
  return response.ok;
}

const BILLING_RANK: Record<SeniorOption['billing'], number> = {
  free: 0,
  subscription: 1,
  metered: 2,
};

const TIER_RANK: Record<SeniorOption['tier'], number> = {
  premium: 0,
  strong: 1,
};

export function sortSeniors(options: SeniorOption[]): SeniorOption[] {
  return [...options].sort(
    (a, b) =>
      Number(a.cooling) - Number(b.cooling) ||
      BILLING_RANK[a.billing] - BILLING_RANK[b.billing] ||
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      a.key.localeCompare(b.key),
  );
}

export async function fetchModels(): Promise<ModelsResult> {
  return serverJson<ModelsResult>('/api/models', { models: [], skipped: [] });
}

export async function fetchRoute(category: string): Promise<RouteResult> {
  const q = encodeURIComponent(category);
  return serverJson<RouteResult>(`/api/route?category=${q}`, { candidates: [], dropped: {} });
}

export async function fetchBenchmarks(): Promise<BenchmarkRun[]> {
  return serverJson<BenchmarkRun[]>('/api/benchmarks', []);
}

export function groupByAdapter(models: SmurfModel[]): Record<string, SmurfModel[]> {
  const byAdapter: Record<string, SmurfModel[]> = {};
  for (const model of models) {
    const bucket = (byAdapter[model.adapter] ??= []);
    bucket.push(model);
  }
  for (const adapter of Object.keys(byAdapter)) {
    byAdapter[adapter].sort((a, b) => a.key.localeCompare(b.key));
  }
  return byAdapter;
}
