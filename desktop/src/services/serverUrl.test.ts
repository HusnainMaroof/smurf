import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

async function load(config: { url?: string; token?: string } = {}) {
  const store = memoryStorage();
  if (config.url !== undefined) store.setItem('smurf.serverUrl', config.url);
  if (config.token !== undefined) store.setItem('smurf.token', config.token);
  vi.stubGlobal('localStorage', store);
  vi.resetModules();
  return import('./serverUrl');
}

describe('serverUrl', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the local smurf-server', async () => {
    const mod = await load();
    expect(mod.SERVER_BASE).toBe('http://127.0.0.1:47821');
    expect(mod.serverHttpUrl('/api/workspaces')).toBe('http://127.0.0.1:47821/api/workspaces');
    expect(mod.hasServerToken()).toBe(false);
  });

  it('uses the persisted url and strips trailing slashes', async () => {
    const mod = await load({ url: 'https://smurf.example:9000/', token: 'abc' });
    expect(mod.SERVER_BASE).toBe('https://smurf.example:9000');
    expect(mod.getServerToken()).toBe('abc');
  });

  it('ignores invalid persisted urls', async () => {
    const mod = await load({ url: 'not a url' });
    expect(mod.SERVER_BASE).toBe(mod.DEFAULT_SERVER_URL);
  });

  it('builds ws urls with the token', async () => {
    const mod = await load({ token: 't k' });
    await expect(mod.serverWebSocketUrl('/ws/runs/r1')).resolves.toBe('ws://127.0.0.1:47821/ws/runs/r1?token=t%20k');
    expect(mod.toWebSocketBase('https://h:1')).toBe('wss://h:1');
  });

  it('detects server API paths', async () => {
    const mod = await load();
    expect(mod.isServerApiPath('/api/workspace/media?path=x')).toBe(true);
    expect(mod.isServerApiPath('http://127.0.0.1:47821/api/workspace/media?path=x')).toBe(true);
    expect(mod.isServerApiPath('https://storage.googleapis.com/bucket/v.mp4')).toBe(false);
  });

  it('sends the bearer token on every call', async () => {
    const mod = await load({ token: 'secret' });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await mod.serverFetch(mod.serverHttpUrl('/api/workspaces'));
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer secret');
  });

  it('serverJson falls back on 404', async () => {
    const mod = await load({ token: 'secret' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"Not Found"}', { status: 404 })));
    await expect(mod.serverJson('/api/unknown', { items: [] })).resolves.toEqual({ items: [] });
  });
});
