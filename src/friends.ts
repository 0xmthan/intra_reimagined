// Friends: a private, one-way list of students you follow (adding someone sends them nothing; only
// you see your list). Kept on our server (server: /v1/me/friends) so it follows you across devices.
// A side panel next to the left sidebar (the whole screen above the bottom bar on phones), opened from the sidebar tools (every page
// starts with it closed), shows
// each friend's seat, level, wallet, eval points, logtime and, for anyone on the blackhole system
// (probation), the days to that deadline.
//
// Their stats come from our server for the whole list in one request (name, photo, seat, level,
// wallet, eval points, logtime: server/friend-stats.ts), so every row updates at once. Only the
// days to the next milestone are read from intra with your own session, friend by friend (42's
// API doesn't have them), on a slow schedule. Each part is refreshed while the panel is open and
// the tab is visible (see STALE). The last values are kept in extension storage, so the panel
// opens filled in on any intra page and updates in place.
import { setHTML } from './html';
import { myLogin } from './me';
import { openClusters } from './clusters';
import { primeUserTip } from './user-tooltip';
import { fetchFriendStats, fetchFriends, saveFriend } from './profile/data';

const HOST = 'ir-friends';
const PROFILE = 'https://profile.intra.42.fr';
const STATS_KEY = 'friendStats';
const TICK_MS = 60_000;
const PARALLEL = 2; // friends whose milestone days are fetched from intra at once
const MIN = 60_000;

/** How old each part may get while the panel is open: `server` = everything from our server. */
const STALE = { server: 3 * MIN, pace: 6 * 60 * MIN } as const;

/** `photo`/`groups`: what the hover card shows (handed to it, see primeUserTip). */
interface Light { name: string; image?: string; photo?: string; groups?: string[]; seat?: string; level?: number; at: number }
interface Heavy { wallet?: string; evalPoints?: string; at: number }
/** `probation`: on the blackhole system, where missing the deadline blackholes you (only then is it shown). */
interface Pace { kind: 'milestone' | 'blackhole' | 'frozen' | 'done' | 'none'; days?: number; date?: string; probation?: boolean; at: number }
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
    probationary_period?: boolean;
  }>(`${PROFILE}/users/${encodeURIComponent(login)}/goals?cursus=42cursus`);
  const at = Date.now();
  if (!g) return { kind: 'none', probation: false, at };
  if (typeof g.agu === 'number' && g.agu > 0) return { kind: 'frozen', days: g.agu, date: g.agu_date, probation: false, at };
  if (typeof g.next_milestone_days === 'number')
    return { kind: 'milestone', days: g.next_milestone_days, date: g.next_milestone, probation: !!g.probationary_period, at };
  if (typeof g.singularity === 'number') return { kind: 'blackhole', days: g.singularity, date: g.bh_date, probation: true, at };
  if (g.cc_validated) return { kind: 'done', probation: false, at };
  return { kind: 'none', probation: false, at };
}

/** The start of this week (Monday 00:00, local time), for "this week" logtime. */
function mondayStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
}

let serverAt = 0;
let serverInflight: Promise<void> | undefined;

/** Everything our server knows for the whole list, in one request; rows update together. */
function refreshFromServer(): Promise<void> {
  serverInflight ??= fetchFriendStats(mondayStart())
    .then((all) => {
      if (!all) return;
      serverAt = Date.now();
      for (const [login, x] of Object.entries(all)) {
        const s = (stats[login] ??= {});
        if (x.at) {
          s.light = { name: x.name, image: x.image, photo: x.photo, groups: s.light?.groups, seat: x.seat, level: x.level, at: x.at };
          s.heavy = { wallet: x.wallet === undefined ? undefined : String(x.wallet), evalPoints: x.evalPoints === undefined ? undefined : String(x.evalPoints), at: x.at };
        }
        if (x.hours) s.hours = x.hours;
      }
      save(STATS_KEY, stats);
      render();
    })
    .finally(() => (serverInflight = undefined));
  return serverInflight;
}

/** The stats saved last time, so the panel opens filled in. */
const loadStats = () => (statsLoaded ??= load<Record<string, Stats>>(STATS_KEY).then((s) => void (stats = { ...(s ?? {}), ...stats })));

