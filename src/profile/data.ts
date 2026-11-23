// Everything the new profile header shows, read from intra's own (hidden) banner plus the same
// JSON endpoints intra's page calls. Works on your own home page and on other users' profiles.
// Interactive bits (title picker, cursus select, "give points") keep a handle on intra's original
// element so we can trigger intra's own behaviour instead of re-implementing it.
import { myLogin } from '../me';
import { dropToken, getToken } from '../auth';

export interface TitleOption {
  label: string;
  active: boolean;
  el: HTMLAnchorElement;
}

export interface HeroData {
  own: boolean;
  login: string;
  name: string;
  title: string;
  titles: TitleOption[];
  /** Custom badges next to the name (LEADER, TUTOR, ...), each with intra's own look. */
  badges: Badge[];
  avatar?: string;
  cover?: string;
  coalition?: { name: string; color: string; href?: string; score?: number; rank?: number; icon?: string };
  wallet?: string;
  evalPoints?: string;
  giveEl?: HTMLElement;
  grade?: string;
  cursus: { value: string; options: { value: string; label: string }[]; el?: HTMLSelectElement };
  level?: { level: number; pct: number; href?: string };
  location: { available: boolean; text: string };
  campus?: string;
  email?: string;
  /** When the user did the C Piscine, from their earliest piscine project (e.g. "Sep 2025"). */
  piscine?: { label: string; date: Date };
  links: { graph?: string; resume?: string; edit?: string };
}

export interface Goals {
  edtrax_weeks?: Week[];
  probationary_period?: boolean;
  next_milestone?: string; // dd.mm.yyyy
  next_milestone_days?: number;
  cc_eta?: string; // dd.mm.yyyy
  cc_validated?: boolean; // common core done (e.g. Transcender): no ETA, no milestones
  cc_eta_days?: string;
  // Old blackhole system (e.g. accounts blackholed before pace): days left, negative once absorbed.
  singularity?: number;
  bh_date?: string; // dd.mm.yyyy
  // Freeze in progress: days until it ends, and its end date (dd.mm.yyyy).
  agu?: number;
  agu_date?: string;
}

export interface Week {
  name: string;
  hours: number;
  text: string;
}

export interface CoalitionInfo {
  name?: string;
  score?: number;
  rank?: number;
  color?: string;
  icon?: string;
  cover?: string;
}

const txt = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const bgUrl = (el: Element | null | undefined) =>
  el ? getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] : undefined;

export interface Badge {
  text: string;
  background?: string; // image url
  fill?: string; // background color
  color?: string;
  stroke?: string; // -webkit-text-stroke
}

/**
 * A badge's look comes from inline styles (on the badge, and on a span inside it for text color
 * and outline). Read those, not computed styles: dark mode recolors grey text and backgrounds.
 */
function readBadge(el: HTMLElement): Badge {
  const parse = (s: string | null | undefined) => {
    const t = document.createElement('span');
    t.setAttribute('style', s ?? '');
    return t.style;
  };
  const outer = parse(el.getAttribute('style'));
  const inner = parse(el.querySelector('[style]')?.getAttribute('style'));
  return {
    text: txt(el),
    background: bgUrl(el),
    fill: outer.backgroundColor || undefined,
    color: inner.color || outer.color || undefined,
    stroke: inner.webkitTextStroke || outer.webkitTextStroke || undefined,
  };
}

