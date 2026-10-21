/**
 * smurf-server connection: base URL + Bearer token persisted in localStorage.
 *
 * Every HTTP call to the server should go through `serverFetch` (adds the token,
 * reports 401s to the Connect screen). WebSockets use `serverWebSocketUrl`
 * (`ws(s)://<server>/ws/...?token=<token>`).
 *
 * Changing the URL/token is done from the Connect screen, which saves and reloads,
 * so `SERVER_BASE` can be a module-level constant.
 */

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:47821';
export const SERVER_URL_STORAGE_KEY = 'smurf.serverUrl';
export const SERVER_TOKEN_STORAGE_KEY = 'smurf.token';

/** Fired on `window` when an authenticated call returns 401 (token missing/wrong). */
export const SERVER_UNAUTHORIZED_EVENT = 'smurf:unauthorized';
/** Fired on `window` to show the Connect screen on demand (Settings → Server connection). */
export const OPEN_CONNECT_EVENT = 'smurf:open-connect';

export function openConnectScreen(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPEN_CONNECT_EVENT));
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Trim and drop trailing slashes; returns '' for unusable input. */
export function normalizeServerUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return trimmed;
  } catch {
    return '';
  }
}

export function getServerUrl(): string {
  return normalizeServerUrl(storage()?.getItem(SERVER_URL_STORAGE_KEY)) || DEFAULT_SERVER_URL;
}

export function getServerToken(): string {
  return (storage()?.getItem(SERVER_TOKEN_STORAGE_KEY) ?? '').trim();
}

export function hasServerToken(): boolean {
  return getServerToken().length > 0;
}

export function saveServerConfig(config: { url: string; token: string }): void {
  const store = storage();
  if (!store) return;
  store.setItem(SERVER_URL_STORAGE_KEY, normalizeServerUrl(config.url) || DEFAULT_SERVER_URL);
  store.setItem(SERVER_TOKEN_STORAGE_KEY, config.token.trim());
}

/** HTTP base of smurf-server (no trailing slash). Fixed for the page lifetime. */
export const SERVER_BASE = getServerUrl();

export async function serverAuthHeaders(init?: HeadersInit): Promise<Headers> {
  const headers = new Headers(init);
  const token = getServerToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

function notifyUnauthorized(url: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SERVER_UNAUTHORIZED_EVENT, { detail: { url } }));
}

const warnedUnsupported = new Set<string>();

/** Log each unsupported (404) endpoint once instead of on every poll. */
function noteUnsupported(input: string, method: string): void {
  let key = `${method} ${input}`;
  try {
    const url = new URL(input, SERVER_BASE);
    key = `${method} ${url.pathname}`;
  } catch {
    /* keep raw key */
  }
  if (warnedUnsupported.has(key)) return;
  warnedUnsupported.add(key);
  console.info(`[smurf] endpoint not provided by smurf-server: ${key}`);
}

/**
 * Authenticated fetch for smurf-server HTTP APIs.
 *
 * - Adds `Authorization: Bearer <token>`.
 * - 401 → dispatches `SERVER_UNAUTHORIZED_EVENT` (the app shows the Connect screen).
 * - 404 → returned unchanged (smurf-server answers `{detail}` for features it does not
 *   implement); callers should treat it as "feature unavailable". Use `isUnsupported()`.
 */
export async function serverFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = await serverAuthHeaders(init?.headers);
  // Relative paths ('/api/...') always target the server, never the page origin.
  const url = input.startsWith('/') ? serverHttpUrl(input) : input;
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    notifyUnauthorized(input);
  } else if (response.status === 404) {
    noteUnsupported(input, (init?.method ?? 'GET').toUpperCase());
  }
  return response;
}

/** True when the server does not implement this endpoint (404/405/501). */
export function isUnsupported(response: Response): boolean {
  return response.status === 404 || response.status === 405 || response.status === 501;
}

