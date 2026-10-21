import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getServerUrl, serverFetch, serverJson } from '../services/serverUrl';
import { FlowCanvas } from './canvas/FlowCanvas';
import { NodePanel } from './canvas/NodePanel';
import {
  addNode,
  toFlow,
  validateLocal,
  type Graph,
  type NodeSpec,
} from './canvas/graph';

type WorkflowItem = Graph & { id: string };

type SaveResult = { status: 'saved' | 'invalid'; problems: string[] };

const GROUP_ORDER = ['senior', 'flow', 'human', 'output', 'agent', 'workspace', 'verify'];

async function saveGraph(id: string, graph: Graph): Promise<SaveResult> {
  const response = await serverFetch(
    `${getServerUrl()}/api/workflows/user/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph }),
    },
  );
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    if (body && typeof body.detail === 'string') message = body.detail;
    throw new Error(message);
  }
  const body = (await response.json().catch(() => ({}))) as {
    status?: unknown;
    problems?: unknown;
  };
  return {
    status: body.status === 'saved' ? 'saved' : 'invalid',
    problems: Array.isArray(body.problems) ? body.problems.map(String) : [],
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cloneGraph(graph: Graph): Graph {
  return {
    name: graph.name,
    description: graph.description,
    start: graph.start,
    nodes: graph.nodes.map((node) => {
      const copy: Graph['nodes'][number] = { id: node.id, type: node.type };
      if (node.name !== undefined) copy.name = node.name;
      if (node.params) copy.params = { ...node.params };
      if (node.position) copy.position = [node.position[0], node.position[1]];
      return copy;
    }),
    edges: graph.edges.map((edge) =>
      edge.port === undefined
        ? { from: edge.from, to: edge.to }
        : { from: edge.from, port: edge.port, to: edge.to },
    ),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WorkflowsView() {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [specs, setSpecs] = useState<NodeSpec[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [original, setOriginal] = useState<Graph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [showProblems, setShowProblems] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadSeq = useRef(0);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void serverJson<{ workflows?: WorkflowItem[] }>('/api/workflows/user', {})
      .then((data) => {
        if (cancelled) return;
        setWorkflows(Array.isArray(data.workflows) ? data.workflows : []);
        setListLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setWorkflows([]);
        setListLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void serverJson<NodeSpec[]>('/api/nodes', [])
      .then((list) => {
        if (!cancelled) setSpecs(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setSpecs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (graph && selectedNodeId && !graph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [graph, selectedNodeId]);

  const openWorkflow = useCallback(
    async (id: string) => {
      if (id === selectedId && graph) return;
      const seq = loadSeq.current + 1;
      loadSeq.current = seq;

      setSelectedId(id);
      setGraph(null);
      setOriginal(null);
      setSelectedNodeId(null);
      setLoadError(null);
      setServerProblems([]);
      setShowProblems(false);
      setAddOpen(false);
      setSaved(false);

      try {
        const data = await serverJson<{ graph?: Graph }>(
          `/api/workflows/user/${encodeURIComponent(id)}`,
          {},
        );
        if (seq !== loadSeq.current) return;
        if (!data.graph) {
          setLoadError('Could not load this workflow.');
          return;
        }
        setGraph(data.graph);
        setOriginal(data.graph);
      } catch (error) {
        if (seq === loadSeq.current) setLoadError(errorText(error));
      }
    },
    [selectedId, graph],
  );

  const changeGraph = useCallback((next: Graph) => {
    setGraph(next);
    setServerProblems([]);
    setSaved(false);
  }, []);

  const dirty = useMemo(
    () => Boolean(graph && original && JSON.stringify(graph) !== JSON.stringify(original)),
    [graph, original],
  );

  const localProblems = useMemo(
    () => (graph ? validateLocal(graph, specs) : []),
    [graph, specs],
  );

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? specs.filter((spec) =>
          `${spec.label} ${spec.type} ${spec.description}`.toLowerCase().includes(needle),
        )
      : specs;
    const order = [...GROUP_ORDER];
    for (const spec of matches) {
      if (!order.includes(spec.group)) order.push(spec.group);
    }
    return order
      .map((group) => ({ group, items: matches.filter((spec) => spec.group === group) }))
      .filter((entry) => entry.items.length > 0);
  }, [specs, query]);

  const discard = () => {
    if (!original) return;
    setGraph(original);
    setSelectedNodeId(null);
    setServerProblems([]);
    setShowProblems(false);
    setSaved(false);
  };

  const save = async () => {
    if (!graph || !selectedId || saving || !dirty) return;
    setSaving(true);
    setServerProblems([]);
    try {
      const result = await saveGraph(selectedId, graph);
      if (result.status === 'invalid') {
        setServerProblems(result.problems);
        return;
      }
      const savedGraph = graph;
      setOriginal(savedGraph);
      setWorkflows((list) =>
        list.map((item) => (item.id === selectedId ? { ...item, ...savedGraph } : item)),
      );
      setSaved(true);
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => {
        setSaved(false);
        savedTimer.current = null;
      }, 2000);
    } catch (error) {
      setServerProblems([errorText(error)]);
    } finally {
      setSaving(false);
    }
  };

  const createWorkflow = async () => {
    const name = newName.trim();
    if (!name) return;
    const template = workflows.find((item) => item.id === 'default');
    if (!template) {
      setNewError('No default workflow to copy.');
      return;
    }
    const base = slugify(name);
    if (!base) {
      setNewError('Use letters or numbers in the name.');
      return;
    }
    let id = base;
    let suffix = 2;
    while (workflows.some((item) => item.id === id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    const next: Graph = { ...cloneGraph(template), name };

    try {
      const result = await saveGraph(id, next);
      if (result.status !== 'saved') {
        setNewError(result.problems.join('; ') || 'Workflow is invalid.');
        return;
      }
    } catch (error) {
      setNewError(errorText(error));
      return;
    }

    setWorkflows((list) => [...list, { ...next, id }]);
    setCreating(false);
    setNewName('');
    setNewError(null);
    setSelectedId(id);
    setGraph(next);
    setOriginal(next);
    setSelectedNodeId(null);
    setServerProblems([]);
    setShowProblems(false);
    setSaved(false);
  };

  const addAtCenter = (spec: NodeSpec) => {
    if (!graph) return;
    const flow = toFlow(graph, specs);
    const xs = flow.nodes.map((node) => node.position.x);
    const ys = flow.nodes.map((node) => node.position.y);
    const centerX = xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    const centerY = ys.length > 0 ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
    const next = addNode(graph, spec, [centerX + 40, centerY + 40]);
    changeGraph(next);
    setSelectedNodeId(next.nodes[next.nodes.length - 1].id);
    setAddOpen(false);
    setQuery('');
  };

  const selectedNode = graph && selectedNodeId ? graph.nodes.find((node) => node.id === selectedNodeId) : undefined;

  return (
    <div className="flex h-full min-h-0" style={{ background: 'var(--bg)' }}>
      <aside
        className="flex h-full flex-col overflow-hidden"
        style={{
          width: 220,
          flex: '0 0 220px',
          background: 'var(--panel)',
          borderRight: '1px solid var(--line)',
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>Workflows</span>
          <button
            type="button"
            className="sm-btn"
            style={{ height: 24, padding: '0 8px' }}
            onClick={() => {
              setCreating((value) => !value);
              setNewError(null);
            }}
          >
            New
          </button>
        </div>

        {creating && (
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <div className="flex gap-1">
              <input
                className="sm-input"
                style={{ minWidth: 0, flex: 1, height: 26, boxSizing: 'border-box' }}
                placeholder="Name"
                value={newName}
                autoFocus
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createWorkflow();
                  if (event.key === 'Escape') {
                    setCreating(false);
                    setNewError(null);
                  }
                }}
              />
              <button
                type="button"
                className="sm-btn"
                style={{ height: 26, padding: '0 8px' }}
                disabled={!newName.trim()}
                onClick={() => void createWorkflow()}
              >
                Create
              </button>
            </div>
            {newError && (
              <p style={{ margin: '6px 0 0', fontSize: 10, lineHeight: 1.4, color: 'var(--bad)' }}>
                {newError}
              </p>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {workflows.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void openWorkflow(item.id)}
              className="w-full text-left hover:bg-[var(--raised)]"
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 10px',
                border: 'none',
                background: item.id === selectedId ? 'var(--raised)' : 'transparent',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.name}
              </div>
              <div className="sm-label" style={{ fontSize: 10, marginTop: 1 }}>
                {item.nodes.length} node{item.nodes.length === 1 ? '' : 's'}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {graph ? (
          <>
            <div
              className="flex items-center gap-2"
              style={{
                height: 44,
                flex: '0 0 44px',
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
                {graph.name}
              </span>
              <span className="sm-label" style={{ color: 'var(--ok)' }}>
                {saved ? 'Saved' : ''}
              </span>
              <div style={{ flex: 1 }} />

              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="sm-btn"
                  onClick={() => {
                    setAddOpen((value) => !value);
                    setQuery('');
                  }}
                >
                  Add node
                </button>
                {addOpen && (
                  <>
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 10 }}
                      onClick={() => setAddOpen(false)}
                    />
                    <div
                      className="sm-panel"
                      style={{
                        position: 'absolute',
                        top: 34,
                        left: 0,
                        width: 300,
                        maxHeight: 360,
                        overflowY: 'auto',
                        zIndex: 11,
                        padding: 8,
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                      }}
                    >
                      <input
                        className="sm-input"
                        style={{ width: '100%', boxSizing: 'border-box' }}
                        placeholder="Search nodes"
                        value={query}
                        autoFocus
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      {groups.length === 0 && (
                        <div className="sm-label" style={{ padding: 6 }}>
                          {specs.length === 0 ? 'Node list unavailable.' : 'No matching nodes.'}
                        </div>
                      )}
                      {groups.map(({ group, items }) => (
                        <div key={group} style={{ marginTop: 6 }}>
                          <div
                            className="sm-label"
                            style={{ textTransform: 'uppercase', letterSpacing: 1, padding: '2px 4px' }}
                          >
                            {group}
                          </div>
                          {items.map((spec) => (
                            <button
                              key={spec.type}
                              type="button"
                              onClick={() => addAtCenter(spec)}
                              className="w-full text-left hover:bg-[var(--raised)]"
                              style={{
                                display: 'block',
                                width: '100%',
                                padding: '5px 6px',
                                border: 'none',
                                borderRadius: 6,
                                background: 'transparent',
                                color: 'var(--text)',
                                cursor: 'pointer',
                              }}
                            >
                              <span style={{ fontSize: 12 }}>{spec.label}</span>
                              <span
                                className="mono"
                                style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}
                              >
                                {spec.type}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                className="sm-btn"
                style={{ color: localProblems.length > 0 ? 'var(--bad)' : 'var(--muted)' }}
                onClick={() => setShowProblems((value) => !value)}
              >
                {localProblems.length} problem{localProblems.length === 1 ? '' : 's'}
              </button>

              <button
                type="button"
                className="sm-btn"
                disabled={!dirty}
                onClick={discard}
              >
                Discard
              </button>
              <button
                type="button"
                className="sm-btn sm-btn-primary"
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                Save
              </button>
            </div>

            {serverProblems.length > 0 && (
              <div
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--line)',
                  background: 'var(--panel)',
                  color: 'var(--bad)',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {serverProblems.map((problem, index) => (
                  <div key={index}>{problem}</div>
                ))}
              </div>
            )}

            {showProblems && (
              <div
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--line)',
                  background: 'var(--panel)',
                  fontSize: 11,
                  lineHeight: 1.5,
                }}
              >
                {localProblems.length === 0 ? (
                  <span className="sm-label">No local problems.</span>
                ) : (
                  localProblems.map((problem, index) => (
                    <div key={index} style={{ color: 'var(--bad)' }}>
                      {problem}
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="min-h-0 flex-1" style={{ position: 'relative' }}>
              <FlowCanvas
                graph={graph}
                specs={specs}
                selectedId={selectedNodeId}
                onSelect={setSelectedNodeId}
                onChange={changeGraph}
              />
            </div>
          </>
        ) : (
          <div
            className="flex h-full items-center justify-center"
            style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}
          >
            {!listLoaded ? (
              'Loading…'
            ) : loadError ? (
              <span style={{ color: 'var(--bad)' }}>{loadError}</span>
            ) : workflows.length === 0 ? (
              'No workflows yet. Start the runner: ./smurf.sh runner'
            ) : (
              'Pick a workflow on the left'
            )}
          </div>
        )}
      </section>

      {graph && selectedNode && (
        <NodePanel
          graph={graph}
          specs={specs}
          nodeId={selectedNode.id}
          onChange={changeGraph}
        />
      )}
    </div>
  );
}
