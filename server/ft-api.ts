// Minimal 42 API v2 client: app-only (client credentials) token, kept fresh, and a request queue
// that stays under 42's per-app limit (2 requests/second), retrying on 429.

const API = 'https://api.intra.42.fr';
const MIN_GAP_MS = 550; // 42 allows 2 req/s per application

export class FtApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Token {
  value: string;
  expiresAt: number;
}

export class FtApi {
  #token?: Token;
  #tokenPromise?: Promise<Token>;
  #queue: Promise<unknown> = Promise.resolve();
  #lastCall = 0;
  readonly #uid: string;
  readonly #secret: string;

  constructor(uid: string, secret: string) {
    this.#uid = uid;
    this.#secret = secret;
  }

  async #fetchToken(): Promise<Token> {
    const res = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.#uid, client_secret: this.#secret }),
    });
    if (!res.ok) throw new FtApiError(res.status, `42 token request failed (${res.status}): check FT_UID / FT_SECRET`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    return { value: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
  }

  async #getToken(force = false): Promise<string> {
    if (!force && this.#token && this.#token.expiresAt > Date.now()) return this.#token.value;
    // One refresh at a time, shared by concurrent callers.
    this.#tokenPromise ??= this.#fetchToken().finally(() => (this.#tokenPromise = undefined));
    this.#token = await this.#tokenPromise;
    return this.#token.value;
  }

  /** Runs `task` after the previous queued call, at least MIN_GAP_MS after it started. */
  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(async () => {
      const wait = this.#lastCall + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.#lastCall = Date.now();
      return task();
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  /**
   * A student photo from 42's CDN (it refuses requests without a 42 session or token). Not queued:
   * the CDN isn't the API and doesn't count toward its limit.
   */
  async image(url: string): Promise<{ type: string; data: Buffer }> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${await this.#getToken(attempt > 0)}` } });
      if (res.ok) return { type: res.headers.get('content-type') ?? '', data: Buffer.from(await res.arrayBuffer()) };
      if (res.status === 401 && attempt < 1) continue;
      throw new FtApiError(res.status, `42 CDN ${url} → ${res.status}`);
    }
  }

  /** GET a v2 path (e.g. `/v2/users/mtaheri`) as JSON. Throws FtApiError on failure. */
  get<T>(path: string): Promise<T> {
    // Retries happen inside the queued task (re-queueing from inside it would deadlock).
    return this.#enqueue(async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await this.#getToken(attempt > 0)}` } });
        if (res.ok) return (await res.json()) as T;
        if ((res.status === 401 || res.status === 429) && attempt < 2) {
          if (res.status === 429) await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 1) * 1000));
          continue;
        }
        throw new FtApiError(res.status, `42 API ${path} → ${res.status}`);
      }
    });
  }
}