export function readHero(): HeroData | undefined {
  const q = <T extends Element = Element>(s: string, root: ParentNode = document) => root.querySelector<T>(s);
  const qa = <T extends Element = Element>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)];

  const nameBox = q('.profile-item .profile-name');
  const loginEl = q<HTMLElement>('.profile-name .login[data-login]');
  const login = loginEl?.dataset.login;
  if (!nameBox || !login) return undefined;

  const me = myLogin();
  const own = location.pathname === '/' || me === login;

  const nameEl = q('.name', nameBox)?.cloneNode(true) as Element | undefined;
  nameEl?.querySelectorAll('.user-badge').forEach((b) => b.remove());
  const name = txt(nameEl) || login;

  const titles: TitleOption[] = qa<HTMLAnchorElement>('#title-selector .dropdown-menu a').map((a) => ({
    label: txt(a),
    active: !!a.closest('li')?.classList.contains('active'),
    el: a,
  }));

  const badges = qa<HTMLElement>('.profile-name .user-badge').map(readBadge).filter((b) => b.text);

  // Others' pages show their photo; your own home page only has your navbar avatar.
  const avatar = bgUrl(q('.profile-item .user-image')) ?? (own ? bgUrl(q('.user-profile-picture')) : undefined);

  const coalSpan = q<HTMLElement>('.profile-name .coalition-span');
  const coalition = coalSpan
    ? {
        name: txt(coalSpan),
        color: coalSpan.style.color || '#00babc',
        href: q<HTMLAnchorElement>('.profile-name .coalition-name a, .profile-name .user-banner a')?.href,
        score: Number(txt(q('#coalition-score .value'))) || undefined,
        rank: Number(txt(q('#coalition-rank .value'))) || undefined,
      }
    : undefined;

  const select = q<HTMLSelectElement>('.cursus-user-select');
  const cursus = {
    value: select?.value || '42cursus',
    options: qa<HTMLOptionElement>('option', select ?? document.createElement('select')).map((o) => ({ value: o.value, label: txt(o) })),
    el: select ?? undefined,
  };

  const levelEl = qa<HTMLAnchorElement>('.user-progress .progress-container').find((a) => a.dataset.cursus === cursus.value);
  const lm = txt(levelEl?.querySelector('.on-progress')).match(/level\s+(\d+)\s*-\s*(\d+)%/i);

  const status = txt(q('.user-poste-status'));
  const seat = txt(q('.user-poste-infos')).replace(/^-$/, '');
  const available = !!seat && !/unavailable/i.test(status);

  const actions = qa<HTMLAnchorElement>('.profile-name .button-actions a');

  return {
    own,
    login,
    name,
    title: titles.find((t) => t.active)?.label || txt(loginEl) || login,
    titles,
    badges,
    avatar,
    cover: bgUrl(q('.profile-item .profile-banner')),
    coalition,
    wallet: txt(q('.user-wallet-value')).replace(/\s*₳$/, '') || undefined,
    evalPoints: txt(q('.user-correction-point-value > div')) || txt(q('.user-correction-point-value')) || undefined,
    giveEl: q<HTMLElement>('.correction-point-btn') ?? undefined,
    grade: txt(q(`.user-grade[data-cursus="${cursus.value}"] .user-grade-value`)) || undefined,
    cursus,
    level: lm ? { level: Number(lm[1]), pct: Number(lm[2]), href: levelEl?.href } : undefined,
    location: { available, text: available ? seat : 'Unavailable' },
    campus: txt(q('.profile-item .icon-location')?.parentElement) || undefined,
    piscine: readPiscine(),
    email: q<HTMLAnchorElement>('.profile-item a[href^="mailto:"]')?.href.replace(/^mailto:/, '') || undefined,
    links: {
      graph: actions.find((a) => a.href.includes('graph'))?.href,
      resume: actions.find((a) => a.href.includes('resume'))?.href,
      edit: actions.find((a) => a.href.includes('/edit'))?.href,
    },
  };
}

/**
 * The profile's project list tags each project with its cursus and a date (`data-long-date`,
 * e.g. "2023-01-16 05:14:04 +0300"). The earliest C Piscine project falls in the piscine's
 * first week, which gives its month. Falls back to any piscine-like cursus.
 */
