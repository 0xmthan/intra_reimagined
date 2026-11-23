// The new profile header ("Sleek" design). Replaces intra's banner on v2 profile pages; intra's
// original banner stays in the page (hidden) so its interactive controls keep working and we can
// drive them: title picker, cursus select and "give points".
//
// Built in layers so animated backgrounds can drop in later without touching the rest:
//   .bg (cover image today; canvas/video later) → .scrim (keeps text readable) → .inner (content)
import css from './hero.css?inline';
import { checkBannerUrl, fetchBanner, fetchCoalition, fetchEvalStats, fetchGoals, fetchIrUser, fetchLogtimeWeeks, fetchPiscine, fetchPiscineFromProfile, readHero, type ApiPiscine, type Badge, type EvalStats, type Goals, type HeroData, type Week } from './data';
import { PACES } from '../pace/types';
import { syncOwnTheme, showVisitedTheme } from '../theme';
import { bindPaceTooltips, fmtIsoDate, loadPace, paceSegments, paceTrackHtml } from '../pace/timeline';
import type { PaceProfile } from '../pace/types';
import { addTooltip } from '../tooltip';
import { myLogin } from '../me';
import { openPiscineList } from './piscine-list';
import { NEEDS_LOGIN, connect } from '../auth';
import { openBannerEditor } from './banner';
import { setHTML } from '../html';
import { openClusters } from '../clusters';
import { bindFriendButton } from '../friends';
import { attachBlackhole } from './blackhole';

export const HERO_ID = 'ir-hero';
const ON_CLASS = 'ir-hero-on';
const DAY_MS = 86_400_000;

/** Every pace as a chip (beside the next milestone's date): the student's highlighted, faster ones
 * crossed out, slower ones dimmed.
 * Your own profile (the pace API leaves `pace` out, null, for anyone else), or anyone on probation
 * (always pace 24). */
function pacesHtml(mine: number, own = true) {
  const all = [...new Set([...PACES, mine])].sort((a, b) => a - b);
  const chip = (p: number) => {
    const kind = p < mine ? 'gone' : p === mine ? 'mine' : 'slower';
    const tip = p === mine
      ? own ? `Your pace: common core in ${p} months` : `On probation: pace ${p}, common core in ${p} months`
      : p < mine ? `Pace ${p}: faster than ${own ? 'yours' : 'theirs'}` : `Pace ${p}`;
    return `<span class="pace ${kind}" data-tip="${tip}">${p}</span>`;
  };
  return `<div class="paces">${all.map(chip).join('')}</div>`;
}


const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface State {
  data: HeroData;
  goals?: Goals;
  /** Set once the goals request finished, so cards can tell "loading" from "nothing to show". */
  goalsLoaded?: boolean;
  /** Official piscine from our API server, preferred over the month guessed from projects. */
  piscine?: ApiPiscine;
  /** Fallback label found on the full profile page (your home page doesn't list piscine projects). */
  piscineLabel?: string;
  /** As-evaluator stats from our API server; null = unavailable (no server / request failed),
   * 'auth' = needs login with 42 first. */
  evals?: EvalStats | null | 'auth';
  /** Attendance from raw logtime, when goals have none. */
  logWeeks?: Week[];
  pace?: PaceProfile;
  coal?: Awaited<ReturnType<typeof fetchCoalition>>;
  /** Custom banner from our server; null = none (coalition cover), undefined = not known yet. */
  banner?: string | null;
  /** They use Intra Reimagined (and didn't hide it): shows the badge next to the name. */
  irUser?: boolean;
}

