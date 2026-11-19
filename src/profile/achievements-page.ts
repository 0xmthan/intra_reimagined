// The achievements page (/users/<login>/achievements, also inside our Achievements window), rebuilt
// from what intra puts in it:
//   - progress: earned of total, a bar, tier counts, and per category
//   - filters: category tabs, Earned / Locked / All, and a search
//   - a grid of cards; a series (Bonus Hunter 1–4, CodinGame Challenger: Fall/Summer/…) is one card
//     with a pip per level, its current level and what the next one asks; click it for every level
// It replaces intra's list and filters (nothing of ours depends on their scripts).
import { ago, el, parseAchievements, type Ach } from './achievements';

const KINDS: [string, string][] = [
  ['', 'All'],
  ['project', 'Project'],
  ['social', 'Social'],
  ['scolarity', 'Scolarity'],
  ['pedagogy', 'Pedagogy'],
];
const TIER_RANK = ['platinum', 'gold', 'silver', 'bronze'];
type Status = 'all' | 'earned' | 'locked';

type Group = { key: string; title: string; levels: Ach[]; earned: Ach[]; top: Ach; next?: Ach; kind?: string };

/** Series: intra's own (same data-name), or names sharing what comes before a colon. */
function groups(all: Ach[]): Group[] {
  const map = new Map<string, Ach[]>();
  const key = (a: Ach) => (a.name.includes(':') ? a.name.split(':')[0].trim() : a.series);
  for (const a of all) map.set(key(a), [...(map.get(key(a)) ?? []), a]);
  return [...map.entries()].map(([k, levels]) => {
    levels.sort((a, b) => a.level - b.level || (a.date ?? 0) - (b.date ?? 0));
    const earned = levels.filter((a) => a.done);
    const top = earned.length ? earned.reduce((a, b) => (b.level > a.level || (b.level === a.level && (b.date ?? 0) > (a.date ?? 0)) ? b : a)) : levels[0];
    const next = levels.find((a) => !a.done);
    return { key: k, title: levels.length > 1 ? k : levels[0].name, levels, earned, top, next, kind: levels[0].kind };
  });
}

const latest = (g: Group) => Math.max(0, ...g.earned.map((a) => a.date ?? 0));

function badge(a: Ach, size = '') {
  const b = el('div', `ir-ap-badge ${size}`);
  if (a.img) {
    const img = el('img');
    img.src = a.img;
    img.alt = '';
    img.loading = 'lazy';
    b.append(img);
  }
  return b;
}

function levelRow(a: Ach) {
  const r = el('div', `ir-ap-level${a.done ? ' done' : ''}`);
  const text = el('div', 'ir-ap-leveltext');
  const name = el('div', 'ir-ap-levelname', a.name);
  if (a.tier) name.append(el('span', `ir-tier dot ${a.tier}`));
  text.append(name, el('div', 'ir-ap-leveldesc', a.desc));
  const side = el('div', 'ir-ap-levelside');
  side.append(el('span', '', a.done ? (a.date ? ago(a.date) : 'Earned') : 'Locked'));
  if (a.wallet) side.append(el('span', 'ir-ap-wallet', `+${a.wallet}`));
  r.append(badge(a, 'sm'), text, side);
  return r;
}

function card(g: Group) {
  const series = g.levels.length > 1;
  const c = el('article', `ir-ap-card ${g.top.tier ?? 'none'}${g.earned.length ? '' : ' locked'}`);
  const head = el('div', 'ir-ap-cardhead');
  const text = el('div', 'ir-ap-cardtext');
  const name = el('h3', '', series ? g.title : g.top.name);
  if (g.top.tier && g.earned.length) name.append(el('span', `ir-tier dot ${g.top.tier}`));
  text.append(name);
  if (series) {
    const pips = el('div', 'ir-ap-pips');
    for (const a of g.levels) {
      const p = el('i', a.done ? `on ${a.tier ?? ''}` : '');
      p.title = a.name;
      pips.append(p);
    }
    pips.append(el('span', '', `${g.earned.length}/${g.levels.length}`));
    text.append(pips);
  }
  text.append(el('p', 'ir-ap-desc', g.top.desc));
  head.append(badge(g.top), text);
  c.append(head);

  const foot = el('div', 'ir-ap-foot');
  if (g.earned.length) {
    const when = latest(g);
    foot.append(el('span', 'ir-ap-earned', when ? `Earned ${ago(when)}` : 'Earned'));
  } else foot.append(el('span', 'ir-ap-lockedtag', 'Locked'));
  const rewards = g.levels.filter((a) => a.done && a.wallet).map((a) => Number.parseInt(a.wallet!, 10));
  if (rewards.length) foot.append(el('span', 'ir-ap-wallet', `+${rewards.reduce((x, y) => x + y, 0)}₳`));
  if (g.top.title && g.top.done) {
    const t = el('span', 'ir-ap-title', g.top.title);
    t.title = 'Title';
    foot.append(t);
  }
  c.append(foot);

  if (series && g.next && g.earned.length) {
    const nx = el('div', 'ir-ap-next');
    nx.append(el('b', '', 'Next'), ` ${g.next.desc}`);
    c.append(nx);
  }

  if (series) {
    c.classList.add('series');
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-expanded', 'false');
    const body = el('div', 'ir-ap-levels');
    body.hidden = true;
    const toggle = () => {
      const open = body.hidden === true;
      if (open && !body.childElementCount) body.append(...g.levels.map(levelRow));
      body.hidden = !open;
      c.setAttribute('aria-expanded', String(open));
      c.classList.toggle('open', open);
    };
    c.addEventListener('click', toggle);
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    c.append(body);
  }
  return c;
}

