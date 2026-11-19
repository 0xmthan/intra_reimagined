// Home page Agenda, reworked in place: intra's list stays (its Filters reload it, its "See more"
// opens the event popup), restyled in styles.css (.ir-agenda), plus:
//   - headers grouping the events: This week, Next week, Later in November, December, ...
//   - short months ("Nov") and the event's kind as a tag in front of its title
//   - the whole row opens the event (intra's "See more")
// Re-applied whenever intra swaps the list (filters).
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY = 86_400_000;

/** The event's date from its "20" / "November" block (the year is the next one that fits). */
function dateOf(item: Element): Date | undefined {
  const day = Number(item.querySelector('.date-day')?.textContent?.trim());
  const month = MONTHS.indexOf(item.querySelector('.date-month')?.textContent?.trim().toLowerCase() ?? '');
  if (!day || month < 0) return undefined;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let d = new Date(now.getFullYear(), month, day);
  if (d.getTime() < today.getTime() - 60 * DAY) d = new Date(now.getFullYear() + 1, month, day); // e.g. January, seen in November
  return d;
}

/** "This week", "Next week", then "Later in November", "December", "January 2027". */
function groupLabel(d: Date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const weeks = Math.floor((d.getTime() - monday.getTime()) / (7 * DAY));
  if (weeks <= 0) return 'This week';
  if (weeks === 1) return 'Next week';
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  if (d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()) return `Later in ${month}`;
  return d.getFullYear() === today.getFullYear() ? month : `${month} ${d.getFullYear()}`;
}

function enhance(list: HTMLElement) {
  list.querySelectorAll('.ir-agenda-day').forEach((h) => h.remove());
  let last = '';
  for (const item of list.querySelectorAll<HTMLElement>(':scope > .event-item')) {
    const d = dateOf(item);
    const key = d ? groupLabel(d) : '';
    if (d && key !== last) {
      const h = document.createElement('div');
      h.className = 'ir-agenda-day';
      h.textContent = key;
      item.before(h);
      last = key;
    }
    if (item.dataset.irDone) continue;
    item.dataset.irDone = '1';
    const month = item.querySelector('.date-month');
    if (month?.textContent) month.textContent = month.textContent.trim().slice(0, 3);
    // Kind first, as a small tag; the event's own name is the title.
    const kind = item.querySelector<HTMLElement>('.event-name');
    const sub = item.querySelector<HTMLElement>('.event-subname');
    if (kind && sub && sub.textContent?.trim()) {
      kind.classList.add('ir-agenda-kind');
      kind.textContent = kind.textContent?.trim() ?? '';
    }
    const more = item.querySelector<HTMLElement>('.event-button:not(.copy)');
    if (more) {
      // It's a link to "#": without this the page jumps to the top (intra's popup still opens).
      more.addEventListener('click', (e) => e.preventDefault());
      item.classList.add('ir-agenda-link');
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.addEventListener('click', (e) => {
        if ((e.target as Element).closest('a, .copy')) return; // the link inside, or "copy link"
        more.click();
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          more.click();
        }
      });
    }
  }
}

/** "2026-11-20 14:15:00 +0300" → epoch ms. */
function parseLong(v: string | undefined) {
  const m = v?.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d)(?::(\d\d))? ([+-]\d\d)(\d\d)$/);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3] ?? '00'}${m[4]}:${m[5]}`) : NaN;
}

/** "in 17 hours", "in 3 days", "started 20 min ago"; nothing beyond a week out. */
function relative(at: number) {
  const min = Math.round((at - Date.now()) / 60_000);
  const abs = Math.abs(min);
  const span = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} hour${Math.round(abs / 60) === 1 ? '' : 's'}` : `${Math.round(abs / 1440)} days`;
  if (min < 0) return `started ${span} ago`;
  return abs <= 7 * 1440 ? `in ${span}` : '';
}

/** "Fri 20 Nov · 14:15 · in 17 hours", in your own time zone. */
function eventWhen(at: number) {
  const d = new Date(at);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return [day, time, relative(at)].filter(Boolean).join(' · ');
}

/**
 * The event popup's date: intra's script swaps "November 20, 14:15" for "in 17 hours" a moment
 * after it opens. Show both, computed here from the exact time intra puts in the page, and keep it.
 */
function watchEventPopup() {
  const modal = document.getElementById('smartModal');
  if (!modal || modal.dataset.irWhen) return;
  modal.dataset.irWhen = '1';
  const fix = () => {
    for (const el of modal.querySelectorAll<HTMLElement>('.details [data-long-date]')) {
      const at = parseLong(el.dataset.longDate);
      if (!Number.isFinite(at)) continue;
      const text = eventWhen(at);
      if (el.textContent !== text) el.textContent = text; // only when changed, so this settles
    }
  };
  new MutationObserver(fix).observe(modal, { childList: true, subtree: true, characterData: true });
}

export function reworkAgenda() {
  watchEventPopup();
  const box = document.querySelector<HTMLElement>('[data-ir-card="agenda"] > .container-inner-item');
  const list = box?.querySelector<HTMLElement>('#events-list');
  if (!box || !list || box.classList.contains('ir-agenda')) return;
  box.classList.add('ir-agenda');
  enhance(list);
  // Filters reload the list (its items, or the whole list): redo it then. Our own day headers
  // don't count as a change, so this settles after one pass.
  new MutationObserver(() => {
    const current = box.querySelector<HTMLElement>('#events-list');
    if (current?.querySelector('.event-item:not([data-ir-done])')) enhance(current);
  }).observe(box, { childList: true, subtree: true });
}
