// The new profile header ("Sleek" design). Replaces intra's banner on v2 profile pages; intra's
// original banner stays in the page (hidden) so its interactive controls keep working and we can
// drive them: title picker, cursus select and "give points".
//
// Built in layers so animated backgrounds can drop in later without touching the rest:
//   .bg (cover image today; canvas/video later) → .scrim (keeps text readable) → .inner (content)
import css from './hero.css?inline';
import { fetchCoalition, fetchGoals, fetchLogtimeWeeks, fetchPiscine, readHero, type Goals, type HeroData, type Week } from './data';
import { bindPaceTooltips, fmtIsoDate, loadPace, paceSegments, paceTrackHtml } from '../pace/timeline';
import type { PaceProfile } from '../pace/types';
import { addTooltip } from '../tooltip';
import { setHTML } from '../html';

export const HERO_ID = 'ir-hero';
const ON_CLASS = 'ir-hero-on';
const DAY_MS = 86_400_000;

// Placeholder until we wire a real source (shown with a "sample data" tag).
const SAMPLE_EVALS = { total: 142, failed: 31, outstanding: 18 };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface State {
  data: HeroData;
  goals?: Goals;
  /** Set once the goals request finished, so cards can tell "loading" from "nothing to show". */
  goalsLoaded?: boolean;
  /** Official piscine month from our API server, preferred over the one guessed from projects. */
  piscine?: string;
  /** Attendance from raw logtime, when goals have none. */
  logWeeks?: Week[];
  pace?: PaceProfile;
  coal?: Awaited<ReturnType<typeof fetchCoalition>>;
}

export function mountHero() {
  const banner = document.querySelector('.profile-item .profile-banner');
  const data = readHero();
  if (!banner || !data || document.getElementById(HERO_ID)) return;

  const host = document.createElement('div');
  host.id = HERO_ID;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const hero = document.createElement('header');
  hero.className = 'hero';
  root.append(style, hero);
  banner.before(host);
  document.documentElement.classList.add(ON_CLASS);

  const state: State = { data };
  const paint = () => render(hero, state);
  paint();

  let req = 0;
  const refresh = async () => {
    const mine = ++req;
    state.goalsLoaded = false;
    const [goals, coal] = await Promise.all([
      fetchGoals(state.data.login, state.data.cursus.value),
      fetchCoalition(state.data.login, state.data.cursus.value),
    ]);
    if (mine !== req) return; // a newer cursus was picked meanwhile
    Object.assign(state, { goals, coal, goalsLoaded: true });
    paint();
    if (!goals?.edtrax_weeks?.length && !state.logWeeks) {
      state.logWeeks = (await fetchLogtimeWeeks(state.data.login)) ?? [];
      paint();
    }
  };
  refresh();
  fetchPiscine(data.login).then((piscine) => {
    if (!piscine) return;
    state.piscine = piscine;
    paint();
  });
  loadPace(data.login, (pace) => {
    state.pace = pace;
    paint();
  });

  // Firefox restores intra's cursus select to the last choice only after we have read it (and intra
  // may switch it itself), so follow the select whenever it no longer matches what we show.
  const followSelect = () => {
    if (!state.data.cursus.el || state.data.cursus.el.value === state.data.cursus.value) return;
    state.data = readHero() ?? state.data;
    paint();
    refresh();
  };
  if (document.readyState === 'complete') followSelect();
  else window.addEventListener('load', followSelect, { once: true });
  state.data.cursus.el?.addEventListener('change', () => setTimeout(followSelect, 50));

  // Clicking anywhere else closes the title menu.
  document.addEventListener('click', () => hero.querySelector('.menu')?.classList.remove('open'));

  // Cursus picker drives intra's own select, then we re-read what intra updated.
  hero.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (!sel.matches('[data-cursus]') || !state.data.cursus.el) return;
    state.data.cursus.el.value = sel.value;
    state.data.cursus.el.dispatchEvent(new Event('change', { bubbles: true })); // followSelect picks it up
  });
}

/** Hide intra's banner (CSS keyed on html.ir-hero-on) and show it again. */
export function unmountHero() {
  document.getElementById(HERO_ID)?.remove();
  document.documentElement.classList.remove(ON_CLASS);
}

// ---------- rendering ----------

