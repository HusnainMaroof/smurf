import React from 'react';

/** One editable parameter of a node type, as served by `GET /api/nodes`. */
export interface NodeParamSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default?: unknown;
  options?: string[];
  description: string;
}

/** One node type, as served by `GET /api/nodes`. */
export interface NodeTypeSpec {
  type: string;
  label: string;
  group: string;
  description: string;
  ports: string[];
  params: NodeParamSpec[];
}

/** Turn a raw form value into the value stored in the workflow params. */
export function coerceParam(spec: NodeParamSpec, raw: string | boolean): unknown {
  if (spec.type === 'boolean') {
    return raw === true || raw === 'true';
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (spec.type === 'number') {
    const trimmed = raw.trim();
    return trimmed === '' ? undefined : Number(trimmed);
  }
  return raw === '' ? undefined : raw;
}

const INPUT_CLASS =
  'w-full border border-neutral-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200/50 transition-all font-medium';

function asText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function placeholderOf(param: NodeParamSpec): string | undefined {
  return param.default === undefined ? undefined : String(param.default);
}

export const NodeParamsForm: React.FC<{
  spec: NodeParamSpec[];
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}> = ({ spec, value, onChange }) => {
  if (spec.length === 0) return null;

  const update = (param: NodeParamSpec, raw: string | boolean) => {
    const next = { ...value };
    const coerced = coerceParam(param, raw);
    if (coerced === undefined) {
      delete next[param.name];
    } else {
      next[param.name] = coerced;
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {spec.map((param) => {
        const id = `param-${param.name}`;
        return (
          <div key={param.name} className="space-y-1">
            <label htmlFor={id} className="block text-[10px] font-bold text-neutral-700">
              {param.name}
            </label>
            {param.type === 'boolean' ? (
              <input
                id={id}
                type="checkbox"
                checked={Boolean(value[param.name])}
                onChange={(e) => update(param, e.target.checked)}
                className="rounded border-neutral-300 text-neutral-800 focus:ring-neutral-400 w-3.5 h-3.5"
              />
            ) : param.type === 'select' ? (
              <select
                id={id}
                value={asText(value[param.name])}
                onChange={(e) => update(param, e.target.value)}
                className={`${INPUT_CLASS} bg-white`}
              >
                <option value="">{placeholderOf(param) ?? '—'}</option>
                {(param.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={param.type === 'number' ? 'number' : 'text'}
                value={asText(value[param.name])}
                placeholder={placeholderOf(param)}
                onChange={(e) => update(param, e.target.value)}
                className={INPUT_CLASS}
              />
            )}
            {param.description && (
              <p className="text-[10px] text-neutral-400 leading-snug">{param.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
};
