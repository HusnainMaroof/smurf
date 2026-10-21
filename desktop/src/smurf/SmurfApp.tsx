import { useEffect, useState } from 'react';
import { Play, Settings, Workflow } from 'lucide-react';

import { RunsView } from './RunsView';
import { SettingsView } from './SettingsView';
import { WorkflowsView } from './WorkflowsView';
import { fetchServerHealth } from '../services/serverUrl';

const VIEW_STORAGE_KEY = 'smurf.view';

type View = 'workflows' | 'runs' | 'settings';

type HealthState = 'ok' | 'wait' | 'bad';

const HEALTH_TITLES: Record<HealthState, string> = {
  ok: 'Server and runner connected',
  wait: 'Runner not connected: run ./smurf.sh runner',
  bad: 'Server not reachable',
};

const HEALTH_COLORS: Record<HealthState, string> = {
  ok: 'var(--ok)',
  wait: 'var(--wait)',
  bad: 'var(--bad)',
};

const NAV_ITEMS: Array<{ id: View; label: string; Icon: typeof Workflow }> = [
  { id: 'workflows', label: 'Workflows', Icon: Workflow },
  { id: 'runs', label: 'Runs', Icon: Play },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

function readStoredView(): View {
  const stored = localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === 'runs' || stored === 'settings' ? stored : 'workflows';
}

export function SmurfApp() {
  const [view, setView] = useState<View>(readStoredView);
  const [health, setHealth] = useState<HealthState>('wait');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const result = await fetchServerHealth();
        if (cancelled) return;
        if (result.status !== 'ok') {
          setHealth('bad');
        } else {
          setHealth(result.runner?.connected ? 'ok' : 'wait');
        }
      } catch {
        if (!cancelled) setHealth('bad');
      }
    };
    void check();
    const timer = window.setInterval(() => {
      void check();
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const selectView = (next: View) => {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside
        className="flex h-full flex-col items-center"
        style={{
          width: 52,
          flex: '0 0 52px',
          background: 'var(--panel)',
          borderRight: '1px solid var(--line)',
        }}
      >
        <div className="flex items-center justify-center" style={{ height: 44, color: 'var(--text)' }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>S</span>
        </div>
        <nav className="flex flex-col items-center gap-1" aria-label="Main">
          {NAV_ITEMS.map(({ id, label, Icon }) => {
            const active = view === id;
            return (
              <button
                key={id}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={active}
                onClick={() => selectView(id)}
                className="flex items-center justify-center"
                style={{
                  width: 32,
                  height: 32,
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: active ? 'var(--raised)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--muted)',
                }}
              >
                <Icon size={16} strokeWidth={1.75} />
              </button>
            );
          })}
        </nav>
        <div className="mb-3 mt-auto flex items-center justify-center">
          <span
            role="status"
            title={HEALTH_TITLES[health]}
            aria-label={HEALTH_TITLES[health]}
            style={{
              display: 'block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: HEALTH_COLORS[health],
            }}
          />
        </div>
      </aside>
      <main className="h-full min-w-0 flex-1 overflow-hidden">
        {view === 'workflows' ? <WorkflowsView /> : view === 'runs' ? <RunsView /> : <SettingsView />}
      </main>
    </div>
  );
}
