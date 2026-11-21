// Friends: a private, one-way list of students you follow (adding someone sends them nothing; only
// you see your list). Kept on our server (server: /v1/me/friends) so it follows you across devices.
// A side panel (a sheet above the bottom bar on phones), opened from the sidebar tools (every page
// starts with it closed), shows
// each friend's seat, level, wallet, eval points, days to their next deadline and logtime.
//
// Their stats come straight from intra with your own session (and logtime from our server), in
// parts that change at different speeds, each refreshed on its own schedule while the panel is
// open and the tab is visible (see STALE). The last values are kept in extension storage, so the
// panel opens filled in on any intra page and updates in place.
import { setHTML } from './html';
import { myLogin } from './me';
import { openClusters } from './clusters';
import { fetchFriends, fetchLogtimeSessions, saveFriend } from './profile/data';

const HOST = 'ir-friends';
const PROFILE = 'https://profile.intra.42.fr';
const STATS_KEY = 'friendStats';
const TICK_MS = 60_000;
const PARALLEL = 2; // friends fetched at once, so a long list doesn't flood intra
const MIN = 60_000;

/** How old each part may get while the panel is open. */
const STALE = { light: 3 * MIN, heavy: 30 * MIN, pace: 6 * 60 * MIN, hours: 10 * MIN } as const;
type Part = keyof typeof STALE;

interface Light { name: string; image?: string; seat?: string; level?: number; at: number }
interface Heavy { wallet?: string; evalPoints?: string; at: number }
interface Pace { kind: 'milestone' | 'blackhole' | 'frozen' | 'done' | 'none'; days?: number; date?: string; at: number }
interface Hours { week: number; total: number; at: number }
interface Stats { light?: Light; heavy?: Heavy; pace?: Pace; hours?: Hours }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- extension storage (shared by every intra site) ----------

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
const storage = ((globalThis as { browser?: { storage: { local: StorageArea } } }).browser ??
  (globalThis as { chrome?: { storage: { local: StorageArea } } }).chrome)?.storage.local;

const load = async <T>(key: string): Promise<T | undefined> => {
  try {
    return (await storage?.get(key))?.[key] as T | undefined;
  } catch {
    return undefined;
  }
};
const save = (key: string, value: unknown) => void storage?.set({ [key]: value }).catch(() => {});

// ---------- the list ----------

let friends: string[] | undefined;
let listPromise: Promise<string[] | undefined> | undefined;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

function loadList(force = false) {
  if (!listPromise || force) {
    listPromise = fetchFriends().then((r) => {
      if (Array.isArray(r)) friends = r;
      changed();
      return friends;
    });
  }
  return listPromise;
}

async function setFriend(login: string, add: boolean): Promise<string | undefined> {
  const r = await saveFriend(login.toLowerCase(), add);
  if ('error' in r) return r.error;
  friends = r.friends;
  changed();
  if (add) void refresh([login.toLowerCase()], true);
  return undefined;
}

/** The ＋/✓ button on someone's profile header (hero.ts). */
export function bindFriendButton(btn: HTMLButtonElement, login: string) {
  login = login.toLowerCase();
  const paint = () => {
    const on = !!friends?.includes(login);
    btn.classList.toggle('on', on);
    btn.disabled = !friends;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Remove from friends' : 'Add to friends');
    setHTML(btn, svg(on ? 'friendOn' : 'friendAdd'));
  };
  paint();
  listeners.add(paint);
  void loadList();
  btn.addEventListener('click', async () => {
    const on = !!friends?.includes(login);
    btn.disabled = true;
    const err = await setFriend(login, !on);
    btn.disabled = false;
    if (err) alert(err);
    else if (!on) toast(`${login} added to your friends`);
    paint();
  });
}

// ---------- stats ----------

let stats: Record<string, Stats> = {};
let statsLoaded: Promise<void> | undefined;
const inflight = new Set<string>();

