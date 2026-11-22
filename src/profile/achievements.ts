// Achievements card (home and /users/<login>), reworked: intra shows the last three, without dates.
// This reads the whole achievements page (/users/<login>/achievements) and shows:
//   - progress: "70 of 152", a bar, and how many per tier (bronze/silver/gold/platinum)
//   - up to two achievements the student pinned (saved on our server), above the progress
//   - every achievement earned, by rarity (each series stacked) or newest first, with its badge,
//     description, date and wallet reward; on your own page each has a pin button
// "See all achievements" opens that page in a window over this one (like Clusters; slots.ts wires it).
import { fetchPins, savePins } from './data';
import { myLogin } from '../me';

const DAY = 86_400_000;
const TIERS: Record<string, string> = { easy: 'bronze', medium: 'silver', hard: 'gold', challenge: 'platinum' };

export type Ach = {
  name: string;
  desc: string;
  img?: string;
  date?: number;
  tier?: string;
  reward?: string; // "+500₳ Title: …", as intra's tooltip says it
  wallet?: string; // "500₳"
  title?: string; // a title it gives
  kind?: string;
  series: string;
  level: number;
  done: boolean;
  ongoing: boolean; // the next levels of a series you've started
};

/** Every achievement on an achievements page (intra's #achievement-list), earned or not. */
export function parseAchievements(doc: Document | Element): Ach[] {
  return [...doc.querySelectorAll<HTMLElement>('#achievement-list > .achievement-item')].map((i): Ach => {
    const h = i.querySelector('.achievement-item--content > h1');
    const when = i.querySelector('.achieved p')?.textContent?.trim();
    const t = when ? Date.parse(when) : NaN;
    const tip = h?.querySelector('[data-toggle="tooltip"]')?.getAttribute('title') ?? h?.querySelector('[data-original-title]')?.getAttribute('data-original-title') ?? '';
    return {
      name: h?.firstChild?.textContent?.trim() ?? '',
      desc: i.querySelector('.achievement-item--content > p')?.textContent?.trim() ?? '',
      img: i.querySelector<HTMLImageElement>('.achievement-item--image img')?.getAttribute('src') ?? undefined,
      date: Number.isFinite(t) ? t : undefined,
      tier: TIERS[i.dataset.tier ?? ''],
      reward: /^Wallet/.test(tip) ? tip.replace(/^Wallet:\s*/, '+') : undefined,
      wallet: tip.match(/Wallet:\s*(\d+\s*₳)/)?.[1],
      title: tip.match(/Title:\s*(.+)$/)?.[1]?.trim(),
      kind: i.dataset.kind,
      series: i.dataset.name ?? h?.firstChild?.textContent?.trim() ?? '',
      level: Number(i.dataset.position) || 1,
      done: i.dataset.done === 'true',
      ongoing: !!i.dataset.ongoing,
    };
  });
}

const memo = new Map<string, Promise<{ done: Ach[]; total: number } | undefined>>();

function load(login: string) {
  let p = memo.get(login);
  if (p) return p;
  p = (async () => {
    const res = await fetch(`/users/${encodeURIComponent(login)}/achievements`, { credentials: 'include', headers: { Accept: 'text/html' } });
    if (!res.ok) return undefined;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const items = parseAchievements(doc);
    const done = items.filter((a) => a.done).sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
    return { done, total: items.length };
  })().catch(() => undefined);
  memo.set(login, p);
  return p;
}

