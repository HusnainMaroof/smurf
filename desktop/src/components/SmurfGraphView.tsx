import React, { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import type { CompilerWorkflow } from '../services/workflowFormat';
import { serverJson } from '../services/serverUrl';
import { NodeParamsForm, type NodeTypeSpec } from './NodeParamsForm';

/** Horizontal distance between breadth-first levels for nodes without a stored position. */
const LEVEL_WIDTH = 250;
/** Vertical distance between nodes that share a breadth-first level. */
const ROW_HEIGHT = 120;

const NODE_STYLES: Record<string, { background: string; border: string }> = {
  start: { background: '#f3f4f6', border: '#9ca3af' },
  human_gate: { background: '#fef3c7', border: '#f59e0b' },
  check: { background: '#d1fae5', border: '#10b981' },
  agent_task: { background: '#dbeafe', border: '#3b82f6' },
};

const DEFAULT_NODE_STYLE = NODE_STYLES.start;

/** Breadth-first order of node ids starting at `start`; unreachable nodes are appended last. */
export function layoutOrder(workflow: CompilerWorkflow): string[] {
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const targets = outgoing.get(edge.source);
    if (targets) {
      targets.push(edge.target);
    } else {
      outgoing.set(edge.source, [edge.target]);
    }
  }

  const order: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [];
  if (nodeIds.has('start')) {
    queue.push('start');
    seen.add('start');
  }

  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const target of outgoing.get(id) ?? []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }

  for (const node of workflow.nodes) {
    if (!seen.has(node.id)) {
      seen.add(node.id);
      order.push(node.id);
    }
  }

  return order;
}

/** Breadth-first level per node; unreachable nodes fall back to level 0. */
function layoutLevels(workflow: CompilerWorkflow): Map<string, number> {
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const targets = outgoing.get(edge.source);
    if (targets) {
      targets.push(edge.target);
    } else {
      outgoing.set(edge.source, [edge.target]);
    }
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];
  if (nodeIds.has('start')) {
    queue.push('start');
    levels.set('start', 0);
  }

  while (queue.length > 0) {
    const id = queue.shift() as string;
    const nextLevel = (levels.get(id) ?? 0) + 1;
    for (const target of outgoing.get(id) ?? []) {
      if (!levels.has(target)) {
        levels.set(target, nextLevel);
        queue.push(target);
      }
    }
  }

  return levels;
}

function nodeLabel(nodeId: string, data: Record<string, unknown>): React.ReactNode {
  const instruction = data.instruction ? String(data.instruction) : nodeId;
  const agent = data.agent ? String(data.agent) : '';
  return (
    <div className="flex flex-col text-left leading-snug">
      <span className="text-[12px] font-semibold text-neutral-800">{instruction}</span>
      {agent && <span className="text-[10px] font-mono text-neutral-500 mt-0.5">{agent}</span>}
    </div>
  );
}

function edgeLabel(when: unknown): string | undefined {
  if (!when) return undefined;
  return Array.isArray(when) ? when.join(', ') : String(when);
}

export interface SmurfGraphViewProps {
  workflow: CompilerWorkflow;
  /** When given, nodes are draggable/editable and the graph can be saved. */
  onSave?: (workflow: CompilerWorkflow) => Promise<void>;
}