// Last known custom banner per login, so it shows from the first paint instead of swapping in
// after the request (the URL only; the image itself is cached by the browser).
const BANNER_CACHE = 'intra-reimagined:banner:';
const cachedBanner = (login: string) => {
  try {
    // intra's own scripts can write this page's storage too: only accept one of our image URLs.
    return checkBannerUrl(localStorage.getItem(BANNER_CACHE + login)) ?? undefined;
  } catch {
    return undefined;
  }
};
const cacheBanner = (login: string, url: string | null) => {
  try {
    if (url) localStorage.setItem(BANNER_CACHE + login, url);
    else localStorage.removeItem(BANNER_CACHE + login);
  } catch {
    /* ignore */
  }
};

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
    // Re-read intra's banner too: by now intra has finished its own cursus switch.
    state.data = readHero() ?? state.data;
    Object.assign(state, { goals, coal, goalsLoaded: true });
    paint();
    if (!goals?.edtrax_weeks?.length && !state.logWeeks) {
      state.logWeeks = (await fetchLogtimeWeeks(state.data.login)) ?? [];
      paint();
    }
  };
  refresh();
  fetchPiscine(data.login).then(async (piscine) => {
    if (piscine) state.piscine = piscine;
    else if (!data.piscine) state.piscineLabel = (await fetchPiscineFromProfile(data.login))?.label;
    if (state.piscine || state.piscineLabel) paint();
  });
  state.banner = cachedBanner(data.login);
  fetchBanner(data.login).then((banner) => {
    if (banner === undefined) return; // unknown (offline / signed out): keep what we have
    cacheBanner(data.login, banner);
    if (banner !== state.banner) {
      state.banner = banner;
      paint();
    }
  });
  fetchIrUser(data.login).then((ir) => {
    // Theme: yours follows you across devices; someone else's shows on their profile if they share it.
    if (data.own) syncOwnTheme(ir?.theme);
    else if (ir?.theme) showVisitedTheme(ir.theme);
    // Your own badge shows unless you hid it in settings.
    const on = !!ir?.user && !ir.hidden;
    if (on !== !!state.irUser) {
      state.irUser = on;
      paint();
    }
  });
  fetchEvalStats(data.login, data.own ? undefined : myLogin()).then((evals) => {
    state.evals = evals ?? null;
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


  // Piscine chip → everyone from that piscine; "Connect" → login with 42 for our server.
  hero.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-act="connect"]')) return void connect();
    if ((e.target as Element).closest('[data-act="banner"]')) {
      return void openBannerEditor({
        current: state.banner ?? null,
        coalCover: state.coal?.cover ?? state.data.cover,
        editHref: state.data.links.edit,
        onSaved: (url) => {
          state.banner = url;
          cacheBanner(state.data.login, url);
          paint();
        },
      });
    }
    const avatar = (e.target as Element).closest<HTMLImageElement>('img.avatar');
    if (avatar) return void openAvatar(avatar);
    if (!(e.target as Element).closest('[data-act="piscine"]') || !state.piscine) return;
    openPiscineList(state.piscine, { campus: state.data.campus, current: state.data.login });
  });

  // Cursus picker drives intra's own select, then we re-read what intra updated.
  hero.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (!sel.matches('[data-cursus]') || !state.data.cursus.el) return;
    state.data.cursus.el.value = sel.value;
    state.data.cursus.el.dispatchEvent(new Event('change', { bubbles: true })); // followSelect picks it up
  });
}

/** The extension's logo (public/icon.svg), for the "uses Intra Reimagined" badge. */
const IR_MARK = `<svg viewBox="0 0 128 128" aria-label="Intra Reimagined user"><rect width="128" height="128" rx="30" fill="#00babc"/><g transform="translate(64 64) scale(.88) rotate(-22) translate(-64 -64)" fill="none" stroke-linecap="round"><path d="M12 64A52 14 0 0 1 116 64" stroke="#fff" stroke-width="7"/><circle cx="64" cy="64" r="27" fill="#fff" stroke="none"/><path d="M116 64A52 14 0 0 1 12 64" stroke="#00babc" stroke-width="15"/><path d="M116 64A52 14 0 0 1 12 64" stroke="#fff" stroke-width="7"/></g></svg>`;

