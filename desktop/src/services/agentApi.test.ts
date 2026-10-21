import { describe, expect, it } from 'vitest';

import { profileToAgent } from './agentApi';
import type { SmurfAgentProfile } from './agentApi';

const profile: SmurfAgentProfile = {
  id: 'coder',
  category: 'coding',
  name: 'Coder',
  mode: 'edit',
  minTier: 'pro',
  timeoutMin: 10,
  review: 'auto',
  description: 'Writes code.',
};

describe('profileToAgent', () => {
  it('prefixes id with smurf-', () => {
    expect(profileToAgent(profile).id).toBe('smurf-coder');
  });

  it('uses name and includes category in description', () => {
    const agent = profileToAgent(profile);
    expect(agent.name).toBe('Coder');
    expect(agent.description).toContain('Category: coding');
  });
});