export function ago(t: number) {
  const days = Math.floor((Date.now() - t) / DAY);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

type View = 'date' | 'rarity';
const VIEW_KEY = 'ir-ach-view';
const TIER_ORDER = ['platinum', 'gold', 'silver', 'bronze'];

const PIN_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

/** Pinning, when the card is yours: which names are pinned and how to toggle one. */
type Pins = { names: string[]; toggle?: (name: string) => void };
let pins: Pins = { names: [] };

function pinButton(a: Ach) {
  const b = el('button', 'ir-ach-pin');
  b.type = 'button';
  b.dataset.name = a.name;
  b.setAttribute('aria-pressed', String(pins.names.includes(a.name)));
  b.title = pins.names.includes(a.name) ? 'Unpin' : 'Pin to the top (up to 2)';
  const svg = new DOMParser().parseFromString(PIN_ICON, 'image/svg+xml').documentElement;
  b.append(document.importNode(svg, true));
  b.addEventListener('click', (e) => {
    e.stopPropagation(); // not the stack's open/close
    pins.toggle?.(a.name);
  });
  return b;
}

function row(a: Ach) {
  const r = el('div', 'ir-ach-row');
  const badge = el('div', 'ir-ach-badge');
  if (a.img) {
    const img = el('img');
    img.src = a.img;
    img.alt = '';
    badge.append(img);
  }
  const text = el('div', 'ir-ach-text');
  const name = el('div', 'ir-ach-name');
  name.append(el('span', 'ir-ach-nametext', a.name));
  if (a.tier) name.append(el('span', `ir-tier dot ${a.tier}`));
  text.append(name, el('div', 'ir-ach-desc', a.desc));
  const side = el('div', 'ir-ach-side');
  if (a.date) {
    const d = el('span', 'ir-ach-date', ago(a.date));
    d.title = new Date(a.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    side.append(d);
  }
  if (a.wallet) side.append(el('span', 'ir-ach-reward', `+${a.wallet}`)); // titles: on the full page
  r.title = a.desc;
  r.append(badge, text, side);
  if (pins.toggle) r.append(pinButton(a));
  return r;
}

/** The pinned achievements, as larger cards one above the other, with their description. */
function pinnedCards(done: Ach[]) {
  const box = el('div', 'ir-ach-pinned');
  for (const name of pins.names) {
    const a = done.find((x) => x.name === name);
    if (!a) continue;
    const card = el('div', `ir-ach-pincard ${a.tier ?? 'none'}`);
    card.title = a.desc;
    const badge = el('div', 'ir-ach-badge');
    if (a.img) {
      const img = el('img');
      img.src = a.img;
      img.alt = '';
      badge.append(img);
    }
    const text = el('div', 'ir-ach-text');
    const nm = el('div', 'ir-ach-name');
    nm.append(el('span', 'ir-ach-nametext', a.name));
    if (a.tier) nm.append(el('span', `ir-tier dot ${a.tier}`));
    text.append(nm, el('div', 'ir-ach-desc', a.desc));
    if (a.date) text.append(el('div', 'ir-ach-when', [ago(a.date), a.wallet && `+${a.wallet}`].filter(Boolean).join(' · ')));
    card.append(badge, text);
    if (pins.toggle) card.append(pinButton(a));
    box.append(card);
  }
  box.hidden = !box.childElementCount;
  return box;
}

const rank = (a: Ach) => (a.tier ? TIER_ORDER.indexOf(a.tier) : TIER_ORDER.length);

/**
 * One series (Bonus Hunter 1, 2, 3, 4… or CodinGame Challenger: Fall, Summer…) as a stack: its highest
 * level (or newest) on top, the cards under it
 * peeking out; clicking shows the levels below. A series of one is a plain row.
 */
function stack(levels: Ach[]) {
  const [top, ...rest] = levels;
  if (!rest.length) return row(top);
  const box = el('div', `ir-ach-stack ${top.tier ?? 'none'}`);
  box.dataset.depth = String(Math.min(rest.length, 2));
  const head = row(top);
  head.classList.add('ir-ach-stackhead');
  head.tabIndex = 0;
  head.setAttribute('role', 'button');
  head.setAttribute('aria-expanded', 'false');
  const leveled = new Set(levels.map((a) => a.level)).size === levels.length;
  head.querySelector('.ir-ach-name')?.append(el('span', 'ir-ach-levels', leveled ? `${levels.length} levels` : `${levels.length} earned`));
  head.append(el('i', 'ir-ach-chev'));
  const body = el('div', 'ir-ach-stackbody');
  body.hidden = true;
  const toggle = () => {
    const open = body.hidden === true;
    if (open && !body.childElementCount) body.append(...rest.map(row));
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    box.classList.toggle('open', open);
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
  box.append(head, body);
  return box;
}

/** Earned achievements grouped by series, highest level first; series ordered by rarity. */
function bySeries(done: Ach[]) {
  const groups = new Map<string, Ach[]>();
  // A series is intra's own (same data-name: Bonus Hunter 1–4) or names sharing what comes before a
  // colon (CodinGame Challenger: Fall, Summer, …).
  const key = (a: Ach) => (a.name.includes(':') ? a.name.split(':')[0].trim() : a.series);
  for (const a of done) groups.set(key(a), [...(groups.get(key(a)) ?? []), a]);
  return [...groups.values()]
    .map((g) => g.sort((a, b) => b.level - a.level || (b.date ?? 0) - (a.date ?? 0)))
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b.length - a.length || (b[0].date ?? 0) - (a[0].date ?? 0));
}

function render(box: HTMLElement, data: { done: Ach[]; total: number }) {
  const wrap = el('div', 'ir-ach');

  // Progress: count, bar, tiers.
  const head = el('div', 'ir-ach-head');
  const count = el('div', 'ir-ach-count');
  count.append(el('b', '', String(data.done.length)), ` of ${data.total}`);
  const pct = Math.round((data.done.length / Math.max(1, data.total)) * 100);
  const bar = el('div', 'ir-ach-bar');
  const fill = el('i');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  const tiers = el('div', 'ir-ach-tiers');
  for (const t of ['platinum', 'gold', 'silver', 'bronze']) {
    const n = data.done.filter((a) => a.tier === t).length;
    if (!n) continue;
    const s = el('span', `ir-tier ${t}`);
    s.append(el('b', '', String(n)), ` ${t}`);
    tiers.append(s);
  }
  head.append(count, el('span', 'ir-ach-pct', `${pct}%`), bar, tiers);
  let pinned = pinnedCards(data.done);

  // Everything earned: newest first, or by rarity with each series stacked (click to see its levels).
  const bar2 = el('div', 'ir-ach-listhead');
  const picker = el('div', 'ir-sort');
  picker.setAttribute('role', 'radiogroup');
  picker.setAttribute('aria-label', 'Order achievements');
  const buttons = (['date', 'rarity'] as View[]).map((v) => {
    const b = el('button', '', v === 'date' ? 'Newest' : 'Rarity');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => show(v));
    return b;
  });
  picker.append(...buttons);
  bar2.append(el('span', '', 'Earned'), picker);
  const list = el('div', 'ir-ach-list');

  const show = (v: View) => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
    view = v;
    buttons.forEach((b, i) => b.setAttribute('aria-checked', String((['date', 'rarity'] as View[])[i] === v)));
    list.replaceChildren();
    if (v === 'date') {
      list.append(...data.done.map(row));
      return;
    }
    list.append(...bySeries(data.done).map(stack));
  };
  // The progress and the list scroll together (only the pinned cards stay put).
  const scroll = el('div', 'ir-ach-scroll');
  scroll.append(head, bar2, list);
  wrap.append(pinned, scroll);
  let view: View = 'rarity';
  try {
    if (localStorage.getItem(VIEW_KEY) === 'date') view = 'date';
  } catch {}
  show(view);

  // A pin changed: redraw the pinned cards and every pin button's state.
  const refresh = () => {
    const next = pinnedCards(data.done);
    pinned.replaceWith(next);
    pinned = next;
    for (const b of wrap.querySelectorAll<HTMLElement>('.ir-ach-pin')) {
      const on = pins.names.includes(b.dataset.name ?? '');
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Unpin' : 'Pin to the top (up to 2)';
    }
  };

  // intra's three tiles go; our list takes their place under the title.
  box.querySelectorAll(':scope > .achievement-item, :scope > .vertical-list, :scope > #achievements').forEach((e) => e.remove());
  box.append(wrap);
  return refresh;
}