const fetchJson = async <T>(url: string): Promise<T | undefined> => {
  try {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json; charset=utf-8' } });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
};

/** /users/<login> as JSON (what intra's own hover card uses): name, photo, seat, levels. */
async function getLight(login: string): Promise<Light | undefined> {
  const r = await fetchJson<{
    login: string;
    usual_full_name?: string;
    full_name?: string;
    location?: string | null;
    image?: { link?: string; versions?: { small?: string; medium?: string } };
    cursus?: Record<string, { level?: number }>[];
  }>(`${PROFILE}/users/${encodeURIComponent(login)}?ams=true`);
  if (!r) return undefined;
  const levels = Object.fromEntries((r.cursus ?? []).flatMap((c) => Object.entries(c)).map(([k, v]) => [k, v?.level]));
  const nums = Object.values(levels).filter((n): n is number => typeof n === 'number');
  return {
    name: r.usual_full_name || r.full_name || login,
    image: r.image?.versions?.small ?? r.image?.versions?.medium ?? r.image?.link ?? undefined,
    seat: r.location || undefined,
    level: typeof levels['42cursus'] === 'number' ? levels['42cursus'] : nums.length ? Math.max(...nums) : undefined,
    at: Date.now(),
  };
}

/** Wallet and eval points are only on the full profile page (~400 KB), hence the slow schedule. */
async function getHeavy(login: string): Promise<Heavy | undefined> {
  try {
    const res = await fetch(`${PROFILE}/users/${encodeURIComponent(login)}`, { credentials: 'include', headers: { Accept: 'text/html' } });
    if (!res.ok) return undefined;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const txt = (s: string) => doc.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
    return {
      wallet: txt('.user-wallet-value')?.replace(/\s*₳$/, ''),
      evalPoints: txt('.user-correction-point-value > div') ?? txt('.user-correction-point-value'),
      at: Date.now(),
    };
  } catch {
    return undefined;
  }
}

/** Days to the next pace milestone (or the old blackhole, or the end of a freeze). */
async function getPace(login: string): Promise<Pace | undefined> {
  const g = await fetchJson<{
    next_milestone_days?: number;
    next_milestone?: string;
    singularity?: number;
    bh_date?: string;
    agu?: number;
    agu_date?: string;
    cc_validated?: boolean;
  }>(`${PROFILE}/users/${encodeURIComponent(login)}/goals?cursus=42cursus`);
  const at = Date.now();
  if (!g) return { kind: 'none', at };
  if (typeof g.agu === 'number' && g.agu > 0) return { kind: 'frozen', days: g.agu, date: g.agu_date, at };
  if (typeof g.next_milestone_days === 'number') return { kind: 'milestone', days: g.next_milestone_days, date: g.next_milestone, at };
  if (typeof g.singularity === 'number') return { kind: 'blackhole', days: g.singularity, date: g.bh_date, at };
  if (g.cc_validated) return { kind: 'done', at };
  return { kind: 'none', at };
}

/** This week (since Monday, local time) and all time, from every session our server has. */
async function getHours(login: string): Promise<Hours | undefined> {
  const sessions = await fetchLogtimeSessions(login);
  if (!sessions) return undefined;
  const now = Date.now();
  const d = new Date();
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
  let total = 0;
  let week = 0;
  for (const [a, b] of sessions) {
    const end = Math.min(b ?? now, now);
    total += Math.max(0, end - a);
    week += Math.max(0, end - Math.max(a, monday));
  }
  return { week: week / 3_600_000, total: total / 3_600_000, at: now };
}

const GETTERS: Record<Part, (login: string) => Promise<Stats[Part] | undefined>> = {
  light: getLight,
  heavy: getHeavy,
  pace: getPace,
  hours: getHours,
};

/** The stats saved last time, so the panel opens filled in. */
const loadStats = () => (statsLoaded ??= load<Record<string, Stats>>(STATS_KEY).then((s) => void (stats = { ...(s ?? {}), ...stats })));

/** Refreshes whatever is stale for these friends (everything, if forced), PARALLEL at a time. */
async function refresh(logins: string[], force = false) {
  await loadStats();
  const jobs: [string, Part][] = [];
  for (const login of logins) {
    for (const part of Object.keys(STALE) as Part[]) {
      const at = stats[login]?.[part]?.at ?? 0;
      if ((force || Date.now() - at > STALE[part]) && !inflight.has(`${login}:${part}`)) jobs.push([login, part]);
    }
  }
  // One friend's parts together, so rows fill in one at a time.
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [login, part] = job;
      const key = `${login}:${part}`;
      inflight.add(key);
      try {
        const value = await GETTERS[part](login);
        if (value) (stats[login] ??= {})[part] = value as never;
      } finally {
        inflight.delete(key);
      }
      if (!queue.some(([l]) => l === login)) {
        save(STATS_KEY, stats);
        render();
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  lastRefresh = Date.now();
  render();
}

// ---------- the panel ----------

let host: HTMLElement | undefined;
let open = false;
let timer: ReturnType<typeof setInterval> | undefined;
let lastRefresh = 0;
let error = '';

/** Called once per page (content.ts). The panel starts closed; the sidebar button opens it. */
export function initFriends() {
  listeners.add(render);
  document.addEventListener('visibilitychange', () => {
    if (open && !document.hidden) void tick();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) setOpen(false);
  });
}

export const toggleFriends = () => setOpen(!open);

function setOpen(on: boolean) {
  open = on;
  document.documentElement.classList.toggle('ir-friends-open', on);
  document.getElementById('ir-friends-tool')?.classList.toggle('on', on);
  clearInterval(timer);
  if (on) {
    mount();
    render();
    void tick();
    timer = setInterval(() => void tick(), TICK_MS);
  } else {
    host?.remove();
    host = undefined;
  }
}

/** The list and saved stats always (cheap); fresh stats from intra only while you can see them. */
async function tick(force = false) {
  if (!open) return;
  const [list] = await Promise.all([loadList(force), loadStats()]);
  render();
  if (list && !document.hidden) await refresh(list, force);
}

function mount() {
  if (host) return;
  host = document.createElement(HOST);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const panel = document.createElement('aside');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'Friends');
  setHTML(panel, `
    <header>
      <h2>${svg('friends')} Friends <span class="count"></span></h2>
      <span class="ago"></span>
      <button class="icon" data-act="refresh" aria-label="Refresh" title="Refresh now">${svg('refresh')}</button>
      <button class="icon" data-act="close" aria-label="Close" title="Close (Esc)">${svg('close')}</button>
    </header>
    <form class="add">
      <input name="login" placeholder="Add a login…" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="32">
      <button type="submit">Add</button>
    </form>
    <p class="error" hidden></p>
    <div class="list"></div>
    <p class="note">Only you see this list. Adding someone doesn’t notify them.</p>`);
  root.append(style, panel);
  document.body.append(host);

  panel.querySelector('[data-act="close"]')!.addEventListener('click', () => setOpen(false));
  const refreshBtn = panel.querySelector<HTMLButtonElement>('[data-act="refresh"]')!;
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('spin');
    await tick(true);
    refreshBtn.classList.remove('spin');
  });
  const form = panel.querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.elements.namedItem('login') as HTMLInputElement;
    const login = input.value.trim().toLowerCase();
    if (!login) return;
    if (login === myLogin()) return showError("That's you.");
    input.disabled = true;
    const err = await setFriend(login, true);
    input.disabled = false;
    showError(err ?? '');
    if (!err) input.value = '';
    input.focus();
  });
  panel.querySelector('.list')!.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const seat = t.closest<HTMLElement>('[data-seat]');
    if (seat) {
      e.preventDefault();
      openClusters(seat.dataset.seat);
      return;
    }
    const rm = t.closest<HTMLElement>('[data-remove]');
    if (rm) {
      e.preventDefault();
      showError((await setFriend(rm.dataset.remove!, false)) ?? '');
    }
  });
}

