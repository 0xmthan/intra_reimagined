// Home page Logtime card, reworked: intra draws a bare month calendar. This shows hours per day
// as numbers that matter (this week vs last, this month, daily average, current and longest
// streak, best day, this year, all time), a calendar heatmap (one square per day, Monday to
// Sunday, scrolling back through the whole history) and hours per week as bars.
// Data: every session from our server (all time, server/logtime.ts), split into local days; without
// it, intra's locations_stats (only the last ~4 months). Built with DOM APIs in a shadow root
// inside the card; intra's own calendar is hidden.
import { myLogin } from '../me';
import { fetchLogtimeSessions } from './data';

const HOST = 'ir-logtime';
const DAY = 86_400_000;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Day {
  date: Date; // local midnight
  hours: number;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const secs = (t: string) => t.split(':').reduce((acc, n) => acc * 60 + (Number(n) || 0), 0);
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const fmtH = (h: number) => (h >= 10 ? `${Math.round(h)}` : h >= 1 ? h.toFixed(1).replace(/\.0$/, '') : h > 0 ? `${Math.round(h * 60)}m` : '0');
const hm = (h: number) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
const short = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** Like short, plus the year when it isn't this one (all-time records can be from long ago). */
const dated = (d: Date) =>
  d.toLocaleDateString('en-GB', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });

/** Every day from `first` to today, zeros included. */
function fillDays(first: Date, hoursOn: (isoDay: string) => number): Day[] {
  const days: Day[] = [];
  const today = midnight(new Date());
  for (let t = midnight(first); t <= today; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
    days.push({ date: t, hours: hoursOn(iso(t)) });
  }
  return days;
}

/** Sessions split at local midnights into hours per day (same numbers as intra's own stats). */
function sessionsToDays(sessions: [number, number | null][]): Day[] {
  const byDay = new Map<string, number>();
  const now = Date.now();
  for (const [start, stop] of sessions) {
    const end = Math.min(stop ?? now, now);
    for (let a = new Date(start); a.getTime() < end; ) {
      const next = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1);
      const b = Math.min(next.getTime(), end);
      byDay.set(iso(a), (byDay.get(iso(a)) ?? 0) + (b - a.getTime()) / 3_600_000);
      a = new Date(b);
    }
  }
  return fillDays(new Date(sessions[0][0]), (d) => byDay.get(d) ?? 0);
}

/** All-time days from our server, or undefined (no server, signed out, no sessions). */
async function fetchAllDays(login: string): Promise<Day[] | undefined> {
  const sessions = await fetchLogtimeSessions(login);
  return sessions?.length ? sessionsToDays(sessions) : undefined;
}

/** Intra's own stats: only about the last four months. */
async function fetchDays(login: string): Promise<Day[] | undefined> {
  try {
    const res = await fetch(`https://translate.intra.42.fr/users/${encodeURIComponent(login)}/locations_stats.json`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return undefined;
    const stats = (await res.json()) as Record<string, string>;
    const keys = Object.keys(stats).filter((k) => /^\d{4}-\d\d-\d\d$/.test(k)).sort();
    if (!keys.length) return [];
    const [y, m, d] = keys[0].split('-').map(Number);
    return fillDays(new Date(y, m - 1, d), (day) => secs(stats[day] ?? '0:0:0') / 3600);
  } catch {
    return undefined;
  }
}

function summarize(days: Day[]) {
  const today = midnight(new Date());
  const byIso = new Map(days.map((d) => [iso(d.date), d.hours]));
  const sum = (from: Date, to: Date) => days.filter((d) => d.date >= from && d.date < to).reduce((s, d) => s + d.hours, 0);

  const thisMonday = mondayOf(today);
  const week = sum(thisMonday, new Date(today.getTime() + DAY));
  // Last week up to the same weekday, so the comparison is fair mid-week.
  const lastMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const lastSoFar = sum(lastMonday, new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() + ((today.getDay() + 6) % 7) + 1));
  const month = sum(new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getTime() + DAY));

  const last30 = days.filter((d) => d.date > new Date(today.getTime() - 30 * DAY));
  const active30 = last30.filter((d) => d.hours > 0);
  const avg = active30.length ? active30.reduce((s, d) => s + d.hours, 0) / active30.length : 0;

  // Current streak: days in a row with logtime, ending today (or yesterday, if today hasn't started).
  let streak = 0;
  let t = byIso.get(iso(today)) ? today : new Date(today.getTime() - DAY);
  while ((byIso.get(iso(t)) ?? 0) > 0) {
    streak++;
    t = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  }
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.hours > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const best = days.reduce<Day | undefined>((b, d) => (!b || d.hours > b.hours ? d : b), undefined);
  const year = sum(new Date(today.getFullYear(), 0, 1), new Date(today.getTime() + DAY));
  const lastYear = sum(new Date(today.getFullYear() - 1, 0, 1), new Date(today.getFullYear(), 0, 1));
  const total = days.reduce((s, d) => s + d.hours, 0);
  return { week, lastSoFar, month, avg, activeDays: active30.length, streak, longest, best, year, lastYear, total };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tile(label: string, value: string, unit: string, sub?: string, tone?: 'up' | 'down') {
  const t = el('div', 'tile');
  const v = el('div', 'big', value);
  if (unit) v.append(el('small', '', unit));
  t.append(v, el('div', 'label', label));
  if (sub) t.append(el('div', `sub${tone ? ` ${tone}` : ''}`, sub));
  return t;
}

