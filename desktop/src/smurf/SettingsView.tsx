import { useEffect, useState } from 'react';

import {
  checkServerConnection,
  fetchServerHealth,
  getServerToken,
  getServerUrl,
  saveServerConfig,
  serverJson,
  type ServerHealth,
} from '../services/serverUrl';
import { fetchModels, groupByAdapter, type ModelsResult, type SmurfModel } from '../services/smurfApi';

function tierLabel(tier: SmurfModel['tier']): string {
  return { light: 'Light', standard: 'Standard', strong: 'Strong', premium: 'Premium' }[tier];
}

export function SettingsView() {
  const [url, setUrl] = useState(getServerUrl);
  const [token, setToken] = useState(getServerToken);
  const [showToken, setShowToken] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [models, setModels] = useState<ModelsResult>({ models: [], skipped: [] });
  const [modelsLoading, setModelsLoading] = useState(false);

  const loadModels = async () => {
    setModels(await fetchModels());
  };

  useEffect(() => {
    void loadModels();
    void (async () => {
      try {
        setHealth(await fetchServerHealth());
      } catch {
        setHealth(null);
      }
    })();
  }, []);

  const grouped = groupByAdapter(models.models);
  const adapters = Object.keys(grouped).sort();

  const handleTest = async () => {
    const result = await checkServerConnection(url, token);
    if (result.error) {
      setTestResult(result.error);
      setTestOk(false);
    } else if (result.authorized === false) {
      setTestResult('Token rejected');
      setTestOk(false);
    } else {
      setTestResult(result.authorized ? 'Connected' : 'Reachable');
      setTestOk(true);
    }
  };

  const handleSave = () => {
    saveServerConfig({ url, token });
    window.location.reload();
  };

  const handleRefresh = async () => {
    setModelsLoading(true);
    await serverJson<ModelsResult>('/api/models?refresh=1', { models: [], skipped: [] });
    await loadModels();
    setModelsLoading(false);
  };

  const runnerStatus = health?.runner?.connected
    ? `Connected: ${health.runner.host ?? 'runner'}`
    : 'Runner not connected: run ./smurf.sh runner';

  return (
    <div
      className="sm-panel flex flex-col"
      style={{
        maxWidth: 760,
        padding: 24,
        margin: '0 auto',
        height: '100%',
        boxSizing: 'border-box',
        overflow: 'auto',
      }}
    >
      <section>
        <div className="sm-label" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          Connection
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="sm-label" style={{ display: 'block', marginBottom: 4 }}>
              Server URL
            </label>
            <input
              type="text"
              className="sm-input"
              style={{ width: '100%' }}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:47821"
            />
          </div>
          <div>
            <label className="sm-label" style={{ display: 'block', marginBottom: 4 }}>
              Token
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showToken ? 'text' : 'password'}
                className="sm-input"
                style={{ width: '100%' }}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Bearer token"
              />
              <button
                type="button"
                className="sm-btn"
                onClick={() => setShowToken((v) => !v)}
                style={{
                  position: 'absolute',
                  right: 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  padding: '2px 8px',
                  fontSize: 11,
                }}
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="sm-btn sm-btn-primary" onClick={() => void handleTest()}>
              Test
            </button>
            <button type="button" className="sm-btn" onClick={handleSave}>
              Save
            </button>
          </div>
          {testResult && (
            <div
              style={{
                fontSize: 12,
                color: testOk ? 'var(--ok)' : 'var(--bad)',
              }}
            >
              {testResult}
            </div>
          )}
          <div className="sm-label" style={{ fontSize: 12, color: 'var(--muted)' }}>
            {runnerStatus}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="sm-label" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          Models
        </div>
        <div style={{ marginBottom: 12 }}>
          <button
            type="button"
            className="sm-btn"
            onClick={() => void handleRefresh()}
            disabled={modelsLoading}
          >
            {modelsLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)' }}>Model</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)' }}>Adapter</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)' }}>Tier</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)' }}>Plan</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {adapters.map((adapter) => (
              <>
                <tr key={`group-${adapter}`}>
                  <td
                    colSpan={5}
                    className="sm-label"
                    style={{ padding: '4px 8px', color: 'var(--muted)' }}
                  >
                    {adapter}
                  </td>
                </tr>
                {grouped[adapter].map((model) => (
                  <tr key={model.key} style={{ height: 30, borderBottom: '1px solid var(--line)' }}>
                    <td className="mono" style={{ padding: '0 8px', verticalAlign: 'middle' }}>
                      {model.key}
                    </td>
                    <td style={{ padding: '0 8px', verticalAlign: 'middle' }}>{model.adapter}</td>
                    <td style={{ padding: '0 8px', verticalAlign: 'middle' }}>{tierLabel(model.tier)}</td>
                    <td style={{ padding: '0 8px', verticalAlign: 'middle' }}>
                      {model.free ? 'Free' : 'Paid'}
                    </td>
                    <td style={{ padding: '0 8px', verticalAlign: 'middle' }}>
                      {model.cooling ? (
                        <span style={{ color: 'var(--wait)' }}>cooling down</span>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
