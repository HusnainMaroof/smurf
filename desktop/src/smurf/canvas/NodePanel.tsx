import { removeNode, type Graph, type GraphNode, type NodeParamSpec, type NodeSpec } from './graph';

export interface NodePanelProps {
  graph: Graph;
  specs: NodeSpec[];
  nodeId: string;
  onChange: (graph: Graph) => void;
}

function valueText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function defaultText(param: NodeParamSpec): string | undefined {
  return param.default === undefined ? undefined : String(param.default);
}

export function NodePanel({ graph, specs, nodeId, onChange }: NodePanelProps) {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const spec = specs.find((item) => item.type === node.type);

  const updateNode = (patch: Partial<GraphNode>) => {
    onChange({
      ...graph,
      nodes: graph.nodes.map((item) => (item.id === node.id ? { ...item, ...patch } : item)),
    });
  };

  const setName = (name: string) => {
    if (name === '') {
      const next = { ...node };
      delete next.name;
      onChange({
        ...graph,
        nodes: graph.nodes.map((item) => (item.id === node.id ? next : item)),
      });
      return;
    }
    updateNode({ name });
  };

  const setParam = (param: NodeParamSpec, value: unknown) => {
    const params = { ...(node.params ?? {}) };
    if (value === undefined) {
      delete params[param.name];
    } else {
      params[param.name] = value;
    }
    if (Object.keys(params).length === 0) {
      const next = { ...node };
      delete next.params;
      onChange({
        ...graph,
        nodes: graph.nodes.map((item) => (item.id === node.id ? next : item)),
      });
      return;
    }
    updateNode({ params });
  };

  return (
    <aside
      className="sm-panel"
      style={{
        width: 300,
        flex: '0 0 300px',
        height: '100%',
        borderRadius: 0,
        borderTop: 'none',
        borderRight: 'none',
        borderBottom: 'none',
        borderLeft: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 12 }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          {node.type}
        </div>
        <div style={{ fontSize: 13, marginTop: 2 }}>{spec?.label ?? node.id}</div>
        <p className="sm-label" style={{ marginTop: 6, lineHeight: 1.5 }}>
          {spec?.description ?? 'Unknown node type.'}
        </p>

        <div style={{ marginTop: 14 }}>
          <label htmlFor="sm-node-name" className="sm-label" style={{ display: 'block', marginBottom: 4 }}>
            Name
          </label>
          <input
            id="sm-node-name"
            className="sm-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            type="text"
            value={node.name ?? ''}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        {(spec?.params ?? []).map((param) => {
          const id = `sm-param-${param.name}`;
          const value = node.params?.[param.name];
          return (
            <div key={param.name} style={{ marginTop: 12 }}>
              {param.type === 'boolean' ? (
                <label
                  htmlFor={id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(event) => setParam(param, event.target.checked)}
                  />
                  {param.name}
                </label>
              ) : (
                <>
                  <label htmlFor={id} className="sm-label" style={{ display: 'block', marginBottom: 4 }}>
                    {param.name}
                  </label>
                  {param.type === 'select' ? (
                    <select
                      id={id}
                      className="sm-input"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      value={valueText(value)}
                      onChange={(event) =>
                        setParam(param, event.target.value === '' ? undefined : event.target.value)
                      }
                    >
                      <option value="">{defaultText(param) ?? '—'}</option>
                      {(param.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      className="sm-input"
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      type={param.type === 'number' ? 'number' : 'text'}
                      value={valueText(value)}
                      placeholder={defaultText(param)}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === '') {
                          setParam(param, undefined);
                          return;
                        }
                        if (param.type === 'number') {
                          const parsed = Number(raw);
                          setParam(param, Number.isNaN(parsed) ? undefined : parsed);
                          return;
                        }
                        setParam(param, raw);
                      }}
                    />
                  )}
                </>
              )}
              {param.description && (
                <p className="sm-label" style={{ marginTop: 4, lineHeight: 1.4 }}>
                  {param.description}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div
        className="flex items-center gap-2"
        style={{ padding: 12, borderTop: '1px solid var(--line)' }}
      >
        <button
          type="button"
          className="sm-btn"
          disabled={graph.start === node.id}
          onClick={() => onChange({ ...graph, start: node.id })}
        >
          Set as start
        </button>
        <button
          type="button"
          className="sm-btn"
          style={{ color: 'var(--bad)' }}
          onClick={() => onChange(removeNode(graph, node.id))}
        >
          Delete node
        </button>
      </div>
    </aside>
  );
}