function readPiscine(root: ParentNode = document): HeroData['piscine'] {
  const items = [...root.querySelectorAll<HTMLElement>('.project-item[data-cursus]')];
  for (const re of [/(^|\s)c-piscine/, /piscine/]) {
    const dates = items
      .filter((el) => re.test(el.dataset.cursus ?? ''))
      .map((el) => el.querySelector<HTMLElement>('[data-long-date]')?.dataset.longDate)
      .map((s) => (s ? new Date(s.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2')) : undefined))
      .filter((d): d is Date => !!d && !isNaN(d.getTime()));
    if (dates.length) {
      const date = new Date(Math.min(...dates.map((d) => d.getTime())));
      return { date, label: date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) };
    }
  }
  return undefined;
}

async function getJSON<T>(url: string, withCookies = true): Promise<T | undefined> {
  try {
    const res = await fetch(url, { credentials: withCookies ? 'include' : 'omit', headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

export const fetchGoals = (login: string, cursus: string) =>
  getJSON<Goals>(`/users/${encodeURIComponent(login)}/goals?cursus=${encodeURIComponent(cursus)}`);

export async function fetchCoalition(login: string, cursus: string): Promise<CoalitionInfo | undefined> {
  const j = await getJSON<{
    coalitions_user?: { score: number; rank: number; coalition: { name: string; color: string; image_url: string; cover_url: string } };
  }>(`/users/${encodeURIComponent(login)}/coalitions?cursus=${encodeURIComponent(cursus)}`);
  const c = j?.coalitions_user;
  return c
    ? { name: c.coalition.name, score: c.score, rank: c.rank, color: c.coalition.color, icon: c.coalition.image_url, cover: c.coalition.cover_url }
    : undefined;
}

/**
 * Hours on campus for the last 4 full weeks (Mon–Sun), newest first like `edtrax_weeks`.
 * Fallback for profiles whose goals have no attendance (pisciners, blackholed accounts).
 */
export async function fetchLogtimeWeeks(login: string): Promise<Week[] | undefined> {
  const stats = await getJSON<Record<string, string>>(
    `https://translate.intra.42.fr/users/${encodeURIComponent(login)}/locations_stats.json`,
  );
  if (!stats) return undefined;
  const secs = (t: string) => t.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); // this week's Monday
  return [1, 2, 3, 4].map((ago) => {
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() - ago * 7 + i);
      total += secs(stats[iso(day)] ?? '0:0:0');
    }
    const h = Math.floor(total / 3600);
    return { name: ago === 1 ? 'Last week' : `W-${ago}`, hours: h, text: `${h}h ${Math.floor((total % 3600) / 60)}m` };
  });
}

/** Our API server (see server/), set at build time with VITE_IR_API; unset = not used. */
const IR_API = (import.meta.env.VITE_IR_API as string | undefined)?.replace(/\/+$/, '');

/** GET from our server with the login-with-42 token; 'auth' = not signed in (or signed out). */
async function irGet<T>(path: string, cache: RequestCache = 'default'): Promise<T | 'auth' | undefined> {
  const token = await getToken();
  if (!token) return 'auth';
  try {
    const res = await fetch(`${IR_API}${path}`, {
      credentials: 'omit',
      cache,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      dropToken();
      return 'auth';
    }
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

// ---------- custom banners (server/banners.ts) ----------

/** Only our server's own image paths ever reach CSS (defence in depth on top of the server). */
const BANNER_PATH = /^\/banners\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
const bannerUrl = (path: unknown) => (typeof path === 'string' && BANNER_PATH.test(path) ? `${IR_API}${path}` : null);

/** A full banner URL we built earlier (e.g. read back from a cache), or null if it isn't one. */
export const checkBannerUrl = (url: unknown) =>
  typeof url === 'string' && IR_API && url.startsWith(IR_API) ? bannerUrl(url.slice(IR_API.length)) : null;

/** Someone's custom banner image URL; null = none (use the coalition cover); undefined = unknown. */
export async function fetchBanner(login: string): Promise<string | null | undefined> {
  if (!IR_API) return undefined;
  // no-cache: a banner someone just changed must show right away (the image is cached by hash).
  const j = await irGet<{ url: unknown }>(`/v1/users/${encodeURIComponent(login)}/banner`, 'no-cache');
  return j && j !== 'auth' ? bannerUrl(j.url) : undefined;
}

export const BANNER_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const BANNER_MAX_BYTES = 10 * 1024 * 1024; // same as server/banners.ts MAX_BYTES

/** Upload a new banner (or `null` to go back to the coalition cover). Returns the new URL or an error. */
export async function saveBanner(file: File | null): Promise<{ url: string | null } | { error: string }> {
  const token = await getToken();
  if (!IR_API || !token) return { error: 'Log in with 42 first.' };
  try {
    const res = await fetch(`${IR_API}/v1/me/banner`, {
      method: file ? 'PUT' : 'DELETE',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, ...(file ? { 'Content-Type': file.type || 'application/octet-stream' } : {}) },
      body: file ?? undefined,
    });
    const j = (await res.json().catch(() => ({}))) as { url?: unknown; error?: unknown };
    if (res.status === 401) dropToken();
    if (!res.ok) return { error: typeof j.error === 'string' ? j.error : `Couldn't save (${res.status}).` };
    return { url: bannerUrl(j.url) };
  } catch {
    return { error: "Couldn't reach the server. Try again." };
  }
}

// ---------- outstanding flags per project (server: /v1/users/:login/outstanding) ----------

/** Outstanding flags `login` got, by project slug; undefined = unknown (no server, signed out). */
export async function fetchOutstanding(login: string): Promise<Record<string, number> | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ projects: unknown }>(`/v1/users/${encodeURIComponent(login)}/outstanding`);
  if (!j || j === 'auth' || typeof j.projects !== 'object' || !j.projects) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j.projects)) if (typeof v === 'number' && v > 0 && /^[\w.-]{1,80}$/.test(k)) out[k] = v;
  return out;
}

// ---------- all-time logtime (server: /v1/users/:login/logtime) ----------

/** Every session `login` spent at a campus computer, [start ms, end ms | null = still on], oldest first;
 * undefined = unknown (no server, signed out, or the server couldn't reach 42). */
export async function fetchLogtimeSessions(login: string): Promise<[number, number | null][] | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ sessions: unknown }>(`/v1/users/${encodeURIComponent(login)}/logtime`);
  if (!j || j === 'auth' || !Array.isArray(j.sessions)) return undefined;
  const ok = (v: unknown): v is [number, number | null] =>
    Array.isArray(v) && Number.isFinite(v[0]) && (v[1] === null || (Number.isFinite(v[1]) && v[1] >= v[0]));
  return j.sessions.filter(ok);
}