function showError(msg: string) {
  error = msg;
  const p = host?.shadowRoot?.querySelector<HTMLElement>('.error');
  if (p) {
    p.textContent = msg;
    p.hidden = !msg;
  }
}

const fmtH = (h: number) => (h >= 100 ? Math.round(h).toLocaleString('en-GB') : h >= 10 ? String(Math.round(h)) : h.toFixed(1).replace(/\.0$/, ''));

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

function paceHtml(p?: Pace) {
  if (!p) return '<span class="v muted">…</span>';
  if (p.kind === 'done') return '<span class="v ok" title="Common core validated">✓ done</span>';
  if (p.kind === 'none' || p.days === undefined) return '<span class="v muted" title="No deadline">—</span>';
  const tone = p.kind === 'frozen' ? 'frozen' : p.days < 0 ? 'bad' : p.days < 7 ? 'bad' : p.days < 14 ? 'warn' : '';
  const what = p.kind === 'frozen' ? 'Freeze ends' : p.kind === 'blackhole' ? 'Blackhole' : 'Next milestone';
  const label = p.kind === 'frozen' ? `❄ ${p.days}d` : p.days < 0 ? `${-p.days}d late` : `${p.days}d`;
  return `<span class="v ${tone}" title="${esc(`${what}${p.date ? ` · ${p.date}` : ''} (${p.days} days)`)}">${esc(label)}</span>`;
}

