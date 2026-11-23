// Campus events on the Logtime card's Calendar view: a dot (coloured by kind) on each day with
// events; hovering (or tapping) the day shows a tooltip listing them, and clicking one opens
// intra's own event panel (#smartModal), like the Agenda's "See more". The tooltip previews who's
// subscribed (a few photos and the count); "+N" or the row opens the panel, which lists everyone.
// The tooltip lives in its own shadow root on <body>, so the card's overflow never clips it.
import { myLogin } from '../me';
import { fetchEventFeedbacks, fetchEventUsers, type CampusEvent } from './data';

const DAY = 86_400_000;
const MAX_SPAN_DAYS = 14; // a long event marks at most its first two weeks
const FACES = 7; // photos in the tooltip before "+N"

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Same colours as the event popup's accents (styles.css, #smartModal). */
const KIND_COLORS: [string[], string][] = [
  [['association'], '#8f9cff'],
  [['pedago', 'piscine'], '#f5c451'],
  [['rush'], '#ff9a5c'],
  [['extern', 'partnership', 'conference'], '#9aa3b2'],
  [['hackathon', 'challenge'], '#c77dff'],
  [['workshop', 'meet', 'meet_up'], '#3ddc84'],
];
const kindColor = (kind: string) => KIND_COLORS.find(([ks]) => ks.includes(kind.toLowerCase()))?.[1] ?? 'var(--ir-accent-hi)';
const kindLabel = (kind: string) => (kind ? kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Event');

const byCard = new WeakMap<HTMLElement, Map<string, CampusEvent[]>>();

/** Events grouped by the local days they cover. */
export function setCardEvents(card: HTMLElement, events: CampusEvent[]) {
  const days = new Map<string, CampusEvent[]>();
  for (const e of events) {
    const start = new Date(e.begin);
    // An event ending at midnight doesn't cover the next day.
    const last = Math.min(e.end && e.end > e.begin ? e.end - 1 : e.begin, e.begin + MAX_SPAN_DAYS * DAY);
    for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d.getTime() <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const k = iso(d);
      days.set(k, [...(days.get(k) ?? []), e]);
    }
  }
  for (const list of days.values()) list.sort((a, b) => a.begin - b.begin);
  byCard.set(card, days);
}

/** Dots on the calendar's days that have events (safe to call again: it redoes them). */
export function markEvents(card: HTMLElement, root: ShadowRoot) {
  const days = byCard.get(card);
  if (!days) return;
  for (const cell of root.querySelectorAll<HTMLElement>('.day[data-iso]')) {
    cell.querySelector('.dots')?.remove();
    const list = days.get(cell.dataset.iso!);
    cell.classList.toggle('has-ev', !!list);
    if (!list) continue;
    // The custom tooltip carries the hours too, so the native one goes.
    if (cell.title) cell.dataset.hours = cell.title.split(' · ').slice(1).join(' · ');
    cell.removeAttribute('title');
    cell.setAttribute('aria-label', `${list.length} event${list.length === 1 ? '' : 's'}`);
    const dots = document.createElement('i');
    dots.className = 'dots';
    for (const e of list.slice(0, 3)) {
      const b = document.createElement('b');
      b.style.setProperty('--k', kindColor(e.kind));
      dots.append(b);
    }
    cell.append(dots);
  }
}

const wired = new WeakSet<ShadowRoot>();

/** Hover / tap handling for the event days, once per card. */
export function attachEvents(card: HTMLElement, root: ShadowRoot) {
  if (wired.has(root)) return;
  wired.add(root);
  const dayOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('.day.has-ev') : null);
  root.addEventListener('pointerover', (e) => {
    const cell = dayOf(e.target);
    if (!cell || (e as PointerEvent).pointerType !== 'mouse') return;
    clearTimeout(switchTimer);
    // Already showing another day's: wait a moment before switching, since the way from a day up
    // into its tooltip crosses the day above it.
    if (tip && !tip.hidden && anchor && anchor !== cell) switchTimer = window.setTimeout(() => show(card, cell, false), 150);
    else show(card, cell, false);
  });
  root.addEventListener('pointerout', (e) => {
    const cell = dayOf(e.target);
    if (cell && !cell.contains((e as PointerEvent).relatedTarget as Node | null)) {
      clearTimeout(switchTimer);
      hideSoon();
    }
  });
  // Click / tap: a day whose tooltip is already up (hovered, or tapped once on a phone) with a
  // single event opens it; otherwise the tooltip shows and stays pinned until a click elsewhere.
  root.addEventListener('click', (e) => {
    const cell = dayOf(e.target);
    if (!cell) return;
    const list = byCard.get(card)?.get(cell.dataset.iso!);
    if (list?.length === 1 && anchor === cell && tip && !tip.hidden) {
      hide();
      return openEventPanel(list[0].id);
    }
    show(card, cell, true);
  });
}