const level = (h: number) => (h <= 0 ? 0 : h < 2 ? 1 : h < 4 ? 2 : h < 6 ? 3 : h < 8 ? 4 : 5);

/** Days as a Monday-to-Sunday heatmap, newest week on the right, months labelled on top. */
function heatmap(days: Day[]) {
  const wrap = el('div', 'heat');
  const today = midnight(new Date());
  const first = mondayOf(days[0].date);
  const weeks = Math.round((mondayOf(today).getTime() - first.getTime()) / (7 * DAY)) + 1;
  const byIso = new Map(days.map((d) => [iso(d.date), d.hours]));

  const monthHours = new Map<string, number>();
  for (const d of days) {
    const k = `${d.date.getFullYear()}-${d.date.getMonth()}`;
    monthHours.set(k, (monthHours.get(k) ?? 0) + d.hours);
  }

  const months = el('div', 'months');
  months.style.gridTemplateColumns = `repeat(${weeks}, var(--cell))`;
  const grid = el('div', 'grid');
  grid.style.gridTemplateColumns = `repeat(${weeks}, var(--cell))`;
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const monday = new Date(first.getFullYear(), first.getMonth(), first.getDate() + w * 7);
    const label = el('span', '');
    // Label a column when a new month starts in it.
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    if (sunday.getMonth() !== lastMonth) {
      // January carries its year, so scrolling back through the history stays readable.
      label.textContent = sunday.toLocaleDateString('en-GB', sunday.getMonth() === 0 ? { month: 'short', year: '2-digit' } : { month: 'short' });
      label.title = `${sunday.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · ${hm(monthHours.get(`${sunday.getFullYear()}-${sunday.getMonth()}`) ?? 0)}`;
      lastMonth = sunday.getMonth();
    }
    months.append(label);
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const cell = el('span', 'cell');
      if (date > today || date < days[0].date) cell.classList.add('out');
      else {
        const h = byIso.get(iso(date)) ?? 0;
        cell.dataset.l = String(level(h));
        cell.title = `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${h > 0 ? hm(h) : 'no logtime'}`;
        if (date.getTime() === today.getTime()) cell.classList.add('today');
      }
      cell.style.gridColumn = String(w + 1);
      cell.style.gridRow = String(i + 1);
      grid.append(cell);
    }
  }
  const days7 = el('div', 'weekdays');
  for (const d of ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']) days7.append(el('span', '', d));
  // Weekday names stay put; the weeks scroll, opened on the newest (see scrollToNow).
  const scroll = el('div', 'heat-scroll');
  scroll.append(months, grid);
  wrap.append(days7, scroll); // hover a day for its hours, a month name for its total
  return wrap;
}

/** Hours per week, Monday to Sunday, the current week last (partial). */
function weekBars(days: Day[]) {
  const today = midnight(new Date());
  const thisMonday = mondayOf(today);
  const weeks: { monday: Date; hours: number }[] = [];
  for (let w = 11; w >= 0; w--) {
    const monday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - w * 7);
    if (monday < mondayOf(days[0].date)) continue;
    const end = new Date(monday.getTime() + 7 * DAY);
    weeks.push({ monday, hours: days.filter((d) => d.date >= monday && d.date < end).reduce((s, d) => s + d.hours, 0) });
  }
  const max = Math.max(1, ...weeks.map((w) => w.hours));
  const wrap = el('div', 'weeks');
  const bars = el('div', 'bars');
  for (const w of weeks) {
    const b = el('div', 'bar');
    if (w.monday.getTime() === thisMonday.getTime()) b.classList.add('now');
    b.title = `Week of ${short(w.monday)} · ${hm(w.hours)}`;
    const fill = el('span', '');
    fill.style.height = `${(w.hours / max) * 100}%`;
    const v = el('em', '', w.hours >= 1 ? `${Math.round(w.hours)}` : '');
    b.append(v, fill);
    bars.append(b);
  }
  const axis = el('div', 'axis');
  axis.append(el('span', '', short(weeks[0].monday)), el('span', '', 'this week'));
  wrap.append(el('div', 'cap', 'Hours per week'), bars, axis);
  return wrap;
}

