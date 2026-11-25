// Intra Reimagined API: a small, dependency-free server between the extension and 42's API.
// The extension never sees the 42 app secret; it only gets the few fields it shows.
//
//   GET /v1/users/:login/piscine      →  { login, month: "november", year: "2025" }
//   GET /v1/users/:login/evaluations[?with=<you>]  →  { login, total, failed, outstanding, refreshedAt,
//                                                      together?: { with, youEvaluatedThem, theyEvaluatedYou, evals: [{ project, at, you }] } }
//   GET /v1/users/:login/logtime      →  { login, sessions: [[startMs, endMs|null], …], syncedAt }: all-time logtime (logtime.ts)
//   GET /v1/users/:login/events       →  { campusId, events: [{ id, name, kind, location, begin, end, subscribers, max }] }: every event at their campus (events.ts)
//   GET /v1/events/:id/users          →  { id, users: [{ login, name, image }] }: who's subscribed to an event
//   GET /v1/events/:id/feedbacks      →  { id, feedbacks: [{ login, rating, comment, at, details: { kind: 0–4 } }] }: its feedback
//   GET /v1/users/:login/outstanding  →  { login, projects: { "<slug>": n }, refreshedAt }: outstanding flags they got
//   GET /v1/users/:login/family       →  patronage family tree: ancestors and descendants (family.ts)
//   GET /v1/patronages                →  every patronage family at the viewer's campus (family.ts)
//   GET /v1/piscines/:campusId/:year/:month  →  { campusId, year, month, students: [{ login, name, image, active }] }
//   GET /health                       →  { ok: true }
//   GET /auth/start, /auth/callback   →  login with 42 (auth.ts); every /v1 route needs its Bearer token
//   GET /v1/users/:login/banner, PUT|DELETE /v1/me/banner, GET /banners/<hash>.<ext>  →  custom banners (banners.ts)
//   GET /v1/users/:login/pins, PUT /v1/me/pins  →  { pins: ["Bonus Hunter 4", …] }: up to 2 pinned achievements
//   GET /v1/users/:login/ir, PUT /v1/me/ir  →  { user, hidden?, theme? }: are they an Intra Reimagined user (badge),
//     and their theme (yours always; someone else's only if they share it)
//   GET /v1/me/friends, PUT|DELETE /v1/me/friends/:login  →  { friends: [{ login, addedAt }] }: your private
//                                     friends list (one-way: adding someone sends them nothing, and only you see it)
//   GET /v1/me/friends/stats?week=<ms>  →  { friends: { login: { name, image, photo, seat, level, wallet,
//                                     evalPoints, at, hours?: { week, total, at, last? } } } }: the friends panel's stats
//                                     (last: ms when last logged in on campus)
//   GET /install, /updates.json, /xpi/<file>, /chrome/<file>  →  extension installs and updates (releases.ts)
//   GET /friends                      →  your friends list on the web, for phones (friends-page.ts)
//
// Piscines never change: memory → Postgres (DATABASE_URL, optional) → 42 API, saved on the way back.
// Run: node index.ts (Node 23.6+ runs TypeScript directly), or docker compose up. Config: .env.example.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { FtApi, FtApiError } from './ft-api.ts';
import { TtlCache } from './cache.ts';
import { Budget, RateLimiter } from './rate-limit.ts';
import { Db, type Piscine } from './db.ts';
import { EvalService } from './evals.ts';
import { LogtimeService } from './logtime.ts';
import { FriendStatsService } from './friend-stats.ts';
import { serveFriendsPage } from './friends-page.ts';
import { serveStaffPage } from './staff-page.ts';
import { MONTHS, PiscineService } from './piscines.ts';
import { serveRelease } from './releases.ts';
import { Auth } from './auth.ts';
import { FamilyService } from './family.ts';
import { OutstandingService } from './outstanding.ts';
import { CampusMembers } from './campus.ts';
import { CampusEvents } from './events.ts';

