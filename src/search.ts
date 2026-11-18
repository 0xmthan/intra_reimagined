// ⌘K search palette, replacing the search field of intra's (removed) top bar.
// Uses the same read-only endpoints as intra's own typeahead (students, projects) plus a few
// "jump to" pages. Enter with nothing picked runs intra's full search page.
import css from './search.css?inline';
import { setHTML } from './html';
import { myLogin } from './me';

const HOST_ID = 'ir-palette';
const PROFILE = 'https://profile.intra.42.fr';
const MIN_REMOTE = 3; // intra's typeahead only asks the server from 3 characters on
const DEBOUNCE_MS = 200;

interface Item {
  group: 'Students' | 'Projects' | 'Jump to';
  label: string;
  sub?: string;
  href: string;
  img?: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function pages(): Item[] {
  const me = myLogin();
  const p = (label: string, href: string, sub?: string): Item => ({ group: 'Jump to', label, href, sub });
  return [
    p('My profile', me ? `${PROFILE}/users/${me}` : PROFILE),
    ...(me ? [p('Holy graph', `https://projects.intra.42.fr/projects/graph?login=${me}`)] : []),
    p('Manage slots', `${PROFILE}/slots`),
    p('Notifications', `${PROFILE}/notifications`),
    p('Projects', 'https://projects.intra.42.fr'),
    p('E-learning', 'https://elearning.intra.42.fr'),
    p('Shop', 'https://shop.intra.42.fr'),
    p('Settings', `${PROFILE}/users/${me ?? 'me'}/edit`),
    p('Intra Reimagined settings', `${PROFILE}/users/${me ?? 'me'}/edit#intra-reimagined`),
  ];
}

async function getJSON<T>(url: string, signal: AbortSignal): Promise<T[]> {
  try {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' }, signal });
    return res.ok ? ((await res.json()) as T[]) : [];
  } catch {
    return [];
  }
}

async function remote(q: string, signal: AbortSignal): Promise<Item[]> {
  const enc = encodeURIComponent(q);
  const [users, projects] = await Promise.all([
    getJSON<{ login: string; cdn_uri?: string }>(`${PROFILE}/searches/search.json?query=${enc}`, signal),
    getJSON<{ name: string; slug: string; url: string }>(`${PROFILE}/searches/project.json?query=${enc}`, signal),
  ]);
  return [
    ...users.slice(0, 8).map((u): Item => ({ group: 'Students', label: u.login, href: `${PROFILE}/users/${u.login}`, img: u.cdn_uri })),
    ...projects.slice(0, 6).map((p): Item => ({ group: 'Projects', label: p.name, sub: p.slug, href: p.url })),
  ];
}

let host: HTMLElement | undefined;

export function openSearch() {
  if (!host) build();
  host!.hidden = false;
  const input = host!.shadowRoot!.querySelector('input')!;
  input.select();
  input.focus();
}

function build() {
  host = document.createElement('div');
  host.id = HOST_ID;
  host.hidden = true;
  const root = host.attachShadow({ mode: 'open' });
  setHTML(
    root,
    `<style>${css}</style>
     <div class="bg">
       <div class="palette" role="dialog" aria-label="Search">
         <div class="field">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
           <input placeholder="Search students, projects, pages…" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="results">
           <kbd>esc</kbd>
         </div>
         <div class="results" id="results" role="listbox"></div>
       </div>
     </div>`,
  );
  document.body.appendChild(host);

  const bg = root.querySelector<HTMLElement>('.bg')!;
  const input = root.querySelector('input')!;
  const list = root.querySelector<HTMLElement>('.results')!;

  let items: Item[] = [];
  let active = 0;
  let loading = false;
  let timer: number | undefined;
  let ctrl: AbortController | undefined;

  const close = () => {
    host!.hidden = true;
    ctrl?.abort();
  };

  const go = (href: string, newTab: boolean) => {
    if (newTab) window.open(href, '_blank', 'noopener');
    else location.href = href;
    close();
  };

  const q = () => input.value.trim();
  const fullSearch = (): Item => ({ group: 'Jump to', label: `Search all of intra for “${q()}”`, href: `${PROFILE}/searches/search?query=${encodeURIComponent(q())}` });

  const render = () => {
    const query = q().toLowerCase();
    const local = pages().filter((p) => !query || p.label.toLowerCase().includes(query));
    const shown = [...items, ...local, ...(query ? [fullSearch()] : [])];
    active = Math.min(active, Math.max(shown.length - 1, 0));
    let html = '';
    let group = '';
    shown.forEach((it, i) => {
      if (it.group !== group) html += `<h4>${(group = it.group)}</h4>`;
      html += `<a class="row${i === active ? ' on' : ''}" href="${esc(it.href)}" data-i="${i}" role="option" aria-selected="${i === active}">
        ${it.group === 'Students' ? `<span class="pic"${it.img ? ` style="background-image:url('${esc(it.img)}')"` : ''}></span>` : ''}
        <span class="label">${esc(it.label)}</span>${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}
</a>`;
    });
    if (loading && !items.length) html = `<div class="hint">Searching…</div>` + html;
    else if (query.length >= MIN_REMOTE && !items.length && !loading) html = `<div class="hint">No students or projects match</div>` + html;
    setHTML(list, html);
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    current = shown;
  };
  let current: Item[] = [];

  input.addEventListener('input', () => {
    clearTimeout(timer);
    ctrl?.abort();
    items = [];
    active = 0;
    const query = q();
    loading = query.length >= MIN_REMOTE;
    render();
    if (!loading) return;
    timer = window.setTimeout(async () => {
      const c = (ctrl = new AbortController());
      const found = await remote(query, c.signal);
      if (c.signal.aborted) return;
      items = found;
      loading = false;
      render();
    }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = current.length;
      if (n) active = (active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = current[active] ?? (q() ? fullSearch() : undefined);
      if (it) go(it.href, e.metaKey || e.ctrlKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    e.stopPropagation(); // keep intra's own key handlers out of it
  });

  // Hover only moves the highlight; re-rendering under the pointer would swallow clicks.
  list.addEventListener('mousemove', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.row');
    if (!row || Number(row.dataset.i) === active) return;
    active = Number(row.dataset.i);
    for (const r of list.querySelectorAll<HTMLElement>('.row')) {
      const on = r === row;
      r.classList.toggle('on', on);
      r.setAttribute('aria-selected', String(on));
    }
  });
  list.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLAnchorElement>('.row');
    if (!row || e.metaKey || e.ctrlKey || e.button !== 0) return; // let the browser open new tabs
    e.preventDefault();
    go(row.href, false);
  });

  bg.addEventListener('mousedown', (e) => {
    if (e.target === bg) close();
  });

  render();
}