/** Your home page's card by default; others' profile pages pass theirs (user-page.ts). */
export async function reworkLogtime(
  login = myLogin(),
  card = [...document.querySelectorAll<HTMLElement>('.container-inner-item')].find(
    (b) => b.querySelector('h4.profile-title')?.firstChild?.textContent?.trim() === 'Logtime',
  ),
) {
  if (!login || !card || card.querySelector(HOST)) return;
  // All time from our server when it answers quickly; otherwise intra's last four months first,
  // swapped for the whole history once it arrives (a first sync of a long history takes a while).
  const all = fetchAllDays(login);
  const quick = await Promise.race([all, new Promise<'slow'>((r) => setTimeout(r, 1200, 'slow'))]);
  if (quick && quick !== 'slow') return render(card, login, quick, true);
  const recent = await fetchDays(login);
  if (recent?.length) render(card, login, recent, false);
  if (quick === 'slow') {
    const days = await all;
    if (days) render(card, login, days, true);
  }
}

function render(card: HTMLElement, login: string, days: Day[], allTime: boolean) {
  const own = login === myLogin();
  let host = card.querySelector<HTMLElement>(HOST);
  if (!host) {
    host = document.createElement(HOST);
    host.attachShadow({ mode: 'open' });
  }
  const root = host.shadowRoot!;
  const style = document.createElement('style');
  style.textContent = CSS;

  const s = summarize(days);
  const diff = s.week - s.lastSoFar;
  const tiles = el('div', `tiles${allTime ? ' all' : ''}`);
  tiles.append(
    tile('This week', fmtH(s.week), 'h', s.lastSoFar || s.week ? `${diff >= 0 ? '+' : '−'}${fmtH(Math.abs(diff))}h vs last wk` : undefined, diff >= 0 ? 'up' : 'down'),
    tile('This month', fmtH(s.month), 'h'),
    tile('Daily average', fmtH(s.avg), 'h', `${s.activeDays} of last 30 days`),
    tile('Streak', String(s.streak), s.streak === 1 ? ' day' : ' days', s.streak ? 'still going' : own ? 'come in today to start one' : 'no streak right now'),
    tile('Longest streak', String(s.longest), s.longest === 1 ? ' day' : ' days', allTime ? 'ever' : undefined),
    tile('Best day', s.best && s.best.hours > 0 ? fmtH(s.best.hours) : '—', s.best && s.best.hours > 0 ? 'h' : '', s.best && s.best.hours > 0 ? dated(s.best.date) : undefined),
  );
  // Only the full history can say these (intra's four months would undercount them).
  if (allTime) {
    tiles.append(
      tile(`This year`, fmtH(s.year), 'h', s.lastYear ? `${fmtH(s.lastYear)}h in ${new Date().getFullYear() - 1}` : undefined),
      tile('All time', fmtH(s.total), 'h', `since ${days[0].date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`),
    );
  }
  const lower = el('div', 'lower');
  const heat = heatmap(days);
  lower.append(heat, weekBars(days));
  root.replaceChildren(style, tiles, lower);

  // Intra's calendar stays in the page (its script owns it), just not shown.
  for (const c of card.children) if (c.tagName !== 'H4' && c !== host) (c as HTMLElement).hidden = true;
  if (!host.isConnected) card.append(host);
  scrollToNow(heat.querySelector<HTMLElement>('.heat-scroll')!);
}

/** Opens the heatmap on the newest weeks (it starts scrolled to the oldest). */
function scrollToNow(scroll: HTMLElement) {
  // Right away (the card is in the page, so it has a layout), and again on the next frame in case
  // the card was still hidden; background tabs may not run frames until they're shown.
  scroll.scrollLeft = scroll.scrollWidth;
  requestAnimationFrame(() => (scroll.scrollLeft = scroll.scrollWidth));
}

