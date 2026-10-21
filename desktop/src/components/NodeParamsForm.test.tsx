import { describe, expect, it } from 'vitest';
import { coerceParam, type NodeParamSpec } from './NodeParamsForm';

function spec(type: NodeParamSpec['type']): NodeParamSpec {
  return { name: 'value', type, description: '' };
}

describe('coerceParam', () => {
  it('parses numbers and returns undefined for an empty number', () => {
    expect(coerceParam(spec('number'), '42')).toBe(42);
    expect(coerceParam(spec('number'), ' 3.5 ')).toBe(3.5);
    expect(coerceParam(spec('number'), '')).toBeUndefined();
    expect(coerceParam(spec('number'), '   ')).toBeUndefined();
  });

  it('passes booleans through', () => {
    expect(coerceParam(spec('boolean'), true)).toBe(true);
    expect(coerceParam(spec('boolean'), false)).toBe(false);
  });

  it('keeps strings, mapping empty to undefined', () => {
    expect(coerceParam(spec('string'), 'hello')).toBe('hello');
    expect(coerceParam(spec('string'), '')).toBeUndefined();
    expect(coerceParam(spec('select'), 'wide')).toBe('wide');
    expect(coerceParam(spec('select'), '')).toBeUndefined();
  });
});
