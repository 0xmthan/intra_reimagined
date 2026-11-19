// Manage slots (profile.intra.42.fr/slots) opens in a window over the page, like Clusters
// (clusters.ts), instead of leaving it. Closing it tells the Evaluations card to refresh its slots.
import { openFramePopup } from './clusters';

export const SLOTS_URL = 'https://profile.intra.42.fr/slots';
export const SLOTS_CHANGED = 'ir-slots-changed';

const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 14v4M10 16h4"/></svg>';

export function openSlots() {
  openFramePopup({
    url: SLOTS_URL,
    title: 'Manage slots',
    icon: ICON,
    onClose: () => document.dispatchEvent(new Event(SLOTS_CHANGED)),
  });
}

/** Every "Manage slots" link (Evaluations card, the user menu) opens the window. */
export function interceptSlotLinks() {
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href]');
      if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const url = new URL(a.href, location.href);
      if (url.origin + url.pathname.replace(/\/$/, '') !== SLOTS_URL || location.href.startsWith(SLOTS_URL)) return;
      e.preventDefault();
      openSlots();
    },
    true,
  );
}

// ---------- the slots page itself (full page or in the window), reworked in place ----------
// intra's FullCalendar stays (drag to open a slot, drag to move or resize, × to remove); this
// restyles it (styles.css, html.ir-slots-page) and adds: a hint and legend bar, two-line day
// headers ("THU" / "19"), short hour labels ("6 AM"), and a line at the current time.
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function decorate(cal: HTMLElement) {
  for (const th of cal.querySelectorAll<HTMLElement>('th.fc-day-header[data-date]:not([data-ir])')) {
    const d = new Date(`${th.dataset.date}T12:00:00`);
    th.dataset.ir = '1';
    th.replaceChildren();
    const name = document.createElement('span');
    name.className = 'ir-dname';
    name.textContent = DAY_NAMES[d.getDay()];
    const num = document.createElement('span');
    num.className = 'ir-dnum';
    num.textContent = String(d.getDate());
    th.append(name, num);
  }
  for (const s of cal.querySelectorAll<HTMLElement>('.fc-slats .fc-axis > span:not([data-ir])')) {
    s.dataset.ir = '1';
    const m = s.textContent?.trim().match(/^(\d+):00 ?(am|pm)$/i);
    if (m) s.textContent = `${m[1]} ${m[2].toUpperCase()}`;
  }
  // Today's header too (FullCalendar only marks the body cells).
  const today = cal.querySelector<HTMLElement>('td.fc-day.fc-today')?.dataset.date;
  cal.querySelectorAll('th.fc-day-header').forEach((th) => th.classList.toggle('ir-today', (th as HTMLElement).dataset.date === today));
  placeNow(cal);
}

/** The current-time line across today's column. */
function placeNow(cal: HTMLElement) {
  const grid = cal.querySelector<HTMLElement>('.fc-time-grid');
  const day = cal.querySelector<HTMLElement>('td.fc-day.fc-today');
  const slats = cal.querySelector<HTMLElement>('.fc-slats');
  const rows = slats?.querySelectorAll('tr[data-time]').length ?? 0;
  let line = grid?.querySelector<HTMLElement>(':scope > .ir-now');
  if (!grid || !day || !slats || !rows) return line?.remove();
  if (!line) {
    line = document.createElement('div');
    line.className = 'ir-now';
    grid.append(line);
  }
  const now = new Date();
  const g = grid.getBoundingClientRect();
  const d = day.getBoundingClientRect();
  const top = ((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * slats.getBoundingClientRect().height;
  if (line.style.top !== `${top}px`) line.style.top = `${top}px`;
  line.style.left = `${d.left - g.left}px`;
  line.style.width = `${d.width}px`;
}

function legend() {
  const bar = document.createElement('div');
  bar.className = 'ir-slots-bar';
  const hint = document.createElement('p');
  hint.textContent = 'Drag on the calendar to open a slot. Drag a slot to move it, its bottom edge to resize it, × to remove it.';
  const keys = document.createElement('div');
  keys.className = 'ir-slots-keys';
  for (const [cls, label] of [['open', 'Open'], ['booked', 'Booked'], ['closed', 'Unavailable']]) {
    const k = document.createElement('span');
    k.className = `ir-key ${cls}`;
    k.textContent = label;
    keys.append(k);
  }
  bar.append(hint, keys);
  return bar;
}

export function reworkSlotsPage() {
  if (location.origin + location.pathname.replace(/\/$/, '') !== SLOTS_URL) return;
  const cal = document.getElementById('calendar');
  if (!cal || cal.dataset.irDone) return;
  cal.dataset.irDone = '1';
  document.documentElement.classList.add('ir-slots-page');
  cal.before(legend());
  let queued = false;
  const run = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      decorate(cal);
    });
  };
  // FullCalendar redraws on prev/next/today and when it reloads events: decorate again then.
  new MutationObserver(run).observe(cal, { childList: true, subtree: true });
  addEventListener('resize', run);
  setInterval(() => placeNow(cal), 60_000);
  run();
  // Start the view an hour before now rather than at midnight / 6 AM.
  setTimeout(() => {
    const scroller = cal.querySelector<HTMLElement>('.fc-scroller');
    const first = cal.querySelector<HTMLElement>('.fc-slats tr[data-time]');
    if (scroller && first) scroller.scrollTop = Math.max(0, ((new Date().getHours() - 1) * 2) * first.getBoundingClientRect().height);
  }, 300);
}