const CSS = `
:host {
  display: flex; flex-direction: column; gap: 14px; min-height: 0;
  font: 14px/1.35 futura-pt, Futura, 'Trebuchet MS', system-ui, sans-serif;
  color: #f2f4f7; --muted: rgba(242, 244, 247, 0.66); --faint: rgba(242, 244, 247, 0.4);
  --line: rgba(255, 255, 255, 0.09); --coal: #00babc; --cell: 15px;
  overflow: hidden;
}
.tiles { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; flex: none; }
.tile { padding: 10px 14px; box-shadow: -1px 0 0 var(--line); min-width: 0; }
.tile:first-child { box-shadow: none; }
.tiles.all { grid-template-columns: repeat(8, minmax(0, 1fr)); }
.big { font-size: 24px; font-weight: 600; line-height: 1.1; white-space: nowrap; }
.big small { font-size: 14px; font-weight: 500; color: var(--muted); margin-left: 1px; }
.label { font-size: 12px; color: var(--muted); margin-top: 2px; }
.sub { font-size: 11.5px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub.up { color: #3ddc84; }
.sub.down { color: #ff7a7a; }

.lower { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 28px; min-height: 0; flex: 1; }

.heat { display: flex; gap: 6px; align-items: start; min-width: 0; }
/* About four months wide; older weeks are a scroll away. */
.heat-scroll {
  display: grid; gap: 4px; align-content: start; overflow-x: auto; overflow-y: hidden;
  max-width: calc(19 * (var(--cell) + 3px)); padding-bottom: 6px;
  scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}
.months { display: grid; gap: 3px; font-size: 11px; color: var(--faint); height: 14px; }
.months span { white-space: nowrap; overflow: visible; }
.weekdays { display: grid; grid-template-rows: repeat(7, var(--cell)); gap: 3px; width: 24px; font-size: 10.5px; color: var(--faint); padding-top: 18px; flex: none; }
.weekdays span { line-height: var(--cell); }
.grid { display: grid; grid-template-rows: repeat(7, var(--cell)); gap: 3px; }
.cell { width: var(--cell); height: var(--cell); border-radius: 4px; background: rgba(255, 255, 255, 0.05); }
.cell.out { background: transparent; }
.cell.today { outline: 1.5px solid rgba(255, 255, 255, 0.55); outline-offset: 1px; }
.cell[data-l='1'] { background: rgba(0, 186, 188, 0.22); }
.cell[data-l='2'] { background: rgba(0, 186, 188, 0.4); }
.cell[data-l='3'] { background: rgba(0, 186, 188, 0.6); }
.cell[data-l='4'] { background: rgba(0, 186, 188, 0.8); }
.cell[data-l='5'] { background: #2ee6e8; }

.weeks { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.cap { font-size: 11px; color: var(--faint); height: 14px; margin-bottom: 4px; }
.bars { flex: 1; display: flex; align-items: flex-end; gap: 6px; min-height: 60px; }
.bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; min-width: 0; }
.bar span { width: 100%; max-width: 34px; border-radius: 5px 5px 2px 2px; background: rgba(0, 186, 188, 0.45); min-height: 2px; }
.bar.now span { background: var(--coal); }
.bar:hover span { background: #2ee6e8; }
.bar em { font-style: normal; font-size: 10.5px; color: var(--faint); }
.axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--faint); margin-top: 4px; }

/* Phones: tiles in two rows of three; the heatmap above the weekly bars. */
@media (max-width: 768px) {
  .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tiles.all { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .tile { box-shadow: -1px 0 0 var(--line), 0 -1px 0 var(--line); }
  .tile:nth-child(3n + 1) { box-shadow: 0 -1px 0 var(--line); }
  .tile:nth-child(-n + 3) { box-shadow: -1px 0 0 var(--line); }
  .tiles.all .tile { box-shadow: -1px 0 0 var(--line), 0 -1px 0 var(--line); }
  .tiles.all .tile:nth-child(4n + 1) { box-shadow: 0 -1px 0 var(--line); }
  .tiles.all .tile:nth-child(-n + 4) { box-shadow: -1px 0 0 var(--line); }
  .tile:first-child, .tiles.all .tile:first-child { box-shadow: none; }
  .big { font-size: 21px; }
  .lower { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .heat-scroll { max-width: none; }
  .weeks { min-height: 150px; }
}
`;
