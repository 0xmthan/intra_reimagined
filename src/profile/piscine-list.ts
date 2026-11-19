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
           <label class="toggle"><input type="checkbox" class="active-only"> Active only</label>
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
  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = students.filter(
      (s) => (!activeOnly.checked || s.active) && (!q || s.login.includes(q) || s.name.toLowerCase().includes(q)),
    );
    setHTML(
      grid,
      shown.length
        ? shown
            .map(
              (s) => `<a class="student${s.active ? '' : ' inactive'}${s.login === opts.current ? ' current' : ''}" href="https://profile.intra.42.fr/users/${encodeURIComponent(s.login)}" title="${s.active ? '' : 'Account no longer active'}">
                <span class="pic"${s.image ? ` style="background-image:url('${esc(s.image)}')"` : ''}></span>
                <span class="who"><b>${esc(s.login)}</b><small>${esc(s.name)}</small></span>
              </a>`,
            )
            .join('')
        : `<div class="state">No one matches.</div>`,
    );
  };
  filter.addEventListener('input', render);
  activeOnly.addEventListener('change', render);

  fetchPiscineStudents(piscine).then((list) => {
    if (!host || !root.contains(grid)) return; // closed meanwhile
    if (!list) {
      count.textContent = 'Unavailable';
      setHTML(grid, `<div class="state">Couldn't load this piscine right now.</div>`);
      return;
    }
    // Active accounts first, then alphabetical.
    students = [...list].sort((a, b) => Number(b.active) - Number(a.active) || a.login.localeCompare(b.login));
    const active = list.filter((s) => s.active).length;
    count.textContent = `${list.length} students · ${active} active`;
    render();
  });
}
