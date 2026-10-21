import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type TauriCsp = Record<string, string>;

type TauriConfig = {
  productName: string;
  identifier: string;
  build: { devUrl: string };
  app: {
    security: {
      csp: TauriCsp;
      devCsp: TauriCsp;
    };
  };
};

function loadTauriConfig(): TauriConfig {
  const configPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../src-tauri/tauri.conf.json',
  );
  return JSON.parse(readFileSync(configPath, 'utf8')) as TauriConfig;
}

function directiveIncludesOrigin(directive: string, origin: string): boolean {
  return directive.split(/\s+/).includes(origin);
}

describe('Tauri config', () => {
  const config = loadTauriConfig();

  it('is branded Smurf and uses the Smurf dev port', () => {
    expect(config.productName).toBe('Smurf');
    expect(config.identifier).toBe('com.smurf.app');
    expect(config.build.devUrl).toBe('http://127.0.0.1:47823');
  });

  it.each([
    ['csp', config.app.security.csp],
    ['devCsp', config.app.security.devCsp],
  ] as const)('allows smurf-server HTTP + WebSocket in %s', (_label, csp) => {
    for (const origin of [
      'http://127.0.0.1:47821',
      'ws://127.0.0.1:47821',
      'http://localhost:47821',
      'ws://localhost:47821',
    ]) {
      expect(directiveIncludesOrigin(csp['connect-src'], origin)).toBe(true);
    }
  });
});
