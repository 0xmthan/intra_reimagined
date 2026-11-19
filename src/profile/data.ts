// Everything the new profile header shows, read from intra's own (hidden) banner plus the same
// JSON endpoints intra's page calls. Works on your own home page and on other users' profiles.
// Interactive bits (title picker, cursus select, "give points") keep a handle on intra's original
// element so we can trigger intra's own behaviour instead of re-implementing it.
import { myLogin } from '../me';

export interface TitleOption {
  label: string;
  active: boolean;
  el: HTMLAnchorElement;
}

export interface HeroData {
  own: boolean;
  login: string;
  name: string;
  title: string;
  titles: TitleOption[];
  badge?: { text: string; background?: string };
  avatar?: string;
  cover?: string;
  coalition?: { name: string; color: string; href?: string; score?: number; rank?: number; icon?: string };
  wallet?: string;
  evalPoints?: string;
  giveEl?: HTMLElement;
  grade?: string;
  cursus: { value: string; options: { value: string; label: string }[]; el?: HTMLSelectElement };
  level?: { level: number; pct: number; href?: string };
  location: { available: boolean; text: string };
  campus?: string;
  email?: string;
  /** When the user did the C Piscine, from their earliest piscine project (e.g. "Sep 2025"). */
  piscine?: { label: string; date: Date };
  links: { graph?: string; resume?: string; edit?: string };
}

export interface Goals {
  edtrax_weeks?: Week[];
  probationary_period?: boolean;
  next_milestone?: string; // dd.mm.yyyy
  next_milestone_days?: number;
  cc_eta?: string; // dd.mm.yyyy
  cc_eta_days?: string;
  // Old blackhole system (e.g. accounts blackholed before pace): days left, negative once absorbed.
  singularity?: number;
  bh_date?: string; // dd.mm.yyyy
}

export interface Week {
  name: string;
  hours: number;
  text: string;
}

export interface CoalitionInfo {
  name?: string;
  score?: number;
  rank?: number;
  color?: string;
  icon?: string;
  cover?: string;
}

const txt = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const bgUrl = (el: Element | null | undefined) =>
  el ? getComputedStyle(el).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] : undefined;

