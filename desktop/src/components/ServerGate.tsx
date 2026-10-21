import React, { useEffect, useState } from 'react';

import { ConnectScreen, type ConnectReason } from './ConnectScreen';
import { SmurfMark } from './BrandLogo';
import {
  OPEN_CONNECT_EVENT,
  SERVER_UNAUTHORIZED_EVENT,
  fetchServerHealth,
  hasServerToken,
} from '../services/serverUrl';

type GateState =
  | { phase: 'checking' }
  | { phase: 'ready' }
  | { phase: 'connect'; reason: ConnectReason };

/**
 * Renders the app only once a token is set and `/health` answers; otherwise (or after a
 * 401 / on demand from Settings) shows the Connect screen.
 */
export function ServerGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>(() =>
    hasServerToken() ? { phase: 'checking' } : { phase: 'connect', reason: 'no-token' },
  );
  const [appStarted, setAppStarted] = useState(false);

  useEffect(() => {
    if (state.phase !== 'checking') return;
    let cancelled = false;
    fetchServerHealth()
      .then(() => {
        if (!cancelled) setState({ phase: 'ready' });
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'connect', reason: 'unreachable' });
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase]);

  useEffect(() => {
    if (state.phase === 'ready') setAppStarted(true);
  }, [state.phase]);

  useEffect(() => {
    const onUnauthorized = () =>
      setState((prev) => (prev.phase === 'connect' ? prev : { phase: 'connect', reason: 'unauthorized' }));
    const onOpen = () => setState({ phase: 'connect', reason: 'manual' });
    window.addEventListener(SERVER_UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(OPEN_CONNECT_EVENT, onOpen);
    return () => {
      window.removeEventListener(SERVER_UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(OPEN_CONNECT_EVENT, onOpen);
    };
  }, []);

  if (state.phase === 'checking') {
    return (
      <div className="h-screen flex items-center justify-center bg-neutral-50" data-testid="server-gate-checking">
        <SmurfMark className="h-10 w-10 animate-pulse" />
      </div>
    );
  }

  return (
    <>
      {appStarted ? children : null}
      {state.phase === 'connect' && (
        <ConnectScreen
          reason={state.reason}
          onCancel={state.reason === 'manual' && appStarted ? () => setState({ phase: 'ready' }) : undefined}
        />
      )}
    </>
  );
}