// ---------- campus events (server: /v1/users/:login/events) ----------

export interface CampusEvent {
  id: number;
  name: string;
  kind: string;
  location: string;
  begin: number; // ms
  end: number | null;
  subscribers: number;
  max: number | null; // null = no limit
}

/** Every event at `login`'s campus, oldest first; undefined = unknown (no server, signed out). */
export async function fetchCampusEvents(login: string): Promise<CampusEvent[] | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ events: unknown }>(`/v1/users/${encodeURIComponent(login)}/events`);
  if (!j || j === 'auth' || !Array.isArray(j.events)) return undefined;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return j.events
    .filter((e): e is Record<string, unknown> => !!e && Number.isInteger(e.id) && Number.isFinite(e.begin))
    .map((e) => ({
      id: e.id as number,
      name: str(e.name),
      kind: str(e.kind),
      location: str(e.location),
      begin: e.begin as number,
      end: Number.isFinite(e.end) ? (e.end as number) : null,
      subscribers: Number.isInteger(e.subscribers) ? (e.subscribers as number) : 0,
      max: Number.isInteger(e.max) && (e.max as number) > 0 ? (e.max as number) : null,
    }));
}

export interface EventUser {
  login: string;
  name: string;
  image?: string;
}
const eventUsers = new Map<number, Promise<EventUser[] | undefined>>();

