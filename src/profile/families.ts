// "All families": every patronage family at your campus, each drawn as its own tree from its
// root (someone with no patron) down, biggest first, yours on top. A search box narrows the
// families to the ones with a matching login and marks them. Everyone links to their profile.
// Data from our server (GET /v1/patronages, server/family.ts); the tree layout is family.ts's.
import { fetchCampusFamilies, type Family } from './data';
import { TREE_CSS, layout } from './family';

const HOST = 'ir-families';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** One tree per root: the root and everyone below them, with the links among them. */
function familiesOf(all: Pick<Family, 'people' | 'links'>): Family[] {
  const hasPatron = new Set(all.links.map((l) => l.child));
  const childrenOf = new Map<string, string[]>();
  for (const l of all.links) (childrenOf.get(l.patron) ?? childrenOf.set(l.patron, []).get(l.patron)!).push(l.child);
  const roots = [...childrenOf.keys()].filter((l) => !hasPatron.has(l));
  return roots.map((root) => {
    const members = new Set([root]);
    const queue = [root];
    for (let i = 0; i < queue.length; i++)
      for (const c of childrenOf.get(queue[i]) ?? []) if (!members.has(c)) members.add(c), queue.push(c);
    return {
      login: root,
      people: new Map([...members].map((l) => [l, all.people.get(l)])),
      links: all.links.filter((l) => members.has(l.patron) && members.has(l.child)),
      truncated: false,
    };
  });
}

export function openFamilies(me: string) {
  if (document.querySelector(HOST)) return;
  const host = document.createElement(HOST);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS + TREE_CSS; // joined here: family.ts imports this module too

  const backdrop = el('div', 'backdrop');
  const panel = el('div', 'panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Patronage families');
  const head = el('div', 'head');
  const titles = el('div', 'titles');
  const sub = el('div', 'sub', 'Loading…');
  titles.append(el('h2', 'title', 'Patronage families'), sub);
  const search = el('input', 'search');
  search.type = 'search';
  search.placeholder = 'Find a login';
  search.spellcheck = false;
  search.autocomplete = 'off';
  const close = el('button', 'close', '×');
  close.setAttribute('aria-label', 'Close');
  head.append(titles, search, close);
  const body = el('div', 'body');
  const status = el('div', 'status', 'Loading every family at your campus…');
  body.append(status);
  panel.append(head, body);
  backdrop.append(panel);
  root.append(style, backdrop);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') shut();
  };
  function shut() {
    document.removeEventListener('keydown', onKey, true);
    host.remove();
  }
  close.addEventListener('click', shut);
  backdrop.addEventListener('click', (e) => e.target === backdrop && shut());
  document.addEventListener('keydown', onKey, true);
  document.documentElement.append(host);
  search.focus();

  void fetchCampusFamilies().then((all) => {
    if (!host.isConnected) return;
    if (all === 'auth') return void (status.textContent = 'Log in with 42 to see everyone’s families.');
    if (!all) return void (status.textContent = 'Couldn’t load the families right now. Try again in a bit.');

    const families = familiesOf(all)
      .map((f) => ({ f, size: f.people.size, mine: f.people.has(me) }))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || b.size - a.size || a.f.login.localeCompare(b.f.login));
    const people = new Set(families.flatMap(({ f }) => [...f.people.keys()]));
    sub.textContent = `${families.length} families · ${people.size} people at your campus and their patrons`;
    if (!families.length) return void (status.textContent = 'No patronages here yet.');

    const avatars = new Map<string, string>();
    const grid = el('div', 'grid');
    const cards = families.map(({ f, size, mine }) => {
      const card = el('section', mine ? 'card mine' : 'card');
      const label = el('div', 'label');
      label.append(el('span', 'root', `${f.login}’s family`), el('span', 'count', `${size}`));
      const scroll = el('div', 'scroll');
      const tree = layout(f, { avatars });
      tree.nodes.get(me)?.classList.add('me');
      scroll.append(tree.canvas);
      card.append(label, scroll);
      grid.append(card);
      return { card, logins: [...f.people.keys()], nodes: tree.nodes };
    });
    status.remove();
    body.append(grid);
    // Wide families scroll sideways: start on you if you're in it, else on its root.
    requestAnimationFrame(() => {
      for (const c of cards) {
        const scroll = c.card.querySelector<HTMLElement>('.scroll')!;
        if (scroll.scrollWidth <= scroll.clientWidth) continue;
        const n = c.nodes.get(me) ?? c.nodes.get(c.logins[0])!;
        scroll.scrollLeft = n.offsetLeft + n.offsetWidth / 2 - scroll.clientWidth / 2;
      }
    });
    const empty = el('div', 'status', 'Nobody with that login here.');
    empty.hidden = true;
    body.append(empty);

    const filter = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const c of cards) {
        const hits = q ? c.logins.filter((l) => l.includes(q)) : [];
        c.card.hidden = !!q && !hits.length;
        if (!c.card.hidden) shown++;
        c.nodes.forEach((n, l) => n.classList.toggle('hit', hits.includes(l)));
      }
      empty.hidden = shown > 0;
    };
    search.addEventListener('input', filter);
    // Enter: bring the first match into view.
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const hit = root.querySelector<HTMLElement>('.card:not([hidden]) .node.hit');
      hit?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      hit?.focus({ preventScroll: true });
    });
    if (search.value) filter();
  });
}

