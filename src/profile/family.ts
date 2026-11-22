// Patronages as a family tree: the profile's owner in the middle, their patron above (and that
// patron's patron, up to the root), and everyone they patron below (and who those patron, ...),
// joined by curved branches. Ended patronages stay in, faded with a dashed branch.
//
// The whole line comes from our server (server/family.ts). Until it answers, or if it can't, the
// tree shows the one level intra's own #patronages pane lists. Everyone links to their profile;
// "All families" opens every family at your campus (families.ts). Built with DOM APIs in a shadow
// root that replaces the pane's contents (on profile pages, and the copy in our home card).
import { fetchFamily, type Family } from './data';
import { myLogin } from '../me';
import { openFamilies } from './families';

const HOST = 'ir-family-tree';
const LOGIN = /^[a-z0-9-]{1,32}$/i;
const SLOT = 92; // horizontal room per person
const GAP = 44; // vertical room for branches between generations
const ROW = 76; // a person: avatar + name
const CENTER_ROW = 96; // the person in the middle (bigger avatar)
const DEPTH = 1; // generations shown above and below the profile's owner; further ones are a stub
const STUB = 44; // vertical room for a "continues" stub: short branches and a +N
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A CSS url() for an https image URL; anything else gets no image. */
const cssUrl = (u?: string) => (u && /^https:\/\//.test(u) ? `url("${u.replace(/["\\\n\r]/g, '')}")` : '');

/** background-image url from an element's inline style (works in fetched, unrendered documents too). */
const inlineBg = (el: Element | null | undefined) =>
  (el as HTMLElement | null | undefined)?.style?.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] || undefined;
const computedBg = (e: Element) => getComputedStyle(e).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];

type Link = Family['links'][number];