/** Refreshes whatever is stale for these friends (everything, if forced). */
async function refresh(logins: string[], force = false) {
  await loadStats();
  // Someone added since the last server answer has nothing yet: ask again.
  const unseen = logins.some((l) => !stats[l]?.light);
  const server = force || unseen || Date.now() - serverAt > STALE.server ? refreshFromServer() : undefined;
  // Milestone days: from intra, friend by friend, PARALLEL at a time (they change slowly).
  const queue = logins.filter((login) => {
    const p = stats[login]?.pace;
    const at = p && p.probation !== undefined ? p.at : 0; // saved before probation was recorded: fetch again
    return (force || Date.now() - at > STALE.pace) && !inflight.has(login);
  });
  const worker = async () => {
    for (let login = queue.shift(); login; login = queue.shift()) {
      inflight.add(login);
      try {
        const value = await getPace(login);
        if (value) (stats[login] ??= {}).pace = value;
      } finally {
        inflight.delete(login);
      }
      save(STATS_KEY, stats);
      render();
    }
  };
  await Promise.all([server, ...Array.from({ length: PARALLEL }, worker)]);
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
    removeEventListener('resize', placePanel);
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
      <input name="login" placeholder="Add a login…" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="32"
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ir-friend-suggest">
      <button type="submit">Add</button>
      <ul class="suggest" id="ir-friend-suggest" role="listbox" hidden></ul>
    </form>
    <p class="error" hidden></p>
    <div class="list"></div>`);
  root.append(style, panel);
  document.body.append(host);
  placePanel();

  panel.querySelector('[data-act="close"]')!.addEventListener('click', () => setOpen(false));
  const refreshBtn = panel.querySelector<HTMLButtonElement>('[data-act="refresh"]')!;
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('spin');
    await tick(true);
    refreshBtn.classList.remove('spin');
  });
  const form = panel.querySelector('form')!;
  const input = form.elements.namedItem('login') as HTMLInputElement;
  const suggest = bindSuggestions(input, form.querySelector<HTMLUListElement>('.suggest')!, (login) => add(login));
  const add = async (raw: string) => {
    const login = raw.trim().toLowerCase();
    if (!login) return;
    if (login === myLogin()) return showError("That's you.");
    suggest.close();
    input.disabled = true;
    const err = await setFriend(login, true);
    input.disabled = false;
    showError(err ?? '');
    if (!err) input.value = '';
    input.focus();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void add(suggest.picked() ?? input.value);
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

// ---------- suggestions while typing (intra's own search, as in the ⌘K palette) ----------

interface Suggestion { login: string; img?: string }

/** Logins matching what's typed, from intra's search (with your session); [] on any failure. */
async function searchLogins(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  try {
    const res = await fetch(`${PROFILE}/searches/search.json?query=${encodeURIComponent(query)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) return [];
    const users = (await res.json()) as { login?: unknown; cdn_uri?: unknown }[];
    return users
      .filter((u): u is { login: string; cdn_uri?: unknown } => typeof u?.login === 'string' && /^[a-z0-9-]{1,32}$/.test(u.login))
      .map((u) => ({ login: u.login, img: typeof u.cdn_uri === 'string' && /^https:\/\//.test(u.cdn_uri) ? u.cdn_uri : undefined }));
  } catch {
    return [];
  }
}

/** A dropdown under the add box: ↑/↓ to move, Enter or click to add, Esc to close it. */
function bindSuggestions(input: HTMLInputElement, list: HTMLUListElement, pick: (login: string) => void) {
  let items: Suggestion[] = [];
  let active = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ctrl: AbortController | undefined;
  const me = myLogin();

  const close = () => {
    ctrl?.abort();
    clearTimeout(timer);
    items = [];
    active = -1;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
  };
  const paint = () => {
    if (!items.length) return close();
    setHTML(
      list,
      items
        .map((u, i) => {
          const have = !!friends?.includes(u.login);
          return `<li role="option" id="ir-sg-${i}" class="${i === active ? 'on' : ''}${have ? ' have' : ''}" data-login="${esc(u.login)}" aria-selected="${i === active}">
            <span class="sg-pic">${u.img ? `<img src="${esc(u.img)}" alt="" loading="lazy">` : esc(u.login[0].toUpperCase())}</span>
            <span class="sg-login">${esc(u.login)}</span>
            ${have ? '<span class="sg-tag">added</span>' : ''}
          </li>`;
        })
        .join(''),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `ir-sg-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    ctrl?.abort();
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      const found = await searchLogins(q, ctrl.signal);
      if (input.value.trim().toLowerCase() !== q) return; // typed on since
      items = found.filter((u) => u.login !== me).slice(0, 6);
      active = items.findIndex((u) => !friends?.includes(u.login)); // first one you can add
      paint();
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) {
      e.stopPropagation(); // close the list, not the panel
      close();
      return;
    }
    if (list.hidden || !items.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    paint();
  });
  input.addEventListener('blur', () => setTimeout(close, 150)); // after a click on an item
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the box
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-login]');
    if (li && !li.classList.contains('have')) pick(li.dataset.login!);
  });

  return {
    close,
    /** The highlighted suggestion (if you can still add it), for Enter. */
    picked: () => (!list.hidden && active >= 0 && !friends?.includes(items[active]?.login) ? items[active].login : undefined),
  };
}

/** Keeps the panel just right of the sidebar (its width differs between layouts). */
function placePanel() {
  if (!host) return;
  const side = document.querySelector('.main-left-navbar')?.getBoundingClientRect();
  // On phones the sidebar is the bottom bar: nothing to clear on the left.
  const right = side && side.height > innerHeight / 2 ? Math.max(0, Math.round(side.right)) : 0;
  host.style.setProperty('--side', `${right}px`);
  addEventListener('resize', placePanel);
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
      <span class="pic ${seat ? 'on' : ''}" data-tooltip-login="${esc(login)}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : esc(login[0].toUpperCase())}</span>
      <span class="who">
        <span class="top">
          <b>${esc(login)}</b>
          <span class="lvl" title="Level">Lvl <b>${l?.level !== undefined ? l.level.toFixed(2) : '…'}</b></span>
          ${seat ? `<button class="seat" data-seat="${esc(seat)}" title="Show on the clusters map">${esc(seat)}</button>` : ''}
        </span>
        <span class="name">${esc(l?.name ?? '')}</span>
        <span class="stats">
          <span title="Wallet"><span class="v">${esc(s.heavy?.wallet ?? '…')}</span><i>₳</i></span>
          <span title="Evaluation points"><span class="v">${esc(s.heavy?.evalPoints ?? '…')}</span><i>Evp</i></span>
          ${s.pace?.probation ? `<span><i>Blackhole</i>${paceHtml(s.pace)}</span>` : ''}
        </span>
        <span class="hours">${s.hours ? `<span title="Logtime since Monday">${fmtH(s.hours.week)}h this week</span><span title="All-time logtime">${fmtH(s.hours.total)}h all time</span>` : ''}</span>
      </span>
      <button class="rm" data-remove="${esc(login)}" aria-label="Remove ${esc(login)}" title="Remove from friends">${svg('close')}</button>
    </a>`;
}

/** On campus first, then by level, highest first (not loaded yet: last). */
function sorted(list: string[]) {
  const level = (l: string) => stats[l]?.light?.level ?? -1;
  return [...list].sort((a, b) => Number(!!stats[b]?.light?.seat) - Number(!!stats[a]?.light?.seat) || level(b) - level(a) || a.localeCompare(b));
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
  for (const l of order) {
    const x = stats[l]?.light;
    // The hover card needs their groups too: hand it what we have only when we know them.
    if (x?.groups) primeUserTip({ login: l, name: x.name, image: x.photo ?? x.image, location: x.seat, groups: x.groups });
  }
  const heading = (text: string) => {
    const h = document.createElement('h3');
    h.textContent = text;
    return h;
  };
  list.replaceChildren(
    ...(here.length ? [heading(`On campus · ${here.length}`), ...here.map(row)] : []),
    ...(away.length ? [heading(`Off campus · ${away.length}`), ...away.map(row)] : []),
  );
  showError(error);
}

/** Rows are reused while their content is the same, so a refresh doesn't swap out the one you're
 * hovering (its hover card would lose its target). */
const rows = new Map<string, { html: string; el: Element }>();
function row(login: string) {
  const html = rowHtml(login);
  const kept = rows.get(login);
  if (kept?.html === html) return kept.el;
  const box = document.createElement('div');
  setHTML(box, html);
  const el = box.firstElementChild!;
  rows.set(login, { html, el });
  return el;
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
  /* Next to the left sidebar, where its button is (--side: where the sidebar ends, see placePanel). */
  position: fixed; z-index: 2500; top: 12px; left: calc(var(--side, 0px) + 12px); bottom: 12px; width: 340px; max-width: calc(100vw - var(--side, 0px) - 24px);
  display: flex; flex-direction: column; overflow: hidden;
  /* Glass: the page shows through, heavily blurred. */
  background: var(--ir-glass); backdrop-filter: blur(28px) saturate(1.4); -webkit-backdrop-filter: blur(28px) saturate(1.4);
  border: 1px solid rgba(var(--ir-ink), 0.09); border-radius: 18px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  font: 14px/1.35 futura-pt, Futura, 'Trebuchet MS', system-ui, sans-serif; color: var(--ir-text);
  --muted: rgba(var(--ir-ink-text), 0.62); --faint: rgba(var(--ir-ink-text), 0.4); --line: rgba(var(--ir-ink), 0.08); --accent: var(--ir-accent);
  animation: in 0.16s ease-out;
}
@keyframes in { from { opacity: 0; transform: translateX(-12px); } }
header { display: flex; align-items: center; gap: 6px; padding: 14px 12px 10px 18px; }
h2 { margin: 0; flex: 1; display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
h2 svg { color: var(--accent); }
.count { color: var(--faint); letter-spacing: 0; }
.ago { font-size: 11.5px; color: var(--faint); margin-right: 2px; }
button { font: inherit; color: inherit; cursor: pointer; }
.icon { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 9px; background: none; color: var(--muted); }
.icon:hover { background: rgba(var(--ir-ink), 0.07); color: var(--ir-text); }
.icon.spin svg { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.add { position: relative; display: flex; gap: 6px; padding: 0 14px 10px; }
.suggest {
  position: absolute; z-index: 3; top: 38px; left: 14px; right: 14px; margin: 0; padding: 4px; list-style: none;
  background: rgba(var(--ir-glass-rgb), 0.97); border: 1px solid rgba(var(--ir-ink), 0.1); border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}
.suggest li { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 9px; cursor: pointer; }
.suggest li.on, .suggest li:hover { background: rgba(var(--ir-accent-rgb), 0.16); }
.suggest li.have { cursor: default; opacity: 0.55; }
.suggest li.have:hover { background: none; }
.sg-pic { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--ir-surface-3); color: var(--muted); font-size: 12px; font-weight: 600; overflow: hidden; }
.sg-pic img { width: 100%; height: 100%; object-fit: cover; }
.sg-login { flex: 1; font-weight: 500; }
.sg-tag { font-size: 11px; color: var(--faint); }
.add input {
  flex: 1; min-width: 0; height: 34px; padding: 0 12px; border-radius: 10px; font: inherit; color: inherit;
  background: rgba(var(--ir-ink), 0.05); border: 1px solid var(--line); outline: none;
}
.add input:focus { border-color: rgba(var(--ir-accent-rgb), 0.6); }
.add input::placeholder { color: var(--faint); }
.add button { height: 34px; padding: 0 14px; border: 0; border-radius: 10px; background: var(--accent); color: #061314; font-weight: 600; }
.add button:hover { background: var(--ir-accent-hi); }
.error { margin: -4px 16px 8px; font-size: 12.5px; color: #ff8a8a; }
.list { flex: 1; overflow-y: auto; padding: 0 8px 8px; scrollbar-width: thin; scrollbar-color: rgba(var(--ir-ink), 0.15) transparent; }
h3 { margin: 10px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.empty { margin: 18px 10px; color: var(--muted); font-size: 13px; }
.row { position: relative; display: flex; gap: 12px; padding: 10px; border-radius: 12px; color: inherit; text-decoration: none; }
.row:hover { background: rgba(var(--ir-ink), 0.045); }
.pic {
  position: relative; flex: none; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center;
  background: var(--ir-surface-3); color: var(--muted); font-weight: 600;
}
.pic img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.pic.on::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: #3ddc84; box-shadow: 0 0 0 2.5px rgba(var(--ir-glass-rgb), 0.85); }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.top { display: flex; align-items: center; gap: 8px; }
.top b { font-weight: 600; font-size: 14.5px; }
.seat { margin-left: auto; padding: 1px 8px; border: 0; border-radius: 999px; font-size: 12px; background: rgba(61, 220, 132, 0.14); color: var(--ir-ok-text); }
.seat:hover { background: rgba(61, 220, 132, 0.26); }
.name { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 16px; margin-top: 5px; }
.stats > span { display: flex; align-items: baseline; gap: 4px; }
.stats i { font-style: normal; font-size: 11.5px; color: var(--faint); }
.lvl { font-size: 12.5px; color: var(--faint); }
.lvl b { font-weight: 600; color: var(--muted); }
.v { font-size: 14px; font-weight: 600; }
.v.muted { color: var(--faint); font-weight: 400; }
.v.ok { color: var(--ir-ok-text); }
.v.warn { color: #ffb454; }
.v.bad { color: #ff7a7a; }
.v.frozen { color: #8ecbff; }
.hours { display: flex; gap: 12px; margin-top: 4px; font-size: 11.5px; color: var(--faint); }
.rm {
  position: absolute; top: 8px; right: 8px; display: none; place-items: center; width: 24px; height: 24px; padding: 0;
  border: 0; border-radius: 7px; background: rgba(var(--ir-glass-rgb), 0.7); color: var(--faint);
}
.row:hover .rm, .rm:focus-visible { display: grid; }
.row:hover .seat { visibility: hidden; }
.rm:hover { color: #ff8a8a; background: rgba(255, 122, 122, 0.12); }
.rm svg { width: 14px; height: 14px; }

/* Phones: the whole screen above the bottom bar (its Friends button still closes it), same glass. */
@media (max-width: 767px) {
  .panel {
    top: 0; left: 0; right: 0; width: auto; max-width: none; bottom: calc(56px + env(safe-area-inset-bottom));
    padding-top: env(safe-area-inset-top); border: 0; border-radius: 0; box-shadow: none;
    animation-name: in-up;
  }
  @keyframes in-up { from { opacity: 0; transform: translateY(12px); } }
  .rm { display: grid; }
  .row .seat { visibility: visible !important; margin-right: 28px; }
}
`;