export function reworkAchievementsPage() {
  if (!/^\/users\/[a-z0-9-]+\/achievements\/?$/i.test(location.pathname)) return;
  const host = document.querySelector<HTMLElement>('.achievements-container');
  if (!host || host.dataset.irDone) return;
  const all = parseAchievements(document);
  if (!all.length) return;
  host.dataset.irDone = '1';
  document.documentElement.classList.add('ir-achp-page');
  const gs = groups(all);
  const earned = all.filter((a) => a.done);

  const root = el('section', 'ir-ap');

  // Progress.
  const top = el('header', 'ir-ap-top');
  const pct = Math.round((earned.length / all.length) * 100);
  const big = el('div', 'ir-ap-big');
  big.append(el('b', '', String(earned.length)), el('span', '', ` of ${all.length} achievements`));
  const bar = el('div', 'ir-ach-bar');
  const fill = el('i');
  fill.style.width = `${pct}%`;
  bar.append(fill);
  const stats = el('div', 'ir-ap-stats');
  for (const t of TIER_RANK) {
    const n = earned.filter((a) => a.tier === t).length;
    const s = el('span', `ir-tier ${t}`);
    s.append(el('b', '', String(n)), ` ${t}`);
    stats.append(s);
  }
  const wallet = earned.reduce((x, a) => x + (a.wallet ? Number.parseInt(a.wallet, 10) : 0), 0);
  if (wallet) stats.append(el('span', 'ir-ap-wallet', `+${wallet}₳ earned`));
  top.append(big, el('span', 'ir-ap-pct', `${pct}%`), bar, stats);

  // Filters.
  const tools = el('div', 'ir-ap-tools');
  const tabs = el('div', 'ir-ap-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = KINDS.map(([k, label]) => {
    const inKind = all.filter((a) => !k || a.kind === k);
    const b = el('button', '', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.append(el('span', '', `${inKind.filter((a) => a.done).length}/${inKind.length}`));
    b.addEventListener('click', () => {
      kind = k;
      update();
    });
    return b;
  });
  tabs.append(...tabButtons);
  const status = el('div', 'ir-sort');
  status.setAttribute('role', 'radiogroup');
  const statusButtons = (['all', 'earned', 'locked'] as Status[]).map((v) => {
    const b = el('button', '', v[0].toUpperCase() + v.slice(1));
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      st = v;
      update();
    });
    return b;
  });
  status.append(...statusButtons);
  const search = el('input', 'ir-ap-search');
  search.type = 'search';
  search.placeholder = 'Search achievements';
  search.addEventListener('input', () => update());
  tools.append(tabs, status, search);

  const grid = el('div', 'ir-ap-grid');
  const empty = el('p', 'ir-ap-empty', 'Nothing matches.');

  let kind = '';
  let st: Status = 'all';
  // Earned first (most recent first; series by their latest level), then the rest by rarity.
  const ordered = [...gs].sort(
    (a, b) =>
      Number(!!b.earned.length) - Number(!!a.earned.length) ||
      latest(b) - latest(a) ||
      TIER_RANK.indexOf(a.top.tier ?? '') - TIER_RANK.indexOf(b.top.tier ?? '') ||
      a.title.localeCompare(b.title),
  );
  const cards = new Map(ordered.map((g) => [g, card(g)]));
  grid.append(...cards.values());

  function update() {
    tabButtons.forEach((b, i) => b.setAttribute('aria-selected', String(KINDS[i][0] === kind)));
    statusButtons.forEach((b, i) => b.setAttribute('aria-checked', String((['all', 'earned', 'locked'] as Status[])[i] === st)));
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const [g, c] of cards) {
      const ok =
        (!kind || g.kind === kind) &&
        (st === 'all' || (st === 'earned' ? g.earned.length > 0 : g.earned.length < g.levels.length)) &&
        (!q || g.levels.some((a) => a.name.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q)));
      c.hidden = !ok;
      if (ok) shown++;
    }
    empty.hidden = shown > 0;
  }
  update();

  root.append(top, tools, grid, empty);
  host.replaceChildren(root);
}