/** The Achievements card of `login`'s page (yours on the home page). */
export async function reworkAchievements(login: string | undefined) {
  const box = document.querySelector<HTMLElement>('[data-ir-card="achievements"] > .container-inner-item');
  if (!login || !box || box.dataset.irAch) return;
  box.dataset.irAch = '1';
  const title = box.querySelector('h4.profile-title');
  if (title?.firstChild?.nodeType === Node.TEXT_NODE) title.firstChild.textContent = 'Achievements ';
  const mine = login === myLogin();
  const [data, saved] = await Promise.all([load(login), fetchPins(login)]);
  // Loaded (or not): intra's tiles, hidden while we fetched, go or come back.
  const ready = () => (box.dataset.irAch = 'ready');
  if (!data?.done.length) return ready();
  pins = { names: (saved ?? []).filter((n) => data.done.some((a) => a.name === n)) };
  // Your own card: pin up to two (a third replaces the older one); saved on our server.
  if (mine && saved !== undefined) {
    pins.toggle = async (name) => {
      const before = pins.names;
      pins.names = before.includes(name) ? before.filter((n) => n !== name) : [...before, name].slice(-2);
      refresh();
      const r = await savePins(pins.names);
      if ('error' in r) {
        pins.names = before;
        refresh();
        box.querySelector('.ir-ach-error')?.remove();
        const note = el('div', 'ir-ach-error', r.error);
        box.querySelector('.ir-ach')?.prepend(note);
        setTimeout(() => note.remove(), 5000);
      }
    };
  }
  const refresh = render(box, data);
  ready();
}