export function readHero(): HeroData | undefined {
  const q = <T extends Element = Element>(s: string, root: ParentNode = document) => root.querySelector<T>(s);
  const qa = <T extends Element = Element>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)];

  const nameBox = q('.profile-item .profile-name');
  const loginEl = q<HTMLElement>('.profile-name .login[data-login]');
  const login = loginEl?.dataset.login;
  if (!nameBox || !login) return undefined;

  const me = myLogin();
  const own = location.pathname === '/' || me === login;

  const nameEl = q('.name', nameBox)?.cloneNode(true) as Element | undefined;
  nameEl?.querySelectorAll('.user-badge').forEach((b) => b.remove());
  const name = txt(nameEl) || login;

  const titles: TitleOption[] = qa<HTMLAnchorElement>('#title-selector .dropdown-menu a').map((a) => ({
    label: txt(a),
    active: !!a.closest('li')?.classList.contains('active'),
    el: a,
  }));

  const badgeEl = q<HTMLElement>('.profile-name .user-badge');
  const badge = badgeEl ? { text: txt(badgeEl), background: bgUrl(badgeEl) } : undefined;

  // Others' pages show their photo; your own home page only has your navbar avatar.
  const avatar = bgUrl(q('.profile-item .user-image')) ?? (own ? bgUrl(q('.user-profile-picture')) : undefined);

  const coalSpan = q<HTMLElement>('.profile-name .coalition-span');
  const coalition = coalSpan
    ? {
        name: txt(coalSpan),
        color: coalSpan.style.color || '#00babc',
        href: q<HTMLAnchorElement>('.profile-name .coalition-name a, .profile-name .user-banner a')?.href,
        score: Number(txt(q('#coalition-score .value'))) || undefined,
        rank: Number(txt(q('#coalition-rank .value'))) || undefined,
      }
    : undefined;

  const select = q<HTMLSelectElement>('.cursus-user-select');
  const cursus = {
    value: select?.value || '42cursus',
    options: qa<HTMLOptionElement>('option', select ?? document.createElement('select')).map((o) => ({ value: o.value, label: txt(o) })),
    el: select ?? undefined,
  };

  const levelEl = qa<HTMLAnchorElement>('.user-progress .progress-container').find((a) => a.dataset.cursus === cursus.value);
  const lm = txt(levelEl?.querySelector('.on-progress')).match(/level\s+(\d+)\s*-\s*(\d+)%/i);

  const status = txt(q('.user-poste-status'));
  const seat = txt(q('.user-poste-infos')).replace(/^-$/, '');
  const available = !!seat && !/unavailable/i.test(status);

  const actions = qa<HTMLAnchorElement>('.profile-name .button-actions a');

  return {
    own,
    login,
    name,
    title: titles.find((t) => t.active)?.label || txt(loginEl) || login,
    titles,
    badge,
    avatar,
    cover: bgUrl(q('.profile-item .profile-banner')),
    coalition,
    wallet: txt(q('.user-wallet-value')).replace(/\s*₳$/, '') || undefined,
    evalPoints: txt(q('.user-correction-point-value > div')) || txt(q('.user-correction-point-value')) || undefined,
    giveEl: q<HTMLElement>('.correction-point-btn') ?? undefined,
    grade: txt(q(`.user-grade[data-cursus="${cursus.value}"] .user-grade-value`)) || undefined,
    cursus,
    level: lm ? { level: Number(lm[1]), pct: Number(lm[2]), href: levelEl?.href } : undefined,
    location: { available, text: available ? seat : 'Unavailable' },
    campus: txt(q('.profile-item .icon-location')?.parentElement) || undefined,
    piscine: readPiscine(),
    email: q<HTMLAnchorElement>('.profile-item a[href^="mailto:"]')?.href.replace(/^mailto:/, '') || undefined,
    links: {
      graph: actions.find((a) => a.href.includes('graph'))?.href,
      resume: actions.find((a) => a.href.includes('resume'))?.href,
      edit: actions.find((a) => a.href.includes('/edit'))?.href,
    },
  };
}

/**
 * The profile's project list tags each project with its cursus and a date (`data-long-date`,
 * e.g. "2023-01-16 05:14:04 +0300"). The earliest C Piscine project falls in the piscine's
 * first week, which gives its month. Falls back to any piscine-like cursus.
 */