export const SmurfGraphView: React.FC<SmurfGraphViewProps> = ({ workflow, onSave }) => {
  const [saved, setSaved] = useState<CompilerWorkflow | null>(null);
  const current = saved ?? workflow;

  const { nodes: baseNodes, edges } = useMemo(() => {
    const order = layoutOrder(current);
    const orderIndex = new Map(order.map((id, index) => [id, index]));
    const levels = layoutLevels(current);
    const rowsPerLevel = new Map<number, number>();

    const flowNodes: Node[] = current.nodes.map((node) => {
      const level = levels.get(node.id) ?? 0;
      const row = rowsPerLevel.get(level) ?? 0;
      rowsPerLevel.set(level, row + 1);
      const position = node.position ?? { x: level * LEVEL_WIDTH, y: row * ROW_HEIGHT };
      const style = NODE_STYLES[node.type] ?? DEFAULT_NODE_STYLE;

      return {
        id: node.id,
        position,
        data: { label: nodeLabel(node.id, node.data) },
        style: {
          width: 200,
          padding: '8px 12px',
          borderRadius: 10,
          background: style.background,
          border: `1px solid ${style.border}`,
        },
      };
    });

    const flowEdges: Edge[] = current.edges.map((edge, index) => {
      const sourceIndex = orderIndex.get(edge.source);
      const targetIndex = orderIndex.get(edge.target);
      const isBackEdge =
        sourceIndex !== undefined && targetIndex !== undefined && targetIndex < sourceIndex;
      const when = edgeLabel(edge.data?.when);

      return {
        id: edge.id || `e-${index}-${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: when,
        type: isBackEdge ? 'smoothstep' : undefined,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          stroke: '#9ca3af',
          ...(isBackEdge ? { strokeDasharray: '5 5' } : {}),
        },
        labelStyle: { fill: '#6b7280', fontSize: 10 },
        labelBgStyle: { fill: '#ffffff' },
      };
    });

    return { nodes: flowNodes, edges: flowEdges };
  }, [current]);

  const editable = Boolean(onSave);

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [params, setParams] = useState<Record<string, Record<string, unknown>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [registry, setRegistry] = useState<NodeTypeSpec[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A new workflow resets every local edit.
  useEffect(() => {
    setSaved(null);
    setPositions({});
    setNames({});
    setParams({});
    setSelectedId(null);
    setDirty(false);
    setStatus(null);
    setError(null);
  }, [workflow]);

  // Node registry feeds the per-type parameter form; [] when unavailable.
  useEffect(() => {
    if (!editable) return;
    let cancelled = false;
    void serverJson<NodeTypeSpec[]>('/api/nodes', [])
      .then((list) => {
        if (!cancelled) setRegistry(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setRegistry([]);
      });
    return () => {
      cancelled = true;
    };
  }, [editable]);

  const nodes = useMemo(
    () =>
      baseNodes.map((node) => {
        const source = current.nodes.find((item) => item.id === node.id);
        const instruction = names[node.id];
        const data = {
          ...(source?.data ?? {}),
          ...(instruction !== undefined ? { instruction } : {}),
        };
        return {
          ...node,
          position: positions[node.id] ?? node.position,
          selected: editable && node.id === selectedId,
          data: { ...node.data, label: nodeLabel(node.id, data) },
        };
      }),
    [baseNodes, current, names, positions, editable, selectedId],
  );

  const handleNodesChange = (changes: NodeChange[]) => {
    if (!onSave) return;
    const moved: Record<string, { x: number; y: number }> = {};
    let dropped = false;
    for (const change of changes) {
      if (change.type !== 'position' || !change.position) continue;
      moved[change.id] = change.position;
      if (change.dragging === false) dropped = true;
    }
    if (Object.keys(moved).length > 0) {
      setPositions((prev) => ({ ...prev, ...moved }));
    }
    if (dropped) setDirty(true);
  };

  const selectedNode = selectedId
    ? current.nodes.find((node) => node.id === selectedId) ?? null
    : null;
  const selectedName = selectedNode
    ? names[selectedNode.id] ??
      (selectedNode.data.instruction === undefined ? '' : String(selectedNode.data.instruction))
    : '';
  const selectedParams: Record<string, unknown> = selectedNode
    ? params[selectedNode.id] ??
      (selectedNode.data.params && typeof selectedNode.data.params === 'object'
        ? (selectedNode.data.params as Record<string, unknown>)
        : {})
    : {};
  const registryEntry = selectedNode
    ? registry.find((entry) => entry.type === String(selectedNode.data.agent ?? ''))
    : undefined;

  const handleSave = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    const updated: CompilerWorkflow = {
      ...current,
      nodes: current.nodes.map((node) => {
        const position = positions[node.id];
        const instruction = names[node.id];
        const nodeParams = params[node.id];
        if (position === undefined && instruction === undefined && nodeParams === undefined) {
          return node;
        }
        return {
          ...node,
          ...(position !== undefined ? { position } : {}),
          data: {
            ...node.data,
            ...(instruction !== undefined ? { instruction } : {}),
            ...(nodeParams !== undefined ? { params: nodeParams } : {}),
          },
        };
      }),
    };
    try {
      await onSave(updated);
      setSaved(updated);
      setPositions({});
      setNames({});
      setParams({});
      setStatus('Saved');
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setPositions({});
    setNames({});
    setParams({});
    setDirty(false);
    setStatus(null);
    setError(null);
  };

  const graph = (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      nodesDraggable={editable}
      nodesConnectable={false}
      elementsSelectable={editable}
      onNodesChange={editable ? handleNodesChange : undefined}
      onNodeClick={editable ? (_event, node) => setSelectedId(node.id) : undefined}
      onPaneClick={editable ? () => setSelectedId(null) : undefined}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );

  if (!onSave) {
    return (
      <div
        className="w-full rounded-xl border border-neutral-200 bg-white overflow-hidden"
        style={{ height: 520 }}
      >
        {graph}
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-neutral-200 bg-neutral-900 text-white disabled:opacity-40 hover:bg-neutral-800 transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 transition-colors"
        >
          Reset
        </button>
        {status && (
          <span className="text-[10px] font-mono text-emerald-700">{status}</span>
        )}
        {error && (
          <span
            className="text-[10px] font-mono text-rose-700 max-w-[320px] truncate"
            title={error}
          >
            {error}
          </span>
        )}
      </div>
      <div className="flex gap-3 items-start">
        <div
          className="flex-1 min-w-0 rounded-xl border border-neutral-200 bg-white overflow-hidden"
          style={{ height: 520 }}
        >
          {graph}
        </div>
        {selectedNode && (
          <aside
            className="shrink-0 rounded-xl border border-neutral-200 bg-white p-3 text-left"
            style={{ width: 280 }}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Node</p>
            <p className="text-[11px] font-mono text-neutral-800 break-all">{selectedNode.id}</p>
            <p className="text-[10px] font-mono text-neutral-500 mt-0.5 break-all">
              {selectedNode.data.agent === undefined || selectedNode.data.agent === ''
                ? '—'
                : String(selectedNode.data.agent)}
            </p>
            <div className="mt-3 space-y-1">
              <label
                htmlFor="graph-node-name"
                className="block text-[10px] font-bold text-neutral-700"
              >
                Name
              </label>
              <input
                id="graph-node-name"
                type="text"
                value={selectedName}
                onChange={(e) => {
                  setNames((prev) => ({ ...prev, [selectedNode.id]: e.target.value }));
                  setDirty(true);
                }}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50 transition-all font-medium"
              />
            </div>
            {registryEntry && (
              <div className="mt-3">
                <NodeParamsForm
                  spec={registryEntry.params}
                  value={selectedParams}
                  onChange={(next) => {
                    setParams((prev) => ({ ...prev, [selectedNode.id]: next }));
                    setDirty(true);
                  }}
                />
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
};
