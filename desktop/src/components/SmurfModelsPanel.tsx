import React, { useCallback, useEffect, useState } from 'react';
import { BTN_GHOST } from './ui/buttonStyles';
import { BADGE_NEUTRAL, BADGE_SUCCESS, EMPTY_STATE, SECTION_EYEBROW } from './ui/surfaceStyles';
import { LegacyIcon } from './ui/LegacyIcon';
import {
  fetchBenchmarks,
  fetchModels,
  fetchRoute,
  groupByAdapter,
  type BenchmarkRun,
  type RouteCandidate,
  type RouteResult,
  type SmurfModel,
} from '../services/smurfApi';
import { useLanguage } from './LanguageContext';

const ROUTE_CATEGORIES = ['coding', 'debugging', 'testing', 'research', 'review', 'architecture', 'docs'];

const TIER_LABEL: Record<SmurfModel['tier'], string> = {
  light: 'Light',
  standard: 'Standard',
  strong: 'Strong',
  premium: 'Premium',
};

function tierColor(tier: SmurfModel['tier']): string {
  switch (tier) {
    case 'light':
      return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'standard':
      return 'text-sky-700 bg-sky-50 border-sky-200';
    case 'strong':
      return 'text-indigo-700 bg-indigo-50 border-indigo-200';
    case 'premium':
      return 'text-amber-700 bg-amber-50 border-amber-200';
    default:
      return 'text-neutral-700 bg-neutral-100 border-neutral-200';
  }
}

function formatDate(date: string): string {
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
}

function isExpired(until: string): boolean {
  try {
    return Date.now() > Date.parse(until);
  } catch {
    return false;
  }
}

