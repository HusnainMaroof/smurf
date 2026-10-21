import { Fragment, memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Bot,
  Brain,
  FileText,
  FolderGit2,
  GitBranch,
  ShieldCheck,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';

import type { GraphFlowNode, NodeStatus } from './graph';

const GROUP_ICONS: Record<string, LucideIcon> = {
  senior: Brain,
  agent: Bot,
  human: UserCheck,
  verify: ShieldCheck,
  flow: GitBranch,
  workspace: FolderGit2,
  output: FileText,
};

const STATUS_RINGS: Record<NodeStatus, string> = {
  running: '0 0 0 2px var(--run)',
  waiting: '0 0 0 2px var(--wait)',
  completed: '0 0 0 2px var(--ok)',
  pending: 'none',
};

export const NodeCard = memo(function NodeCard({ data, selected }: NodeProps<GraphFlowNode>) {
  const { graphNode, spec, isStart, status } = data;
  const group = spec?.group ?? 'flow';
  const color = spec && GROUP_ICONS[group] ? `var(--g-${group})` : 'var(--muted)';
  const Icon = GROUP_ICONS[group] ?? GitBranch;
  const ports = spec?.ports ?? [];
  const hasPortLabels = ports.length > 1;

  return (
    <div
      className={status === 'running' ? 'smurf-node-running' : undefined}
      style={{
        width: 200,
        height: 56,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        position: 'relative',
        borderRadius: 10,
        background: 'var(--raised)',
        border: `1px solid ${selected ? 'var(--text)' : 'var(--line)'}`,
        boxShadow: status ? STATUS_RINGS[status] : undefined,
        color: 'var(--text)',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 8, height: 8, background: 'var(--muted)', border: '1px solid var(--bg)' }}
      />

      <span
        style={{
          width: 36,
          height: 36,
          flex: '0 0 36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          background: `color-mix(in srgb, ${color} 18%, transparent)`,
          color,
        }}
      >
        <Icon size={18} strokeWidth={1.75} />
      </span>

      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span
          style={{
            fontSize: 13,
            lineHeight: '16px',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {graphNode.name || spec?.label || graphNode.type}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            lineHeight: '14px',
            color: 'var(--muted)',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {graphNode.type}
        </span>
      </span>

      {isStart && (
        <span
          className="mono"
          style={{
            position: 'absolute',
            top: -9,
            right: 8,
            padding: '0 4px',
            borderRadius: 4,
            border: '1px solid var(--line)',
            background: 'var(--raised)',
            color: 'var(--muted)',
            fontSize: 9,
            lineHeight: '14px',
          }}
        >
          start
        </span>
      )}

      {ports.map((port, index) => {
        const top = hasPortLabels
          ? `${((index + 1) / (ports.length + 1)) * 100}%`
          : '50%';
        return (
          <Fragment key={port}>
            {hasPortLabels && (
              <span
                className="mono"
                style={{
                  position: 'absolute',
                  top,
                  right: 10,
                  transform: 'translateY(-50%)',
                  fontSize: 10,
                  lineHeight: '10px',
                  color: 'var(--muted)',
                  pointerEvents: 'none',
                }}
              >
                {port}
              </span>
            )}
            <Handle
              id={port}
              type="source"
              position={Position.Right}
              style={{
                top,
                width: 8,
                height: 8,
                background: 'var(--muted)',
                border: '1px solid var(--bg)',
              }}
            />
          </Fragment>
        );
      })}
    </div>
  );
});
