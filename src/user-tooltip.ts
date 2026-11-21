// Hovering a login (intra marks them [data-tooltip-login]), or any link to someone's profile (the
// Evaluations card, project pages, clusters map seats), shows a card: the student's photo filling
// it, their name over a dark fade at the bottom, and where they are. Replaces intra's
// own tooltip (hidden in styles.css), which lost its photo ("url(undefined)") and sat on a flat
// teal box. Same data source as intra's: /users/<login>?ams=true, cached for the session.
const HOST_ID = 'ir-user-tip';
const DELAY = 350;
const QUICK_DELAY = 120;
const W = 230;
const H = 270;

type Info = { login: string; name: string; image?: string; location?: string; groups: string[] };
type Raw = {
  login: string;
  usual_full_name?: string;
  full_name?: string;
  location?: string | null;
  image?: { link?: string; versions?: { large?: string; medium?: string } };
  groups?: { name: string }[];
};

const memo = new Map<string, Promise<Info | undefined>>();

/** Hands over a student we already fetched elsewhere (friends panel), so their card shows at once. */
export function primeUserTip(info: Info) {
  if (!memo.has(info.login)) memo.set(info.login, Promise.resolve(info));
}

const plain = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';

function load(login: string, base: string) {
  let p = memo.get(login);
  if (p) return p;
  p = (async () => {
    const key = `ir-tip2:${login}`;
    try {
      const hit = sessionStorage.getItem(key);
      if (hit) return JSON.parse(hit) as Info;
    } catch {}
    const res = await fetch(`${base}/users/${encodeURIComponent(login)}?ams=true`, {
      credentials: 'include',
      headers: { Accept: 'application/json; charset=utf-8' },
    });
    if (!res.ok) return undefined;
    const r = (await res.json()) as Raw;
    const info: Info = {
      login: r.login,
      name: r.usual_full_name || r.full_name || r.login,
      image: r.image?.versions?.large ?? r.image?.versions?.medium ?? r.image?.link ?? undefined,
      location: r.location ?? undefined,
      groups: (r.groups ?? []).map((g) => plain(g.name)).filter(Boolean),
    };
    try {
      sessionStorage.setItem(key, JSON.stringify(info));
    } catch {}
    return info;
  })().catch(() => undefined);
  memo.set(login, p);
  return p;
}

const CSS = `
:host { all: initial; }
.card {
  position: fixed;
  z-index: 3000;
  width: ${W}px;
  height: ${H}px;
  border-radius: 16px;
  overflow: hidden;
  background: #1b1d24 center / cover no-repeat;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.1);
  font-family: futura-pt, Helvetica, Arial, sans-serif;
  color: #fff;
  pointer-events: none;
  opacity: 0;
  transform: translateY(4px) scale(0.98);
  transition: opacity 120ms ease, transform 120ms ease;
}
.card.on { opacity: 1; transform: none; }
.card.below { transform: translateY(-4px) scale(0.98); }
.card.below.on { transform: none; }
.card.noimg { background-image: linear-gradient(135deg, #2a2d38, #16171c); }
.initial {
  position: absolute;
  inset: 0 0 35%;
  display: grid;
  place-items: center;
  font-size: 64px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.18);
}
.fade {
  position: absolute;
  inset: auto 0 0;
  padding: 60px 14px 12px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.72) 45%, rgba(0, 0, 0, 0.92));
}
.name { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.15; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
.login { margin: 2px 0 0; font-size: 12.5px; color: rgba(255, 255, 255, 0.7); display: flex; align-items: center; gap: 6px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #6b7280; flex: none; }
.dot.on { background: #4ade80; box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.25); }
.groups { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; flex-wrap: wrap; gap: 4px; }
.groups span {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.loading { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; color: rgba(255, 255, 255, 0.5); }
`;

let card: HTMLElement | undefined;
let current: Element | undefined;
let timer: number | undefined;

function ensureCard() {
  if (card?.isConnected) return card;
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  card = document.createElement('div');
  card.className = 'card';
  root.append(style, card);
  document.body.append(host);
  return card;
}