/**
 * `serverFetch` + JSON decode that resolves to `fallback` when the endpoint is
 * unsupported or the server is unreachable. Throws only for other HTTP errors.
 */
export async function serverJson<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await serverFetch(serverHttpUrl(path), init);
  } catch {
    return fallback;
  }
  if (isUnsupported(response) || response.status === 401) return fallback;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: unknown };
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function serverHttpUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${SERVER_BASE}${normalized}`;
}

/** True when src targets smurf-server HTTP (relative /api or the configured server origin). */
export function isServerApiPath(src: string): boolean {
  const trimmed = src.trim();
  if (trimmed.startsWith('/api/')) {
    return true;
  }
  try {
    const url = new URL(trimmed);
    const base = new URL(SERVER_BASE);
    return url.origin === base.origin;
  } catch {
    return false;
  }
}

function withToken(url: string): string {
  const token = getServerToken();
  if (!token) return url;
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}token=${encodeURIComponent(token)}`;
}

/** Append session token for media elements that cannot send Authorization headers. */
export async function serverAuthedHttpUrl(path: string): Promise<string> {
  return withToken(serverHttpUrl(path.trim()));
}

/** Authenticated media URL for a workspace-relative file (png/mp4/…). */
export async function workspaceMediaUrl(relativePath: string, wtId?: string | null): Promise<string> {
  const id = (wtId ?? '').trim();
  const extra = id ? `&wt_id=${encodeURIComponent(id)}` : '';
  return serverAuthedHttpUrl(
    `/api/workspace/media?path=${encodeURIComponent(relativePath)}${extra}`,
  );
}

/** ws(s):// equivalent of an http(s):// base URL. */
export function toWebSocketBase(httpBase: string): string {
  return httpBase.replace(/^http(s?):\/\//i, (_m, s: string) => (s ? 'wss://' : 'ws://'));
}

/** `ws://<server>/ws/runs/<id>?token=<token>` */
export async function serverWebSocketUrl(path: string): Promise<string> {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return withToken(`${toWebSocketBase(SERVER_BASE)}${normalized}`);
}

export interface ServerHealth {
  status?: string;
  api_version?: string;
  runner?: { connected?: boolean; host?: string; since?: string };
}

export interface ServerConnectionCheck {
  /** `/health` answered. */
  reachable: boolean;
  health: ServerHealth | null;
  /** `GET /api/workspaces` accepted the token. null when not checked. */
  authorized: boolean | null;
  error: string | null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchServerHealth(baseUrl: string = SERVER_BASE): Promise<ServerHealth> {
  const response = await fetchWithTimeout(`${normalizeServerUrl(baseUrl) || DEFAULT_SERVER_URL}/health`);
  if (!response.ok) throw new Error(`/health returned HTTP ${response.status}`);
  return (await response.json()) as ServerHealth;
}

/** Connect-screen test: `/health`, then `GET /api/workspaces` with the token. */
export async function checkServerConnection(baseUrl: string, token: string): Promise<ServerConnectionCheck> {
  const base = normalizeServerUrl(baseUrl);
  if (!base) {
    return { reachable: false, health: null, authorized: null, error: 'Invalid server URL' };
  }
  let health: ServerHealth;
  try {
    health = await fetchServerHealth(base);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { reachable: false, health: null, authorized: null, error: `Cannot reach ${base} (${detail})` };
  }
  if (!token.trim()) {
    return { reachable: true, health, authorized: null, error: 'Token is required' };
  }
  try {
    const response = await fetchWithTimeout(`${base}/api/workspaces`, {
      headers: { Authorization: `Bearer ${token.trim()}` },
    });
    if (response.status === 401 || response.status === 403) {
      return { reachable: true, health, authorized: false, error: 'Token rejected (401)' };
    }
    if (!response.ok) {
      return { reachable: true, health, authorized: false, error: `/api/workspaces returned HTTP ${response.status}` };
    }
    return { reachable: true, health, authorized: true, error: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { reachable: true, health, authorized: false, error: detail };
  }
}