/** The one level intra's pane shows, as a Family (plus the titles intra writes next to logins). */
function readPane(pane: Element, login: string, ownerAvatar?: string) {
  const people = new Map<string, string | undefined>([[login, ownerAvatar]]);
  const titles = new Map<string, string>();
  const links: Link[] = [];
  const heading = (c: Element) => c.querySelector('h3')?.textContent?.trim().toLowerCase() ?? '';
  for (const col of pane.querySelectorAll('.col-sm-6')) {
    const up = heading(col).startsWith('patroned');
    if (!up && !heading(col).startsWith('patroning')) continue;
    for (const item of col.querySelectorAll('.patronage-item')) {
      const a = item.querySelector<HTMLAnchorElement>('a[data-tooltip-login], a[href*="/users/"]');
      const other = a?.dataset.tooltipLogin ?? a?.getAttribute('href')?.match(/\/users\/([^/?#]+)/)?.[1];
      if (!a || !other || !LOGIN.test(other)) continue;
      people.set(other, inlineBg(item.querySelector('.user-image')));
      // The link reads "login, Their Title" (or "login Their Title").
      const text = a.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const title = text.startsWith(other) ? text.slice(other.length).replace(/^[\s,]+/, '') : '';
      if (title) titles.set(other, title);
      links.push(up ? { patron: other, child: login, ongoing: true, since: '' } : { patron: login, child: other, ongoing: true, since: '' });
    }
  }
  return { family: { login, people, links, truncated: false } as Family, titles };
}

/**
 * Turns a #patronages pane into the tree. `doc` is the page the pane came from. With `header`
 * (our home card's title), "All families" and "Reports" go there as pills and the tree fills
 * the card; otherwise they sit under the tree. `login` is whose pane it is, for panes without
 * patronages (intra then leaves out the Reports link we otherwise read it from).
 */
export function renderFamilyTree(pane: Element, doc: Document = document, header?: Element, login?: string) {
  if (pane.querySelector(HOST)) return;
  const reports = pane.querySelector<HTMLAnchorElement>('a[href$="/patronages"]');
  const owner = reports?.getAttribute('href')?.match(/\/users\/([^/]+)\/patronages$/)?.[1] ?? login;
  if (!owner || !LOGIN.test(owner)) return;
  const avatarEl = doc.querySelector('.profile-item .user-image');
  const ownerAvatar = inlineBg(avatarEl) ?? (doc === document && avatarEl ? computedBg(avatarEl) : undefined);
  const page = readPane(pane, owner, ownerAvatar);

  const host = document.createElement(HOST);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const viewport = el('div', 'viewport');
  const all = el('button', header ? 'btn simple-link' : 'all');
  all.type = 'button';
  all.textContent = 'All families';
  all.addEventListener('click', () => openFamilies(owner));
  // Reports only exist where intra links them (not on a pane without patronages).
  const reportsLink = reports ? document.createElement('a') : undefined;
  if (reportsLink) {
    reportsLink.href = reports!.href;
    reportsLink.textContent = 'Reports';
  }
  const foot = el('div', 'foot');
  if (header) {
    reportsLink && (reportsLink.className = 'btn simple-link');
    const pills = el('span', 'pull-right');
    pills.append(all, ...(reportsLink ? [reportsLink] : []));
    header.append(pills);
    host.setAttribute('fill', '');
  } else foot.append(all, ...(reportsLink ? [reportsLink] : []));
  const frame = el('div', 'frame');
  frame.append(viewport, ...['up', 'down', 'left', 'right'].map((d) => el('div', `fade ${d}`)));
  root.append(style, frame, ...(header ? [] : [foot]));
  pane.replaceChildren(host);

  // Avatars: the page's first (fresher and bigger than the API's).
  const avatars = new Map<string, string>();
  page.family.people.forEach((img, l) => img && avatars.set(l, img));

  const show = (f: Family) => {
    f.people.forEach((img, l) => img && !avatars.has(l) && avatars.set(l, img));
    if (!f.links.length) return viewport.replaceChildren(emptyState(f.login, avatars.get(f.login)));
    const tree = layout(f, { avatars, titles: page.titles, center: f.login, depth: DEPTH, siblings: true });
    viewport.replaceChildren(tree.canvas);
    focus(viewport, tree.nodes.get(f.login)!);
  };

  // Soft edges where there's more to scroll to (ancestors above, more people to the sides).
  const edges = () => {
    const { scrollTop: t, scrollLeft: l, scrollHeight: h, scrollWidth: w, clientHeight: ch, clientWidth: cw } = viewport;
    frame.classList.toggle('more-up', t > 2);
    frame.classList.toggle('more-down', t + ch < h - 2);
    frame.classList.toggle('more-left', l > 2);
    frame.classList.toggle('more-right', l + cw < w - 2);
  };
  viewport.addEventListener('scroll', edges, { passive: true });
  new ResizeObserver(edges).observe(viewport);
  new MutationObserver(() => requestAnimationFrame(edges)).observe(viewport, { childList: true });
  dragToPan(viewport);

  // The page's one level right away, then the whole line from our server.
  show(page.family);
  void fetchFamily(owner).then((f) => f && f !== 'auth' && show(f));
}

/** No patronages at all (none on intra, none ended either): who it is, and that the tree is empty. */
function emptyState(login: string, avatar?: string) {
  const own = login === myLogin();
  const box = el('div', 'empty');
  const pic = el('a', 'avatar');
  pic.href = `https://profile.intra.42.fr/users/${login}`;
  const bg = cssUrl(avatar);
  if (bg) pic.style.backgroundImage = bg;
  else pic.textContent = login[0].toUpperCase();
  const title = el('div', 'empty-title');
  title.textContent = 'No patronages yet';
  const text = el('p', 'empty-text');
  text.textContent = own
    ? 'You’re not patroning anyone, and you don’t have a patron.'
    : `${login} isn’t patroning anyone and doesn’t have a patron.`;
  box.append(pic, title, text);
  return box;
}

/**
 * Click and drag (mouse or pen) moves the tree around, like a map; touch already scrolls it natively.
 * A drag that ends on a person doesn't open their profile; a plain click still does.
 */
function dragToPan(viewport: HTMLElement) {
  let start: { x: number; y: number; l: number; t: number; id: number } | undefined;
  let dragged = false;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (viewport.scrollWidth <= viewport.clientWidth && viewport.scrollHeight <= viewport.clientHeight) return; // nothing to pan
    start = { x: e.clientX, y: e.clientY, l: viewport.scrollLeft, t: viewport.scrollTop, id: e.pointerId };
    dragged = false;
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return; // still a click
    if (!dragged) {
      dragged = true;
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add('dragging');
    }
    viewport.scrollLeft = start.l - dx;
    viewport.scrollTop = start.t - dy;
  });
  const end = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    start = undefined;
    viewport.classList.remove('dragging');
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);
  viewport.addEventListener(
    'click',
    (e) => {
      if (!dragged) return;
      dragged = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  // Links and images would otherwise start the browser's own drag-and-drop.
  viewport.addEventListener('dragstart', (e) => e.preventDefault());
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

/** Scrolls the viewport (only it, never the page) so `node` sits in the middle, a bit high. */
function focus(viewport: HTMLElement, node: HTMLElement) {
  const apply = () => {
    viewport.scrollLeft = node.offsetLeft + node.offsetWidth / 2 - viewport.clientWidth / 2;
    viewport.scrollTop = node.offsetTop + node.offsetHeight / 2 - viewport.clientHeight * 0.45;
  };
  if (viewport.clientWidth) return apply();
  // A hidden tab has no size yet: do it once it's shown.
  const ro = new ResizeObserver(() => {
    if (!viewport.clientWidth || !node.isConnected) return;
    ro.disconnect();
    apply();
  });
  ro.observe(viewport);
}

/**
 * Generations as rows: ancestors above (each row centered over the person in the middle),
 * descendants below laid out as a tree (each subtree as wide as its leaves, a parent centered
 * over its children).
 */
export interface LayoutOptions {
  avatars: Map<string, string>;
  titles?: Map<string, string>;
  /** Shown bigger, with a ring (the profile's owner); none in the all-families view. */
  center?: string;
  /** Whose tree: ancestors above them, descendants below (default: f.login). */
  root?: string;
  /**
   * Generations shown each way (default: all). Someone at the edge with family beyond it gets a
   * stub instead: a few short faded branches and how many more there are, linking to their profile.
   */
  depth?: number;
  /**
   * Also show siblings (the others the patrons patron) beside them, in the order they were
   * patroned; their own patronees are a stub.
   */
  siblings?: boolean;
}

export function layout(f: Family, o: LayoutOptions) {
  const me = o.root ?? f.login;
  const big = (l: string) => l === o.center;
  const group = (key: 'child' | 'patron') => {
    const m = new Map<string, Link[]>();
    for (const l of f.links) (m.get(l[key]) ?? m.set(l[key], []).get(l[key])!).push(l);
    return m;
  };
  const patronsOf = group('child');
  const childrenOf = group('patron');

  // Everyone reachable from `l` through `next` (patrons or children) not already in view.
  const beyond = (l: string, next: Map<string, Link[]>, key: 'patron' | 'child') => {
    const seen = new Set<string>();
    const stack = [l];
    while (stack.length)
      for (const x of next.get(stack.pop()!) ?? [])
        if (!depthOf.has(x[key]) && !seen.has(x[key])) seen.add(x[key]), stack.push(x[key]);
    return seen.size;
  };
  const moreUp = new Map<string, number>(); // edge person -> how many more above them
  const moreDown = new Map<string, number>();

  // Ancestors by generation (up[0] = patrons, up[1] = their patrons, ...).
  const depthOf = new Map<string, number>([[me, 0]]);
  const up: string[][] = [];
  for (let level = [me]; ; ) {
    if (o.depth !== undefined && up.length === o.depth) {
      for (const l of level) {
        const n = beyond(l, patronsOf, 'patron');
        if (n) moreUp.set(l, n);
      }
      break;
    }
    const next: string[] = [];
    for (const l of level)
      for (const p of patronsOf.get(l) ?? [])
        if (!depthOf.has(p.patron)) depthOf.set(p.patron, -(up.length + 1)), next.push(p.patron);
    if (!next.length) break;
    up.push(next);
    level = next;
  }

  // Siblings, oldest patronage first (undated ones last), `me` in their own place among them.
  const left: string[] = [];
  const right: string[] = [];
  const sibs = new Set<string>();
  if (o.siblings && up[0]) {
    const row: Link[] = [];
    for (const l of up[0].flatMap((p) => childrenOf.get(p) ?? []))
      if (l.child === me || !depthOf.has(l.child)) if (!row.some((r) => r.child === l.child)) row.push(l);
    row.sort((a, b) => (a.since || '9').localeCompare(b.since || '9'));
    const at = row.findIndex((l) => l.child === me);
    row.forEach((l, i) => {
      if (l.child === me) return;
      (i < at ? left : right).push(l.child);
      sibs.add(l.child);
      depthOf.set(l.child, 0);
    });
  }

  // Descendants as a tree (someone with two patrons in view hangs under the first).
  const kids = new Map<string, string[]>();
  const queue = [me];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (o.depth !== undefined && depthOf.get(p) === o.depth) {
      const n = beyond(p, childrenOf, 'child');
      if (n) moreDown.set(p, n);
      continue;
    }
    for (const l of childrenOf.get(p) ?? []) {
      if (depthOf.has(l.child)) continue;
      depthOf.set(l.child, depthOf.get(p)! + 1);
      (kids.get(p) ?? kids.set(p, []).get(p)!).push(l.child);
      queue.push(l.child);
    }
  }
  for (const s of sibs) {
    const n = beyond(s, childrenOf, 'child');
    if (n) moreDown.set(s, n);
  }
  const width = new Map<string, number>();
  const measure = (l: string): number => {
    const w = Math.max(SLOT, (kids.get(l) ?? []).reduce((s, k) => s + measure(k), 0));
    width.set(l, w);
    return w;
  };
  const treeWidth = measure(me);
  const x = new Map<string, number>(); // center x of each person
  const place = (l: string, left: number) => {
    const ks = kids.get(l) ?? [];
    let cursor = left + (width.get(l)! - ks.reduce((s, k) => s + width.get(k)!, 0)) / 2;
    for (const k of ks) {
      place(k, cursor);
      cursor += width.get(k)!;
    }
    x.set(l, ks.length ? (x.get(ks[0])! + x.get(ks[ks.length - 1])!) / 2 : left + width.get(l)! / 2);
  };

  // Their row: siblings on each side, `me` over their own subtree in between.
  const rowWidth = (left.length + right.length) * SLOT + treeWidth;
  const canvasWidth = Math.max(rowWidth, ...up.map((r) => r.length * SLOT)) + 32;
  const rowStart = (canvasWidth - rowWidth) / 2;
  left.forEach((l, i) => x.set(l, rowStart + i * SLOT + SLOT / 2));
  place(me, rowStart + left.length * SLOT);
  right.forEach((l, i) => x.set(l, rowStart + left.length * SLOT + treeWidth + i * SLOT + SLOT / 2));
  // Ancestors centered over that whole row.
  const first = left[0] ?? me;
  const last = right[right.length - 1] ?? me;
  const anchor = (x.get(first)! + x.get(last)!) / 2;
  up.forEach((row) => {
    const w = row.length * SLOT;
    const start = Math.min(Math.max(16, anchor - w / 2), canvasWidth - 16 - w);
    row.forEach((l, j) => x.set(l, start + j * SLOT + SLOT / 2));
  });

  const depths = [...depthOf.values()];
  const top = Math.min(...depths);
  const bottom = Math.max(...depths);
  const centerRow = big(me) ? CENTER_ROW : ROW;
  const stubTop = moreUp.size ? STUB : 0;
  const rowY = (d: number) => 8 + stubTop + (d - top) * (ROW + GAP) + (d > 0 ? centerRow - ROW : 0);
  const height = rowY(bottom) + (bottom === 0 ? centerRow : ROW) + (moreDown.size ? STUB : 0);

  const canvas = el('div', 'canvas');
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${height}px`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('branches');
  svg.setAttribute('width', String(canvasWidth));
  svg.setAttribute('height', String(height));
  canvas.append(svg);

  // The link that joins each person toward the middle: if it ended, that person is faded.
  const linkTo = new Map<string, Link>();
  for (const l of f.links) {
    const dc = depthOf.get(l.child);
    const dp = depthOf.get(l.patron);
    if (dc === undefined || dp === undefined || dc !== dp + 1) continue;
    if ((dc > 0 || sibs.has(l.child)) && !linkTo.has(l.child)) linkTo.set(l.child, l);
    if (dp < 0 && !sibs.has(l.child) && !linkTo.has(l.patron)) linkTo.set(l.patron, l);
  }

  const nodes = new Map<string, HTMLElement>();
  for (const [l, d] of depthOf) {
    const n = node(l, big(l), o.avatars.get(l) ?? f.people.get(l), o.titles?.get(l), linkTo.get(l));
    n.style.left = `${x.get(l)! - SLOT / 2}px`;
    n.style.top = `${rowY(d)}px`;
    nodes.set(l, n);
    canvas.append(n);
  }

  // Branches: from under a patron's name to the top of their child's avatar (sizes from the CSS).
  const nodeBottom = (l: string) => rowY(depthOf.get(l)!) + 4 + (big(l) ? 60 : 44) + 4 + 22;
  for (const l of f.links) {
    const dp = depthOf.get(l.patron);
    const dc = depthOf.get(l.child);
    if (dp === undefined || dc === undefined || dc !== dp + 1) continue;
    const a = { x: x.get(l.patron)!, y: nodeBottom(l.patron) + 2 };
    const b = { x: x.get(l.child)!, y: rowY(dc) + 2 };
    const m = (b.y - a.y) / 2;
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', `M${a.x},${a.y} C${a.x},${a.y + m} ${b.x},${b.y - m} ${b.x},${b.y}`);
    if (!l.ongoing) p.classList.add('ended');
    svg.append(p);
  }

  // Stubs where the family goes on past the edge: short dotted branches from the person (three
  // fanning out below; one going up, as a line of patrons doesn't branch), and "+N" at their ends
  // (a link to that person, whose own tree shows the rest).
  const stub = (l: string, n: number, dir: 1 | -1) => {
    const cx = x.get(l)!;
    const y0 = dir > 0 ? nodeBottom(l) + 2 : rowY(depthOf.get(l)!) + 2;
    const y1 = y0 + dir * (STUB - 18);
    for (const dx of dir > 0 ? [-16, 0, 16] : [0]) {
      const p = document.createElementNS(SVG_NS, 'path');
      const m = (y1 - y0) / 2;
      p.setAttribute('d', `M${cx},${y0} C${cx},${y0 + m} ${cx + dx},${y1 - m} ${cx + dx},${y1}`);
      p.classList.add('more');
      svg.append(p);
    }
    const tag = el('a', 'more-count');
    tag.href = `https://profile.intra.42.fr/users/${encodeURIComponent(l)}`;
    tag.textContent = `+${n}`;
    tag.title = `${n} more ${dir > 0 ? 'under' : 'above'} ${l}: open their tree`;
    tag.style.left = `${cx}px`;
    tag.style.top = `${dir > 0 ? y1 + 1 : y1 - 17}px`;
    canvas.append(tag);
  };
  moreUp.forEach((n, l) => stub(l, n, -1));
  moreDown.forEach((n, l) => stub(l, n, 1));

  return { canvas, nodes };
}

function node(login: string, center: boolean, avatar: string | undefined, title: string | undefined, link?: Link) {
  const n = el('a', center ? 'node center' : 'node');
  n.href = `https://profile.intra.42.fr/users/${encodeURIComponent(login)}`;
  n.dataset.login = login;
  if (link && !link.ongoing) n.classList.add('ended');
  const av = el('span', 'avatar');
  const url = cssUrl(avatar);
  if (url) av.style.backgroundImage = url;
  else av.textContent = login.slice(0, 1).toUpperCase();
  const name = el('span', 'login');
  name.textContent = login;
  n.append(av, name);
  const tip = [login];
  if (title) tip.push(title);
  const since = link?.since ? new Date(link.since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
  if (since) tip.push(`${link!.ongoing ? 'since' : 'from'} ${since}`);
  if (link && !link.ongoing) tip.push('ended');
  n.title = tip.join(' · ');
  return n;
}

/** The tree itself (people, avatars, branches): shared with the all-families page. */
export const TREE_CSS = `
.canvas { position: relative; margin: 0 auto; animation: in 180ms ease-out; }
.branches { position: absolute; inset: 0; pointer-events: none; }
.branches path { fill: none; stroke: var(--ir-accent); stroke-width: 2; stroke-linecap: round; opacity: 0.55; }
.branches path.ended { stroke: var(--ir-faint); stroke-dasharray: 3 5; opacity: 0.7; }
.branches path.more { stroke: var(--ir-accent); stroke-dasharray: 1 5; opacity: 0.5; }
.more-count {
  position: absolute; transform: translateX(-50%); padding: 0 7px; border-radius: 999px;
  font-size: 11px; font-weight: 600; line-height: 16px; color: var(--ir-muted); text-decoration: none;
  background: rgba(var(--ir-accent-rgb), 0.1);
}
.more-count:hover { color: var(--ir-text); background: rgba(var(--ir-accent-rgb), 0.22); }
.node {
  position: absolute; width: ${SLOT}px; box-sizing: border-box; margin: 0;
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 4px 0;
  font: inherit; color: inherit; text-decoration: none; background: none; border: 0; cursor: pointer;
  border-radius: 12px; transition: transform 140ms ease, opacity 140ms ease;
}
.node:hover { transform: translateY(-2px); }
.node:hover .avatar { box-shadow: 0 0 0 2px var(--tree-bg, var(--ir-surface-2)), 0 0 0 4px var(--ir-accent), 0 6px 16px rgba(0, 0, 0, 0.35); }
.avatar {
  flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
  background: var(--ir-surface-3) center / cover no-repeat;
  box-shadow: 0 0 0 2px var(--tree-bg, var(--ir-surface-2)), 0 0 0 3px rgba(var(--ir-ink), 0.12);
  color: var(--ir-muted); font-weight: 600; font-size: 18px;
  transition: box-shadow 140ms ease;
}
.login {
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; font-weight: 500; line-height: 22px;
}
.center .avatar {
  width: 60px; height: 60px;
  box-shadow: 0 0 0 3px var(--tree-bg, var(--ir-surface-2)), 0 0 0 5px var(--ir-accent), 0 8px 22px rgba(var(--ir-accent-rgb), 0.2);
}
.center:hover .avatar { box-shadow: 0 0 0 3px var(--tree-bg, var(--ir-surface-2)), 0 0 0 5px var(--ir-accent), 0 8px 22px rgba(var(--ir-accent-rgb), 0.35); }
.center .login { font-size: 14.5px; font-weight: 600; }
.ended { opacity: 0.45; }
.ended .avatar { filter: grayscale(0.85); }
.ended:hover { opacity: 0.85; }
@keyframes in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .node, .avatar, .canvas { transition: none; animation: none; } }
`;

const CSS = `
/* --tree-bg (avatar rings, edge fades): the glass card's own color, not the old blue-grey surface. */
:host { display: block; font: 14px/1.35 futura-pt, Helvetica, Arial, sans-serif; color: var(--ir-text); --tree-bg: var(--ir-surface); }
.viewport {
  overflow: auto; max-height: 330px; cursor: grab;
  scrollbar-width: thin; scrollbar-color: rgba(var(--ir-ink), 0.15) transparent;
}
.viewport.dragging { cursor: grabbing; user-select: none; }
.viewport.dragging * { cursor: grabbing !important; }
.frame { position: relative; }
/* Home card: the tree takes the card's whole height (its buttons are in the card's title). */
:host([fill]) { height: 100%; display: flex; flex-direction: column; }
:host([fill]) .frame { flex: 1; min-height: 0; display: flex; flex-direction: column; }
:host([fill]) .viewport { flex: 1; max-height: none; }
.fade { position: absolute; pointer-events: none; opacity: 0; transition: opacity 160ms ease; z-index: 2; }
.fade.up { top: 0; left: 0; right: 0; height: 36px; background: linear-gradient(var(--tree-bg-up, var(--tree-bg)), transparent); }
.fade.down { bottom: 0; left: 0; right: 0; height: 36px; background: linear-gradient(transparent, var(--tree-bg-down, var(--tree-bg))); }
.fade.left { top: 0; bottom: 0; left: 0; width: 36px; background: linear-gradient(to right, var(--tree-bg), transparent); }
.fade.right { top: 0; bottom: 0; right: 0; width: 36px; background: linear-gradient(to left, var(--tree-bg), transparent); }
.frame.more-up .fade.up, .frame.more-down .fade.down, .frame.more-left .fade.left, .frame.more-right .fade.right { opacity: 1; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 10px 2px; }
.all {
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--ir-text); cursor: pointer;
  background: rgba(var(--ir-accent-rgb), 0.12); border: 1px solid rgba(var(--ir-accent-rgb), 0.35); border-radius: 999px; padding: 4px 12px;
}
.all:hover { background: rgba(var(--ir-accent-rgb), 0.2); }
.foot a { color: var(--ir-muted); font-size: 12.5px; text-decoration: none; }
.foot a:hover { color: var(--ir-text); text-decoration: underline; }
:focus-visible { outline: 2px solid var(--ir-accent); outline-offset: 2px; }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 100%; padding: 22px 16px; box-sizing: border-box; text-align: center; cursor: default; }
.empty .avatar {
  width: 60px; height: 60px; margin-bottom: 6px; text-decoration: none;
  box-shadow: 0 0 0 3px var(--tree-bg, var(--ir-surface-2)), 0 0 0 5px rgba(var(--ir-ink), 0.14);
}
.empty-title { font-size: 15px; font-weight: 600; }
.empty-text { margin: 0; max-width: 280px; font-size: 13px; color: var(--ir-muted); }
${TREE_CSS}`;
