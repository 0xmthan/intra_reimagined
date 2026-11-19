// Home page Logtime card, reworked: intra draws a bare month calendar. This shows the same data
// (intra's locations_stats: hours per day, about the last four months) as numbers that matter
// (this week vs last, this month, daily average, current and longest streak, best day), a
// calendar heatmap (one square per day, Monday to Sunday) and hours per week as bars.
// Built with DOM APIs in a shadow root inside the card; intra's own calendar is hidden.
import { myLogin } from '../me';

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
    // Every day from the first one intra has to today, zeros included.
    const [y, m, d] = keys[0].split('-').map(Number);
    const days: Day[] = [];
    const today = midnight(new Date());
    for (let t = new Date(y, m - 1, d); t <= today; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
      days.push({ date: t, hours: secs(stats[iso(t)] ?? '0:0:0') / 3600 });
    }
    return days;
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
  return { week, lastSoFar, month, avg, activeDays: active30.length, streak, longest, best };
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
      label.textContent = sunday.toLocaleDateString('en-GB', { month: 'short' });
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
  const body = el('div', 'heat-body');
  body.append(days7, grid);
  wrap.append(months, body); // hover a day for its hours
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

export async function reworkLogtime() {
  const login = myLogin();
  const card = [...document.querySelectorAll<HTMLElement>('.container-inner-item')].find(
    (b) => b.querySelector('h4.profile-title')?.firstChild?.textContent?.trim() === 'Logtime',
  );
  if (!login || !card || card.querySelector(HOST)) return;
  const days = await fetchDays(login);
  if (!days?.length || card.querySelector(HOST)) return;

  const s = summarize(days);
  const host = document.createElement(HOST);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;

  const diff = s.week - s.lastSoFar;
  const tiles = el('div', 'tiles');
  tiles.append(
    tile('This week', fmtH(s.week), 'h', s.lastSoFar || s.week ? `${diff >= 0 ? '+' : '−'}${fmtH(Math.abs(diff))}h vs last week` : undefined, diff >= 0 ? 'up' : 'down'),
    tile('This month', fmtH(s.month), 'h'),
    tile('Daily average', fmtH(s.avg), 'h', `${s.activeDays} of the last 30 days`),
    tile('Streak', String(s.streak), s.streak === 1 ? ' day' : ' days', s.streak ? 'in a row, still going' : 'come in today to start one'),
    tile('Longest streak', String(s.longest), s.longest === 1 ? ' day' : ' days'),
    tile('Best day', s.best && s.best.hours > 0 ? fmtH(s.best.hours) : '—', s.best && s.best.hours > 0 ? 'h' : '', s.best && s.best.hours > 0 ? short(s.best.date) : undefined),
  );
  const lower = el('div', 'lower');
  lower.append(heatmap(days), weekBars(days));
  root.append(style, tiles, lower);

  // Intra's calendar stays in the page (its script owns it), just not shown.
  for (const c of card.children) if (c.tagName !== 'H4') (c as HTMLElement).hidden = true;
  card.append(host);
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
.big { font-size: 24px; font-weight: 600; line-height: 1.1; white-space: nowrap; }
.big small { font-size: 14px; font-weight: 500; color: var(--muted); margin-left: 1px; }
.label { font-size: 12px; color: var(--muted); margin-top: 2px; }
.sub { font-size: 11.5px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub.up { color: #3ddc84; }
.sub.down { color: #ff7a7a; }

.lower { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 28px; min-height: 0; flex: 1; }

.heat { display: grid; gap: 4px; align-content: start; }
.months { display: grid; gap: 3px; margin-left: 30px; font-size: 11px; color: var(--faint); height: 14px; }
.months span { white-space: nowrap; overflow: visible; }
.heat-body { display: flex; gap: 6px; }
.weekdays { display: grid; grid-template-rows: repeat(7, var(--cell)); gap: 3px; width: 24px; font-size: 10.5px; color: var(--faint); }
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
`;
