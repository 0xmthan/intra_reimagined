// v3-style milestone timeline, shown under the profile banner on v2 profile pages
// (your own home page and other users' /users/<login> pages).
import { V3_ORIGIN, type PaceMessage, type PaceProfile } from './types';
import { addTooltip } from '../tooltip';

const ROOT_ID = 'ir-pace-timeline';
const MAX_DEADLINE_ID = 'ir-max-deadline';
const CACHE_PREFIX = 'intra-reimagined:pace:'; // + login
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** True on the v2 profile home and on any user's profile page. */
export const isProfilePage = (path = location.pathname) => path === '/' || /^\/users\/[^/]+\/?$/.test(path);

export async function addPaceTimeline() {
  const banner = document.querySelector('.profile-item .profile-banner');
  const login = document.querySelector<HTMLElement>('.profile-name .login[data-login]')?.dataset.login;
  if (!banner || !login || document.getElementById(ROOT_ID)) return;

  const cached = readCache(login);
  if (cached) render(banner, cached.data);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return;

  try {
    const userId = await findUserId(login);
    if (!userId) return;
    const data = await loadViaV3(userId);
    writeCache(login, data);
    render(banner, data);
  } catch (err) {
    console.warn('[intra-reimagined] pace timeline:', err);
  }
}

// ---------- data ----------

/** The pace API needs the numeric id; v2 only shows it on your own page, so look it up by login. */
async function findUserId(login: string): Promise<string | undefined> {
  try {
    const res = await fetch(`/users/${encodeURIComponent(login)}/coalitions?cursus=42cursus`, {
      headers: { Accept: 'application/json' },
    });
    const id = res.ok ? (await res.json())?.coalitions_user?.user_id : undefined;
    if (id) return String(id);
  } catch {
    /* fall through to the link scan */
  }
  // Own profile: links like companies.intra.42.fr/users/<id>/resumes carry it.
  if (location.pathname === '/') {
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/users/"]')) {
      const id = a.href.match(/\/users\/(\d+)(?:\/|$)/)?.[1];
      if (id) return id;
    }
  }
  return undefined;
}

/** Loads profile-v3 in a hidden frame; our bridge script in there returns the pace data. */
function loadViaV3(userId: string): Promise<PaceProfile> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.src = `${V3_ORIGIN}/`;
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1280px;height:800px;opacity:0;pointer-events:none;border:0;';

    const cleanup = () => {
      clearInterval(ping);
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frame.remove();
    };
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as PaceMessage | undefined;
      if (e.origin !== V3_ORIGIN || e.source !== frame.contentWindow || msg?.type !== 'ir-pace-response') return;
      cleanup();
      if (msg.data) resolve(msg.data);
      else reject(new Error(msg.error ?? 'no data'));
    };
    // The bridge only exists once the frame's content script has loaded, so keep asking.
    const ping = setInterval(() => {
      frame.contentWindow?.postMessage({ type: 'ir-pace-request', userId } satisfies PaceMessage, V3_ORIGIN);
    }, 1000);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for profile-v3'));
    }, FETCH_TIMEOUT_MS);

    window.addEventListener('message', onMessage);
    document.body.appendChild(frame);
  });
}

