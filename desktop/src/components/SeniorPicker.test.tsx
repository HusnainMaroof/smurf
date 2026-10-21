import { describe, expect, it } from 'vitest';
import { sortSeniors, type SeniorOption } from '../services/smurfApi';

function senior(
  key: string,
  tier: SeniorOption['tier'],
  billing: SeniorOption['billing'],
  cooling = false,
): SeniorOption {
  return { key, tier, billing, cooling };
}

describe('sortSeniors', () => {
  it('puts non-cooling options before cooling ones', () => {
    const sorted = sortSeniors([
      senior('a', 'premium', 'free', true),
      senior('b', 'strong', 'metered', false),
    ]);

    expect(sorted.map((option) => option.key)).toEqual(['b', 'a']);
  });

  it('orders free before subscription before metered', () => {
    const sorted = sortSeniors([
      senior('metered', 'premium', 'metered'),
      senior('free', 'strong', 'free'),
      senior('subscription', 'premium', 'subscription'),
    ]);

    expect(sorted.map((option) => option.key)).toEqual(['free', 'subscription', 'metered']);
  });

  it('orders premium before strong within the same billing', () => {
    const sorted = sortSeniors([
      senior('strong', 'strong', 'free'),
      senior('premium', 'premium', 'free'),
    ]);

    expect(sorted.map((option) => option.key)).toEqual(['premium', 'strong']);
  });

  it('breaks remaining ties by key', () => {
    const sorted = sortSeniors([
      senior('zeta', 'premium', 'free'),
      senior('alpha', 'premium', 'free'),
      senior('beta', 'premium', 'free'),
    ]);

    expect(sorted.map((option) => option.key)).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('applies cooling first, then billing, then tier, then key', () => {
    const sorted = sortSeniors([
      senior('cooling-free-premium', 'premium', 'free', true),
      senior('metered-strong', 'strong', 'metered'),
      senior('free-strong', 'strong', 'free'),
      senior('free-premium', 'premium', 'free'),
      senior('sub-premium', 'premium', 'subscription'),
    ]);

    expect(sorted.map((option) => option.key)).toEqual([
      'free-premium',
      'free-strong',
      'sub-premium',
      'metered-strong',
      'cooling-free-premium',
    ]);
  });
});