/** Who's subscribed to an event (once per page load; a failed fetch is tried again next time). */
export function fetchEventUsers(id: number): Promise<EventUser[] | undefined> {
  let p = eventUsers.get(id);
  if (!p) {
    p = (async () => {
      if (!IR_API) return undefined;
      const j = await irGet<{ users: unknown }>(`/v1/events/${id}/users`);
      if (!j || j === 'auth' || !Array.isArray(j.users)) return undefined;
      return j.users
        .filter((u): u is Record<string, unknown> => !!u && typeof u.login === 'string' && LOGIN_RE.test(u.login))
        .map((u) => ({
          login: u.login as string,
          name: typeof u.name === 'string' ? u.name : (u.login as string),
          image: typeof u.image === 'string' && CDN_IMAGE.test(u.image) ? u.image : undefined,
        }));
    })();
    p.then((v) => v || eventUsers.delete(id));
    eventUsers.set(id, p);
  }
  return p;
}

export interface EventFeedback {
  login: string;
  rating: number; // 0–5
  comment: string;
  at: number;
  details: Record<string, number>; // interesting, pertinent, quality, accuracy → 0–4
}
const eventFeedbacks = new Map<number, Promise<EventFeedback[] | undefined>>();

/** Everyone's feedback on an event, oldest first (once per page load; failures are tried again). */
export function fetchEventFeedbacks(id: number): Promise<EventFeedback[] | undefined> {
  let p = eventFeedbacks.get(id);
  if (!p) {
    p = (async () => {
      if (!IR_API) return undefined;
      const j = await irGet<{ feedbacks: unknown }>(`/v1/events/${id}/feedbacks`);
      if (!j || j === 'auth' || !Array.isArray(j.feedbacks)) return undefined;
      const num = (v: unknown, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(0, v as number)) : 0);
      return j.feedbacks
        .filter((f): f is Record<string, unknown> => !!f && typeof f.login === 'string' && LOGIN_RE.test(f.login))
        .map((f) => ({
          login: f.login as string,
          rating: num(f.rating, 5),
          comment: typeof f.comment === 'string' ? f.comment : '',
          at: num(f.at, Number.MAX_SAFE_INTEGER),
          details: Object.fromEntries(
            Object.entries(f.details && typeof f.details === 'object' ? f.details : {})
              .filter(([k]) => /^[a-z_]{1,32}$/.test(k))
              .map(([k, v]) => [k, num(v, 4)]),
          ),
        }));
    })();
    p.then((v) => v || eventFeedbacks.delete(id));
    eventFeedbacks.set(id, p);
  }
  return p;
}

// ---------- friends (server: GET /v1/me/friends, PUT|DELETE /v1/me/friends/:login) ----------

const LOGIN_RE = /^[a-z0-9-]{1,32}$/;
const friendList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((f) => (f as { login?: unknown })?.login).filter((l): l is string => typeof l === 'string' && LOGIN_RE.test(l)) : [];

/** Your friends' logins, oldest first; 'auth' = not signed in; undefined = unknown (no server, offline). */
export async function fetchFriends(): Promise<string[] | 'auth' | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ friends: unknown }>('/v1/me/friends', 'no-cache');
  return j === 'auth' ? 'auth' : j ? friendList(j.friends) : undefined;
}

export interface FriendStat {
  name: string;
  image?: string;
  photo?: string;
  seat?: string;
  level?: number;
  wallet?: number;
  evalPoints?: number;
  at: number;
  hours?: { week: number; total: number; at: number };
}

/**
 * Stats for your whole friends list in one request (server: friend-stats.ts): name, photo, seat,
 * level, wallet, eval points and logtime (this week counts from `weekStart`, your Monday in ms).
 */
export async function fetchFriendStats(weekStart: number): Promise<Record<string, FriendStat> | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ friends?: Record<string, unknown> }>(`/v1/me/friends/stats?week=${Math.round(weekStart)}`, 'no-cache');
  if (!j || j === 'auth' || !j.friends || typeof j.friends !== 'object') return undefined;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const out: Record<string, FriendStat> = {};
  for (const [login, raw] of Object.entries(j.friends)) {
    if (!LOGIN_RE.test(login) || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const h = r.hours as Record<string, unknown> | undefined;
    const hours = h && num(h.week) !== undefined && num(h.total) !== undefined ? { week: h.week as number, total: h.total as number, at: num(h.at) ?? Date.now() } : undefined;
    if (typeof r.name !== 'string') {
      if (hours) out[login] = { name: login, at: 0, hours }; // logtime only (42 didn't answer for them)
      continue;
    }
    out[login] = {
      name: r.name,
      // Only 42's own image host reaches the page.
      image: str(r.image)?.startsWith('https://') ? (r.image as string) : undefined,
      photo: str(r.photo)?.startsWith('https://') ? (r.photo as string) : undefined,
      seat: str(r.seat),
      level: num(r.level),
      wallet: num(r.wallet),
      evalPoints: num(r.evalPoints),
      at: num(r.at) ?? Date.now(),
      hours,
    };
  }
  return out;
}

