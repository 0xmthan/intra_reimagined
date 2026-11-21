// "Who was in this piscine": a panel listing every student of a piscine (same campus, month,
// year), opened from the piscine chip in the profile header. Data comes from our API server.
import css from './piscine-list.css?inline';
import { setHTML } from '../html';
import { fetchPiscineStudents, type ApiPiscine, type PiscineStudent } from './data';

const HOST_ID = 'ir-piscine-list';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let host: HTMLElement | undefined;
let onKey: ((e: KeyboardEvent) => void) | undefined;

function close() {
  host?.remove();
  host = undefined;
  if (onKey) document.removeEventListener('keydown', onKey, true);
  document.documentElement.classList.remove('ir-scroll-lock');
}

// 42's "active?" is false while an account is frozen (and for everyone who left), so combine it
// with the 42cursus row: in 42cursus + blackhole ahead = cadet (frozen if inactive).
type Status = 'cadet' | 'frozen' | 'blackholed' | 'piscine';
const status = (s: PiscineStudent): Status =>
  s.cursusLevel == null
    ? 'piscine'
    : s.blackholedAt && new Date(s.blackholedAt).getTime() < Date.now()
      ? 'blackholed'
      : s.active
        ? 'cadet'
        : 'frozen';

type Filter = 'all' | 'cursus' | 'frozen' | 'blackholed' | 'piscine';
const FILTERS: [Filter, string, (s: PiscineStudent) => boolean][] = [
  ['all', 'All', () => true],
  ['cursus', 'In 42cursus', (s) => s.cursusLevel != null],
  ['frozen', 'Frozen', (s) => status(s) === 'frozen'],
  ['blackholed', 'Blackholed', (s) => status(s) === 'blackholed'],
  ['piscine', 'Didn’t join', (s) => status(s) === 'piscine'],
];

type Sort = 'level' | 'piscine' | 'login';
const pisc = (s: PiscineStudent) => s.piscineLevel ?? -1;
const SORTS: [Sort, string, (a: PiscineStudent, b: PiscineStudent) => number][] = [
  // Got into 42cursus first (by that level), then the rest by piscine level.
  ['level', '42cursus', (a, b) => Number(b.cursusLevel != null) - Number(a.cursusLevel != null) || (b.cursusLevel ?? 0) - (a.cursusLevel ?? 0) || pisc(b) - pisc(a)],
  ['piscine', 'Piscine', (a, b) => pisc(b) - pisc(a)],
  ['login', 'A–Z', () => 0],
];

const lvl = (n: number) => n.toFixed(2);

/** A row of options as one pill switch (like the cards' Newest | A–Z). */
function pills<T extends string>(label: string, options: [T, string][], value: T, onPick: (v: T) => void) {
  const wrap = document.createElement('div');
  wrap.className = 'pills';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', label);
  const paint = (v: T) => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
  for (const [v, text] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = v;
    b.setAttribute('role', 'radio');
    setHTML(b, text);
    b.addEventListener('click', () => {
      paint(v);
      onPick(v);
    });
    wrap.append(b);
  }
  paint(value);
  return wrap;
}