function readPiscine(root: ParentNode = document): HeroData['piscine'] {
  const items = [...root.querySelectorAll<HTMLElement>('.project-item[data-cursus]')];
  for (const re of [/(^|\s)c-piscine/, /piscine/]) {
    const dates = items
      .filter((el) => re.test(el.dataset.cursus ?? ''))
      .map((el) => el.querySelector<HTMLElement>('[data-long-date]')?.dataset.longDate)
      .map((s) => (s ? new Date(s.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2')) : undefined))
      .filter((d): d is Date => !!d && !isNaN(d.getTime()));
    if (dates.length) {
      const date = new Date(Math.min(...dates.map((d) => d.getTime())));
      return { date, label: date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) };
    }
  }
  return undefined;
}

async function getJSON<T>(url: string, withCookies = true): Promise<T | undefined> {
  try {
    const res = await fetch(url, { credentials: withCookies ? 'include' : 'omit', headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

export const fetchGoals = (login: string, cursus: string) =>
  getJSON<Goals>(`/users/${encodeURIComponent(login)}/goals?cursus=${encodeURIComponent(cursus)}`);

export async function fetchCoalition(login: string, cursus: string): Promise<CoalitionInfo | undefined> {
  const j = await getJSON<{
    coalitions_user?: { score: number; rank: number; coalition: { name: string; color: string; image_url: string; cover_url: string } };
  }>(`/users/${encodeURIComponent(login)}/coalitions?cursus=${encodeURIComponent(cursus)}`);
  const c = j?.coalitions_user;
  return c
    ? { name: c.coalition.name, score: c.score, rank: c.rank, color: c.coalition.color, icon: c.coalition.image_url, cover: c.coalition.cover_url }
    : undefined;
}

/**
 * Hours on campus for the last 4 full weeks (Mon–Sun), newest first like `edtrax_weeks`.
 * Fallback for profiles whose goals have no attendance (pisciners, blackholed accounts).
 */
export async function fetchLogtimeWeeks(login: string): Promise<Week[] | undefined> {
  const stats = await getJSON<Record<string, string>>(
    `https://translate.intra.42.fr/users/${encodeURIComponent(login)}/locations_stats.json`,
  );
  if (!stats) return undefined;
  const secs = (t: string) => t.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); // this week's Monday
  return [1, 2, 3, 4].map((ago) => {
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() - ago * 7 + i);
      total += secs(stats[iso(day)] ?? '0:0:0');
    }
    const h = Math.floor(total / 3600);
    return { name: ago === 1 ? 'Last week' : `W-${ago}`, hours: h, text: `${h}h ${Math.floor((total % 3600) / 60)}m` };
  });
}

/** Our API server (see server/), set at build time with VITE_IR_API; unset = not used. */
const IR_API = (import.meta.env.VITE_IR_API as string | undefined)?.replace(/\/+$/, '');

/** Official piscine month from 42's API via our server, e.g. "Nov 2025". */
export interface ApiPiscine {
  label: string; // "Nov 2025"
  month: string; // "november"
  year: string;
  campusId: number | null;
}

export async function fetchPiscine(login: string): Promise<ApiPiscine | undefined> {
  if (!IR_API) return undefined;
  const j = await getJSON<{ month: string | null; year: string | null; campusId?: number | null }>(
    // ?v= busts browser caches of older response shapes (bump it when the response changes).
    `${IR_API}/v1/users/${encodeURIComponent(login)}/piscine?v=2`,
    false,
  );
  if (!j?.month || !j.year) return undefined;
  const date = new Date(`${j.month} 1, ${j.year}`);
  if (isNaN(date.getTime())) return undefined;
  return { label: date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), month: j.month, year: j.year, campusId: j.campusId ?? null };
}

export interface PiscineStudent {
  login: string;
  name: string;
  image: string | null;
  active: boolean;
  piscineLevel?: number | null;
  /** 42cursus level; null = didn't get into the common core. */
  cursusLevel?: number | null;
}

/** Everyone from one piscine (same campus, month and year), via our server. */
export async function fetchPiscineStudents(p: ApiPiscine): Promise<PiscineStudent[] | undefined> {
  if (!IR_API || p.campusId === null) return undefined;
  // ?v= busts browser caches of older response shapes (bump it when the response changes).
  const j = await getJSON<{ students: PiscineStudent[] }>(`${IR_API}/v1/piscines/${p.campusId}/${p.year}/${p.month}?v=2`, false);
  return j?.students;
}

/**
 * Your home page (/) only lists a couple of recent projects, so the piscine ones may be missing;
 * the full profile page (/users/<login>) has them all.
 */
export async function fetchPiscineFromProfile(login: string): Promise<HeroData['piscine']> {
  try {
    const res = await fetch(`/users/${encodeURIComponent(login)}`, { credentials: 'include', headers: { Accept: 'text/html' } });
    if (!res.ok) return undefined;
    return readPiscine(new DOMParser().parseFromString(await res.text(), 'text/html'));
  } catch {
    return undefined;
  }
}

export interface EvalStats {
  total: number;
  failed: number;
  outstanding: number;
  /** On someone else's profile: evaluations between you and them, each way. */
  together?: { youEvaluatedThem: number; theyEvaluatedYou: number };
}

/** What this student did as an evaluator (and, with `viewer`, how often you two met), via our server. */
export async function fetchEvalStats(login: string, viewer?: string): Promise<EvalStats | undefined> {
  if (!IR_API) return undefined;
  const q = viewer && viewer !== login ? `?with=${encodeURIComponent(viewer)}` : '';
  const j = await getJSON<EvalStats>(`${IR_API}/v1/users/${encodeURIComponent(login)}/evaluations${q}`, false);
  return j && typeof j.total === 'number'
    ? { total: j.total, failed: j.failed, outstanding: j.outstanding, together: j.together }
    : undefined;
}