/** Adds or removes a friend; the new list, or a message to show. Nothing is sent to them. */
export async function saveFriend(login: string, add: boolean): Promise<{ friends: string[] } | { error: string }> {
  const token = await getToken();
  if (!IR_API || !token) return { error: 'Log in with 42 to keep a friends list.' };
  if (!LOGIN_RE.test(login)) return { error: 'That isn’t a 42 login.' };
  try {
    const res = await fetch(`${IR_API}/v1/me/friends/${encodeURIComponent(login)}`, {
      method: add ? 'PUT' : 'DELETE',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = (await res.json().catch(() => ({}))) as { friends?: unknown; error?: unknown };
    if (res.status === 401) dropToken();
    if (res.status === 404) return { error: `No student called ${login}.` };
    if (!res.ok) return { error: typeof j.error === 'string' ? j.error[0].toUpperCase() + j.error.slice(1) + '.' : `Couldn't save (${res.status}).` };
    return { friends: friendList(j.friends) };
  } catch {
    return { error: "Couldn't reach the server. Try again." };
  }
}

// ---------- Intra Reimagined users (server: /v1/users/:login/ir, /v1/me/ir) ----------

export interface IrTheme {
  mode: string;
  accent: string;
  /** Yours only: do visitors see it, and did you ever save one. */
  share?: boolean;
  saved?: boolean;
}

/**
 * Whether `login` uses the extension, and their theme (someone else's only if they share it).
 * For yourself, also whether you hid the badge. undefined = unknown.
 */
export async function fetchIrUser(login: string): Promise<{ user: boolean; hidden?: boolean; theme?: IrTheme } | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ user: unknown; hidden?: unknown; theme?: Record<string, unknown> }>(`/v1/users/${encodeURIComponent(login)}/ir`, 'no-cache');
  if (!j || j === 'auth') return undefined;
  const t = j.theme;
  const theme =
    t && typeof t.mode === 'string' && typeof t.accent === 'string'
      ? { mode: t.mode, accent: t.accent, share: typeof t.share === 'boolean' ? t.share : undefined, saved: t.saved === true }
      : undefined;
  return { user: j.user === true, hidden: typeof j.hidden === 'boolean' ? j.hidden : undefined, theme };
}

/** Saves your theme (any of mode, accent, shareTheme) on the server; returns an error message on failure. */
export async function saveIrTheme(t: { mode?: string; accent?: string; shareTheme?: boolean }): Promise<{ error?: string }> {
  const token = await getToken();
  if (!IR_API || !token) return { error: 'Log in with 42 first.' };
  try {
    const res = await fetch(`${IR_API}/v1/me/ir`, {
      method: 'PUT',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    });
    if (res.status === 401) dropToken();
    return res.ok ? {} : { error: `Couldn't save (${res.status}).` };
  } catch {
    return { error: "Couldn't reach the server. Try again." };
  }
}

/** Hides (or shows again) your badge; returns an error message on failure. */
export async function saveIrHidden(hidden: boolean): Promise<{ error?: string }> {
  const token = await getToken();
  if (!IR_API || !token) return { error: 'Log in with 42 first.' };
  try {
    const res = await fetch(`${IR_API}/v1/me/ir`, {
      method: 'PUT',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden }),
    });
    if (res.status === 401) dropToken();
    return res.ok ? {} : { error: `Couldn't save (${res.status}).` };
  } catch {
    return { error: "Couldn't reach the server. Try again." };
  }
}

