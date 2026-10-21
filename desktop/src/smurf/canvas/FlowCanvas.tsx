import { useCallback, useEffect, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NodeCard } from './NodeCard';
import {
  connect,
  fromFlow,
  toFlow,
  type Graph,
  type GraphFlowEdge,
  type GraphFlowNode,
  type NodeSpec,
  type NodeStatus,
} from './graph';

const nodeTypes = { card: NodeCard };

const STATUS_VALUES: NodeStatus[] = ['running', 'waiting', 'completed', 'pending'];

const FLOW_CSS = `
.smurf-flow .react-flow__edge-path {
  stroke: #52525b;
  stroke-width: 1.5px;
}
.smurf-flow .react-flow__edge.selected .react-flow__edge-path,
.smurf-flow .react-flow__edge:focus .react-flow__edge-path {
  stroke: var(--text);
}
.smurf-flow .react-flow__edge-text {
  fill: var(--muted);
  font-size: 10px;
}
.smurf-flow .react-flow__edge-textbg {
  fill: var(--panel);
}
.smurf-flow .react-flow__controls {
  box-shadow: none;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
.smurf-flow .react-flow__controls-button {
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  color: var(--text);
}
.smurf-flow .react-flow__controls-button:hover {
  background: var(--raised);
}
.smurf-flow .react-flow__controls-button svg {
  fill: var(--text);
}
.smurf-flow .react-flow__attribution {
  display: none;
}
.smurf-node-running {
  animation: smurf-node-pulse 1.4s ease-in-out infinite;
}
@keyframes smurf-node-pulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--run); }
  50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--run) 35%, transparent); }
}
`;

export interface FlowCanvasProps {
  graph: Graph;
  specs: NodeSpec[];
  readOnly?: boolean;
  status?: Record<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (graph: Graph) => void;
}

export function FlowCanvas({
  graph,
  specs,
  readOnly = false,
  status,
  selectedId,
  onSelect,
  onChange,
}: FlowCanvasProps) {
  const initialFlow = useRef<{ nodes: GraphFlowNode[]; edges: GraphFlowEdge[] } | null>(null);
  if (initialFlow.current === null) initialFlow.current = toFlow(graph, specs);

  const [nodes, setNodes] = useNodesState<GraphFlowNode>(initialFlow.current.nodes);
  const [edges, setEdges] = useEdgesState<GraphFlowEdge>(initialFlow.current.edges);

  // Rebuild from props only when the graph identity or the registry changes.
  const flowSource = useRef<{ graph: Graph; specs: NodeSpec[] } | null>(null);
  useEffect(() => {
    if (flowSource.current?.graph === graph && flowSource.current?.specs === specs) return;
    flowSource.current = { graph, specs };
    const flow = toFlow(graph, specs);
    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [graph, specs, setNodes, setEdges]);

  // Selection is a prop; keep ReactFlow's own selected flag in sync after rebuilds.
  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const selected = node.id === selectedId;
        if (node.selected === selected) return node;
        changed = true;
        return { ...node, selected };
      });
      return changed ? next : current;
    });
  }, [selectedId, graph, specs, setNodes]);

  // Status changes touch node data only; positions and selection stay untouched.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const value = status?.[node.id];
        const nextStatus = STATUS_VALUES.includes(value as NodeStatus)
          ? (value as NodeStatus)
          : undefined;
        if (node.data.status === nextStatus) return node;
        const data = { ...node.data };
        if (nextStatus) {
          data.status = nextStatus;
        } else {
          delete data.status;
        }
        return { ...node, data };
      }),
    );
  }, [status, graph, specs, setNodes]);

  const commit = useCallback(
    (nextNodes: GraphFlowNode[], nextEdges: GraphFlowEdge[]) => {
      if (!onChange) return;
      const next = fromFlow(nextNodes, nextEdges, graph);
      if (!next.nodes.some((node) => node.id === next.start)) {
        next.start = next.nodes[0]?.id ?? '';
      }
      onChange(next);
    },
    [graph, onChange],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<GraphFlowNode>[]) => {
      const effective = readOnly
        ? changes.filter((change) => change.type !== 'position' && change.type !== 'remove')
        : changes;
      if (effective.length === 0) return;

      setNodes((current) => applyNodeChanges(effective, current));

      const dragEnded = effective.some(
        (change) => change.type === 'position' && change.dragging === false,
      );
      if (dragEnded && !readOnly) {
        commit(applyNodeChanges(effective, nodes), edges);
      }
    },
    [readOnly, nodes, edges, commit, setNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<GraphFlowEdge>[]) => {
      const effective = readOnly
        ? changes.filter((change) => change.type !== 'remove')
        : changes;
      if (effective.length === 0) return;
      setEdges((current) => applyEdgeChanges(effective, current));
    },
    [readOnly, setEdges],
  );

  const handleDelete = useCallback(
    ({
      nodes: deletedNodes,
      edges: deletedEdges,
    }: {
      nodes: GraphFlowNode[];
      edges: GraphFlowEdge[];
    }) => {
      if (readOnly) return;
      const nodeIds = new Set(deletedNodes.map((node) => node.id));
      const edgeIds = new Set(deletedEdges.map((edge) => edge.id));
      const nextNodes = nodes.filter((node) => !nodeIds.has(node.id));
      const nextEdges = edges.filter(
        (edge) =>
          !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
      );
      commit(nextNodes, nextEdges);
    },
    [readOnly, nodes, edges, commit],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || !onChange) return;
      const { source, target, sourceHandle } = connection;
      if (!source || !target) return;
      const port = sourceHandle || 'out';
      const id = `${source}:${port}->${target}`;

      setEdges((current) => [
        ...current.filter(
          (edge) => !(edge.source === source && (edge.sourceHandle ?? 'out') === port),
        ),
        {
          id,
          source,
          target,
          sourceHandle: port,
          label: port === 'out' ? undefined : port,
          type: 'smoothstep',
        },
      ]);
      onChange(connect(graph, source, port, target));
    },
    [readOnly, onChange, graph, setEdges],
  );

  return (
    <div className="smurf-flow" style={{ width: '100%', height: '100%' }}>
      <style>{FLOW_CSS}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onDelete={handleDelete}
        onConnect={readOnly ? undefined : handleConnect}
        onNodeClick={(_event, node) => onSelect?.(node.id)}
        onPaneClick={() => onSelect?.(null)}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesReconnectable={false}
        elementsSelectable
        deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
        colorMode="dark"
        fitView
        minZoom={0.2}
        snapToGrid
        snapGrid={[20, 20]}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        style={{ background: 'var(--bg)' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#26262a" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