// ---------- the tooltip ----------

let tipHost: HTMLElement | undefined;
let tip: HTMLElement | undefined;
let hideTimer: number | undefined;
let switchTimer: number | undefined;
let pinned = false;
let anchor: HTMLElement | undefined;

function ensureTip() {
  if (tipHost?.isConnected && tip) return tip;
  tipHost = document.createElement('ir-lt-events-tip');
  const root = tipHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = TIP_CSS;
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  tip.addEventListener('pointerenter', () => {
    clearTimeout(hideTimer);
    clearTimeout(switchTimer);
  });
  tip.addEventListener('pointerleave', () => !pinned && hideSoon());
  root.append(style, tip);
  document.body.append(tipHost);
  document.addEventListener('pointerdown', (e) => {
    if (!tip || tip.hidden) return;
    const path = e.composedPath();
    if (!path.includes(tipHost!) && !(anchor && path.includes(anchor))) hide();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  window.addEventListener('scroll', () => hide(), { passive: true, capture: true });
  return tip;
}

function hide() {
  clearTimeout(hideTimer);
  clearTimeout(switchTimer);
  pinned = false;
  anchor = undefined;
  if (tip) tip.hidden = true;
}
function hideSoon() {
  if (pinned) return;
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hide, 160); // time to move the pointer into the tooltip
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayName = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function when(e: CampusEvent, dayIso: string) {
  if (!e.end) return time(e.begin);
  const sameDay = iso(new Date(e.begin)) === iso(new Date(e.end - 1));
  if (sameDay) return `${time(e.begin)}–${time(e.end)}`;
  // Spans days: say which part this is.
  return iso(new Date(e.begin)) === dayIso ? `from ${time(e.begin)}, until ${dayName(e.end)}` : `${dayName(e.begin)} – ${dayName(e.end)}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function show(card: HTMLElement, cell: HTMLElement, pin: boolean) {
  const list = byCard.get(card)?.get(cell.dataset.iso!);
  if (!list) return;
  const t = ensureTip();
  clearTimeout(hideTimer);
  if (anchor === cell && !t.hidden) {
    pinned ||= pin;
    return;
  }
  pinned = pin;
  anchor = cell;

  const [y, m, d] = cell.dataset.iso!.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const head = el('div', 'head');
  head.append(el('b', '', date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })));
  if (cell.dataset.hours) head.append(el('span', '', cell.dataset.hours));

  const items = list.map((e) => {
    // Not a link: the photos inside it are.
    const row = el('div', 'ev');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.style.setProperty('--k', kindColor(e.kind));
    const body = el('span', 'body');
    const top = el('span', 'top');
    top.append(el('span', 'kind', kindLabel(e.kind)), el('span', 'name', e.name));
    body.append(top, el('span', 'meta', [when(e, cell.dataset.iso!), e.location].filter(Boolean).join(' · ')), subscribers(e));
    row.append(el('i', 'dot'), body);
    const open = () => {
      hide();
      openEventPanel(e.id);
    };
    row.addEventListener('click', (ev) => !(ev.target as Element).closest('a.face') && open()); // a photo opens its profile
    row.addEventListener('keydown', (ev) => {
      if (ev.target === row && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        open();
      }
    });
    return row;
  });
  const listEl = el('div', 'list');
  listEl.append(...items);
  t.replaceChildren(head, listEl);
  t.hidden = false;

  place(t, cell);
}

/** Above the day, centred, kept on screen; below it when there's no room above. */
function place(t: HTMLElement, cell: HTMLElement) {
  const r = cell.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  const gap = 8;
  let top = r.top - tr.height - gap;
  t.classList.toggle('below', top < 4);
  if (top < 4) top = r.bottom + gap;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 8);
  t.style.top = `${top}px`;
  t.style.left = `${left}px`;
  t.style.setProperty('--arrow', `${r.left + r.width / 2 - left}px`);
}

/** A preview of who's subscribed: a few photos (profile links, with the student hover card), "+N"
 * (opens the event's panel, which lists everyone), and the count. */
function subscribers(e: CampusEvent) {
  const box = el('span', 'subs');
  const past = (e.end ?? e.begin) < Date.now();
  const count = e.max ? `${e.subscribers} / ${e.max}` : String(e.subscribers);
  const label = el('span', 'count', e.subscribers ? `${count} ${past ? 'went' : 'subscribed'}` : past ? 'No one subscribed' : 'No one subscribed yet');
  if (e.max && e.subscribers >= e.max && !past) label.classList.add('full');
  box.append(label);
  if (!e.subscribers) return box;
  const faces = el('span', 'faces loading');
  for (let i = 0; i < Math.min(e.subscribers, FACES); i++) faces.append(el('i', 'face'));
  box.prepend(faces);
  fetchEventUsers(e.id).then((users) => {
    faces.classList.remove('loading');
    if (!users) return faces.remove();
    faces.replaceChildren(
      ...users.slice(0, FACES).map((u) => {
        const a = el('a', 'face');
        a.href = `/users/${encodeURIComponent(u.login)}`;
        a.dataset.tooltipLogin = u.login;
        a.setAttribute('aria-label', u.name);
        if (u.image) {
          const img = el('img', '');
          img.src = u.image;
          img.alt = '';
          img.loading = 'lazy';
          a.append(img);
        } else a.textContent = u.login.slice(0, 2);
        return a;
      }),
    );
    if (users.length > FACES) {
      const more = el('span', 'more', `+${users.length - FACES}`);
      more.title = 'See everyone';
      faces.append(more); // a click on it reaches the row, which opens the panel
    }
  });
  return box;
}

/** What the panel's sections need, read from the event page itself (so any opener can use it). */
interface PanelInfo {
  id: number;
  subscribers: number;
  max: number | null;
  past: boolean; // started already: "Went", and feedback
}

/** The subscribers, under the event's description in its panel: photo and login, each a profile link. */
function subscriberList(e: PanelInfo) {
  const past = e.past;
  const box = el('section', 'ir-event-subs');
  const head = el('div', 'ir-event-subs-head');
  head.append(el('b', '', past ? 'Went' : 'Subscribed'), el('span', '', e.max ? `${e.subscribers} / ${e.max}` : String(e.subscribers)));
  const grid = el('div', 'ir-event-subs-grid loading');
  for (let i = 0; i < Math.min(e.subscribers, 12); i++) grid.append(el('span', 'ir-event-sub'));
  box.append(head, grid);
  fetchEventUsers(e.id).then((users) => {
    grid.classList.remove('loading');
    if (!users) {
      grid.replaceChildren(el('span', 'ir-event-subs-none', "Couldn't load who's subscribed."));
      return;
    }
    if (!users.length) return box.remove();
    head.lastElementChild!.textContent = e.max ? `${users.length} / ${e.max}` : String(users.length);
    grid.replaceChildren(
      ...users.map((u) => {
        const a = el('a', 'ir-event-sub');
        a.href = `/users/${encodeURIComponent(u.login)}`;
        a.dataset.tooltipLogin = u.login; // the student hover card (user-tooltip.ts)
        const face = el('span', 'ir-event-sub-face', u.image ? undefined : u.login.slice(0, 2));
        if (u.image) {
          const img = el('img', '');
          img.src = u.image;
          img.alt = '';
          img.loading = 'lazy';
          face.append(img);
        }
        a.append(face, el('span', 'ir-event-sub-login', u.login));
        return a;
      }),
    );
  });
  return box;
}

const CRITERIA: [string, string][] = [
  ['interesting', 'Interesting'],
  ['pertinent', 'Relevant'],
  ['quality', 'Quality'],
  ['accuracy', 'On time'],
];

/** Everyone's feedback, under the subscribers: average, then each person's rating and comment. */
function feedbackList(e: PanelInfo) {
  const box = el('section', 'ir-event-fb');
  const head = el('div', 'ir-event-subs-head');
  const summary = el('span', '', '');
  head.append(el('b', '', 'Feedback'), summary);
  const list = el('div', 'ir-event-fb-list loading');
  for (let i = 0; i < 2; i++) list.append(el('div', 'ir-event-fb-item'));
  box.append(head, list);
  Promise.all([fetchEventFeedbacks(e.id), e.subscribers ? fetchEventUsers(e.id) : undefined]).then(([feedbacks, users]) => {
    list.classList.remove('loading');
    if (!feedbacks) return list.replaceChildren(el('span', 'ir-event-subs-none', "Couldn't load the feedback."));
    if (!feedbacks.length) return list.replaceChildren(el('span', 'ir-event-subs-none', 'No feedback yet.'));
    const avg = feedbacks.reduce((s, f) => s + f.rating, 0) / feedbacks.length;
    summary.textContent = `★ ${avg.toFixed(1).replace(/\.0$/, '')} / 5 · ${feedbacks.length} ${feedbacks.length === 1 ? 'review' : 'reviews'}`;
    const photos = new Map(users?.map((u) => [u.login, u.image]));
    // Yours first, then written ones (newest first), then ratings without a comment.
    const me = myLogin();
    const sorted = [...feedbacks].sort(
      (a, b) => Number(b.login === me) - Number(a.login === me) || Number(!!b.comment) - Number(!!a.comment) || b.at - a.at,
    );
    list.replaceChildren(
      ...sorted.map((f) => {
        const item = el('article', `ir-event-fb-item${f.login === me ? ' mine' : ''}`);
        const who = el('a', 'ir-event-fb-who');
        who.href = `/users/${encodeURIComponent(f.login)}`;
        who.dataset.tooltipLogin = f.login;
        const face = el('span', 'ir-event-sub-face', photos.get(f.login) ? undefined : f.login.slice(0, 2));
        const src = photos.get(f.login);
        if (src) {
          const img = el('img', '');
          img.src = src;
          img.alt = '';
          img.loading = 'lazy';
          face.append(img);
        }
        who.append(face, el('b', '', f.login));
        if (f.login === me) who.append(el('span', 'ir-event-fb-you', 'You'));
        const top = el('div', 'ir-event-fb-top');
        const stars = el('span', 'ir-event-fb-stars', '★'.repeat(Math.round(f.rating)) + '☆'.repeat(5 - Math.round(f.rating)));
        stars.title = `${f.rating} / 5`;
        top.append(who, stars, el('time', '', new Date(f.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })));
        const crit = el('div', 'ir-event-fb-crit');
        for (const [k, label] of CRITERIA) {
          if (!(k in f.details)) continue;
          const c = el('span', f.details[k] <= 1 ? 'low' : '', `${label} `);
          c.append(el('b', '', `${f.details[k]}/4`));
          crit.append(c);
        }
        item.append(top, crit);
        if (f.comment) item.append(el('p', 'ir-event-fb-comment', f.comment));
        return item;
      }),
    );
  });
  return box;
}

/**
 * Intra's event panel (#smartModal), filled the way its own Smart class does for the Agenda's
 * "See more": the event page's article, header and footer, copied into the modal. Intra binds that
 * handler to each link once at page load, so links added later are never wired; it's done here
 * instead, and Bootstrap's delegated [data-toggle="modal"] shows it. Its Subscribe and Close
 * buttons are handled by delegated listeners too (rails-ujs, Bootstrap), so they work as usual.
 * Under the description: who's subscribed, then (once it's over) everyone's feedback.
 * Without the modal (or if the page can't be loaded), the event's page opens in a new tab.
 */
export async function openEventPanel(id: number) {
  const url = `/events/${id}`;
  const modal = document.getElementById('smartModal');
  const fallback = () => window.open(url, '_blank', 'noopener');
  if (!modal) return fallback();
  try {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(String(res.status));
    const page = new DOMParser().parseFromString(await res.text(), 'text/html');
    const body = modal.querySelector('.modal-body');
    const article = page.querySelector('article');
    if (!body || !article) throw new Error('no article');
    // Start time ("2026-08-15 13:00:00 +0300") and seats ("30 / 30", or just "30").
    const long = page.querySelector<HTMLElement>('header [data-long-date]')?.dataset.longDate?.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d)(?::(\d\d))? ([+-]\d\d)(\d\d)$/);
    const begin = long ? Date.parse(`${long[1]}T${long[2]}:${long[3] ?? '00'}${long[4]}:${long[5]}`) : NaN;
    const seats = page.querySelector('header .event-suscriptions')?.textContent?.match(/(\d+)\s*(?:\/\s*(\d+))?/);
    const info: PanelInfo = {
      id,
      subscribers: seats ? Number(seats[1]) : 0,
      max: seats?.[2] ? Number(seats[2]) || null : null,
      past: Number.isFinite(begin) && begin < Date.now(),
    };
    body.replaceChildren(...article.childNodes);
    const fill = (part: string) => {
      const target = modal.querySelector<HTMLElement>(`.modal-${part}`);
      const from = page.querySelector(part);
      if (!target) return;
      target.replaceChildren(...(from?.childNodes ?? []));
      target.style.display = from ? '' : 'none';
    };
    fill('header');
    fill('footer');
    if (info.subscribers || !seats) body.append(subscriberList(info)); // no seat count shown: look anyway
    if (info.past) body.append(feedbackList(info)); // feedback only comes after
    modal.classList.add('event-modal');
    const show = document.createElement('a');
    show.hidden = true;
    show.dataset.toggle = 'modal';
    show.dataset.target = '#smartModal';
    show.addEventListener('click', (e) => e.preventDefault());
    document.body.append(show);
    show.click();
    show.remove();
  } catch {
    fallback();
  }
}

const TIP_CSS = `
.tip {
  position: fixed; z-index: 2900; /* under intra's student hover card (3000) */ width: max-content; max-width: min(360px, calc(100vw - 16px)); min-width: min(260px, calc(100vw - 16px));
  padding: 10px 6px 6px; border-radius: 12px;
  background: var(--ir-surface, #14171d); color: var(--ir-text, #e8eaf0);
  border: 1px solid var(--ir-border, rgba(255,255,255,.09));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.2);
  font: 13px/1.35 futura-pt, Futura, 'Trebuchet MS', system-ui, sans-serif;
  animation: pop 0.12s ease-out;
}
.tip[hidden] { display: none; }
.tip::after {
  content: ''; position: absolute; top: 100%; left: var(--arrow); width: 10px; height: 10px; margin: -5px 0 0 -5px;
  background: inherit; border: inherit; border-width: 0 1px 1px 0; transform: rotate(45deg);
}
.tip.below::after { top: 0; border-width: 1px 0 0 1px; }
@keyframes pop { from { opacity: 0; transform: translateY(3px); } }
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; padding: 0 8px 6px; font-size: 12px; white-space: nowrap; }
.head b { font-weight: 600; }
.head span { color: var(--ir-muted, #a1a7b5); }
.list { display: grid; gap: 1px; max-height: 260px; overflow-y: auto; scrollbar-width: thin; }
.ev {
  display: flex; gap: 9px; align-items: flex-start; padding: 6px 8px; border-radius: 8px;
  color: inherit; cursor: pointer;
}
.ev:hover, .ev:focus-visible { background: rgba(var(--ir-ink, 255, 255, 255), 0.06); outline: none; }
.dot { flex: none; width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: var(--k); }
.body { display: grid; gap: 1px; min-width: 0; }
.top { display: flex; gap: 6px; align-items: baseline; min-width: 0; }
.kind {
  flex: none; font-size: 10px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; color: var(--k);
}
.name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Subscribers preview: overlapping photos, then the count. */
.subs { display: flex; align-items: center; gap: 7px; margin-top: 4px; min-width: 0; font-size: 11.5px; color: var(--ir-muted, #a1a7b5); }
.count { white-space: nowrap; }
.count.full { color: #ff9a5c; }
.faces { display: flex; align-items: center; padding-left: 5px; }
.face {
  flex: none; width: 22px; height: 22px; margin-left: -5px; border-radius: 50%; overflow: hidden;
  background: rgba(var(--ir-ink, 255, 255, 255), 0.1); box-shadow: 0 0 0 2px var(--ir-surface, #14171d);
  display: grid; place-items: center; font-size: 9px; text-transform: uppercase; color: var(--ir-muted, #a1a7b5); text-decoration: none;
  transition: transform 0.1s;
}
a.face:hover { transform: translateY(-2px); position: relative; z-index: 1; }
.face img { width: 100%; height: 100%; object-fit: cover; display: block; }
.faces.loading .face { animation: pulse 1s ease-in-out infinite alternate; }
@keyframes pulse { to { opacity: 0.4; } }
.more {
  flex: none; height: 22px; min-width: 22px; margin-left: -5px; padding: 0 6px; border-radius: 11px;
  background: rgba(var(--ir-ink, 255, 255, 255), 0.12); box-shadow: 0 0 0 2px var(--ir-surface, #14171d);
  font-size: 10.5px; font-weight: 600; line-height: 22px; text-align: center; color: var(--ir-text, #e8eaf0);
}
.ev:hover .more { background: rgba(var(--ir-ink, 255, 255, 255), 0.2); }
.meta { font-size: 11.5px; color: var(--ir-muted, #a1a7b5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
