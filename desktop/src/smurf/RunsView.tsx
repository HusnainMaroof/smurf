import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FlowCanvas } from './canvas/FlowCanvas';
import type { Graph, NodeSpec } from './canvas/graph';
import {
  createSession,
  emptyRunState,
  fetchNodeSpecs,
  fetchRunHistory,
  fetchRunState,
  fetchSeniors,
  fetchUserWorkflow,
  fetchUserWorkflows,
  fetchWorkspaces,
  isLive,
  nodeStatuses,
  sendToRun,
  setSessionSenior,
  type RunSession,
  type RunState,
  type SeniorsResult,
  type WorkflowItem,
  type Workspace,
} from './runs/runApi';

const POLL_MS = 2000;

/** run/wait/ok/bad colors for a run status. */
function statusColor(status?: string): string {
  switch (status) {
    case 'running':
      return 'var(--run)';
    case 'awaiting_human':
      return 'var(--wait)';
    case 'passed':
      return 'var(--ok)';
    case 'failed':
      return 'var(--bad)';
    default:
      return 'var(--muted)';
  }
}

/** "5m", "3h", "2d" for a timestamp; empty when there is none. */
function relativeTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function RunsView() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [sessions, setSessions] = useState<RunSession[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [newRunOpen, setNewRunOpen] = useState(false);

  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [seniors, setSeniors] = useState<SeniorsResult>({ default: [], options: [] });
  const [seniorKey, setSeniorKey] = useState('');
  const [request, setRequest] = useState('');

  const [specs, setSpecs] = useState<NodeSpec[]>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [runState, setRunState] = useState<RunState | null>(null);
  const [tab, setTab] = useState<'messages' | 'log'>('messages');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchWorkspaces()
      .then((data) => {
        if (cancelled) return;
        setWorkspaces(data.workspaces);
        setWorkspaceId((current) => {
          if (current && data.workspaces.some((item) => item.id === current)) return current;
          return data.active_id ?? data.workspaces[0]?.id ?? '';
        });
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchUserWorkflows()
      .then((list) => {
        if (cancelled) return;
        setWorkflows(list);
        setWorkflowId((current) => {
          if (current && list.some((item) => item.id === current)) return current;
          if (list.some((item) => item.id === 'default')) return 'default';
          return list[0]?.id ?? '';
        });
      })
      .catch(() => {
        if (!cancelled) setWorkflows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSeniors()
      .then((data) => {
        if (cancelled) return;
        setSeniors(data);
        setSeniorKey((current) => {
          if (current && data.options.some((option) => option.key === current)) return current;
          const preferred = data.default[0] ?? data.options[0]?.key ?? '';
          return data.options.some((option) => option.key === preferred) ? preferred : '';
        });
      })
      .catch(() => {
        if (!cancelled) setSeniors({ default: [], options: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchNodeSpecs()
      .then((list) => {
        if (!cancelled) setSpecs(list);
      })
      .catch(() => {
        if (!cancelled) setSpecs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!workspaceId) {
      setSessions([]);
      return;
    }
    const list = await fetchRunHistory(workspaceId);
    setSessions(list);
  }, [workspaceId]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // Poll the run state while it is live; one last fetch when it stops.
  useEffect(() => {
    if (!selectedRunId) {
      setRunState(null);
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    let finalFetched = false;
    let failures = 0;
    setRunState(null);

    const tick = async () => {
      try {
        const next = await fetchRunState(selectedRunId);
        if (cancelled) return;
        failures = 0;
        setRunState(next);
        if (isLive(next.status)) {
          finalFetched = false;
          timer = window.setTimeout(() => void tick(), POLL_MS);
        } else if (!finalFetched) {
          finalFetched = true;
          timer = window.setTimeout(() => void tick(), 300);
        } else {
          // The run is over: the list needs its final status.
          void refreshHistory();
        }
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures < 5) timer = window.setTimeout(() => void tick(), POLL_MS);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [selectedRunId, refreshHistory]);

  const graphId = runState?.workflow_id || workflowId;
  useEffect(() => {
    if (!graphId) {
      setGraph(null);
      return;
    }
    let cancelled = false;
    void fetchUserWorkflow(graphId)
      .then((next) => {
        if (!cancelled) setGraph(next);
      })
      .catch(() => {
        if (!cancelled) setGraph(null);
      });
    return () => {
      cancelled = true;
    };
  }, [graphId]);

  const messages = runState?.messages ?? [];
  useEffect(() => {
    const element = bottomRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [runState?.messages, tab]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.run_id === selectedRunId) ?? null,
    [sessions, selectedRunId],
  );
  const status = runState?.status ?? selectedSession?.status ?? 'idle';
  const live = isLive(status);
  const waiting = runState?.waiting ?? null;
  // Memoized: a fresh object here would rebuild the canvas nodes on every render.
  const statuses = useMemo(
    () => nodeStatuses(runState ?? emptyRunState(selectedRunId ?? '')),
    [runState, selectedRunId],
  );

  const startRun = async () => {
    const text = request.trim();
    if (!text || !workspaceId) return;
    setStarting(true);
    setError(null);
    try {
      const runId = await createSession({ workspace_id: workspaceId, title: text.slice(0, 60) });
      if (seniorKey) await setSessionSenior(runId, seniorKey);
      await sendToRun(runId, {
        text,
        senior: seniorKey || undefined,
        workflow_id: workflowId || undefined,
      });
      setRequest('');
      setNewRunOpen(false);
      setSelectedRunId(runId);
      void refreshHistory();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setStarting(false);
    }
  };

  const stopRun = async () => {
    if (!selectedRunId) return;
    try {
      await sendToRun(selectedRunId, { action: 'stop_run' });
    } catch (err) {
      setError(errorText(err));
    }
  };

  const decide = async (decision: string) => {
    if (!selectedRunId) return;
    try {
      await sendToRun(selectedRunId, { action: 'human_decision', decision });
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="flex h-full min-h-0" style={{ background: 'var(--bg)' }}>
      <aside
        className="flex h-full flex-col overflow-hidden"
        style={{
          width: 260,
          flex: '0 0 260px',
          background: 'var(--panel)',
          borderRight: '1px solid var(--line)',
        }}
      >
        <div
          className="flex flex-col"
          style={{ padding: 10, gap: 8, borderBottom: '1px solid var(--line)' }}
        >
          <select
            className="sm-input"
            style={{ width: '100%' }}
            value={workspaceId}
            aria-label="Project"
            onChange={(event) => {
              setWorkspaceId(event.target.value);
              setSelectedRunId(null);
            }}
          >
            {workspaces.length === 0 && <option value="">No project</option>}
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name || workspace.workspace_path || workspace.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="sm-btn"
            onClick={() => {
              setNewRunOpen(true);
              setError(null);
            }}
          >
            New run
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {sessions.length === 0 && (
            <div className="sm-label" style={{ padding: 10 }}>
              No runs yet.
            </div>
          )}
          {sessions.map((session) => (
            <button
              key={session.run_id}
              type="button"
              className="w-full text-left hover:bg-[var(--raised)]"
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 10px',
                border: 'none',
                background: session.run_id === selectedRunId ? 'var(--raised)' : 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
              onClick={() => {
                setNewRunOpen(false);
                setError(null);
                setSelectedRunId(session.run_id);
              }}
            >
              <div className="flex items-center" style={{ gap: 6 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    flex: '0 0 6px',
                    borderRadius: '50%',
                    background: statusColor(
                      session.run_id === selectedRunId
                        ? runState?.status ?? session.status
                        : session.status,
                    ),
                  }}
                />
                <span
                  style={{
                    fontSize: 12,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {session.title || 'Untitled run'}
                </span>
              </div>
              <div className="sm-label" style={{ fontSize: 10, marginTop: 1 }}>
                {relativeTime(session.updated_at || session.created_at)}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {newRunOpen ? (
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 24 }}>
            <div className="flex flex-col" style={{ maxWidth: 560, gap: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>New run</div>

              <label className="sm-label" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                Workflow
                <select
                  className="sm-input"
                  style={{ width: '100%' }}
                  value={workflowId}
                  onChange={(event) => setWorkflowId(event.target.value)}
                >
                  {workflows.length === 0 && <option value="">default</option>}
                  {workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name || workflow.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="sm-label" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                Senior
                <select
                  className="sm-input"
                  style={{ width: '100%' }}
                  value={seniorKey}
                  onChange={(event) => setSeniorKey(event.target.value)}
                >
                  {seniors.options.length === 0 && <option value="">No senior available</option>}
                  {seniors.options.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.key}
                    </option>
                  ))}
                </select>
              </label>

              <label className="sm-label" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                Request
                <textarea
                  className="sm-input"
                  style={{ width: '100%' }}
                  rows={6}
                  value={request}
                  placeholder="What should the team do?"
                  onChange={(event) => setRequest(event.target.value)}
                />
              </label>

              {error && (
                <div style={{ color: 'var(--bad)', fontSize: 11, lineHeight: 1.5 }}>{error}</div>
              )}

              <div>
                <button
                  type="button"
                  className="sm-btn sm-btn-primary"
                  disabled={starting || !request.trim() || !workspaceId}
                  onClick={() => void startRun()}
                >
                  {starting ? 'Starting…' : 'Start run'}
                </button>
              </div>
            </div>
          </div>
        ) : selectedRunId ? (
          <>
            <div
              className="flex items-center"
              style={{
                height: 44,
                flex: '0 0 44px',
                gap: 10,
                padding: '0 12px',
                borderBottom: '1px solid var(--line)',
                background: 'var(--panel)',
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  minWidth: 0,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {selectedSession?.title || selectedRunId}
              </span>
              <span className="sm-label" style={{ color: statusColor(status) }}>
                {status}
              </span>
              <span className="sm-label mono">
                ${(runState?.session_cost_usd ?? 0).toFixed(4)}
              </span>
              <div style={{ flex: 1 }} />
              {live && (
                <button type="button" className="sm-btn" onClick={() => void stopRun()}>
                  Stop
                </button>
              )}
            </div>

            {error && (
              <div
                style={{
                  padding: '6px 12px',
                  borderBottom: '1px solid var(--line)',
                  background: 'var(--panel)',
                  color: 'var(--bad)',
                  fontSize: 11,
                }}
              >
                {error}
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col">
              <div style={{ flex: '0 0 55%', minHeight: 0, position: 'relative' }}>
                {graph ? (
                  <FlowCanvas
                    graph={graph}
                    specs={specs}
                    readOnly
                    status={statuses}
                  />
                ) : (
                  <div
                    className="flex h-full items-center justify-center"
                    style={{ color: 'var(--muted)' }}
                  >
                    No workflow graph.
                  </div>
                )}
              </div>

              <div
                className="flex min-h-0 flex-1 flex-col"
                style={{ borderTop: '1px solid var(--line)' }}
              >
                {waiting && (
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 12, lineHeight: 1.5 }}>{waiting.question}</div>
                    <div className="flex" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {waiting.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className="sm-btn"
                          onClick={() => void decide(option)}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex" style={{ gap: 6, padding: '6px 8px' }}>
                  <button
                    type="button"
                    className="sm-btn"
                    style={{
                      height: 24,
                      padding: '0 8px',
                      background: tab === 'messages' ? 'var(--raised)' : 'transparent',
                      color: tab === 'messages' ? 'var(--text)' : 'var(--muted)',
                    }}
                    onClick={() => setTab('messages')}
                  >
                    Messages
                  </button>
                  <button
                    type="button"
                    className="sm-btn"
                    style={{
                      height: 24,
                      padding: '0 8px',
                      background: tab === 'log' ? 'var(--raised)' : 'transparent',
                      color: tab === 'log' ? 'var(--text)' : 'var(--muted)',
                    }}
                    onClick={() => setTab('log')}
                  >
                    Log
                  </button>
                </div>

                <div ref={bottomRef} className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 8 }}>
                  {tab === 'messages' ? (
                    messages.length === 0 ? (
                      <div className="sm-label">No messages yet.</div>
                    ) : (
                      messages.map((message) => (
                        <div key={message.id} style={{ marginBottom: 10 }}>
                          <div className="sm-label" style={{ fontSize: 10, marginBottom: 2 }}>
                            {message.agent}
                            {message.time ? ` · ${message.time}` : ''}
                          </div>
                          <div
                            style={{
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          >
                            {message.text}
                          </div>
                        </div>
                      ))
                    )
                  ) : (runState?.terminal_logs ?? []).length === 0 ? (
                    <div className="sm-label">No log lines yet.</div>
                  ) : (
                    (runState?.terminal_logs ?? []).map((line, index) => (
                      <div
                        key={index}
                        className="mono"
                        style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}
                      >
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div
            className="flex h-full items-center justify-center"
            style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}
          >
            Pick a run on the left, or start a new one.
          </div>
        )}
      </section>
    </div>
  );
}
