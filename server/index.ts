// Intra Reimagined API: a small, dependency-free server between the extension and 42's API.
// The extension never sees the 42 app secret; it only gets the few fields it shows.
//
//   GET /v1/users/:login/piscine  →  { login, month: "november", year: "2025" }
//   GET /health                   →  { ok: true }
//
// Piscines never change: memory → Postgres (DATABASE_URL, optional) → 42 API, saved on the way back.
// Run: node index.ts (Node 23.6+ runs TypeScript directly), or docker compose up. Config: .env.example.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { FtApi, FtApiError } from './ft-api.ts';
import { TtlCache } from './cache.ts';
import { RateLimiter } from './rate-limit.ts';
import { Db, type Piscine } from './db.ts';

const envFile = new URL('.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { FT_UID, FT_SECRET } = process.env;
if (!FT_UID || !FT_SECRET) {
  console.error('Missing FT_UID / FT_SECRET (create an app at https://profile.intra.42.fr/oauth/applications/new).');
  process.exit(1);
}
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
// Content scripts fetch with the intra page's origin, so these are the origins CORS has to allow.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://profile.intra.42.fr')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DAY = 86_400_000;
const api = new FtApi(FT_UID, FT_SECRET);
const piscineCache = new TtlCache<Piscine | null>(5000); // hot logins, in front of Postgres
const limiter = new RateLimiter(60, 60_000); // per client IP: 60 requests / minute

const db = process.env.DATABASE_URL ? new Db(process.env.DATABASE_URL) : undefined;
if (db) await db.init();
else console.warn('No DATABASE_URL: piscines are only cached in memory.');

async function getPiscine(login: string): Promise<Piscine | null> {
  const hit = piscineCache.get(login);
  if (hit !== undefined) return hit;

  const stored = await db?.getPiscine(login);
  if (stored) {
    piscineCache.set(login, stored, 30 * DAY);
    return stored;
  }

  try {
    const u = await api.get<{ login: string; pool_month: string | null; pool_year: string | null }>(
      `/v2/users/${encodeURIComponent(login)}`,
    );
    const value = { login: u.login, month: u.pool_month, year: u.pool_year };
    piscineCache.set(login, value, 30 * DAY);
    if (u.login !== login) piscineCache.set(u.login, value, 30 * DAY);
    await db?.savePiscine(value);
    return value;
  } catch (e) {
    if (e instanceof FtApiError && e.status === 404) {
      piscineCache.set(login, null, DAY / 24); // remember unknown logins for an hour
      return null;
    }
    throw e;
  }
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(body));
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
}

// Behind Cloudflare (tunnel) the real client is in CF-Connecting-IP; other proxies set X-Forwarded-For.
const clientIp = (req: IncomingMessage) =>
  (process.env.TRUST_PROXY
    ? String(req.headers['cf-connecting-ip'] ?? '') || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    : '') ||
  req.socket.remoteAddress ||
  'unknown';

const server = createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  if (url.pathname === '/health') {
    try {
      await db?.ping();
      return send(res, 200, { ok: true });
    } catch {
      return send(res, 503, { ok: false, error: 'database unreachable' });
    }
  }

  const m = url.pathname.match(/^\/v1\/users\/([a-z0-9-]{1,32})\/piscine$/i);
  if (!m) return send(res, 404, { error: 'not found' });

  if (!limiter.take(clientIp(req))) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });

  try {
    const piscine = await getPiscine(m[1].toLowerCase());
    if (!piscine) return send(res, 404, { error: 'unknown login' });
    // Let the browser cache it too: a piscine date doesn't change.
    send(res, 200, piscine, { 'Cache-Control': 'public, max-age=86400' });
  } catch (e) {
    console.error(e);
    send(res, 502, { error: '42 API unavailable' });
  }
});

server.listen(PORT, HOST, () => console.log(`Intra Reimagined API on http://${HOST}:${PORT}`));

// docker stop sends SIGTERM: finish in-flight requests, close the pool, exit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => db?.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
