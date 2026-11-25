// Login with 42: only 42 students can use the /v1 API. The OAuth dance happens here (the app
// secret never leaves the server); at the end we hand the extension our own signed token by
// redirecting back to the intra page it came from, with the token in the URL fragment.
//
//   GET /auth/start?state=<nonce>&return=<url>  →  302 to 42's authorize page
//   GET /auth/callback?code&state               →  302 to <url>#ir-auth=<token>&ir-state=<nonce>
// <url> is an intra page (the extension) or our own /friends page (friends-page.ts).
//
// Token: "<login>.<expiry ms>.<HMAC-SHA256 of both, base64url>". Stateless; rotate AUTH_SECRET to
// sign everyone out.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const FT = 'https://api.intra.42.fr';
const TOKEN_TTL = 30 * 86_400_000;
const LOGIN = /^[a-z0-9-]{1,32}$/;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

export class Auth {
  readonly #uid: string;
  readonly #secret: string;
  readonly #key: string;
  readonly #callback: string;
  readonly #origin: string;

  constructor(uid: string, secret: string, key: string, publicUrl: string) {
    this.#uid = uid;
    this.#secret = secret;
    this.#key = key;
    this.#callback = `${publicUrl.replace(/\/+$/, '')}/auth/callback`;
    this.#origin = new URL(publicUrl).origin;
  }

  #sign(payload: string) {
    return createHmac('sha256', this.#key).update(payload).digest('base64url');
  }

  issue(login: string): string {
    const payload = `${login}.${Date.now() + TOKEN_TTL}`;
    return `${payload}.${this.#sign(payload)}`;
  }

  /** The login a request's `Authorization: Bearer` token was issued to, or undefined. */
  verify(req: IncomingMessage): string | undefined {
    const m = String(req.headers.authorization ?? '').match(/^Bearer ([a-z0-9-]{1,32})\.(\d{13})\.([A-Za-z0-9_-]{43})$/);
    if (!m || Number(m[2]) < Date.now()) return undefined;
    const want = Buffer.from(this.#sign(`${m[1]}.${m[2]}`));
    const got = Buffer.from(m[3]);
    return want.length === got.length && timingSafeEqual(want, got) ? m[1] : undefined;
  }

  /** Handles /auth/* routes; returns false for anything else. */
  async handle(url: URL, res: ServerResponse): Promise<boolean> {
    if (url.pathname === '/auth/start') {
      const nonce = url.searchParams.get('state') ?? '';
      const back = this.#backUrl(url.searchParams.get('return'));
      if (!NONCE.test(nonce) || !back) return text(res, 400, 'Bad login link.'), true;
      const q = new URLSearchParams({
        client_id: this.#uid,
        redirect_uri: this.#callback,
        response_type: 'code',
        scope: 'public',
        state: Buffer.from(JSON.stringify({ nonce, back })).toString('base64url'),
      });
      return redirect(res, `${FT}/oauth/authorize?${q}`), true;
    }
    if (url.pathname === '/auth/callback') {
      let state: { nonce?: unknown; back?: unknown };
      try {
        state = JSON.parse(Buffer.from(url.searchParams.get('state') ?? '', 'base64url').toString());
      } catch {
        state = {};
      }
      const back = this.#backUrl(typeof state.back === 'string' ? state.back : null);
      const nonce = typeof state.nonce === 'string' && NONCE.test(state.nonce) ? state.nonce : undefined;
      if (!back || !nonce) return text(res, 400, 'Bad login state.'), true;

      const done = (frag: Record<string, string>) => {
        back.hash = new URLSearchParams({ ...frag, 'ir-state': nonce }).toString();
        redirect(res, back.toString());
      };
      const code = url.searchParams.get('code');
      if (!code) return done({ 'ir-auth-error': url.searchParams.get('error') || 'denied' }), true;
      try {
        done({ 'ir-auth': this.issue(await this.#login(code)) });
      } catch (e) {
        console.error(e);
        done({ 'ir-auth-error': 'failed' });
      }
      return true;
    }
    return false;
  }

  /** Where a login may return to: an intra page, or our own /friends or /staff page (never an open redirect). */
  #backUrl(s: string | null): URL | undefined {
    const intra = intraUrl(s);
    if (intra) return intra;
    try {
      const u = new URL(s ?? '');
      return u.origin === this.#origin && (u.pathname === '/friends' || u.pathname === '/staff') ? u : undefined;
    } catch {
      return undefined;
    }
  }

  /** Exchanges an authorization code for the user's 42 login. */
  async #login(code: string): Promise<string> {
    const tok = await fetch(`${FT}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.#uid,
        client_secret: this.#secret,
        code,
        redirect_uri: this.#callback,
      }),
    });
    if (!tok.ok) throw new Error(`42 code exchange failed (${tok.status})`);
    const { access_token } = (await tok.json()) as { access_token: string };
    const me = await fetch(`${FT}/v2/me`, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!me.ok) throw new Error(`42 /v2/me failed (${me.status})`);
    const { login } = (await me.json()) as { login: string };
    if (!LOGIN.test(login)) throw new Error(`unexpected login from 42: ${login}`);
    return login;
  }
}

/** Only send people back to an intra page (never an open redirect). */
function intraUrl(s: string | null): URL | undefined {
  try {
    const u = new URL(s ?? '');
    return u.protocol === 'https:' && (u.hostname === 'intra.42.fr' || u.hostname.endsWith('.intra.42.fr')) ? u : undefined;
  } catch {
    return undefined;
  }
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function text(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
