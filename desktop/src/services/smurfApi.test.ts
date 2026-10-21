import { describe, expect, it } from 'vitest';
import { groupByAdapter, type SmurfModel } from './smurfApi';

function makeModel(
  key: string,
  adapter: string,
  overrides: Partial<Omit<SmurfModel, 'key' | 'adapter'>> = {},
): SmurfModel {
  return {
    key,
    adapter,
    model: `model-${key}`,
    tier: 'standard',
    free: true,
    modes: ['chat'],
    ...overrides,
  };
}

describe('groupByAdapter', () => {
  it('groups models by adapter key', () => {
    const models: SmurfModel[] = [
      makeModel('a1', 'openai'),
      makeModel('b1', 'anthropic'),
      makeModel('a2', 'openai'),
    ];
    const result = groupByAdapter(models);
    expect(Object.keys(result).sort()).toEqual(['anthropic', 'openai']);
    expect(result.openai).toHaveLength(2);
    expect(result.anthropic).toHaveLength(1);
    expect(result.anthropic[0].key).toBe('b1');
  });

  it('sorts each adapter group by key ascending', () => {
    const models: SmurfModel[] = [
      makeModel('z9', 'openai'),
      makeModel('a1', 'anthropic'),
      makeModel('m3', 'openai'),
      makeModel('b2', 'anthropic'),
    ];
    const result = groupByAdapter(models);
    expect(result.openai.map((m) => m.key)).toEqual(['m3', 'z9']);
    expect(result.anthropic.map((m) => m.key)).toEqual(['a1', 'b2']);
  });

  it('returns an empty object for no models', () => {
    expect(groupByAdapter([])).toEqual({});
  });
});