function rowHtml(login: string) {
  const s = stats[login] ?? {};
  const l = s.light;
  const seat = l?.seat;
  const img = l?.image && /^https:\/\//.test(l.image) ? l.image : undefined;
  return `
    <a class="row" href="${PROFILE}/users/${esc(login)}">
      <span class="pic ${seat ? 'on' : ''}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : esc(login[0].toUpperCase())}</span>
      <span class="who">
        <span class="top">
          <b>${esc(login)}</b>
          ${seat ? `<button class="seat" data-seat="${esc(seat)}" title="Show on the clusters map">${esc(seat)}</button>` : `<span class="off">${l ? 'offline' : ''}</span>`}
        </span>
        <span class="name">${esc(l?.name ?? '')}</span>
        <span class="stats">
          <span title="Level"><i>Lvl</i><span class="v">${l?.level !== undefined ? l.level.toFixed(2) : '…'}</span></span>
          <span title="Wallet"><i>₳</i><span class="v">${esc(s.heavy?.wallet ?? '…')}</span></span>
          <span title="Evaluation points"><i>Ev</i><span class="v">${esc(s.heavy?.evalPoints ?? '…')}</span></span>
          <span><i>Left</i>${paceHtml(s.pace)}</span>
        </span>
        <span class="hours">${s.hours ? `<span title="Logtime since Monday">${fmtH(s.hours.week)}h this week</span><span title="All-time logtime">${fmtH(s.hours.total)}h all time</span>` : ''}</span>
      </span>
      <button class="rm" data-remove="${esc(login)}" aria-label="Remove ${esc(login)}" title="Remove from friends">${svg('close')}</button>
    </a>`;
}

/** On campus first, then the closest deadline first. */
function sorted(list: string[]) {
  const days = (l: string) => {
    const p = stats[l]?.pace;
    return p?.kind === 'milestone' || p?.kind === 'blackhole' ? (p.days ?? 1e9) : 1e9;
  };
  return [...list].sort((a, b) => Number(!!stats[b]?.light?.seat) - Number(!!stats[a]?.light?.seat) || days(a) - days(b) || a.localeCompare(b));
}

function render() {
  const root = host?.shadowRoot;
  if (!root) return;
  const list = root.querySelector<HTMLElement>('.list')!;
  root.querySelector('.count')!.textContent = friends ? String(friends.length) : '';
  // Before this page's first refresh: how old the saved stats are.
  const saved = Math.max(0, ...(friends ?? []).map((l) => stats[l]?.light?.at ?? 0));
  const updated = lastRefresh || saved;
  root.querySelector('.ago')!.textContent = updated ? `updated ${ago(updated)}` : '';
  if (!friends) {
    setHTML(list, `<p class="empty">${listPromise ? 'Loading…' : ''}</p>`);
    return;
  }
  if (!friends.length) {
    setHTML(list, '<p class="empty">No friends yet. Add a login above, or use the ＋ button on someone’s profile.</p>');
    return;
  }
  const order = sorted(friends);
  const here = order.filter((l) => stats[l]?.light?.seat);
  const away = order.filter((l) => !stats[l]?.light?.seat);
  setHTML(
    list,
    (here.length ? `<h3>On campus · ${here.length}</h3>${here.map(rowHtml).join('')}` : '') +
      (away.length ? `<h3>Away · ${away.length}</h3>${away.map(rowHtml).join('')}` : ''),
  );
  showError(error);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string) {
  let t = document.getElementById('ir-friends-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ir-friends-toast';
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.classList.remove('on'), 2200);
}

// ---------- icons ----------