const CSS = `
:host { all: initial; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 24px;
  background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  font: 14px/1.4 futura-pt, Helvetica, Arial, sans-serif; color: #e2e4ea;
  animation: fade 140ms ease-out;
}
.panel {
  --tree-bg: #1b1f27;
  width: min(1200px, 100%); height: min(860px, 100%); box-sizing: border-box; display: flex; flex-direction: column;
  border-radius: 16px; background: #14171d; border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45); overflow: hidden;
}
.head {
  display: flex; align-items: center; gap: 16px; padding: 18px 20px; flex-wrap: wrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.titles { flex: 1; min-width: 200px; }
.title { margin: 0; font-size: 20px; font-weight: 600; }
.sub { color: #a1a7b5; font-size: 13px; margin-top: 2px; }
.search {
  width: 220px; max-width: 100%; box-sizing: border-box; font: inherit; color: inherit;
  background: #1b1f27; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 8px 12px;
}
.search:focus { outline: none; border-color: #00babc; }
.close {
  font: inherit; font-size: 22px; line-height: 1; color: #a1a7b5; cursor: pointer;
  background: rgba(255, 255, 255, 0.06); border: 0; border-radius: 10px; width: 36px; height: 36px;
}
.close:hover { color: #e2e4ea; background: rgba(255, 255, 255, 0.11); }
.body {
  flex: 1; overflow: auto; padding: 18px 20px 24px;
  scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
.grid { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; }
.card {
  flex: 0 1 auto; max-width: 100%; box-sizing: border-box; background: #1b1f27;
  border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 14px; padding: 10px 6px 6px;
}
.card[hidden] { display: none; }
.card.mine { border-color: rgba(0, 186, 188, 0.45); }
.label { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 0 10px 4px; }
.root { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #737a8a; }
.count { font-size: 12px; color: #737a8a; }
.scroll { overflow-x: auto; scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.15) transparent; }
.node.me .avatar { box-shadow: 0 0 0 2px var(--tree-bg), 0 0 0 4px #00babc; }
.node.me .login { color: #00babc; font-weight: 600; }
.node.hit .avatar { box-shadow: 0 0 0 2px var(--tree-bg), 0 0 0 4px #f5c451, 0 0 18px rgba(245, 196, 81, 0.35); }
.node.hit .login { color: #f5c451; font-weight: 600; }
.status { color: #a1a7b5; padding: 40px 0; text-align: center; }
.status[hidden] { display: none; }
:focus-visible { outline: 2px solid #00babc; outline-offset: 2px; }
@keyframes fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .backdrop { animation: none; } }
`;