/** Opens the list. `current` is the profile it was opened from (highlighted in the list). */
export function openPiscineList(piscine: ApiPiscine, opts: { campus?: string; current: string }) {
  close();
  host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const title = new Date(`${piscine.month} 1, ${piscine.year}`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  setHTML(
    root,
    `<style>${css}</style>
     <div class="bg">
       <section class="panel" role="dialog" aria-label="Piscine ${esc(title)}">
         <header>
           <div>
             <h2>Piscine · ${esc(title)}</h2>
             <p class="meta">${opts.campus ? `${esc(opts.campus)} · ` : ''}<span class="count">Loading…</span></p>
           </div>
           <button class="x" aria-label="Close">✕</button>
         </header>
         <div class="summary" hidden></div>
         <div class="tools">
           <input type="search" placeholder="Filter by login or name…" spellcheck="false" autocomplete="off">
           <div class="filter-slot"></div>
           <div class="sort-slot"><span class="cap">Sort</span></div>
         </div>
         <div class="grid"><div class="state">Loading students…</div></div>
       </section>
     </div>`,
  );
  document.body.appendChild(host);
  document.documentElement.classList.add('ir-scroll-lock');

  const bg = root.querySelector<HTMLElement>('.bg')!;
  const grid = root.querySelector<HTMLElement>('.grid')!;
  const count = root.querySelector<HTMLElement>('.count')!;
  const summary = root.querySelector<HTMLElement>('.summary')!;
  const filter = root.querySelector<HTMLInputElement>('input[type="search"]')!;

  root.querySelector('.x')!.addEventListener('click', close);
  bg.addEventListener('mousedown', (e) => e.target === bg && close());
  onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  filter.focus();

  let students: PiscineStudent[] = [];
  let show: Filter = 'all';
  let sort: Sort = 'level';

  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const test = FILTERS.find(([f]) => f === show)![2];
    const by = SORTS.find(([k]) => k === sort)![2];
    const shown = students
      .filter((s) => test(s) && (!q || s.login.includes(q) || s.name.toLowerCase().includes(q)))
      .sort((a, b) => by(a, b) || a.login.localeCompare(b.login));
    // The bar: each student's level against the best one in the whole piscine (same measure).
    const value = (s: PiscineStudent) => (sort === 'piscine' ? s.piscineLevel : (s.cursusLevel ?? null));
    const top = Math.max(1, ...students.map((s) => value(s) ?? 0));
    setHTML(
      grid,
      shown.length
        ? shown
            .map((s, i) => {
              const st = status(s);
              const main = sort === 'piscine' ? s.piscineLevel : s.cursusLevel;
              const second = sort === 'piscine' ? s.cursusLevel : s.piscineLevel;
              const v = value(s);
              const tag = st === 'frozen' ? '<i class="tag frozen">Frozen</i>' : st === 'blackholed' ? '<i class="tag bh">Blackholed</i>' : '';
              return `<a class="student ${st}${s.login === opts.current ? ' current' : ''}" href="https://profile.intra.42.fr/users/${encodeURIComponent(s.login)}" target="_blank" rel="noopener">
                <span class="rank">${sort === 'login' ? '' : i + 1}</span>
                <span class="pic" data-tooltip-login="${esc(s.login)}"${s.image ? ` style="background-image:url('${esc(s.image)}')"` : ''}></span>
                <span class="who">
                  <b>${esc(s.login)}${tag}</b>
                  <small>${esc(s.name)}</small>
                  <span class="bar"><i style="width:${v != null ? Math.max(2, (v / top) * 100) : 0}%"></i></span>
                </span>
                <span class="lv">
                  <b class="${sort === 'piscine' ? 'p' : main != null ? 'cc' : 'none'}" title="${sort === 'piscine' ? 'Piscine level' : '42cursus level'}">${main != null ? lvl(main) : '—'}</b>
                  <small title="${sort === 'piscine' ? '42cursus level' : 'Piscine level'}">${sort === 'piscine' ? 'cursus' : 'piscine'} ${second != null ? lvl(second) : '—'}</small>
                </span>
              </a>`;
            })
            .join('')
        : `<div class="state">No one matches.</div>`,
    );
  };
  filter.addEventListener('input', render);

  fetchPiscineStudents(piscine).then((list) => {
    if (!host || !root.contains(grid)) return; // closed meanwhile
    if (!list) {
      count.textContent = 'Unavailable';
      setHTML(grid, `<div class="state">Couldn't load this piscine right now.</div>`);
      return;
    }
    students = list;
    const n = (f: Filter) => list.filter(FILTERS.find(([k]) => k === f)![2]).length;
    count.textContent = `${list.length} students`;

    // Filters and sorts, with counts.
    root.querySelector('.filter-slot')!.replaceWith(
      pills('Show', FILTERS.map(([f, text]) => [f, `${text} <span class="n">${n(f)}</span>`]), show, (v) => ((show = v), render())),
    );
    root.querySelector('.sort-slot')!.append(pills('Sort by', SORTS.map(([k, text]) => [k, text]), sort, (v) => ((sort = v), render())));

    // At a glance: how many got in, the average piscine level, and where this profile stands.
    const admitted = n('cursus');
    const piscLevels = list.map((s) => s.piscineLevel).filter((x): x is number => x != null);
    const avg = piscLevels.length ? piscLevels.reduce((a, b) => a + b, 0) / piscLevels.length : undefined;
    const me = list.find((s) => s.login === opts.current);
    const cursusRank = me?.cursusLevel != null ? list.filter((s) => (s.cursusLevel ?? -1) > me.cursusLevel!).length + 1 : undefined;
    const piscRank = me?.piscineLevel != null ? list.filter((s) => pisc(s) > me.piscineLevel!).length + 1 : undefined;
    const stat = (big: string, label: string, tone = '') => `<div class="stat ${tone}"><b>${big}</b><span>${label}</span></div>`;
    setHTML(
      summary,
      stat(`${admitted}<small> / ${list.length}</small>`, `joined 42cursus · ${Math.round((admitted / Math.max(1, list.length)) * 100)}%`) +
        (avg !== undefined ? stat(lvl(avg), 'average piscine level') : '') +
        stat(String(n('frozen')), 'frozen', 'frozen') +
        stat(String(n('blackholed')), 'blackholed', 'bh') +
        (me ? stat(`#${cursusRank ?? piscRank}`, cursusRank ? `in 42cursus · #${piscRank ?? '—'} in piscine` : 'in piscine level', 'me') : ''),
    );
    summary.hidden = false;
    render();
  });
}
