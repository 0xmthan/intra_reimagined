// Clusters: a sidebar icon that opens meta's clusters map in a window over the current page,
// with a button to open it as its own page. The map page is framed (the background lets the tab frame it,
// background.ts) and runs in "embed" mode (see initEmbed): no intra sidebar/top bar, and following a
// link (e.g. a student's seat) loads that page in the whole tab, which also closes the window.
// The same window (openFramePopup) shows other intra pages too, like Manage slots (slots.ts).
import css from './clusters.css?inline';
import { setHTML } from './html';

export const CLUSTERS_URL = 'https://meta.intra.42.fr/clusters';
export const EMBED_PARAM = 'ir-embed';
const BUTTON_ID = 'ir-clusters-button';
const HOST_ID = 'ir-clusters';

const ICON = {
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

/** Adds the Clusters icon to intra's main sidebar, right after Projects. */
export function addClustersButton() {
  const list = document.querySelector('.main-left-navbar > div') ?? document.querySelector('.main-left-navbar');
  if (!list || document.getElementById(BUTTON_ID)) return;
  const li = document.createElement('li');
  li.id = BUTTON_ID;
  const here = location.origin + location.pathname.replace(/\/$/, '') === CLUSTERS_URL;
  setHTML(li, `<a class="${here ? 'active' : 'inactive'}" href="${CLUSTERS_URL}" aria-label="Clusters">${ICON.map}<span class="visible-overlay"> Clusters </span></a>`);
  // On the map, intra marks Meta as the current page (it's on meta's site): it's Clusters here.
  if (here) list.querySelector('a.active[href="https://meta.intra.42.fr"]')?.classList.replace('active', 'inactive');
  const projects = [...list.querySelectorAll(':scope > li')].find((l) => l.querySelector('a[href^="https://projects.intra.42.fr"]'));
  list.insertBefore(li, projects?.nextSibling ?? null);
  li.querySelector('a')!.addEventListener('click', (e) => {
    if (here || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // on the map already, or a new tab: let it be
    e.preventDefault();
    openClusters();
  });
}

type Runtime = { runtime: { sendMessage(msg: unknown): Promise<unknown> } };
const runtime = ((globalThis as { browser?: Runtime }).browser ?? (globalThis as { chrome?: Runtime }).chrome)?.runtime;

/** Asks the background to let this tab frame intra's clusters and slots pages. */
const allowFrames = () =>
  Promise.race([runtime?.sendMessage({ type: 'ir-allow-frames' }).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);

let host: HTMLElement | undefined;
let onKey: ((e: KeyboardEvent) => void) | undefined;
let onClose: (() => void) | undefined;

function close() {
  host?.remove();
  host = undefined;
  if (onKey) document.removeEventListener('keydown', onKey, true);
  document.documentElement.classList.remove('ir-scroll-lock');
  const done = onClose;
  onClose = undefined;
  done?.();
}

export type FramePopup = {
  /** The page to show, opened in "embed" mode (initEmbed). */
  url: string;
  title: string;
  icon: string;
  /** Extra query parameters for the framed page (e.g. the seat to show on the map). */
  params?: Record<string, string>;
  /** Pages the frame may move to and stay in the window (the rest open in the whole tab). */
  stays?: (href: string) => boolean;
  onClose?: () => void;
};

/** An intra page in a window over the current one, like the Clusters map. */
export function openFramePopup(o: FramePopup) {
  if (host) return;
  host = document.createElement('div');
  host.id = HOST_ID;
  onClose = o.onClose;
  const stays = o.stays ?? ((href: string) => href.startsWith(o.url));
  const src = new URL(o.url);
  src.searchParams.set(EMBED_PARAM, '1');
  for (const [k, v] of Object.entries(o.params ?? {})) src.searchParams.set(k, v);
  const root = host.attachShadow({ mode: 'open' });
  setHTML(
    root,
    `<style>${css}</style>
     <div class="bg">
       <section class="win" role="dialog">
         <header>
           <h2>${o.icon} <span class="t"></span></h2>
           <div class="btns">
             <a class="btn open" title="Open as a page">${ICON.expand}</a>
             <button class="btn x" title="Close (Esc)">✕</button>
           </div>
         </header>
         <div class="body">
           <div class="loading"></div>
           <iframe></iframe>
         </div>
       </section>
     </div>`,
  );
  root.querySelector('.win')!.setAttribute('aria-label', o.title);
  root.querySelector('.t')!.textContent = o.title;
  root.querySelector('.loading')!.textContent = `Loading ${o.title.toLowerCase()}…`;
  root.querySelector<HTMLAnchorElement>('.open')!.href = o.url;
  const frame = root.querySelector('iframe')!;
  frame.title = o.title;
  // The background lets this tab frame the page first (background.ts), then it loads.
  void allowFrames().then(() => {
    if (frame.isConnected) frame.src = src.href;
  });
  document.body.appendChild(host);
  document.documentElement.classList.add('ir-scroll-lock');

  const bg = root.querySelector<HTMLElement>('.bg')!;
  frame.addEventListener('load', () => root.querySelector('.loading')?.remove(), { once: true });
  // Pages navigate with script (clicking a seat on the map sets location), not plain links, so the
  // embed-side click handler can't catch it. Catch it here: whenever the frame lands on a page it
  // shouldn't stay on, close the window and open that page in the whole tab. (Same-origin pages
  // only; other origins fall back to the link handler.)
  frame.addEventListener('load', () => {
    let href: string | undefined;
    try {
      href = frame.contentWindow?.location.href;
    } catch {
      return; // cross-origin: nothing to do
    }
    if (!href || href === 'about:blank' || stays(href)) return;
    close();
    location.href = href;
  });

  root.querySelector('.x')!.addEventListener('click', close);
  bg.addEventListener('mousedown', (e) => e.target === bg && close());
  onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };
  document.addEventListener('keydown', onKey, true);
}

export const SEAT_PARAM = 'ir-seat';
const SEAT = /^[a-z0-9]{2,20}$/i;

/** The clusters map in our window; with `seat` (e.g. "k0m07s03"), on that floor, zoomed to it. */
export const openClusters = (seat?: string) =>
  openFramePopup({
    url: CLUSTERS_URL,
    title: seat && SEAT.test(seat) ? `Clusters · ${seat}` : 'Clusters',
    icon: ICON.map,
    params: seat && SEAT.test(seat) ? { [SEAT_PARAM]: seat.toLowerCase() } : undefined,
  });

/** Inside the framed clusters page: just the map, and real links navigate the whole tab. */
export function initEmbed() {
  document.documentElement.classList.add('ir-embed');
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0) return;
      const url = new URL(a.href, location.href);
      // In-page things (tabs, "#" handlers, toggles) stay inside the map.
      if (url.href.split('#')[0] === location.href.split('#')[0] || a.hasAttribute('data-toggle')) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return; // new tab/window: browser default
      e.preventDefault();
      window.top!.location.href = url.href;
    },
    true,
  );
}

export const isEmbedFrame = () =>
  window !== window.top && /^https:\/\/(meta|profile)\.intra\.42\.fr$/.test(location.origin) && new URLSearchParams(location.search).has(EMBED_PARAM);
