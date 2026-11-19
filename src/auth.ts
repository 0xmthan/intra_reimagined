// Login with 42 for our API server (see server/auth.ts). "Connect" sends this tab through the
// server's OAuth flow; it comes back to the same intra page with our token in the URL fragment,
// which we keep in extension storage and send as `Authorization: Bearer` from then on.

const IR_API = (import.meta.env.VITE_IR_API as string | undefined)?.replace(/\/+$/, '');
/** Built with an API server, so the extension needs a login with 42. */
export const NEEDS_LOGIN = !!IR_API;
const TOKEN_KEY = 'apiToken';
const STATE_KEY = 'apiAuthState';

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
const storage = ((globalThis as { browser?: { storage: { local: StorageArea } } }).browser ??
  (globalThis as { chrome?: { storage: { local: StorageArea } } }).chrome)?.storage.local;

let token: Promise<string | undefined> | undefined;

const getStored = (): Promise<string | undefined> =>
  storage
    ? storage.get(TOKEN_KEY).then((r) => (typeof r[TOKEN_KEY] === 'string' ? (r[TOKEN_KEY] as string) : undefined), () => undefined)
    : Promise.resolve(undefined);

export function getToken(): Promise<string | undefined> {
  return (token ??= getStored());
}

/** The server rejected our token (expired or signed out): forget it so we offer "Connect" again. */
export function dropToken() {
  token = Promise.resolve(undefined);
  storage?.remove(TOKEN_KEY).catch(() => {});
  setLoginHint(false);
}

// Extension storage is async, so on its own the page would show intra's old design for a moment
// before we know you're logged in. A per-origin mirror (just a yes/no, never the token) lets us
// apply the redesign at document_start; the real check follows.
const HINT_KEY = 'intra-reimagined:auth';

export function loginHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLoginHint(on: boolean) {
  try {
    if (on) localStorage.setItem(HINT_KEY, '1');
    else localStorage.removeItem(HINT_KEY);
  } catch {
    /* storage blocked: we just wait for extension storage */
  }
}

/** Leave this page for 42's login, coming back here afterwards. */
export async function connect() {
  if (!IR_API || !storage) return;
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await storage.set({ [STATE_KEY]: nonce });
  const back = new URL(location.href);
  back.hash = '';
  location.href = `${IR_API}/auth/start?${new URLSearchParams({ state: nonce, return: back.toString() })}`;
}

/** On the way back from the login: keep the token (if it answers our own request) and tidy the URL. */
export function consumeAuthRedirect() {
  const frag = new URLSearchParams(location.hash.slice(1));
  const state = frag.get('ir-state');
  if (!state) return;
  history.replaceState(history.state, '', location.pathname + location.search);
  const got = frag.get('ir-auth');
  if (!storage) return;
  token = storage.get(STATE_KEY).then(async (r) => {
    await storage.remove(STATE_KEY);
    if (!got || r[STATE_KEY] !== state) return getStored();
    await storage.set({ [TOKEN_KEY]: got });
    return got;
  }, () => undefined);
}