// Theme choices the extension offers (src/theme.ts MODES / ACCENTS).
const MODES = ['dark', 'light'];
const ACCENTS = ['default', 'green', 'coalition'];
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
const MAX_FRIENDS = 100;
const api = new FtApi(FT_UID, FT_SECRET);
const piscineCache = new TtlCache<Piscine | null>(5000); // hot logins, in front of Postgres
const limiter = new RateLimiter(60, 60_000); // per signed-in login: 60 requests / minute
const authLimiter = new RateLimiter(20, 60_000); // per client IP, for the login routes
const uploadLimiter = new RateLimiter(10, 3_600_000); // per login: banner changes per hour
const imageLimiter = new RateLimiter(300, 60_000); // per client IP, for /banners/ images
const auth = new Auth(FT_UID, FT_SECRET, AUTH_SECRET, PUBLIC_URL);

const db = process.env.DATABASE_URL ? new Db(process.env.DATABASE_URL) : undefined;
if (db) await db.init();

// 42 logins allowed to read the profile view log (/staff), comma-separated.
const STAFF_LOGINS = (process.env.STAFF_LOGINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Profile view log retention: prune at start and once a day.
const VIEW_LOG_DAYS = 90;
if (db) {
  const prune = () => db.pruneProfileViews(VIEW_LOG_DAYS).catch((e) => console.error(e));
  prune();
  setInterval(prune, DAY).unref();
}
else console.warn('No DATABASE_URL: data is only cached in memory.');
const evals = new EvalService(api, db);
const logtime = new LogtimeService(api, db);
// The friends panel's share of 42's 2 requests/s (stats and logtime refreshes): about half, so
// profiles, events and the rest always have room. Logtime leaves a reserve for seats.
const friendsBudget = new Budget(1, 20);
const FRIENDS_LOGTIME_STALE_MS = 60_000;
const FRIENDS_LOGTIME_RESERVE = 5;
const friendStats = new FriendStatsService(api, friendsBudget);
const outstanding = new OutstandingService(api, db);
const piscines = new PiscineService(api, db);
const family = new FamilyService(api, db);
const campusMembers = new CampusMembers(api, db);
const campusEvents = new CampusEvents(api);

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

// ---------- student photos for /friends ----------
// 42's CDN only serves photos to a 42 session or token, so the /friends page (our own domain, often
// a phone with no intra login) gets them through here. Only links we signed are served, and only
// signed-in users get those: this is not an open mirror of 42's photos.
const CDN = 'https://cdn.intra.42.fr';
const PHOTO_PATH = /^\/users\/[a-f0-9]{32}\/[a-z0-9_.-]{1,80}\.(jpe?g|png|gif|webp)$/i;
const photoSig = (path: string) => createHmac('sha256', AUTH_SECRET!).update(`photo:${path}`).digest('base64url').slice(0, 22);
const photoCache = new TtlCache<{ type: string; data: Buffer }>(400);

/** A 42 CDN photo URL as a signed link to /photo, or undefined if it isn't one. */
function photoLink(url: string | undefined): string | undefined {
  if (!url?.startsWith(`${CDN}/`)) return undefined;
  const path = url.slice(CDN.length);
  return PHOTO_PATH.test(path) ? `/photo?${new URLSearchParams({ p: path, s: photoSig(path) })}` : undefined;
}

async function sendPhoto(url: URL, res: ServerResponse) {
  const path = url.searchParams.get('p') ?? '';
  const sig = Buffer.from(url.searchParams.get('s') ?? '');
  const want = Buffer.from(photoSig(path));
  if (!PHOTO_PATH.test(path) || sig.length !== want.length || !timingSafeEqual(sig, want)) return send(res, 403, { error: 'forbidden' });
  try {
    let img = photoCache.get(path);
    if (!img) {
      img = await api.image(`${CDN}${path}`);
      if (!/^image\/(jpeg|png|gif|webp)$/.test(img.type)) return send(res, 502, { error: 'not an image' });
      photoCache.set(path, img, DAY);
    }
    res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': String(img.data.length), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.end(img.data);
  } catch (e) {
    console.error(e);
    send(res, 502, { error: 'photo unavailable' });
  }
}

/** Hours logged since `weekStart` and in total, from [start, end|null] sessions. */
function logtimeHours(sessions: [number, number | null][], weekStart: number) {
  const now = Date.now();
  let total = 0;
  let week = 0;
  // `last`: when they were last logged in at a campus computer (now if still logged in; a session 42
  // never closed counts from its start once it's 2 days old). Absent = never.
  let last: number | undefined;
  for (const [a, b] of sessions) {
    const end = Math.min(b ?? now, now);
    total += Math.max(0, end - a);
    week += Math.max(0, end - Math.max(a, weekStart));
    const seen = b ?? (now - a < 2 * DAY ? now : a);
    if (last === undefined || seen > last) last = seen;
  }
  return { week: week / 3_600_000, total: total / 3_600_000, at: now, last };
}

// Anyone with a valid token uses the extension: remember them for the badge (at most hourly per login).
const seen = new TtlCache<true>(10_000);
function signedIn(req: IncomingMessage): string | undefined {
  const me = auth.verify(req);
  if (me && db && !seen.get(me)) {
    seen.set(me, true, DAY / 24);
    db.touchIrUser(me).catch((e) => console.error(e));
  }
  return me;
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
  // Only the banner, pins, badge and friends routes take writes; everything else is read-only.
  const write = req.method === 'PUT' || req.method === 'DELETE';
  if (req.method !== 'GET' && !(write && (url.pathname === '/v1/me/banner' || url.pathname === '/v1/me/pins' || url.pathname === '/v1/me/ir' || /^\/v1\/me\/friends\/[a-z0-9-]{1,32}$/i.test(url.pathname)))) {
    req.resume();
    return send(res, 405, { error: 'method not allowed' });
  }
  if (serveRelease(url.pathname, req, res)) return;
  if (serveFriendsPage(url.pathname, res)) return;
  if (serveStaffPage(url.pathname, res)) return;
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

  if (url.pathname === '/photo') {
    if (!imageLimiter.take(clientIp(req))) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });
    return sendPhoto(url, res);
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
    const me = signedIn(req);
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
    const me = signedIn(req);
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

  if (url.pathname === '/v1/staff/views') {
    const me = signedIn(req);
    if (!me) return send(res, 401, { error: 'login with 42 required' });
    if (!STAFF_LOGINS.includes(me)) return send(res, 403, { error: 'staff only' });
    if (!db) return send(res, 503, { error: 'the view log needs the database' });
    const pick = (k: string) => {
      const v = url.searchParams.get(k)?.trim().toLowerCase();
      return v && /^[a-z0-9-]{1,32}$/.test(v) ? v : undefined;
    };
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 1000);
    try {
      const views = await db.listProfileViews({ viewer: pick('viewer'), viewed: pick('viewed'), limit });
      return send(res, 200, { views }, { 'Cache-Control': 'no-store' });
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: 'could not read the view log' });
    }
  }

  const irOf = url.pathname.match(/^\/v1\/users\/([a-z0-9-]{1,32})\/ir$/i);
  if (irOf || url.pathname === '/v1/me/ir') {
    const me = signedIn(req);
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
      return send(res, 503, { error: 'the badge needs the database' });
    }
    try {
      if (irOf) {
        const login = irOf[1].toLowerCase();
        if (login !== me) db.logProfileView(me, login).catch((e) => console.error(e));
        const row = await db.getIrUser(login);
        // Someone who hid it still sees their own state (for the settings toggle).
        const theme = row && { mode: row.mode ?? 'dark', accent: row.accent ?? 'default' };
        const body =
          login === me
            ? { user: true, hidden: row?.hidden ?? false, theme: { ...(theme ?? { mode: 'dark', accent: 'default' }), share: row?.shareTheme ?? true, saved: !!row?.mode || !!row?.accent } }
            : { user: !!row && !row.hidden, theme: row?.shareTheme && (row.mode || row.accent) ? theme : undefined };
        return send(res, 200, body, { 'Cache-Control': 'private, max-age=600' });
      }
      if (req.method !== 'PUT') {
        req.resume();
        return send(res, 405, { error: 'method not allowed' });
      }
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req, 256)).toString('utf8'));
      } catch {
        return send(res, 400, { error: 'expected JSON' });
      }
      const b = (body ?? {}) as { hidden?: unknown; mode?: unknown; accent?: unknown; shareTheme?: unknown };
      if (b.hidden !== undefined && typeof b.hidden !== 'boolean') return send(res, 400, { error: 'hidden: true or false' });
      if (b.mode !== undefined && !MODES.includes(b.mode as string)) return send(res, 400, { error: `mode: ${MODES.join(' or ')}` });
      if (b.accent !== undefined && !ACCENTS.includes(b.accent as string)) return send(res, 400, { error: `accent: ${ACCENTS.join(' or ')}` });
      if (b.shareTheme !== undefined && typeof b.shareTheme !== 'boolean') return send(res, 400, { error: 'shareTheme: true or false' });
      if (b.hidden === undefined && b.mode === undefined && b.accent === undefined && b.shareTheme === undefined)
        return send(res, 400, { error: 'nothing to save' });
      if (typeof b.hidden === 'boolean') await db.setIrHidden(me, b.hidden);
      if (b.mode !== undefined || b.accent !== undefined || b.shareTheme !== undefined)
        await db.setIrTheme(me, { mode: b.mode as string | undefined, accent: b.accent as string | undefined, shareTheme: b.shareTheme as boolean | undefined });
      return send(res, 200, { user: true });
    } catch (e) {
      if (e instanceof BannerError) {
        res.on('finish', () => req.socket.destroy());
        return send(res, e.status, { error: e.message }, { Connection: 'close' });
      }
      console.error(e);
      return send(res, 500, { error: 'could not save' });
    }
  }

  // Everything the friends panel shows for your whole list in one go (friend-stats.ts), plus logtime
  // this week (since `week`: the start of the viewer's Monday, in ms) and all time.
  if (url.pathname === '/v1/me/friends/stats') {
    req.resume();
    const me = signedIn(req);
    if (!me) return send(res, 401, { error: 'login with 42 required' });
    if (!limiter.take(me)) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });
    if (!db) return send(res, 503, { error: 'friends need the database' });
    const week = Number(url.searchParams.get('week'));
    const weekStart = Number.isFinite(week) && week > 0 ? week : Date.now() - 7 * DAY;
    try {
      const list = (await db.getFriends(me)).map((f) => f.login);
      const [stats, hours] = await Promise.all([
        friendStats.get(list),
        // Logtime is kept per student (logtime.ts); someone never synced before can take a while:
        // left out this time rather than holding up the panel.
        Promise.all(
          list.map((l) =>
            Promise.race([logtime.get(l, FRIENDS_LOGTIME_STALE_MS, () => friendsBudget.take(1, FRIENDS_LOGTIME_RESERVE)), new Promise<undefined>((r) => setTimeout(r, 1500))]).then(
              (t): [string, ReturnType<typeof logtimeHours> | undefined] => [l, t ? logtimeHours(t.sessions, weekStart) : undefined],
              (): [string, undefined] => [l, undefined],
            ),
          ),
        ),
      ]);
      // ?photos=proxy (the /friends page): photos as signed links through /photo (see photoLink).
      const proxy = url.searchParams.get('photos') === 'proxy';
      const friends: Record<string, unknown> = {};
      for (const [l, h] of hours) {
        const s = stats[l];
        friends[l] = s && proxy ? { ...s, image: photoLink(s.image), photo: photoLink(s.photo), hours: h } : { ...s, hours: h };
      }
      return send(res, 200, { friends }, { 'Cache-Control': 'private, no-cache' });
    } catch (e) {
      console.error(e);
      return send(res, 502, { error: '42 API unavailable' });
    }
  }

  const friendOf = url.pathname.match(/^\/v1\/me\/friends\/([a-z0-9-]{1,32})$/i);
  if (friendOf || url.pathname === '/v1/me/friends') {
    req.resume(); // no body on any of these
    const me = signedIn(req);
    if (!me) return send(res, 401, { error: 'login with 42 required' });
    if (!limiter.take(me)) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });
    if (!db) return send(res, 503, { error: 'friends need the database' });
    const list = async () => ({ friends: await db.getFriends(me) });
    try {
      if (!friendOf) return send(res, 200, await list(), { 'Cache-Control': 'private, no-cache' });
      if (req.method === 'GET') return send(res, 405, { error: 'method not allowed' });
      const login = friendOf[1].toLowerCase();
      if (req.method === 'DELETE') {
        await db.removeFriend(me, login);
        return send(res, 200, await list());
      }
      if (login === me) return send(res, 400, { error: "you can't add yourself" });
      // Only real students (cached: 42 is asked once per login, ever).
      if (!(await getPiscine(login))) return send(res, 404, { error: 'unknown login' });
      if (!(await db.addFriend(me, login, MAX_FRIENDS))) return send(res, 409, { error: `at most ${MAX_FRIENDS} friends` });
      return send(res, 200, await list());
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: 'could not update friends' });
    }
  }

  if (url.pathname === '/v1/patronages') {
    const me = signedIn(req);
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

  const em = url.pathname.match(/^\/v1\/events\/(\d{1,9})\/(users|feedbacks)$/);
  if (em) {
    const me = signedIn(req);
    if (!me) return send(res, 401, { error: 'login with 42 required' });
    if (!limiter.take(me)) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '60' });
    try {
      const id = Number(em[1]);
      if (em[2] === 'feedbacks') return send(res, 200, { id, feedbacks: await campusEvents.feedbacks(id) }, { 'Cache-Control': 'private, max-age=300' });
      return send(res, 200, { id, users: await campusEvents.users(id) }, { 'Cache-Control': 'private, max-age=300' });
    } catch (e) {
      if (e instanceof FtApiError && e.status === 404) return send(res, 404, { error: 'unknown event' });
      console.error(e);
      return send(res, 502, { error: '42 API unavailable' });
    }
  }

  const pm = url.pathname.match(/^\/v1\/piscines\/(\d{1,6})\/(\d{4})\/([a-z]+)$/);
  const m = url.pathname.match(/^\/v1\/users\/([a-z0-9-]{1,32})\/(piscine|evaluations|family|outstanding|logtime|events)$/i);
  if (!m && !(pm && MONTHS.includes(pm[3]))) return send(res, 404, { error: 'not found' });

  const me = signedIn(req);
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
    if (m[2] === 'logtime') return send(res, 200, await logtime.get(login), { 'Cache-Control': 'private, max-age=300' });
    if (m[2] === 'events') {
      const campusId = (await getPiscine(login))?.campusId;
      if (!campusId) return send(res, 404, { error: 'unknown campus' });
      return send(res, 200, { campusId, events: await campusEvents.get(campusId) }, { 'Cache-Control': 'private, max-age=600' });
    }
    if (m[2] === 'outstanding') return send(res, 200, await outstanding.get(login), { 'Cache-Control': 'private, max-age=600' });
    if (m[2] === 'piscine') {
      const piscine = await getPiscine(login);
      if (!piscine) return send(res, 404, { error: 'unknown login' });
      // Let the browser cache it too: a piscine date doesn't change.
      return send(res, 200, piscine, { 'Cache-Control': 'private, max-age=86400' });
    }
    const { partners: _, partnerEvals: __, ...stats } = await evals.get(login); // the partner tables stay on the server
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
