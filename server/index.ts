// Intra Reimagined API: a small, dependency-free server between the extension and 42's API.
// The extension never sees the 42 app secret; it only gets the few fields it shows.
//
//   GET /v1/users/:login/piscine      →  { login, month: "november", year: "2025" }
//   GET /v1/users/:login/evaluations[?with=<you>]  →  { login, total, failed, outstanding, refreshedAt,
//                                                      together?: { with, youEvaluatedThem, theyEvaluatedYou } }
//   GET /v1/users/:login/outstanding  →  { login, projects: { "<slug>": n }, refreshedAt }: outstanding flags they got
//   GET /v1/users/:login/family       →  patronage family tree: ancestors and descendants (family.ts)
//   GET /v1/patronages                →  every patronage family at the viewer's campus (family.ts)
//   GET /v1/piscines/:campusId/:year/:month  →  { campusId, year, month, students: [{ login, name, image, active }] }
//   GET /health                       →  { ok: true }
//   GET /auth/start, /auth/callback   →  login with 42 (auth.ts); every /v1 route needs its Bearer token
//   GET /v1/users/:login/banner, PUT|DELETE /v1/me/banner, GET /banners/<hash>.<ext>  →  custom banners (banners.ts)
//   GET /v1/users/:login/pins, PUT /v1/me/pins  →  { pins: ["Bonus Hunter 4", …] }: up to 2 pinned achievements
//   GET /install, /updates.json, /xpi/<file>, /chrome/<file>  →  extension installs and updates (releases.ts)
//
// Piscines never change: memory → Postgres (DATABASE_URL, optional) → 42 API, saved on the way back.
// Run: node index.ts (Node 23.6+ runs TypeScript directly), or docker compose up. Config: .env.example.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { FtApi, FtApiError } from './ft-api.ts';
import { TtlCache } from './cache.ts';
import { RateLimiter } from './rate-limit.ts';
import { Db, type Piscine } from './db.ts';
import { EvalService } from './evals.ts';
import { MONTHS, PiscineService } from './piscines.ts';
import { serveRelease } from './releases.ts';
import { Auth } from './auth.ts';
import { FamilyService } from './family.ts';
import { OutstandingService } from './outstanding.ts';
import { CampusMembers } from './campus.ts';
import { BannerError, MAX_BYTES, MIME, bannerPath, processUpload, readBody, serveBanner, type ImageType } from './banners.ts';