function place(c: HTMLElement, link: Element) {
  const r = link.getBoundingClientRect();
  const below = r.top < H + 16;
  const top = below ? r.bottom + 10 : r.top - H - 10;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), innerWidth - W - 8);
  c.style.top = `${top}px`;
  c.style.left = `${left}px`;
  c.classList.toggle('below', below);
}

function fill(c: HTMLElement, info: Info) {
  c.replaceChildren();
  c.classList.toggle('noimg', !info.image);
  c.style.backgroundImage = info.image ? `url("${info.image.replace(/"/g, '%22')}")` : '';
  if (!info.image) {
    const i = document.createElement('div');
    i.className = 'initial';
    i.textContent = info.name.charAt(0).toUpperCase();
    c.append(i);
  }
  if (info.groups.length) {
    const g = document.createElement('div');
    g.className = 'groups';
    for (const name of info.groups.slice(0, 3)) {
      const s = document.createElement('span');
      s.textContent = name;
      g.append(s);
    }
    c.append(g);
  }
  const fade = document.createElement('div');
  fade.className = 'fade';
  const name = document.createElement('p');
  name.className = 'name';
  name.textContent = info.name;
  const login = document.createElement('p');
  login.className = 'login';
  const dot = document.createElement('i');
  dot.className = info.location ? 'dot on' : 'dot';
  login.append(dot, `${info.login} · ${info.location ?? 'Offline'}`);
  fade.append(name, login);
  c.append(fade);
}

function hide() {
  clearTimeout(timer);
  current = undefined;
  card?.classList.remove('on');
}

const PROFILE = 'https://profile.intra.42.fr';
const PROFILE_LINK = /^https:\/\/profile\.intra\.42\.fr\/users\/([a-z0-9-]{1,32})\/?$/i;
// Menus and our own buttons: a card popping up there would be in the way.
const SKIP = '.main-left-navbar, .dropdown-menu, #ir-side-tools, .main-navbar, #ir-logo';

/** The student a hovered element stands for: intra's tooltip mark, or a link to their profile. */
function target(el: Element | null): { el: Element; login: string } | undefined {
  const marked = el?.closest?.('[data-tooltip-login]');
  if (marked) {
    const login = marked.getAttribute('data-tooltip-login');
    return login ? { el: marked, login } : undefined;
  }
  const a = el?.closest?.<HTMLAnchorElement>('a[href]');
  const login = a?.href.match(PROFILE_LINK)?.[1];
  if (!a || !login || a.closest(SKIP)) return undefined;
  return { el: a, login };
}

async function show(link: Element, login: string) {
  const base = link.getAttribute('data-tooltip-url') || (location.origin === PROFILE ? location.origin : PROFILE);
  const c = ensureCard();
  const info = await load(login, base);
  if (current !== link || !info) return;
  fill(c, info);
  place(c, link);
  // Wait for the photo, so it doesn't pop in after the card.
  if (info.image) {
    const img = new Image();
    img.src = info.image;
    await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
    if (current !== link) return;
  }
  c.classList.add('on');
}

export function initUserTooltips() {
  const onPointer = (e: MouseEvent) => {
    // Our own shadow-root UIs (friends panel) opt in by marking an element with data-tooltip-login:
    // look for one along the composed path, since e.target here is just their host.
    const marked = e.composedPath().find((n): n is Element => n instanceof Element && n.hasAttribute('data-tooltip-login'));
    const t = marked ? target(marked) : target(e.target as Element);
    if (t?.el === current) return;
    hide();
    if (!t) return;
    current = t.el;
    // Photos in our own panels are hovered on purpose: no need to wait as long as for page links.
    timer = window.setTimeout(() => void show(t.el, t.login), marked && marked.getRootNode() !== document ? QUICK_DELAY : DELAY);
  };
  document.addEventListener('mouseover', onPointer);
  // Firefox doesn't always send mouseover inside our shadow roots (moving from a row link onto the
  // photo in it): mousemove still arrives, and does nothing while the target stays the same.
  document.addEventListener('mousemove', onPointer, { passive: true });
  addEventListener('scroll', hide, { capture: true, passive: true });
  addEventListener('blur', hide);
}