function badgeHtml(b: Badge) {
  const vars = [
    b.background && `--badge-bg:url('${b.background}')`,
    b.fill && `--badge-fill:${b.fill}`,
    b.color && `--badge-color:${b.color}`,
    b.stroke && `--badge-stroke:${b.stroke}`,
  ].filter(Boolean);
  return `<span class="badge" style="${esc(vars.join(';'))}">${esc(b.text)}</span>`;
}

/** Profile picture, big and centered (like Instagram). Click it to zoom in more (and back);
 * click outside it or press Escape to close. Its own layer on <html>, above intra's sidebar. */
function openAvatar(img: HTMLImageElement) {
  if (document.querySelector('ir-avatar-zoom')) return;
  const host = document.createElement('ir-avatar-zoom');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ZOOM_CSS;
  const zoom = document.createElement('div');
  zoom.className = 'avatar-zoom';
  zoom.setAttribute('role', 'dialog');
  zoom.setAttribute('aria-label', img.alt);
  const big = document.createElement('img');
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  big.addEventListener('click', (e) => {
    e.stopPropagation();
    zoom.classList.toggle('more');
  });
  zoom.append(big);
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    zoom.classList.add('closing');
    setTimeout(() => host.remove(), 150);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  zoom.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  root.append(style, zoom);
  document.documentElement.append(host);
}

const ZOOM_CSS = `
:host { all: initial; }
.avatar-zoom {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  cursor: zoom-out;
  animation: zoom-fade 160ms ease-out;
}
.avatar-zoom img {
  width: min(420px, 82vw, 82vh);
  aspect-ratio: 1;
  border-radius: 50%;
  object-fit: cover;
  background: #1c2030;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
  cursor: zoom-in;
  transition: width 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
  animation: zoom-pop 200ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}
.avatar-zoom.more img {
  width: min(760px, 94vw, 94vh);
  cursor: zoom-out;
}
.avatar-zoom.closing {
  opacity: 0;
  transition: opacity 150ms;
}
@keyframes zoom-fade {
  from { opacity: 0; }
}
@keyframes zoom-pop {
  from { transform: scale(0.4); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .avatar-zoom,
  .avatar-zoom img {
    animation: none;
    transition: none;
  }
}
`;