function readCache(login: string): { at: number; data: PaceProfile } | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_PREFIX + login) ?? 'null');
    return v?.data?.milestones ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(login: string, data: PaceProfile) {
  try {
    localStorage.removeItem('intra-reimagined:pace'); // pre-per-user cache key
    localStorage.setItem(CACHE_PREFIX + login, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* storage blocked: we just refetch next time */
  }
}

// ---------- rendering ----------

const day = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const fmt = (iso: string) => iso.split('-').reverse().join('.');
const fmtTime = (t: number) => {
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "Took: 93 days" for validated milestones; time left / planned length otherwise. */
function durationLine(from: number, to: number, done: boolean) {
  if (done) return `Took: ${plural(Math.round((to - from) / DAY_MS), 'day')}`;
  const now = Date.now();
  if (now >= from && now < to) return plural(Math.ceil((to - now) / DAY_MS), 'day') + ' left';
  return `Duration: ${plural(Math.round((to - from) / DAY_MS), 'day')}`;
}

function label(level: number, widthPct: number) {
  if (widthPct >= 12) return `Milestone ${level}`;
  if (widthPct >= 6) return `M.${level}`;
  if (widthPct >= 4 && level > 0) return String(level);
  return '';
}

function render(banner: Element, pace: PaceProfile) {
  const start = day(pace.cursus_begin_date);
  const milestones = [...pace.milestones].sort((a, b) => a.level - b.level);

  let prevEnd = start;
  const segments = milestones.map((m) => {
    const end = day(m.validated_at ?? m.deadline);
    const seg = { m, from: prevEnd, to: Math.max(end, prevEnd + DAY_MS) };
    prevEnd = seg.to;
    return seg;
  });
  const end = Math.max(day(pace.eta_end_of_cursus), prevEnd);
  const span = end - start;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100));

  const months: string[] = [];
  const first = new Date(start);
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d.getTime() <= end; d.setMonth(d.getMonth() + 1)) {
    const left = pct(d.getTime());
    months.push(`<span class="ir-pace-month" style="left:${left}%">${MONTHS[d.getMonth()]}</span>`);
  }

  const bars = segments
    .map(({ m, from, to }) => {
      const left = pct(from);
      const width = pct(to) - left;
      const done = !!m.validated_at;
      const text = label(m.level, width);
      return `<div class="ir-pace-seg${done ? ' done' : ''}${m.level === pace.milestone ? ' current' : ''}" style="left:${left}%;width:${width}%" data-begin="${fmtTime(from)}" data-end="${fmtTime(to)}" data-took="${durationLine(from, to, done)}">
        <span class="ir-pace-check">${done ? '✓' : ''}</span>${text ? `<span class="ir-pace-label">${text}</span>` : ''}
      </div>`;
    })
    .join('');

  const now = Date.now();
  const today = now >= start && now <= end ? `<div class="ir-pace-today" style="left:${pct(now)}%"></div>` : '';

  const root = document.getElementById(ROOT_ID) ?? document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <div class="ir-pace-eta">
      <div>Common Core ETA:</div>
      <b>${fmt(pace.eta_end_of_cursus)}</b>
    </div>
    <div class="ir-pace-scroll">
      <div class="ir-pace-track">
        <div class="ir-pace-months">${months.join('')}</div>
        <div class="ir-pace-bars">${bars}</div>
        ${today}
      </div>
    </div>`;
  if (!root.isConnected) banner.after(root);

  // Same hover boxes as v3.
  for (const seg of root.querySelectorAll<HTMLElement>('.ir-pace-seg')) {
    addTooltip(seg, [`Begin at: ${seg.dataset.begin}`, `End at: ${seg.dataset.end}`, seg.dataset.took!], {
      placement: 'bottom',
      style: 'v3',
    });
  }
  const etaValue = root.querySelector<HTMLElement>('.ir-pace-eta b');
  if (etaValue && pace.end_of_cursus_max_deadline) {
    addTooltip(etaValue, `Pace 24 max deadline: ${fmt(pace.end_of_cursus_max_deadline)}`, { placement: 'bottom', style: 'v3' });
  }

  renderMaxDeadline(pace);
}

/** Adds "Pace 24 max deadline" under Common Core ETA in v2's milestone box, like v3's tooltip. */
function renderMaxDeadline(pace: PaceProfile) {
  const max = pace.end_of_cursus_max_deadline;
  const eta = document.querySelector('#milestones-tab .eta');
  if (!max || !eta) return;

  const row = document.getElementById(MAX_DEADLINE_ID) ?? eta.cloneNode(true) as HTMLElement;
  row.id = MAX_DEADLINE_ID;
  // Own class names: intra's JS later rewrites every `.eta .end-goal` with the ETA date.
  row.className = 'ir-max-deadline';
  const title = row.querySelector('.coalition-span');
  if (title) title.textContent = ' Pace 24 Max Deadline ';
  const value = row.querySelector<HTMLElement>('.end-goal, .ir-end-goal');
  const etaValue = eta.querySelector('.end-goal');
  if (value) {
    value.className = 'ir-end-goal';
    value.textContent = fmt(max);
    // Same "N days left" hover as intra's other dates in this box.
    const days = Math.ceil((day(max) - Date.now()) / DAY_MS);
    value.removeAttribute('data-original-title');
    value.removeAttribute('aria-describedby');
    if (!value.dataset.irTooltip) {
      value.dataset.irTooltip = '1';
      addTooltip(value, `${days} days left`);
    }
    // Size it exactly like the ETA date, whose styles are keyed on the classes we dropped.
    if (etaValue) {
      const s = getComputedStyle(etaValue);
      for (const p of ['font-size', 'font-weight', 'letter-spacing', 'line-height', 'font-family'] as const) {
        value.style.setProperty(p, s.getPropertyValue(p));
      }
    }
  }
  if (!row.isConnected) eta.after(row);
}