const PATHS = {
  friends: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.3c1.6.7 2.6 2.3 3 4.7"/>',
  friendAdd: '<circle cx="10" cy="8" r="3.2"/><path d="M4 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M19 8v6M16 11h6"/>',
  friendOn: '<circle cx="10" cy="8" r="3.2"/><path d="M4 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="m16 11 2 2 4-4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
export const svg = (name: keyof typeof PATHS) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

const CSS = `
:host { all: initial; }
.panel {
  position: fixed; z-index: 2500; top: 12px; right: 12px; bottom: 12px; width: 340px;
  display: flex; flex-direction: column; overflow: hidden;
  background: rgba(20, 22, 29, 0.96); backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 18px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  font: 14px/1.35 futura-pt, Futura, 'Trebuchet MS', system-ui, sans-serif; color: #f2f4f7;
  --muted: rgba(242, 244, 247, 0.62); --faint: rgba(242, 244, 247, 0.4); --line: rgba(255, 255, 255, 0.08); --accent: #00babc;
  animation: in 0.16s ease-out;
}
@keyframes in { from { opacity: 0; transform: translateX(12px); } }
header { display: flex; align-items: center; gap: 6px; padding: 14px 12px 10px 18px; }
h2 { margin: 0; flex: 1; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
h2 svg { color: var(--accent); }
.count { color: var(--faint); letter-spacing: 0; }
.ago { font-size: 11.5px; color: var(--faint); margin-right: 2px; }
button { font: inherit; color: inherit; cursor: pointer; }
.icon { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 9px; background: none; color: var(--muted); }
.icon:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
.icon.spin svg { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.add { display: flex; gap: 6px; padding: 0 14px 10px; }
.add input {
  flex: 1; min-width: 0; height: 34px; padding: 0 12px; border-radius: 10px; font: inherit; color: inherit;
  background: rgba(255, 255, 255, 0.05); border: 1px solid var(--line); outline: none;
}
.add input:focus { border-color: rgba(0, 186, 188, 0.6); }
.add input::placeholder { color: var(--faint); }
.add button { height: 34px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--accent); color: #061314; font-weight: 600; }
.add button:hover { background: #2ee6e8; }
.error { margin: -4px 16px 8px; font-size: 12.5px; color: #ff8a8a; }
.list { flex: 1; overflow-y: auto; padding: 0 8px 8px; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.15) transparent; }
h3 { margin: 10px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.empty { margin: 18px 10px; color: var(--muted); font-size: 13px; }
.row { position: relative; display: flex; gap: 12px; padding: 10px; border-radius: 12px; color: inherit; text-decoration: none; }
.row:hover { background: rgba(255, 255, 255, 0.045); }
.pic {
  position: relative; flex: none; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
  background: #2a2d38; color: var(--muted); font-weight: 600;
}
.pic img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.pic.on::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: #3ddc84; box-shadow: 0 0 0 2.5px rgb(20, 22, 29); }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.top { display: flex; align-items: center; gap: 8px; }
.top b { font-weight: 600; font-size: 14.5px; }
.seat { margin-left: auto; padding: 1px 8px; border: 0; border-radius: 999px; font-size: 12px; background: rgba(61, 220, 132, 0.14); color: #6ee7a8; }
.seat:hover { background: rgba(61, 220, 132, 0.26); }
.off { margin-left: auto; font-size: 12px; color: var(--faint); }
.name { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats { display: grid; grid-template-columns: repeat(4, auto); justify-content: start; gap: 2px 14px; margin-top: 6px; }
.stats > span { display: flex; flex-direction: column; }
.stats i { font-style: normal; font-size: 10.5px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.05em; }
.v { font-size: 14px; font-weight: 600; }
.v.muted { color: var(--faint); font-weight: 400; }
.v.ok { color: #3ddc84; }
.v.warn { color: #ffb454; }
.v.bad { color: #ff7a7a; }
.v.frozen { color: #8ecbff; }
.hours { display: flex; gap: 12px; margin-top: 4px; font-size: 11.5px; color: var(--faint); }
.rm {
  position: absolute; top: 8px; right: 8px; display: none; place-items: center; width: 24px; height: 24px; padding: 0;
  border: 0; border-radius: 7px; background: rgba(20, 22, 29, 0.9); color: var(--faint);
}
.row:hover .rm, .rm:focus-visible { display: grid; }
.row:hover .seat, .row:hover .off { visibility: hidden; }
.rm:hover { color: #ff8a8a; background: rgba(255, 122, 122, 0.12); }
.rm svg { width: 14px; height: 14px; }
.note { margin: 0; padding: 10px 18px 14px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--faint); }

/* Phones: a sheet above the bottom bar. */
@media (max-width: 767px) {
  .panel { top: auto; left: 8px; right: 8px; width: auto; bottom: calc(76px + env(safe-area-inset-bottom)); max-height: 72vh; }
  .rm { display: grid; }
  .row .seat, .row .off { visibility: visible !important; margin-right: 28px; }
}
`;
