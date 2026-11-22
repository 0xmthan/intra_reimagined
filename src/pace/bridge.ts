// Runs inside the hidden profile-v3 iframe. Waits for v3 to finish its own login,
// makes read-only GETs to the pace API (and the alumni API, as v3's own profile does)
// with v3's token, and hands only the resulting data back to the v2 page. The token
// never leaves this frame.
import { V2_ORIGIN, type Alumni, type PaceMessage, type PaceProfile } from './types';

const TOKEN_TIMEOUT_MS = 25_000;

function readToken(): string | undefined {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('oidc.user:'));
    if (!key) return undefined;
    const user = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!user?.access_token || (user.expires_at && user.expires_at * 1000 < Date.now() + 10_000)) return undefined;
    return user.access_token as string;
  } catch {
    return undefined;
  }
}

async function waitForToken(): Promise<string> {
  const start = Date.now();
  for (;;) {
    const token = readToken();
    if (token) return token;
    if (Date.now() - start > TOKEN_TIMEOUT_MS) throw new Error('v3 login timed out');
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function fetchPace(userId: string): Promise<PaceProfile> {
  const token = await waitForToken();
  const get = (url: string) => fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const id = encodeURIComponent(userId);
  // The alumni countdown is extra: if it fails, the pace data still goes back.
  const [res, alumni] = await Promise.all([
    get(`https://pace-system.42.fr/api/v1/users/${id}/profile`),
    get(`https://alumni-management.42.fr/api/v1/alumni_auto/${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<Alumni>) : null))
      .catch(() => null),
  ]);
  if (!res.ok) throw new Error(`pace API ${res.status}`);
  const pace = (await res.json()) as PaceProfile;
  const keep = alumni && typeof alumni.deadline === 'string' ? { counter_begin_at: alumni.counter_begin_at ?? null, deadline: alumni.deadline, status: alumni.status ?? null } : null;
  return { ...pace, alumni: keep };
}

export function runPaceBridge() {
  let started = false;
  window.addEventListener('message', async (e: MessageEvent) => {
    const msg = e.data as PaceMessage | undefined;
    if (e.origin !== V2_ORIGIN || msg?.type !== 'ir-pace-request' || !/^\d+$/.test(msg.userId) || started) return;
    started = true;
    const reply = (m: PaceMessage) => window.parent.postMessage(m, V2_ORIGIN);
    try {
      const data = await fetchPace(msg.userId);
      reply({ type: 'ir-pace-response', data: JSON.parse(JSON.stringify(data)) });
    } catch (err) {
      reply({ type: 'ir-pace-response', error: String((err as Error).message ?? err) });
    }
  });
}
