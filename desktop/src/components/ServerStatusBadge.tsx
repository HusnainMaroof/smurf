import { useEffect, useState } from 'react';

import { fetchServerHealth, openConnectScreen, SERVER_BASE, type ServerHealth } from '../services/serverUrl';

const POLL_MS = 15_000;

/** Small sidebar indicator: server + runner status; click to open the Connect screen. */
export function ServerStatusBadge() {
  const [health, setHealth] = useState<ServerHealth | null | 'offline'>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchServerHealth()
        .then((h) => !cancelled && setHealth(h))
        .catch(() => !cancelled && setHealth('offline'));
    };
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const offline = health === 'offline';
  const runnerUp = !offline && health?.runner?.connected === true;
  const dot = health === null ? 'bg-neutral-300' : offline ? 'bg-rose-500' : runnerUp ? 'bg-emerald-500' : 'bg-amber-500';
  const label = health === null ? 'Checking…' : offline ? 'Server offline' : runnerUp ? 'Runner online' : 'Runner offline';

  return (
    <button
      type="button"
      data-testid="server-status-badge"
      onClick={() => openConnectScreen()}
      title={`${SERVER_BASE} — ${label}. Click to change the server connection.`}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-semibold text-on-surface-variant hover:bg-surface-bright hover:text-on-surface"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}
