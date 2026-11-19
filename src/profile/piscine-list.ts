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
         <div class="tools">
           <input type="search" placeholder="Filter by login or name…" spellcheck="false" autocomplete="off">
           <label class="sort">Sort
             <select class="sort-by">
               <option value="level">Level</option>
               <option value="piscine">Piscine level</option>
               <option value="login">Login</option>
             </select>
           </label>
           <label class="toggle"><input type="checkbox" class="active-only"> Cadets only</label>
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
  const filter = root.querySelector<HTMLInputElement>('input[type="search"]')!;
  const activeOnly = root.querySelector<HTMLInputElement>('.active-only')!;
  const sortBy = root.querySelector<HTMLSelectElement>('.sort-by')!;

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
  const BADGE: Record<Status, string> = { cadet: '', frozen: 'Frozen', blackholed: 'Blackholed', piscine: '' };
  const TIP: Record<Status, string> = { cadet: '', frozen: 'Account frozen', blackholed: 'Blackholed', piscine: 'Did not join 42cursus' };
  const pisc = (s: PiscineStudent) => s.piscineLevel ?? -1;
  const SORTS: Record<string, (a: PiscineStudent, b: PiscineStudent) => number> = {
    // Got into 42cursus first (by that level), then the rest by piscine level.
    level: (a, b) =>
      Number(b.cursusLevel != null) - Number(a.cursusLevel != null) ||
      (b.cursusLevel ?? 0) - (a.cursusLevel ?? 0) ||
      pisc(b) - pisc(a),
    piscine: (a, b) => pisc(b) - pisc(a),
    login: () => 0,
  };
  const lvl = (n: number) => n.toFixed(2);
  const levelHtml = (s: PiscineStudent) => {
    const main = sortBy.value === 'piscine' ? s.piscineLevel : (s.cursusLevel ?? s.piscineLevel);
    if (main == null) return '';
    const isCursus = sortBy.value !== 'piscine' && s.cursusLevel != null;
    return `<span class="lvl${isCursus ? ' cc' : ''}" title="${isCursus ? `42cursus level${s.piscineLevel != null ? ` · piscine ${lvl(s.piscineLevel)}` : ''}` : 'Piscine level'}">${lvl(main)}</span>`;
  };
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = students
      .filter((s) => (!activeOnly.checked || ['cadet', 'frozen'].includes(status(s))) && (!q || s.login.includes(q) || s.name.toLowerCase().includes(q)))
      .sort((a, b) => SORTS[sortBy.value](a, b) || a.login.localeCompare(b.login));
    setHTML(
      grid,
      shown.length
        ? shown
            .map(
              (s) => {
                const st = status(s);
                return `<a class="student ${st}${s.login === opts.current ? ' current' : ''}" href="https://profile.intra.42.fr/users/${encodeURIComponent(s.login)}" target="_blank" rel="noopener" title="${TIP[st]}">
                <span class="pic"${s.image ? ` style="background-image:url('${esc(s.image)}')"` : ''}></span>
                <span class="who"><b>${esc(s.login)}</b><small>${BADGE[st] ? `<i class="badge">${BADGE[st]}</i>` : ''}${esc(s.name)}</small></span>
                ${levelHtml(s)}
              </a>`;
              },
            )
            .join('')
        : `<div class="state">No one matches.</div>`,
    );
  };
  filter.addEventListener('input', render);
  activeOnly.addEventListener('change', render);
  sortBy.addEventListener('change', render);

  fetchPiscineStudents(piscine).then((list) => {
    if (!host || !root.contains(grid)) return; // closed meanwhile
    if (!list) {
      count.textContent = 'Unavailable';
      setHTML(grid, `<div class="state">Couldn't load this piscine right now.</div>`);
      return;
    }
    students = list;
    const n = (st: Status) => list.filter((s) => status(s) === st).length;
    const admitted = list.filter((s) => s.cursusLevel != null).length;
    count.textContent = [
      `${list.length} students`,
      `${admitted} in 42cursus`,
      n('frozen') && `${n('frozen')} frozen`,
      n('blackholed') && `${n('blackholed')} blackholed`,
    ]
      .filter(Boolean)
      .join(' · ');
    render();
  });
}
