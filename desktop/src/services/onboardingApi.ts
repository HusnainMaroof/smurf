import { serverFetch, serverHttpUrl } from './serverUrl';

/**
 * Smurf: the Connect screen is the first-run flow. Clutch's onboarding wizard depends on
 * sidecar endpoints (models/tools scan, workspace authorize) that smurf-server does not
 * implement, so it is skipped for now. Return `(await fetchPreferences()).onboarding_completed`
 * here again once the wizard is wired to smurf-server.
 */
export async function fetchOnboardingState(): Promise<boolean> {
  return true;
}

export async function completeOnboarding(): Promise<void> {
  // smurf-server stores POST /api/preferences/:key (hyphens -> underscores) as prefs[key].
  const response = await serverFetch(serverHttpUrl('/api/preferences/onboarding-completed'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'true' }),
  });
  if (!response.ok) {
    throw new Error(`onboarding complete failed (${response.status})`);
  }
}

export async function pollHealth(): Promise<{ ok: boolean; message?: string }> {
  const response = await serverFetch(serverHttpUrl('/health'));
  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status}` };
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { ok: false, message: 'Invalid health response' };
  }
  try {
    const body = (await response.json()) as { status?: string };
    if (body.status === 'ok') {
      return { ok: true };
    }
    return { ok: false, message: `Unexpected status: ${body.status ?? 'missing'}` };
  } catch {
    return { ok: false, message: 'Invalid health response' };
  }
}