// ---------- pinned achievements (server: /v1/users/:login/pins, /v1/me/pins) ----------

const pinList = (v: unknown) => (Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string').slice(0, 2) : []);

/** The (up to 2) achievement names `login` pinned; undefined = unknown (no server, signed out). */
export async function fetchPins(login: string): Promise<string[] | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ pins: unknown }>(`/v1/users/${encodeURIComponent(login)}/pins`, 'no-cache');
  return j && j !== 'auth' ? pinList(j.pins) : undefined;
}

/** Saves your pins; returns what the server kept, or an error message. */
export async function savePins(pins: string[]): Promise<{ pins: string[] } | { error: string }> {
  const token = await getToken();
  if (!IR_API || !token) return { error: 'Log in with 42 to pin achievements.' };
  try {
    const res = await fetch(`${IR_API}/v1/me/pins`, {
      method: 'PUT',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pins }),
    });
    const j = (await res.json().catch(() => ({}))) as { pins?: unknown; error?: unknown };
    if (res.status === 401) dropToken();
    if (!res.ok) return { error: typeof j.error === 'string' ? j.error : `Couldn't save (${res.status}).` };
    return { pins: pinList(j.pins) };
  } catch {
    return { error: "Couldn't reach the server. Try again." };
  }
}

/** Official piscine month from 42's API via our server, e.g. "Nov 2025". */
export interface ApiPiscine {
  label: string; // "Nov 2025"
  month: string; // "november"
  year: string;
  campusId: number | null;
}

export async function fetchPiscine(login: string): Promise<ApiPiscine | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ month: string | null; year: string | null; campusId?: number | null }>(
    // ?v= busts browser caches of older response shapes (bump it when the response changes).
    `/v1/users/${encodeURIComponent(login)}/piscine?v=2`,
  );
  if (!j || j === 'auth' || !j.month || !j.year) return undefined;
  const date = new Date(`${j.month} 1, ${j.year}`);
  if (isNaN(date.getTime())) return undefined;
  return { label: date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), month: j.month, year: j.year, campusId: j.campusId ?? null };
}

export interface FamilyLink {
  patron: string;
  child: string;
  ongoing: boolean;
  since: string;
}
export interface Family {
  login: string;
  /** login → avatar (only https images from intra's CDN get through). */
  people: Map<string, string | undefined>;
  links: FamilyLink[];
  truncated: boolean;
}

const FAMILY_LOGIN = /^[a-z0-9-]{1,32}$/i;
const CDN_IMAGE = /^https:\/\/cdn\.intra\.42\.fr\/[^"'\\\s()]+$/;

/** Someone's patronage family (ancestors and descendants) from our server; checked field by field. */
export async function fetchFamily(login: string): Promise<Family | 'auth' | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ login?: unknown; people?: unknown; links?: unknown; truncated?: unknown }>(
    `/v1/users/${encodeURIComponent(login)}/family`,
  );
  if (!j || j === 'auth') return j;
  return checkFamily(j);
}

function checkFamily(j: { login?: unknown; people?: unknown; links?: unknown; truncated?: unknown }): Family | undefined {
  if (typeof j.login !== 'string' || !(FAMILY_LOGIN.test(j.login) || j.login === '-') || !j.people || typeof j.people !== 'object' || !Array.isArray(j.links))
    return undefined;
  const people = new Map<string, string | undefined>();
  for (const [l, v] of Object.entries(j.people as Record<string, { image?: unknown }>)) {
    if (!FAMILY_LOGIN.test(l)) continue;
    const img = v && typeof v.image === 'string' && CDN_IMAGE.test(v.image) ? v.image : undefined;
    people.set(l, img);
  }
  const links = (j.links as Record<string, unknown>[]).flatMap((x) =>
    x && typeof x.patron === 'string' && typeof x.child === 'string' && people.has(x.patron) && people.has(x.child)
      ? [{ patron: x.patron, child: x.child, ongoing: x.ongoing !== false, since: typeof x.since === 'string' ? x.since.slice(0, 10) : '' }]
      : [],
  );
  if (j.login !== '-' && !people.has(j.login)) people.set(j.login, undefined);
  return { login: j.login, people, links, truncated: j.truncated === true };
}

