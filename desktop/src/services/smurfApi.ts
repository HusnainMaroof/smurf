import { serverJson } from './serverUrl';

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
