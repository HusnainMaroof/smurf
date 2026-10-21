import React, { useMemo } from 'react';
import { ReactFlow, Background, Controls, MarkerType, type Edge, type Node } from '@xyflow/react';
import type { CompilerWorkflow } from '../services/workflowFormat';

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

export const SmurfGraphView: React.FC<{ workflow: CompilerWorkflow }> = ({ workflow }) => {
  const { nodes, edges } = useMemo(() => {
    const order = layoutOrder(workflow);
    const orderIndex = new Map(order.map((id, index) => [id, index]));
    const levels = layoutLevels(workflow);
    const rowsPerLevel = new Map<number, number>();

    const flowNodes: Node[] = workflow.nodes.map((node) => {
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

    const flowEdges: Edge[] = workflow.edges.map((edge, index) => {
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
  }, [workflow]);

  return (
    <div
      className="w-full rounded-xl border border-neutral-200 bg-white overflow-hidden"
      style={{ height: 520 }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};