/** Every patronage family at your campus (people on both sides), from our server. */
export async function fetchCampusFamilies(): Promise<Pick<Family, 'people' | 'links'> | 'auth' | undefined> {
  if (!IR_API) return undefined;
  const j = await irGet<{ people?: unknown; links?: unknown }>('/v1/patronages');
  if (!j || j === 'auth') return j;
  // Same checks as fetchFamily, with a stand-in for its required login.
  const f = checkFamily({ ...j, login: '-' });
  return f && { people: f.people, links: f.links };
}

export interface PiscineStudent {
  login: string;
  name: string;
  image: string | null;
  active: boolean;
  piscineLevel?: number | null;
  /** 42cursus level; null = didn't get into the common core. */
  cursusLevel?: number | null;
  /** 42cursus blackhole date (ISO); in the past = blackholed. */
  blackholedAt?: string | null;
}

/** Everyone from one piscine (same campus, month and year), via our server. */
export async function fetchPiscineStudents(p: ApiPiscine): Promise<PiscineStudent[] | undefined> {
  if (!IR_API || p.campusId === null) return undefined;
  // ?v= busts browser caches of older response shapes (bump it when the response changes).
  const j = await irGet<{ students: PiscineStudent[] }>(`/v1/piscines/${p.campusId}/${p.year}/${p.month}?v=3`);
  return j && j !== 'auth' ? j.students : undefined;
}

/**
 * Someone's full profile page (/users/<login>), parsed. Your home page (/) lacks parts of it (all
 * finished projects, patronages, piscine projects), so home features read them from here. One
 * fetch per page load, shared by everyone who asks.
 */
const profilePages = new Map<string, Promise<Document | undefined>>();
export function fetchProfilePage(login: string): Promise<Document | undefined> {
  let p = profilePages.get(login);
  if (!p) {
    p = fetch(`/users/${encodeURIComponent(login)}`, { credentials: 'include', headers: { Accept: 'text/html' } })
      .then(async (res) => (res.ok ? new DOMParser().parseFromString(await res.text(), 'text/html') : undefined))
      .catch(() => undefined);
    profilePages.set(login, p);
  }
  return p;
}

/** Your home page (/) only lists a couple of recent projects, so the piscine ones may be missing. */
export async function fetchPiscineFromProfile(login: string): Promise<HeroData['piscine']> {
  const doc = await fetchProfilePage(login);
  return doc ? readPiscine(doc) : undefined;
}

export interface EvalStats {
  total: number;
  failed: number;
  outstanding: number;
  /** On someone else's profile: evaluations between you and them, each way. */
  together?: {
    youEvaluatedThem: number;
    theyEvaluatedYou: number;
    /** Each one, newest first: the project, when (ms), and whether you were the evaluator. */
    evals: { project: string; at: number; you: boolean }[];
  };
}

/** What this student did as an evaluator (and, with `viewer`, how often you two met), via our server. */
export async function fetchEvalStats(login: string, viewer?: string): Promise<EvalStats | 'auth' | undefined> {
  if (!IR_API) return undefined;
  const q = viewer && viewer !== login ? `?with=${encodeURIComponent(viewer)}` : '';
  const j = await irGet<EvalStats>(`/v1/users/${encodeURIComponent(login)}/evaluations${q}`);
  if (j === 'auth') return j;
  if (!j || typeof j.total !== 'number') return undefined;
  const t = j.together;
  const together = t && {
    youEvaluatedThem: t.youEvaluatedThem,
    theyEvaluatedYou: t.theyEvaluatedYou,
    evals: (Array.isArray(t.evals) ? t.evals : []).filter(
      (e) => !!e && typeof e.project === 'string' && Number.isFinite(e.at) && typeof e.you === 'boolean',
    ),
  };
  return { total: j.total, failed: j.failed, outstanding: j.outstanding, together };
}
