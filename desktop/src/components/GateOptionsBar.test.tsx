import { describe, expect, it } from 'vitest';
import { gateButtons } from './GateOptionsBar';

describe('gateButtons', () => {
  it('capitalizes option labels', () => {
    expect(gateButtons(['approve', 'retry']).map((button) => button.label)).toEqual([
      'Approve',
      'Retry',
    ]);
  });

  it('marks the first option primary and later options neutral', () => {
    const buttons = gateButtons(['accept', 'retry', 'reassign', 'skip']);

    expect(buttons[0]).toEqual({ id: 'accept', label: 'Accept', tone: 'primary' });
    expect(buttons.slice(1).map((button) => button.tone)).toEqual([
      'neutral',
      'neutral',
      'neutral',
    ]);
  });

  it('marks abort and reject as destructive', () => {
    const buttons = gateButtons(['approve', 'reject', 'abort']);

    expect(buttons.find((button) => button.id === 'reject')?.tone).toBe('danger');
    expect(buttons.find((button) => button.id === 'abort')?.tone).toBe('danger');
    expect(buttons.find((button) => button.id === 'approve')?.tone).toBe('primary');
  });
});