export const SmurfModelsPanel: React.FC = () => {
  const { t } = useLanguage();

  const [models, setModels] = useState<SmurfModel[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [refreshed, setRefreshed] = useState<string | undefined>(undefined);
  const [loadingModels, setLoadingModels] = useState(false);

  const [routeCategory, setRouteCategory] = useState('coding');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const [benchmarks, setBenchmarks] = useState<BenchmarkRun[] | null>(null);
  const [loadingBenchmarks, setLoadingBenchmarks] = useState(false);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const result = await fetchModels();
      setModels(result.models);
      setSkipped(result.skipped);
      setRefreshed(result.refreshed);
    } catch {
      setModels([]);
      setSkipped([]);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const loadRoute = useCallback(async (category: string) => {
    setLoadingRoute(true);
    try {
      setRoute(await fetchRoute(category));
    } catch {
      setRoute(null);
    } finally {
      setLoadingRoute(false);
    }
  }, []);

  const loadBenchmarks = useCallback(async () => {
    setLoadingBenchmarks(true);
    try {
      setBenchmarks(await fetchBenchmarks());
    } catch {
      setBenchmarks([]);
    } finally {
      setLoadingBenchmarks(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
    loadRoute(routeCategory);
    loadBenchmarks();
  }, []);

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setRouteCategory(next);
    loadRoute(next);
  };

  const handleRefreshRoute = () => loadRoute(routeCategory);

  const grouped = models ? groupByAdapter(models) : null;

  return (
    <div className="space-y-6 text-on-surface">
      {/* Section a: Models */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className={SECTION_EYEBROW}>{t('Models')}</h3>
          <button type="button" onClick={loadModels} disabled={loadingModels} className={BTN_GHOST}>
            <LegacyIcon name="sync" className={`text-[13px] ${loadingModels ? 'animate-spin' : ''}`} />
            <span className="ml-1">{t('Refresh')}</span>
          </button>
        </div>
        {refreshed && (
          <p className="text-[10px] text-on-surface-variant">{t('Refreshed')}: {formatDate(refreshed)}</p>
        )}
        {loadingModels ? (
          <p className="text-xs text-on-surface-variant">{t('Loading…')}</p>
        ) : grouped ? (
          Object.keys(grouped).length === 0 ? (
            <p className={EMPTY_STATE}>{t('No models available')}</p>
          ) : (
            Object.keys(grouped).map((adapter) => (
              <div key={adapter} className="bg-surface-container/30 rounded-xl border border-outline/30 overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                  {adapter} · {grouped[adapter].length}
                </div>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-on-surface-variant">
                      <th className="px-3 py-1.5 font-medium">{t('Model')}</th>
                      <th className="px-3 py-1.5 font-medium">{t('Tier')}</th>
                      <th className="px-3 py-1.5 font-medium">{t('Access')}</th>
                      <th className="px-3 py-1.5 font-medium">{t('Modes')}</th>
                      <th className="px-3 py-1.5 font-medium">{t('Cooling')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[adapter].map((m) => (
                      <tr key={m.key} className="border-t border-outline/20">
                        <td className="px-3 py-1.5 font-mono">{m.model}</td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-flex text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${tierColor(m.tier)}`}>
                            {TIER_LABEL[m.tier]}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          {m.free ? (
                            <span className={BADGE_SUCCESS}>{t('Free')}</span>
                          ) : (
                            <span className={BADGE_NEUTRAL}>{m.billing ?? t('Paid')}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-on-surface-variant">{m.modes.join(', ') || '—'}</td>
                        <td className="px-3 py-1.5">
                          {m.cooling && !isExpired(m.cooling.until) && (
                            <span className="inline-flex text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border text-amber-700 bg-amber-50 border-amber-200">
                              {t('Cooling')}: {m.cooling.reason}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )
        ) : (
          <p className={EMPTY_STATE}>{t('No models available')}</p>
        )}
        {skipped.length > 0 && (
          <p className="text-[10px] text-on-surface-variant">{t('Skipped')}: {skipped.join(', ')}</p>
        )}
      </section>

      {/* Section b: Router ranking */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className={SECTION_EYEBROW}>{t('Router ranking')}</h3>
          <div className="flex items-center gap-2">
            <select value={routeCategory} onChange={handleCategoryChange} className="text-[11px] border border-outline bg-surface rounded-md px-2 py-1 text-on-surface">
              {ROUTE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button type="button" onClick={handleRefreshRoute} disabled={loadingRoute} className={BTN_GHOST}>
              <LegacyIcon name="sync" className={`text-[13px] ${loadingRoute ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {loadingRoute ? (
          <p className="text-xs text-on-surface-variant">{t('Loading…')}</p>
        ) : route && route.candidates.length > 0 ? (
          <div className="bg-surface-container/30 rounded-xl border border-outline/30 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-on-surface-variant">
                  <th className="px-3 py-1.5 font-medium">{t('Rank')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('Model')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('Score')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('Why')}</th>
                  <th className="px-3 py-1.5 font-medium">{t('Parts')}</th>
                </tr>
              </thead>
              <tbody>
                {route.candidates.slice(0, 10).map((c: RouteCandidate, i: number) => (
                  <tr key={c.key} className="border-t border-outline/20">
                    <td className="px-3 py-1.5 text-on-surface-variant">{i + 1}</td>
                    <td className="px-3 py-1.5 font-mono">{c.key}</td>
                    <td className="px-3 py-1.5 font-mono">{c.score.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-on-surface-variant">{c.why}</td>
                    <td className="px-3 py-1.5">
                      <PartBars parts={c.parts} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={EMPTY_STATE}>{t('No routing candidates available')}</p>
        )}
        {route && Object.keys(route.dropped).length > 0 && (
          <details className="text-[10px] text-on-surface-variant">
            <summary className="cursor-pointer">{t('Dropped')} ({Object.keys(route.dropped).length})</summary>
            <div className="mt-1 space-y-0.5">
              {Object.entries(route.dropped).map(([k, v]) => (
                <div key={k}>{k}: {v.toFixed(2)}</div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* Section c: Benchmarks */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className={SECTION_EYEBROW}>{t('Benchmarks')}</h3>
          <button type="button" onClick={loadBenchmarks} disabled={loadingBenchmarks} className={BTN_GHOST}>
            <LegacyIcon name="sync" className={`text-[13px] ${loadingBenchmarks ? 'animate-spin' : ''}`} />
            <span className="ml-1">{t('Refresh')}</span>
          </button>
        </div>
        {loadingBenchmarks ? (
          <p className="text-xs text-on-surface-variant">{t('Loading…')}</p>
        ) : benchmarks && benchmarks.length > 0 ? (
          <div className="space-y-2">
            {benchmarks.map((run) => (
              <div key={run.id} className="bg-surface-container/30 rounded-xl border border-outline/30 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left"
                >
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="font-mono text-on-surface-variant">{run.id.slice(0, 8)}</span>
                    <span className="text-on-surface-variant">
                      {formatDate(run.date)}
                    </span>
                    <span className={run.passed === run.total ? BADGE_SUCCESS : BADGE_NEUTRAL}>
                      {run.passed}/{run.total} {t('passed')}
                    </span>
                  </div>
                  <LegacyIcon name={expandedRun === run.id ? 'expand_less' : 'expand_more'} className="text-[15px] text-on-surface-variant" />
                </button>
                {expandedRun === run.id && run.rows.length > 0 && (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-on-surface-variant">
                        <th className="px-3 py-1 font-medium">{t('Task')}</th>
                        <th className="px-3 py-1 font-medium">{t('Category')}</th>
                        <th className="px-3 py-1 font-medium">{t('Model')}</th>
                        <th className="px-3 py-1 font-medium">{t('Result')}</th>
                        <th className="px-3 py-1 font-medium">{t('Seconds')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.rows.map((row, i) => (
                        <tr key={`${run.id}-${i}`} className="border-t border-outline/20">
                          <td className="px-3 py-1">{row.task}</td>
                          <td className="px-3 py-1 text-on-surface-variant">{row.category}</td>
                          <td className="px-3 py-1 font-mono">{row.model}</td>
                          <td className="px-3 py-1">
                            <span className={row.pass ? BADGE_SUCCESS : 'inline-flex text-[9px] font-bold uppercase text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded'}>
                              {row.pass ? 'PASS' : 'FAIL'}
                            </span>
                          </td>
                          <td className="px-3 py-1 text-on-surface-variant">{row.sec.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className={EMPTY_STATE}>{t('No benchmark runs available')}</p>
        )}
      </section>
    </div>
  );
};

function PartBars({ parts }: { parts: Record<string, number> }): React.ReactElement {
  const entries = Object.entries(parts);
  const max = entries.reduce((acc, [, v]) => (v > acc ? v : acc), 0) || 1;
  return (
    <div className="flex flex-col gap-0.5 text-[10px]">
      {entries.map(([name, value]) => (
        <div key={name} className="flex items-center gap-1.5">
          <span className="w-16 text-on-surface-variant">{name}</span>
          <div className="flex-1 h-2 bg-outline/20 rounded overflow-hidden">
            <div
              className="h-full bg-neutral-400/60 rounded"
              style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
            />
          </div>
          <span className="w-8 text-right text-on-surface-variant">{value.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}