/** Hide intra's banner (CSS keyed on html.ir-hero-on) and show it again. */
export function unmountHero() {
  attachBlackhole(null);
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
  snow: '<path d="M12 2v20M4.9 7l14.2 10M4.9 17 19.1 7"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2M3.5 10.5l1.4-3.5 3.6.5M15.5 16.5l3.6.5 1.4-3.5M3.5 13.5l1.4 3.5 3.6-.5M15.5 7.5l3.6-.5 1.4 3.5"/>',
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

/** "You and ybarut had 4 evaluations together", with the split on hover. */
function togetherHtml(login: string, t?: EvalStats['together']) {
  if (!t) return '';
  const n = t.youEvaluatedThem + t.theyEvaluatedYou;
  if (!n) return `<div class="together muted">You and ${esc(login)} haven't evaluated each other yet</div>`;
  const times = (k: number) => (k === 1 ? 'once' : k === 2 ? 'twice' : `${k} times`);
  const you = t.youEvaluatedThem ? `You evaluated them ${times(t.youEvaluatedThem)}` : 'You never evaluated them';
  const they = t.theyEvaluatedYou ? `they evaluated you ${times(t.theyEvaluatedYou)}` : 'they never evaluated you';
  // Then each evaluation on a line of its own, newest first: the project, who evaluated whom, when.
  const when = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const lines = t.evals.map((e) => `${e.project} · ${e.you ? 'you evaluated them' : 'they evaluated you'} · ${when(e.at)}`);
  const tip = esc([`${you} · ${they}`, ...lines].join('\n'));
  return `<div class="together" data-tip="${tip}">You and <b>${esc(login)}</b> had <b>${n}</b> evaluation${n === 1 ? '' : 's'} together</div>`;
}

function render(hero: HTMLElement, { data: d, goals, goalsLoaded, logWeeks, pace, coal, piscine, piscineLabel, evals, banner, irUser }: State) {
  // Coalition look for the selected cursus. Until that cursus's data has loaded, keep showing the
  // previous one as a whole (intra's banner may be half-switched), never a mix of the two.
  const c = goalsLoaded
    ? coal
    : (coal ?? (d.coalition ? { name: d.coalition.name, color: d.coalition.color, score: d.coalition.score, rank: d.coalition.rank } : undefined));
  const cover = banner || (coal?.cover ?? (goalsLoaded || !coal ? d.cover : undefined));
  hero.style.setProperty('--coal', c?.color ?? '#00babc');
  hero.classList.toggle('custom-banner', !!banner);
  if (cover || goalsLoaded) hero.style.setProperty('--cover', cover ? `url("${cover}")` : 'none');

  // ── deadline: next milestone (or blackhole while on probation) ──
  const deadlineAt = parseDmy(goals?.next_milestone);
  const daysLeft = goals?.next_milestone_days ?? (deadlineAt ? Math.ceil((deadlineAt - Date.now()) / DAY_MS) : undefined);
  // Old blackhole system: days left until the blackhole, negative once the student was absorbed.
  const bhDays = goals?.singularity;
  const absorbed = bhDays !== undefined && bhDays < 0;
  const blackhole = !!goals?.probationary_period || bhDays !== undefined;
  const frozen = goals?.agu !== undefined && goals.agu !== null;
  // Pace system: a milestone deadline in the past means it was missed (blackholed while on probation).
  const missed = !frozen && daysLeft !== undefined && daysLeft < 0;
  const blackholed = absorbed || (missed && blackhole); // no common core ahead: no ETA/timeline
  const ccDone = !!goals?.cc_validated; // common core already validated: nothing left to time
  // Once it is, 42 counts down to alumnization (alumni-management, via the pace bridge).
  const alumniAt = ccDone && pace?.alumni?.deadline ? new Date(`${pace.alumni.deadline}T00:00:00`).getTime() : undefined;
  const alumniDays = alumniAt !== undefined ? Math.ceil((alumniAt - Date.now()) / DAY_MS) : undefined;
  // Red only where a deadline can blackhole you (probation / old blackhole); a regular pace
  // milestone, even a close or missed one, isn't one.
  const danger = !frozen && blackhole;
  // The pace API only gives your own pace; anyone on probation is on pace 24, whoever's profile it is.
  const paceNum = pace?.pace ?? (goals?.probationary_period && !frozen ? 24 : undefined);
  // The blackhole itself (blackhole.ts), closer the fewer days are left; swallowing the card once blackholed.
  const bhLeft = daysLeft ?? bhDays;
  const bh = danger && (blackholed || bhLeft !== undefined) ? { days: blackholed ? 0 : bhLeft!, gone: blackholed } : undefined;
  const current = pace ? paceSegments(pace).find((s) => s.level === pace.milestone) : undefined;
  const used = current ? Math.min(1, Math.max(0, (Date.now() - current.from) / (current.to - current.from))) : undefined;
  const C = 2 * Math.PI * 18;

  // ── attendance: W-4 … last week ──
  const weeks = [...(goals?.edtrax_weeks?.length ? goals.edtrax_weeks : (logWeeks ?? []))].reverse();
  const weeksPending = !weeks.length && !(goalsLoaded && logWeeks);
  const maxW = Math.max(40, ...weeks.map((w) => w.hours));
  const wkLabel = (n: string) => (/last/i.test(n) ? 'Last' : n);

  const coalName = c?.name;
  const score = c?.score;
  const rank = c?.rank;
  const coalHref = d.coalition && d.coalition.name === coalName ? d.coalition.href : undefined;
  const ev = evals && evals !== 'auth' ? evals : undefined;
  // Grade (Cadet, Pisciner, ...) belongs to the cursus, so it sits in the cursus chip.
  const grade = d.grade ? `<span class="grade-sep">·</span>${esc(d.grade)}` : '';
  const passed = ev ? ev.total - ev.failed : 0;
  const failRate = ev?.total ? Math.round((ev.failed / ev.total) * 100) : 0;
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
          ${coalName ? `<${coalHref ? `a href="${esc(coalHref)}"` : 'div'} class="coal-line">
            <span class="coal-flag">${coal?.icon ? `<img src="${esc(coal.icon)}" alt="">` : ''}</span>
            <span class="coal-name">${esc(coalName)}</span>
            ${score != null ? `<span class="dot"></span><span class="stat" data-tip="Coalition score">${icon('trophy')} ${score.toLocaleString()}</span>` : ''}
            ${rank != null ? `<span class="dot"></span><span class="stat" data-tip="Rank in coalition">#${rank}</span>` : ''}
          </${coalHref ? 'a' : 'div'}>` : ''}
          <div class="name-row">
            <h1 class="name">${esc(d.name)}</h1>
            ${d.badges.map(badgeHtml).join('')}
            ${irUser ? `<span class="ir-user-badge" data-tip="Uses Intra Reimagined">${IR_MARK}</span>` : ''}
          </div>
          <div class="title-wrap">
            ${d.own && d.titles.length
              ? `<label class="title-btn pick"><span class="title-text">${esc(d.title)}</span><span class="caret">▾</span><select data-title aria-label="Title">${d.titles.map((t, i) => `<option value="${i}" ${t.active ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>`
              : `<span class="title-btn">${esc(d.title)}</span>`}
          </div>
          <div class="chips">
            <button class="chip btn" data-act="copy" data-tip="Copy login">${icon('copy')} ${esc(d.login)}</button>
            ${piscine?.campusId != null
              ? `<button class="chip btn" data-act="piscine" data-tip="Piscine">${icon('wave')} ${esc(piscine.label)}</button>`
              : piscine || piscineLabel || d.piscine
                ? `<span class="chip" data-tip="Piscine">${icon('wave')} ${esc(piscine?.label ?? piscineLabel ?? d.piscine!.label)}</span>`
                : ''}
            ${d.cursus.options.length > 1
              ? `<label class="chip btn pick-cursus" data-tip="Cursus and grade">${esc(d.cursus.options.find((o) => o.value === d.cursus.value)?.label ?? d.cursus.value)}${grade} ▾<select data-cursus aria-label="Cursus">${d.cursus.options.map((o) => `<option value="${esc(o.value)}" ${o.value === d.cursus.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`
              : `<span class="chip" data-tip="Cursus and grade">${esc(d.cursus.value)}${grade}</span>`}
            ${d.location.available
              ? `<button class="chip btn" data-act="seat" data-tip="Show on the clusters map">${icon('seat')} ${esc(d.location.text)}</button>`
              : ''}
            ${d.campus ? `<span class="chip">${icon('pin')} ${esc(d.campus)}</span>` : ''}
            ${d.email ? `<a class="chip btn" href="mailto:${esc(d.email)}">${icon('mail')} ${esc(d.email)}</a>` : ''}
          </div>
        </div>

        <div class="actions">
          ${d.links.graph ? `<a class="icon-btn" href="${esc(d.links.graph)}" data-tip="Holy graph">${icon('graph')}</a>` : ''}
          ${d.links.resume ? `<a class="icon-btn" href="${esc(d.links.resume)}" data-tip="Resume">${icon('resume')}</a>` : ''}
          ${d.own && NEEDS_LOGIN
            ? `<button class="icon-btn" data-act="banner" data-tip="Change banner">${icon('edit')}</button>`
            : d.links.edit ? `<a class="icon-btn" href="${esc(d.links.edit)}" data-tip="Edit profile">${icon('edit')}</a>` : ''}
          ${!d.own && NEEDS_LOGIN ? `<button class="icon-btn friend-btn" data-act="friend" data-tip="Friends">${icon('edit')}</button>` : ''}
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
          <h3>${icon('eval')} As evaluator</h3>
          <a class="mini-btn corner" href="https://projects.intra.42.fr/users/${esc(encodeURIComponent(d.login))}/feedbacks" data-tip="Feedbacks logs">Feedbacks</a>
          ${evals === 'auth' ? '<button class="chip btn" data-act="connect">Connect with 42</button><div class="sub">to see evaluator stats and your piscine</div>' : evals ? `<div class="pair">
            <div><div class="big">${evals.total}</div><div class="sub">evaluations</div></div>
            ${evals.total ? `<div class="ev">
              <div class="evbar" data-tip="${passed} passed · ${evals.failed} failed (${failRate}% fail rate)">
                <span class="pass" style="flex:${passed}"></span><span class="fail" style="flex:${evals.failed}"></span>
              </div>
              <div class="evlegend">
                <span><i class="pass"></i>${passed} passed</span>
                <span><i class="fail"></i>${evals.failed} failed</span>
                <span class="star" data-tip="Outstanding flags given">★ ${evals.outstanding} outstanding</span>
              </div>
            </div>` : ''}
          </div>
          ${togetherHtml(d.login, evals.together)}` : evals === null ? '<div class="big muted">—</div><div class="sub">Not available right now</div>' : '<div class="skeleton"></div>'}
        </div>
        <div class="card deadline ${danger ? 'danger' : ''}${frozen ? ' frozen' : ''}${bh ? ' bh' : ''}">
          ${bh ? `<canvas class="bh-canvas" aria-hidden="true" data-days="${bh.days}" data-gone="${bh.gone ? 1 : 0}"></canvas>` : ''}
          <h3>${icon(frozen ? 'snow' : blackhole ? 'hole' : 'flag')} ${frozen ? 'Freeze' : absorbed || (missed && blackhole) ? 'Blackholed' : missed ? 'Deadline passed' : blackhole ? 'Blackhole' : ccDone && daysLeft === undefined ? (alumniAt !== undefined ? 'Alumnization' : 'Common core') : 'Next deadline'}</h3>
          ${missed ? `
            <div class="big" data-tip="${-daysLeft!} days">${spanHtml(Date.now() + daysLeft! * DAY_MS, Date.now())}<small> ago</small></div>
            <div class="sub">Missed ${pace ? `Milestone ${pace.milestone}` : 'deadline'}${blackhole ? '<br>' : ' · '}${esc(goals?.next_milestone ?? '')}</div>
          ` : frozen ? `
            <div class="big">${goals!.agu}<small> day${goals!.agu === 1 ? '' : 's'} left</small></div>
            <div class="sub">Ends ${esc(goals!.agu_date ?? '')}${goals?.next_milestone ? ` · next milestone ${esc(goals.next_milestone)}` : ''}</div>
          ` : bhDays !== undefined && daysLeft === undefined ? `
            <div class="big" data-tip="${Math.abs(bhDays)} days">${spanHtml(Date.now(), Date.now() + bhDays * DAY_MS)}${absorbed ? '<small> ago</small>' : ''}</div>
            <div class="sub">${absorbed ? 'Absorbed on' : 'Blackhole on'} ${esc(goals?.bh_date ?? '')}</div>
          ` : daysLeft !== undefined ? `
            <div class="big"${bh && used !== undefined ? ` data-tip="${Math.round(used * 100)}% of this milestone's time used"` : ''}>${daysLeft}<small> days</small></div>
            ${paceNum
              ? `<div class="sub-row${d.own ? '' : ' stacked'}"><div class="sub"${pace ? ` data-tip="Milestone ${pace.milestone} deadline"` : ''}>${esc(goals?.next_milestone ?? '')}</div>${pacesHtml(paceNum, d.own)}</div>`
              : `<div class="sub">${pace ? `Milestone ${pace.milestone} · ` : ''}${esc(goals?.next_milestone ?? '')}</div>`}
            ${used !== undefined && !bh ? `<svg class="ring" viewBox="0 0 46 46" data-tip="${Math.round(used * 100)}% of this milestone's time used"><circle class="bg" cx="23" cy="23" r="18"/><circle class="fg" cx="23" cy="23" r="18" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - used)}"/></svg>` : ''}
          ` : ccDone && alumniDays !== undefined && alumniDays > 0 ? `
            <div class="big" data-tip="${alumniDays} days">${spanHtml(Date.now(), alumniAt!)}<small> left</small></div>
            <div class="sub" data-tip="Common core validated${pace?.alumni?.counter_begin_at ? ` on ${fmtIsoDate(pace.alumni.counter_begin_at)}` : ''}">Alumni on ${fmtIsoDate(pace!.alumni!.deadline)}</div>
          ` : ccDone && alumniDays !== undefined ? `
            <div class="big">Alumni</div>
            <div class="sub">Since ${fmtIsoDate(pace!.alumni!.deadline)}</div>
          ` : ccDone ? `
            <div class="big">Done</div>
            <div class="sub">Common core validated</div>
          ` : goalsLoaded ? `
            <div class="big muted">—</div>
            <div class="sub">No deadline in ${esc(d.cursus.options.find((o) => o.value === d.cursus.value)?.label ?? d.cursus.value)}</div>
          ` : '<div class="skeleton"></div>'}
        </div>
      </section>

      ${!blackholed && !ccDone && (goals?.cc_eta || pace?.eta_end_of_cursus) ? `<section class="timeline">
        <div class="tl-eta">
          <span class="label">Common Core ETA</span>
          <span class="date">${esc(pace?.eta_end_of_cursus ? fmtIsoDate(pace.eta_end_of_cursus) : (goals?.cc_eta ?? ''))}</span>
          <span class="sub">${etaDays !== undefined ? `${etaDays} days` : ''}${pace?.end_of_cursus_max_deadline ? ` · max <b class="max" data-tip="Pace 24 max deadline · ${Math.ceil((new Date(pace.end_of_cursus_max_deadline).getTime() - Date.now()) / DAY_MS)} days">${fmtIsoDate(pace.end_of_cursus_max_deadline)}</b>` : ''}</span>
        </div>
        <div class="tl-scroll"><div class="tl-track">${pace ? paceTrackHtml(pace, { yearMarks: true }) : '<div class="skeleton tall"></div>'}</div></div>
      </section>` : ''}
    </div>`);

  bind(hero, d);
  attachBlackhole(hero.querySelector<HTMLCanvasElement>('.bh-canvas'));
}

function bind(hero: HTMLElement, d: HeroData) {
  for (const el of hero.querySelectorAll<HTMLElement>('[data-tip]')) addTooltip(el, el.dataset.tip!.split('\n'), { placement: 'bottom', style: 'v3' });
  bindPaceTooltips(hero);

  // Native title picker (a transparent <select> over the title text).
  hero.querySelector<HTMLSelectElement>('select[data-title]')?.addEventListener('change', (e) => {
    const opt = d.titles[Number((e.target as HTMLSelectElement).value)];
    if (!opt) return;
    opt.el.click(); // intra's own remote link selects the title server-side
    d.titles.forEach((t) => (t.active = t === opt));
    d.title = opt.label;
    hero.querySelector('.title-text')!.textContent = opt.label;
  });

  hero.querySelector('[data-act="copy"]')?.addEventListener('click', () => navigator.clipboard?.writeText(d.login));
  hero.querySelector('[data-act="seat"]')?.addEventListener('click', () => openClusters(d.location.text));
  hero.querySelector('[data-act="give"]')?.addEventListener('click', () => d.giveEl?.click());
  const friendBtn = hero.querySelector<HTMLButtonElement>('[data-act="friend"]');
  if (friendBtn) bindFriendButton(friendBtn, d.login);
}
