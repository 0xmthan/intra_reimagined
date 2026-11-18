// Runs inside the hidden profile-v3 iframe. Waits for v3 to finish its own login,
// makes one read-only GET to the pace API with v3's token, and hands only the
// resulting milestone data back to the v2 page. The token never leaves this frame.
import { V2_ORIGIN, type PaceMessage, type PaceProfile } from './types';

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
  const res = await fetch(`https://pace-system.42.fr/api/v1/users/${encodeURIComponent(userId)}/profile`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`pace API ${res.status}`);
  return res.json();
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