const envFile = new URL('.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { FT_UID, FT_SECRET } = process.env;
if (!FT_UID || !FT_SECRET) {
  console.error('Missing FT_UID / FT_SECRET (create an app at https://profile.intra.42.fr/oauth/applications/new).');
  process.exit(1);
}
const { AUTH_SECRET, PUBLIC_URL } = process.env;
if (!AUTH_SECRET || AUTH_SECRET.length < 32 || !PUBLIC_URL) {
  console.error('Missing AUTH_SECRET (32+ random chars, e.g. `openssl rand -hex 32`) / PUBLIC_URL (e.g. https://intra.mthan.dev).');
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
const limiter = new RateLimiter(60, 60_000); // per signed-in login: 60 requests / minute
const authLimiter = new RateLimiter(20, 60_000); // per client IP, for the login routes
const uploadLimiter = new RateLimiter(10, 3_600_000); // per login: banner changes per hour
const imageLimiter = new RateLimiter(300, 60_000); // per client IP, for /banners/ images
const auth = new Auth(FT_UID, FT_SECRET, AUTH_SECRET, PUBLIC_URL);

const db = process.env.DATABASE_URL ? new Db(process.env.DATABASE_URL) : undefined;
if (db) await db.init();
else console.warn('No DATABASE_URL: data is only cached in memory.');
const evals = new EvalService(api, db);
const outstanding = new OutstandingService(api, db);
const piscines = new PiscineService(api, db);
const family = new FamilyService(api, db);
const campusMembers = new CampusMembers(api, db);

async function getPiscine(login: string): Promise<Piscine | null> {
  const hit = piscineCache.get(login);
  if (hit !== undefined) return hit;

  const stored = await db?.getPiscine(login);
  if (stored && stored.campusId !== null) {
    piscineCache.set(login, stored, 30 * DAY);
    return stored;
  }

  try {
    const u = await api.get<{
      login: string;
      pool_month: string | null;
      pool_year: string | null;
      campus_users?: { campus_id: number; is_primary: boolean }[];
    }>(`/v2/users/${encodeURIComponent(login)}`);
    const campusId = u.campus_users?.find((c) => c.is_primary)?.campus_id ?? u.campus_users?.[0]?.campus_id ?? null;
    const value = { login: u.login, month: u.pool_month, year: u.pool_year, campusId };
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
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }
  // Only the banner and pins routes take writes; everything else is read-only.
  const write = req.method === 'PUT' || req.method === 'DELETE';
  if (req.method !== 'GET' && !(write && (url.pathname === '/v1/me/banner' || url.pathname === '/v1/me/pins'))) {
    req.resume();
    return send(res, 405, { error: 'method not allowed' });
  }
  if (serveRelease(url.pathname, req, res)) return;
  if (url.pathname === '/health') {
    try {
      await db?.ping();
      return send(res, 200, { ok: true });
    } catch {
      return send(res, 503, { ok: false, error: 'database unreachable' });
    }
  }

  if (url.pathname.startsWith('/auth/')) {
    if (!authLimiter.take(clientIp(req))) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });
    if (await auth.handle(url, res)) return;
  }

  if (url.pathname.startsWith('/banners/')) {
    if (!imageLimiter.take(clientIp(req))) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });
    const load = async (hash: string) => {
      const row = await db?.getBannerData(hash);
      return row && row.type in MIME ? { type: row.type as ImageType, data: row.data } : undefined;
    };
    try {
      if (await serveBanner(url.pathname, res, load)) return;
    } catch (e) {
      console.error(e);
      return send(res, 503, { error: 'unavailable' });
    }
    return send(res, 404, { error: 'not found' });
  }

  const bm = url.pathname.match(/^\/v1\/users\/([a-z0-9-]{1,32})\/banner$/i);
  if (bm || url.pathname === '/v1/me/banner') {
    const me = auth.verify(req);
    if (!me) {
      req.resume();
      return send(res, 401, { error: 'login with 42 required' });
    }
    if (!limiter.take(me)) {
      req.resume();
      return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });
    }
    if (!db) {
      req.resume();
      return send(res, 503, { error: 'banners need the database' });
    }
    try {
      if (bm) {
        const b = await db.getBannerOf(bm[1].toLowerCase());
        const url = b && b.type in MIME ? bannerPath(b.hash, b.type as ImageType) : null;
        // no-cache: a changed banner must show right away (the image itself is cached forever by hash).
        return send(res, 200, { url }, { 'Cache-Control': 'private, no-cache' });
      }
      if (req.method === 'GET') return send(res, 405, { error: 'method not allowed' });
      if (!uploadLimiter.take(me)) {
        req.resume();
        return send(res, 429, { error: 'Too many banner changes; try again in an hour.' }, { 'Retry-After': '3600' });
      }
      if (req.method === 'DELETE') {
        await db.deleteBanner(me);
        return send(res, 200, { url: null });
      }
      const img = processUpload(await readBody(req, MAX_BYTES));
      await db.saveBanner(me, img.hash, img.type, img.data);
      return send(res, 200, { url: bannerPath(img.hash, img.type) });
    } catch (e) {
      if (e instanceof BannerError) {
        // The body may be unread (too big): answer, then drop the connection instead of draining it.
        res.on('finish', () => req.socket.destroy());
        return send(res, e.status, { error: e.message }, { Connection: 'close' });
      }
      console.error(e);
      return send(res, 500, { error: 'could not save the banner' });
    }
  }

  const pinsOf = url.pathname.match(/^\/v1\/users\/([a-z0-9-]{1,32})\/pins$/i);
  if (pinsOf || url.pathname === '/v1/me/pins') {
    const me = auth.verify(req);
    if (!me) {
      req.resume();
      return send(res, 401, { error: 'login with 42 required' });
    }
    if (!limiter.take(me)) {
      req.resume();
      return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });
    }
    if (!db) {
      req.resume();
      return send(res, 503, { error: 'pins need the database' });
    }
    try {
      if (pinsOf) return send(res, 200, { pins: await db.getPins(pinsOf[1].toLowerCase()) }, { 'Cache-Control': 'private, no-cache' });
      if (req.method !== 'PUT') {
        req.resume();
        return send(res, 405, { error: 'method not allowed' });
      }
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req, 2048)).toString('utf8'));
      } catch {
        return send(res, 400, { error: 'expected JSON' });
      }
      const pins = (body as { pins?: unknown })?.pins;
      // Names of achievements, as intra shows them: short plain text, at most two, no duplicates.
      if (!Array.isArray(pins) || pins.length > 2 || !pins.every((p) => typeof p === 'string' && p.trim() && p.length <= 100 && !/[<>]/.test(p))) {
        return send(res, 400, { error: 'pins: up to 2 achievement names' });
      }
      const clean = [...new Set(pins.map((p: string) => p.trim()))];
      await db.savePins(me, clean);
      return send(res, 200, { pins: clean });
    } catch (e) {
      if (e instanceof BannerError) {
        res.on('finish', () => req.socket.destroy());
        return send(res, e.status, { error: e.message }, { Connection: 'close' });
      }
      console.error(e);
      return send(res, 500, { error: 'could not save pins' });
    }
  }

  if (url.pathname === '/v1/patronages') {
    const me = auth.verify(req);
    if (!me) return send(res, 401, { error: 'login with 42 required' });
    if (!limiter.take(me)) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });
    try {
      const campusId = (await getPiscine(me))?.campusId;
      if (!campusId) return send(res, 404, { error: 'unknown campus' });
      const all = await family.among(await campusMembers.get(campusId));
      return send(res, 200, { campusId, ...all }, { 'Cache-Control': 'private, max-age=600' });
    } catch (e) {
      console.error(e);
      return send(res, 502, { error: '42 API unavailable' });
    }
  }

  const pm = url.pathname.match(/^\/v1\/piscines\/(\d{1,6})\/(\d{4})\/([a-z]+)$/);
  const m = url.pathname.match(/^\/v1\/users\/([a-z0-9-]{1,32})\/(piscine|evaluations|family|outstanding)$/i);
  if (!m && !(pm && MONTHS.includes(pm[3]))) return send(res, 404, { error: 'not found' });

  const me = auth.verify(req);
  if (!me) return send(res, 401, { error: 'login with 42 required' });
  if (!limiter.take(me)) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });

  if (pm) {
    try {
      const list = await piscines.get(Number(pm[1]), pm[2], pm[3]);
      return send(res, 200, list, { 'Cache-Control': 'private, max-age=3600' });
    } catch (e) {
      console.error(e);
      return send(res, 502, { error: '42 API unavailable' });
    }
  }
  if (!m) return;

  const login = m[1].toLowerCase();
  try {
    if (m[2] === 'family') return send(res, 200, await family.get(login), { 'Cache-Control': 'private, max-age=600' });
    if (m[2] === 'outstanding') return send(res, 200, await outstanding.get(login), { 'Cache-Control': 'private, max-age=600' });
    if (m[2] === 'piscine') {
      const piscine = await getPiscine(login);
      if (!piscine) return send(res, 404, { error: 'unknown login' });
      // Let the browser cache it too: a piscine date doesn't change.
      return send(res, 200, piscine, { 'Cache-Control': 'private, max-age=86400' });
    }
    const { partners: _, ...stats } = await evals.get(login); // the partner table stays on the server
    const viewer = url.searchParams.get('with')?.toLowerCase();
    const together = viewer && viewer !== login && /^[a-z0-9-]{1,32}$/.test(viewer) ? await evals.together(login, viewer) : undefined;
    send(res, 200, { ...stats, together }, { 'Cache-Control': 'private, max-age=600' });
  } catch (e) {
    if (e instanceof FtApiError && e.status === 404) return send(res, 404, { error: 'unknown login' });
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