const ICON = {
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  graph: '<circle cx="12" cy="12" r="3"/><circle cx="4" cy="5" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="19" r="2"/><path d="m6 6 4 4M18 6l-4 4M6 18l4-4M18 18l-4-4"/>',
  resume: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  seat: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="16.5" cy="13.5" r="1.5"/>',
  eval: '<path d="m9 11 3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  hole: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  wave: '<path d="M2 8c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2M2 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2"/>',
};
const icon = (name: keyof typeof ICON) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

/** dd.mm.yyyy → epoch ms */
const parseDmy = (s?: string) => {
  const m = s?.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`).getTime() : undefined;
};

/** Calendar distance between two dates as big-number HTML: "3y 10m", "5m 12d", or "9 days". */
function spanHtml(fromMs: number, toMs: number) {
  const [a, b] = fromMs <= toMs ? [new Date(fromMs), new Date(toMs)] : [new Date(toMs), new Date(fromMs)];
  let months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  if (b.getDate() < a.getDate()) months--;
  const anchor = new Date(a);
  anchor.setMonth(a.getMonth() + months);
  const days = Math.floor((b.getTime() - anchor.getTime()) / DAY_MS);
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y) return `${y}<small>y</small> ${m}<small>m</small>`;
  if (m) return `${m}<small>m</small> ${days}<small>d</small>`;
  return `${days}<small> days</small>`;
}

function render(hero: HTMLElement, { data: d, goals, goalsLoaded, logWeeks, pace, coal, piscine }: State) {
  const color = coal?.color ?? d.coalition?.color ?? '#00babc';
  hero.style.setProperty('--coal', color);
  hero.style.setProperty('--cover', d.cover ? `url("${d.cover}")` : 'none');

  // ── deadline: next milestone (or blackhole while on probation) ──
  const deadlineAt = parseDmy(goals?.next_milestone);
  const daysLeft = goals?.next_milestone_days ?? (deadlineAt ? Math.ceil((deadlineAt - Date.now()) / DAY_MS) : undefined);
  // Old blackhole system: days left until the blackhole, negative once the student was absorbed.
  const bhDays = goals?.singularity;
  const absorbed = bhDays !== undefined && bhDays < 0;
  const blackhole = !!goals?.probationary_period || bhDays !== undefined;
  const danger = blackhole || (daysLeft !== undefined && daysLeft <= 14);
  const current = pace ? paceSegments(pace).find((s) => s.level === pace.milestone) : undefined;
  const used = current ? Math.min(1, Math.max(0, (Date.now() - current.from) / (current.to - current.from))) : undefined;
  const C = 2 * Math.PI * 18;

  // ── attendance: W-4 … last week ──
  const weeks = [...(goals?.edtrax_weeks?.length ? goals.edtrax_weeks : (logWeeks ?? []))].reverse();
  const weeksPending = !weeks.length && !(goalsLoaded && logWeeks);
  const maxW = Math.max(40, ...weeks.map((w) => w.hours));
  const wkLabel = (n: string) => (/last/i.test(n) ? 'Last' : n);

  const coalName = d.coalition?.name;
  const score = coal?.score ?? d.coalition?.score;
  const rank = coal?.rank ?? d.coalition?.rank;
  const failRate = Math.round((SAMPLE_EVALS.failed / SAMPLE_EVALS.total) * 100);
  const etaDays = goals?.cc_eta ? Math.ceil(((parseDmy(goals.cc_eta) ?? 0) - Date.now()) / DAY_MS) : undefined;

  setHTML(hero, `
    <div class="bg"><div class="cover"></div></div>
    <div class="scrim"></div>
    <div class="inner">
      <section class="identity">
        <div class="avatar-wrap">
          ${d.level ? `<svg class="lvl-ring" viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="47"/><circle class="fg" cx="50" cy="50" r="47" pathLength="100" stroke-dasharray="${d.level.pct} 100"/></svg>` : ''}
          ${d.avatar ? `<img class="avatar" src="${esc(d.avatar)}" alt="${esc(d.login)}">` : `<div class="avatar"></div>`}
          <span class="presence ${d.location.available ? 'on' : ''}" data-tip="${d.location.available ? `At ${esc(d.location.text)}` : 'Not on campus right now'}"></span>
          ${d.level ? `<a class="lvl-chip" href="${esc(d.level.href ?? '#')}" data-tip="${d.level.pct}% to level ${d.level.level + 1}">Level <b>${d.level.level}</b> · ${d.level.pct}%</a>` : ''}
        </div>

        <div class="who">
          ${coalName ? `<div class="coal-line">
            <span class="coal-flag">${coal?.icon ? `<img src="${esc(coal.icon)}" alt="">` : ''}</span>
            <a href="${esc(d.coalition?.href ?? '#')}">${esc(coalName)}</a>
            ${score != null ? `<span class="dot"></span><span class="stat" data-tip="Coalition score">${icon('trophy')} ${score.toLocaleString()}</span>` : ''}
            ${rank != null ? `<span class="dot"></span><span class="stat" data-tip="Rank in coalition">#${rank}</span>` : ''}
          </div>` : ''}
          <div class="name-row">
            <h1 class="name">${esc(d.name)}</h1>
            ${d.badge ? `<span class="badge" style="${d.badge.background ? `--badge-bg:url('${esc(d.badge.background)}')` : ''}">${esc(d.badge.text)}</span>` : ''}
          </div>
          <div class="title-wrap">
            <button class="title-btn ${d.own && d.titles.length ? 'pick' : ''}" data-act="titles">${esc(d.title)}${d.own && d.titles.length ? '<span class="caret">▾</span>' : ''}</button>
            ${d.own && d.titles.length ? `<div class="menu">${d.titles.map((t, i) => `<button class="${t.active ? 'on' : ''}" data-title="${i}">${esc(t.label)}</button>`).join('')}</div>` : ''}
          </div>
          <div class="chips">
            <button class="chip btn" data-act="copy" data-tip="Copy login">${icon('copy')} ${esc(d.login)}</button>
            ${d.grade ? `<span class="chip">${esc(d.grade)}</span>` : ''}
            ${piscine || d.piscine ? `<span class="chip" data-tip="${piscine ? 'Piscine' : 'C Piscine, from their first piscine project'}">${icon('wave')} Piscine · ${esc(piscine ?? d.piscine!.label)}</span>` : ''}
            ${d.cursus.options.length > 1
              ? `<label class="chip btn"><select data-cursus>${d.cursus.options.map((o) => `<option value="${esc(o.value)}" ${o.value === d.cursus.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select> ▾</label>`
              : `<span class="chip">${esc(d.cursus.value)}</span>`}
            <span class="chip ${d.location.available ? '' : 'off'}">${icon('seat')} ${esc(d.location.text)}</span>
            ${d.campus ? `<span class="chip">${icon('pin')} ${esc(d.campus)}</span>` : ''}
            ${d.email ? `<a class="chip btn" href="mailto:${esc(d.email)}">${icon('mail')} ${esc(d.email)}</a>` : ''}
          </div>
        </div>

        <div class="actions">
          ${d.links.graph ? `<a class="icon-btn" href="${esc(d.links.graph)}" data-tip="Holy graph">${icon('graph')}</a>` : ''}
          ${d.links.resume ? `<a class="icon-btn" href="${esc(d.links.resume)}" data-tip="Resume">${icon('resume')}</a>` : ''}
          ${d.links.edit ? `<a class="icon-btn" href="${esc(d.links.edit)}" data-tip="Edit profile">${icon('edit')}</a>` : ''}
          ${!d.own && d.email ? `<a class="icon-btn" href="mailto:${esc(d.email)}" data-tip="Send email">${icon('mail')}</a>` : ''}
        </div>
      </section>

      <section class="stats">
        <div class="card">
          <h3>${icon('wallet')} Points</h3>
          <div class="pair">
            <div><div class="big">${esc(d.wallet ?? '—')} <small>₳</small></div><div class="sub">Wallet</div></div>
            <div><div class="big">${esc(d.evalPoints ?? '—')}</div><div class="sub">Eval points</div></div>
          </div>
          ${d.own && d.giveEl ? '<button class="mini-btn corner" data-act="give" data-tip="Give eval points to the pool">Give</button>' : ''}
        </div>
        <div class="card">
          <h3>${icon('clock')} Attendance</h3>
          ${weeks.length ? `<div class="pair">
            <div><div class="big">${weeks.at(-1)!.hours}<small>h</small></div><div class="sub">last week</div></div>
            <div class="att">
              <div class="bars">${weeks.map((w) => `<div data-tip="${esc(wkLabel(w.name))}: ${w.hours}h · ${esc(w.text)}"><span style="height:${(w.hours / maxW) * 100}%"></span></div>`).join('')}</div>
              <div class="bars-x">${weeks.map((w) => `<span>${esc(wkLabel(w.name))}</span>`).join('')}</div>
            </div>
          </div>` : weeksPending ? '<div class="skeleton"></div>' : '<div class="big muted">—</div><div class="sub">No logtime available</div>'}
        </div>
        <div class="card">
          <h3>${icon('eval')} As evaluator <span class="sample">sample data</span></h3>
          <div class="pair">
            <div><div class="big">${SAMPLE_EVALS.total}</div><div class="sub">evaluations</div></div>
            <div class="ev">
              <div class="evbar" data-tip="${SAMPLE_EVALS.total - SAMPLE_EVALS.failed} passed · ${SAMPLE_EVALS.failed} failed (${failRate}% fail rate)">
                <span class="pass" style="flex:${SAMPLE_EVALS.total - SAMPLE_EVALS.failed}"></span><span class="fail" style="flex:${SAMPLE_EVALS.failed}"></span>
              </div>
              <div class="evlegend">
                <span><i class="pass"></i>${SAMPLE_EVALS.total - SAMPLE_EVALS.failed} passed</span>
                <span><i class="fail"></i>${SAMPLE_EVALS.failed} failed</span>
                <span class="star" data-tip="Outstanding flags given">★ ${SAMPLE_EVALS.outstanding} outstanding</span>
              </div>
            </div>
          </div>
        </div>
        <div class="card deadline ${danger ? 'danger' : ''}">
          <h3>${icon(blackhole ? 'hole' : 'flag')} ${absorbed ? 'Blackholed' : blackhole ? 'Blackhole' : 'Next deadline'}</h3>
          ${bhDays !== undefined && daysLeft === undefined ? `
            <div class="big" data-tip="${Math.abs(bhDays)} days">${spanHtml(Date.now(), Date.now() + bhDays * DAY_MS)}${absorbed ? '<small> ago</small>' : ''}</div>
            <div class="sub">${absorbed ? 'Absorbed on' : 'Blackhole on'} ${esc(goals?.bh_date ?? '')}</div>
          ` : daysLeft !== undefined ? `
            <div class="big">${daysLeft}<small> days</small></div>
            <div class="sub">${pace ? `Milestone ${pace.milestone} · ` : ''}${esc(goals?.next_milestone ?? '')}</div>
            ${used !== undefined ? `<svg class="ring" viewBox="0 0 46 46" data-tip="${Math.round(used * 100)}% of this milestone's time used"><circle class="bg" cx="23" cy="23" r="18"/><circle class="fg" cx="23" cy="23" r="18" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - used)}"/></svg>` : ''}
          ` : goalsLoaded ? `
            <div class="big muted">—</div>
            <div class="sub">No deadline in ${esc(d.cursus.options.find((o) => o.value === d.cursus.value)?.label ?? d.cursus.value)}</div>
          ` : '<div class="skeleton"></div>'}
        </div>
      </section>

      ${goals?.cc_eta || pace ? `<section class="timeline">
        <div class="tl-eta">
          <span class="label">Common Core ETA</span>
          <span class="date">${esc(pace ? fmtIsoDate(pace.eta_end_of_cursus) : goals!.cc_eta!)}</span>
          <span class="sub">${etaDays !== undefined ? `${etaDays} days` : ''}${pace?.end_of_cursus_max_deadline ? ` · max <b class="max" data-tip="Pace 24 max deadline">${fmtIsoDate(pace.end_of_cursus_max_deadline)}</b>` : ''}</span>
        </div>
        <div class="tl-scroll"><div class="tl-track">${pace ? paceTrackHtml(pace, { yearMarks: true }) : '<div class="skeleton tall"></div>'}</div></div>
      </section>` : ''}
    </div>`);

  bind(hero, d);
}

function bind(hero: HTMLElement, d: HeroData) {
  for (const el of hero.querySelectorAll<HTMLElement>('[data-tip]')) addTooltip(el, el.dataset.tip!, { placement: 'bottom', style: 'v3' });
  bindPaceTooltips(hero);

  const menu = hero.querySelector<HTMLElement>('.menu');
  hero.querySelector('[data-act="titles"]')?.addEventListener('click', (e) => {
    if (!menu) return;
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  menu?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-title]');
    if (!btn) return;
    const opt = d.titles[Number(btn.dataset.title)];
    opt.el.click(); // intra's own remote link selects the title server-side
    d.titles.forEach((t) => (t.active = t === opt));
    d.title = opt.label;
    hero.querySelector('.title-btn')!.firstChild!.textContent = opt.label;
    menu.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    menu.classList.remove('open');
  });

  hero.querySelector('[data-act="copy"]')?.addEventListener('click', () => navigator.clipboard?.writeText(d.login));
  hero.querySelector('[data-act="give"]')?.addEventListener('click', () => d.giveEl?.click());
}
