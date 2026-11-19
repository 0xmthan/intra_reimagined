// Campus announcements: instead of a long block under the profile header, a slim bar that says
// how many are new, and a drawer with all of them. Opening the drawer marks them as seen
// (remembered in this browser, per announcement).
import css from './news.css?inline';
import { setHTML } from './html';

const BAR_ID = 'ir-news-bar';
const DRAWER_ID = 'ir-news-drawer';
const SEEN_KEY = 'intra-reimagined:seen-news';
const MAX_SEEN = 300;

interface Item {
  id: string;
  title: string;
  at: number; // epoch ms
  ago: string;
  author: string;
  body: Element | null;
}

const ICON = {
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const txt = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-MAX_SEEN)));
  } catch {
    /* storage blocked: everything just counts as new again next time */
  }
}

/**
 * "KASIM HAVUZ EĞİTİMİ (16 KASIM - 11 ARALIK)" → "Kasım Havuz Eğitimi (16 Kasım - 11 Aralık)".
 * Only for titles written in capitals; Turkish letters use Turkish case rules (I→ı, İ→i).
 */
function unshout(title: string) {
  const letters = title.match(/\p{L}/gu) ?? [];
  const upper = letters.filter((c) => c !== c.toLocaleLowerCase()).length;
  if (letters.length < 4 || upper / letters.length < 0.8) return title;
  const lang = /[İıŞşĞğ]/.test(title) ? 'tr' : undefined;
  return title
    .toLocaleLowerCase(lang)
    .replace(/(^|[\s(\-–"'“/])(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toLocaleUpperCase(lang));
}

/** "2026-11-16 13:52:02 +0300" → epoch ms */
const parseLongDate = (s?: string) =>
  s ? new Date(s.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2')).getTime() || 0 : 0;

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
function ago(at: number) {
  if (!at) return '';
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function readItems(list: Element): Item[] {
  // Newest first.
  return [...list.querySelectorAll('.notification-item')].map((el) => {
    const raw = txt(el.querySelector('.notification-title .title'));
    const title = unshout(raw);
    const dateEl = el.querySelector<HTMLElement>('[data-long-date]');
    const info = txt(el.querySelector('.notification-title .info'));
    const at = parseLongDate(dateEl?.dataset.longDate);
    return {
      // Title + exact timestamp identify an announcement well enough to remember it.
      id: `${dateEl?.dataset.longDate ?? ''}|${raw}`,
      title,
      at,
      ago: ago(at) || txt(dateEl),
      author: info.match(/\bby\s+(.+)$/)?.[1] ?? '',
      body: el.querySelector('.notification-text'),
    };
  }).sort((a, b) => b.at - a.at);
}

export function initNews() {
  const list = document.querySelector('.notification-list');
  // Only the list itself: intra keeps the profile banner (our header) in the same box.
  const box = list;
  if (!list || !box || document.getElementById(BAR_ID)) return;
  const items = readItems(list);
  if (!items.length) return;

  box.classList.add('ir-news-hidden');
  const host = document.createElement('div');
  host.id = BAR_ID;
  const root = host.attachShadow({ mode: 'open' });
  box.before(host);

  const seen = readSeen();
  const paint = () => {
    const fresh = items.filter((i) => !seen.has(i.id));
    const latest = items[0];
    setHTML(
      root,
      `<style>${css}</style>
       <button class="bar${fresh.length ? ' has-new' : ''}" aria-label="Open announcements">
         <span class="ico">${ICON.megaphone}</span>
         ${fresh.length ? `<b class="count">${fresh.length} new</b><span class="dot-sep">·</span>` : '<span class="label">Announcements</span><span class="dot-sep">·</span>'}
         <span class="titles">${items
           .map((i) => `<span class="t${seen.has(i.id) ? '' : ' fresh'}">${esc(i.title)}</span>`)
           .join('<span class="dot-sep">·</span>')}</span>
         <span class="when">${esc(latest.ago)}</span>
         <span class="chev">${ICON.chevron}</span>
       </button>`,
    );
    root.querySelector('.bar')!.addEventListener('click', () => {
      openDrawer(items, new Set(seen));
      for (const i of items) seen.add(i.id);
      saveSeen(seen);
      paint();
    });
  };
  paint();
}

let onKey: ((e: KeyboardEvent) => void) | undefined;

function closeDrawer() {
  document.getElementById(DRAWER_ID)?.remove();
  if (onKey) document.removeEventListener('keydown', onKey, true);
  document.documentElement.classList.remove('ir-scroll-lock');
}

/** `seenBefore`: what was already seen before this opening (those don't get the "new" dot). */
function openDrawer(items: Item[], seenBefore: Set<string>) {
  closeDrawer();
  const host = document.createElement('div');
  host.id = DRAWER_ID;
  const root = host.attachShadow({ mode: 'open' });
  setHTML(
    root,
    `<style>${css}</style>
     <div class="bg">
       <aside class="drawer" role="dialog" aria-label="Announcements">
         <header><h2>${ICON.megaphone} Announcements</h2><button class="x" aria-label="Close">✕</button></header>
         <div class="items"></div>
       </aside>
     </div>`,
  );
  const list = root.querySelector('.items')!;
  for (const it of items) {
    const art = document.createElement('article');
    if (!seenBefore.has(it.id)) art.classList.add('new');
    setHTML(
      art,
      `<h3>${esc(it.title)}</h3><p class="meta">${esc(it.ago)}${it.author ? ` · ${esc(it.author)}` : ''}</p><div class="body"></div>`,
    );
    // Intra's own rendered text, copied as nodes (links, lists, emojis intact).
    if (it.body) art.querySelector('.body')!.append(...[...it.body.childNodes].map((n) => n.cloneNode(true)));
    for (const a of art.querySelectorAll('a')) a.target = '_blank';
    list.append(art);
  }
  document.body.appendChild(host);
  document.documentElement.classList.add('ir-scroll-lock');

  const bg = root.querySelector<HTMLElement>('.bg')!;
  root.querySelector('.x')!.addEventListener('click', closeDrawer);
  bg.addEventListener('mousedown', (e) => e.target === bg && closeDrawer());
  onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    closeDrawer();
  };
  document.addEventListener('keydown', onKey, true);
}
