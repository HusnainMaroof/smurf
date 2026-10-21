import React, { useState } from 'react';

import { SmurfMark } from './BrandLogo';
import { BTN_PRIMARY, BTN_SECONDARY } from './ui/buttonStyles';
import {
  DEFAULT_SERVER_URL,
  checkServerConnection,
  getServerToken,
  getServerUrl,
  saveServerConfig,
  type ServerConnectionCheck,
} from '../services/serverUrl';

export type ConnectReason = 'no-token' | 'unreachable' | 'unauthorized' | 'manual';

const REASON_TEXT: Record<ConnectReason, string> = {
  'no-token': 'Connect Smurf to your smurf-server to get started.',
  unreachable: 'smurf-server is not reachable. Check that it is running, or change the URL.',
  unauthorized: 'The server rejected the saved token. Enter the current token.',
  manual: 'Change the server this app talks to.',
};

const INPUT =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 focus:border-neutral-400';

function StatusRow({ label, state, detail }: { label: string; state: 'ok' | 'bad' | 'idle'; detail: string }) {
  const dot = state === 'ok' ? 'bg-emerald-500' : state === 'bad' ? 'bg-rose-500' : 'bg-neutral-300';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
      <span className="flex items-center gap-2 text-neutral-600">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="truncate text-neutral-900 font-medium" title={detail}>
        {detail}
      </span>
    </div>
  );
}

export function ConnectScreen({
  reason,
  onCancel,
}: {
  reason: ConnectReason;
  /** When set, a Cancel button returns to the running app. */
  onCancel?: () => void;
}) {
  const [url, setUrl] = useState(() => getServerUrl());
  const [token, setToken] = useState(() => getServerToken());
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ServerConnectionCheck | null>(null);
  const [tested, setTested] = useState<{ url: string; token: string } | null>(null);

  const runTest = async (): Promise<ServerConnectionCheck> => {
    setBusy(true);
    try {
      const check = await checkServerConnection(url, token);
      setResult(check);
      setTested({ url, token });
      return check;
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    saveServerConfig({ url, token });
    window.location.reload();
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const fresh = tested && tested.url === url && tested.token === token && result;
    const check = fresh ? result : await runTest();
    if (check?.authorized) save();
  };

  const runner = result?.health?.runner;
  const stale = !tested || tested.url !== url || tested.token !== token;

  return (
    <div
      data-testid="connect-screen"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-neutral-50 px-6 font-sans"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-[420px] rounded-2xl border border-neutral-200/80 bg-white p-7 shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
      >
        <div className="mb-6 flex items-center gap-3">
          <SmurfMark className="h-10 w-10" />
          <div>
            <h1 className="text-[17px] font-bold tracking-tight text-neutral-900">Connect to smurf-server</h1>
            <p className="text-[12px] text-neutral-500">{REASON_TEXT[reason]}</p>
          </div>
        </div>

        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-neutral-500" htmlFor="smurf-server-url">
          Server URL
        </label>
        <input
          id="smurf-server-url"
          data-testid="connect-url"
          className={`${INPUT} mb-4 font-mono`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={DEFAULT_SERVER_URL}
          spellCheck={false}
          autoComplete="off"
        />

        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-neutral-500" htmlFor="smurf-server-token">
          Token
        </label>
        <div className="relative mb-1">
          <input
            id="smurf-server-token"
            data-testid="connect-token"
            className={`${INPUT} pr-16 font-mono`}
            type={showToken ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="SMURF_TOKEN"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500 hover:text-neutral-900"
          >
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="mb-5 text-[11px] text-neutral-400">
          Print it with <code className="font-mono text-neutral-600">./smurf.sh token</code> in the Smurf repo.
        </p>

        {result && (
          <div data-testid="connect-result" className={`mb-5 rounded-xl border border-neutral-200/80 bg-neutral-50/60 px-3 py-1.5 ${stale ? 'opacity-50' : ''}`}>
            <StatusRow
              label="Server"
              state={result.reachable ? 'ok' : 'bad'}
              detail={result.reachable ? `online${result.health?.api_version ? ` · ${result.health.api_version}` : ''}` : 'unreachable'}
            />
            <StatusRow
              label="Token"
              state={result.authorized === true ? 'ok' : result.authorized === false ? 'bad' : 'idle'}
              detail={result.authorized === true ? 'accepted' : result.authorized === false ? 'rejected' : 'not checked'}
            />
            <StatusRow
              label="Runner"
              state={runner?.connected ? 'ok' : result.reachable ? 'bad' : 'idle'}
              detail={runner?.connected ? `connected${runner.host ? ` · ${runner.host}` : ''}` : result.reachable ? 'not connected' : '—'}
            />
            {result.error && (
              <p data-testid="connect-error" className="py-1.5 text-[12px] text-rose-600 break-words">
                {result.error}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {onCancel && (
            <button type="button" className={BTN_SECONDARY} onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button type="button" data-testid="connect-test" className={BTN_SECONDARY} onClick={() => void runTest()} disabled={busy}>
            {busy ? 'Testing…' : 'Test'}
          </button>
          {result && !stale && result.authorized !== true && (
            <button type="button" data-testid="connect-save-anyway" className={BTN_SECONDARY} onClick={save} disabled={busy}>
              Save anyway
            </button>
          )}
          <button type="submit" data-testid="connect-save" className={BTN_PRIMARY} disabled={busy || !token.trim()}>
            Save &amp; connect
          </button>
        </div>
      </form>
    </div>
  );
}
