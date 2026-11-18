// Everything the new profile header shows, read from intra's own (hidden) banner plus the same
// JSON endpoints intra's page calls. Works on your own home page and on other users' profiles.
// Interactive bits (title picker, cursus select, "give points") keep a handle on intra's original
// element so we can trigger intra's own behaviour instead of re-implementing it.

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
  links: { graph?: string; resume?: string; edit?: string };
}

export interface Goals {
  edtrax_weeks?: { name: string; hours: number; text: string }[];
  probationary_period?: boolean;
  next_milestone?: string; // dd.mm.yyyy
  next_milestone_days?: number;
  cc_eta?: string; // dd.mm.yyyy
  cc_eta_days?: string;
}

export interface CoalitionInfo {
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

  const me = q<HTMLAnchorElement>('.main-navbar a[href^="https://profile.intra.42.fr/users/"]')?.href.split('/users/')[1];
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
    email: q<HTMLAnchorElement>('.profile-item a[href^="mailto:"]')?.href.replace(/^mailto:/, '') || undefined,
    links: {
      graph: actions.find((a) => a.href.includes('graph'))?.href,
      resume: actions.find((a) => a.href.includes('resume'))?.href,
      edit: actions.find((a) => a.href.includes('/edit'))?.href,
    },
  };
}

async function getJSON<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

export const fetchGoals = (login: string, cursus: string) =>
  getJSON<Goals>(`/users/${encodeURIComponent(login)}/goals?cursus=${encodeURIComponent(cursus)}`);

export async function fetchCoalition(login: string, cursus: string): Promise<CoalitionInfo | undefined> {
  const j = await getJSON<{
    coalitions_user?: { score: number; rank: number; coalition: { color: string; image_url: string; cover_url: string } };
  }>(`/users/${encodeURIComponent(login)}/coalitions?cursus=${encodeURIComponent(cursus)}`);
  const c = j?.coalitions_user;
  return c
    ? { score: c.score, rank: c.rank, color: c.coalition.color, icon: c.coalition.image_url, cover: c.coalition.cover_url }
    : undefined;
}
