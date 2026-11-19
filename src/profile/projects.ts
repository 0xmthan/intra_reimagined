// Your home page's Projects card only lists what you're working on now; your marks (finished
// projects, with retries in a dropdown) are only on your profile page (/users/<you>), as others see
// it. This copies that "Marks" list into the card, under the current ones, as intra's own markup, so
// it looks and behaves as on the profile page. Follows intra's cursus select like the rest of the card.
import { myLogin } from '../me';
import { fetchOutstanding, fetchProfilePage } from './data';

const LIST_ID = 'ir-home-marks';
const REC_ID = 'ir-home-recommended';
const REC_SHOWN = 5;
const PROJECTS = 'https://projects.intra.42.fr';
const SORT_KEY = 'intra-reimagined:marks-sort';
type Sort = 'time' | 'abc';

/** "2026-08-04 21:03:00 +0300" → epoch ms (NaN if missing). */
const when = (el: HTMLElement) => {
  const m = el.dataset.longDate?.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)$/);
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : NaN;
};

/** "3 months ago", as intra writes it (intra fills these in with its own script on the profile page). */
function ago(at: number) {
  const s = (Date.now() - at) / 1000;
  const steps: [number, string][] = [
    [60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year'],
  ];
  let n = s;
  for (const [size, unit] of steps) {
    if (Math.abs(n) < size) {
      const v = Math.max(1, Math.round(n));
      return v === 1 ? `${unit === 'hour' ? 'an' : 'a'} ${unit} ago` : `${v} ${unit}s ago`;
    }
    n /= size;
  }
  return '';
}

/** "Some recommended projects" from projects.intra.42.fr's home page: name and link. */
async function fetchRecommended(): Promise<{ name: string; href: string }[]> {
  try {
    const res = await fetch(`${PROJECTS}/`, { credentials: 'include', headers: { Accept: 'text/html' } });
    if (!res.ok) return [];
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const h = [...doc.querySelectorAll('h2')].find((e) => /recommended/i.test(e.textContent ?? ''));
    const row = h?.nextElementSibling;
    if (!row?.classList.contains('row')) return [];
    return [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap((a) => {
      const name = a.querySelector('b')?.textContent?.trim();
      const href = new URL(a.getAttribute('href')!, `${PROJECTS}/`);
      return name && href.origin === PROJECTS ? [{ name, href: href.href }] : [];
    });
  } catch {
    return [];
  }
}

/** Up to REC_SHOWN recommended projects, then a button for the rest. */
function recommendedSection(items: { name: string; href: string }[]) {
  const section = document.createElement('div');
  section.id = REC_ID;
  const head = document.createElement('div');
  head.className = 'ir-proj-head';
  head.textContent = 'Recommended';
  section.append(head);
  const rows = items.map((p, i) => {
    const a = document.createElement('a');
    a.className = 'project-item block-item ir-rec-item';
    a.href = p.href;
    a.textContent = p.name;
    a.hidden = i >= REC_SHOWN;
    section.append(a);
    return a;
  });
  if (items.length > REC_SHOWN) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'ir-rec-more';
    const label = (open: boolean) => (open ? 'Show less' : `Show ${items.length - REC_SHOWN} more`);
    more.textContent = label(false);
    more.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      rows.forEach((r, i) => (r.hidden = !open && i >= REC_SHOWN));
      more.setAttribute('aria-expanded', String(open));
      more.textContent = label(open);
    });
    section.append(more);
  }
  return section;
}

export async function addFinishedProjects() {
  const login = myLogin();
  const card = [...document.querySelectorAll('.container-inner-item')].find(
    (b) => b.querySelector('h4.profile-title')?.firstChild?.textContent?.trim() === 'Projects',
  );
  const list = card?.querySelector<HTMLElement>('.overflowable-item');
  if (!login || !list || document.getElementById(LIST_ID)) return;
  // Feedbacks logs moved to the header's "As evaluator" card (hero.ts).
  card!.querySelector('h4 a[href$="/feedbacks"]')?.remove();

  const [doc, recommended] = await Promise.all([fetchProfilePage(login), fetchRecommended()]);
  const marks = doc?.querySelector('#marks .overflowable-item');
  if (document.getElementById(LIST_ID) || document.getElementById(REC_ID)) return;
  // Label the current ones too, so the groups read as one list.
  if (list.querySelector('.project-item') && (recommended.length || marks)) {
    const h = document.createElement('div');
    h.className = 'ir-proj-head';
    h.textContent = 'In progress';
    list.prepend(h);
  }
  if (recommended.length) list.append(recommendedSection(recommended));
  if (!marks?.querySelector('.main-project-item')) return;

  appendMarks(list, marks, myLogin());
}

/**
 * The profile's "Marks" list (intra's markup, copied) appended to a Projects card's list, with a
 * Newest / A–Z picker and intra's cursus select applied. Used on your home page (from your fetched
 * profile page) and on others' profile pages (from the page itself, user-page.ts).
 */
const RETRY_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';

export function appendMarks(list: HTMLElement, marks: Element, login?: string) {
  const section = document.createElement('div');
  section.id = LIST_ID;
  const head = document.createElement('div');
  head.className = 'ir-proj-head ir-marks-head';
  const label = document.createElement('span');
  label.textContent = 'Marks';
  const picker = document.createElement('div');
  picker.className = 'ir-sort';
  picker.setAttribute('role', 'radiogroup');
  picker.setAttribute('aria-label', 'Sort marks');
  const options: [Sort, string][] = [['time', 'Newest'], ['abc', 'A–Z']];
  const buttons = options.map(([value, text]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.sort = value;
    b.setAttribute('role', 'radio');
    b.textContent = text;
    return b;
  });
  picker.append(...buttons);
  head.append(label, picker);
  const body = document.createElement('div');
  body.append(...[...marks.children].map((c) => document.importNode(c, true)));
  section.append(head, body);
  for (const d of body.querySelectorAll<HTMLElement>('[data-long-date]')) {
    const at = when(d);
    if (Number.isFinite(at)) d.textContent = ago(at);
  }

  // Retries: a project's dropdown has a row per attempt ("ft_printf #0", "#1", …). Not for parents
  // like Rushes, whose rows are its separate parts.
  for (const item of body.querySelectorAll<HTMLElement>('.main-project-item:not(.parent-item)')) {
    const target = item.dataset.target;
    const attempts = target ? body.querySelectorAll(`${target.split('.').filter(Boolean).map((c) => `.${CSS.escape(c)}`).join('')} .project-item`).length : 0;
    if (attempts < 2) continue;
    const tag = document.createElement('span');
    tag.className = 'ir-retries';
    // A retry icon and the count, quietly; the tooltip says it in words.
    const icon = new DOMParser().parseFromString(RETRY_ICON, 'image/svg+xml').documentElement;
    tag.append(document.importNode(icon, true), String(attempts - 1));
    tag.title = `${attempts - 1} ${attempts === 2 ? 'retry' : 'retries'} (${attempts} attempts)`;
    (item.querySelector('.caret') ?? item.querySelector('.project-item-lighteable'))?.before(tag);
  }

  // A project and its dropdown rows (retries, rush parts) move together.
  const groups: { name: string; at: number; els: Element[] }[] = [];
  for (const el of [...body.children]) {
    if (el.classList.contains('main-project-item') || !groups.length) {
      const date = el.querySelector<HTMLElement>('[data-long-date]');
      groups.push({
        name: el.querySelector('.marked-title a')?.textContent?.trim().toLowerCase() ?? '',
        at: date ? when(date) : NaN,
        els: [el],
      });
    } else groups[groups.length - 1].els.push(el);
  }
  const sortBy = (how: Sort) => {
    const sorted = [...groups].sort((a, b) =>
      how === 'abc' ? a.name.localeCompare(b.name) : (Number.isFinite(b.at) ? b.at : 0) - (Number.isFinite(a.at) ? a.at : 0),
    );
    body.replaceChildren(...sorted.flatMap((g) => g.els));
    for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.sort === how));
    try {
      localStorage.setItem(SORT_KEY, how);
    } catch {
      /* private mode: just not remembered */
    }
  };
  picker.addEventListener('click', (e) => {
    const how = (e.target as Element).closest<HTMLElement>('[data-sort]')?.dataset.sort as Sort | undefined;
    if (how) sortBy(how);
  });
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(SORT_KEY);
  } catch {
    /* ignore */
  }
  sortBy(saved === 'abc' ? 'abc' : 'time');

  list.append(section);

  // Intra's cursus select filters the card; do the same for the marks (and their dropdowns).
  const select = document.querySelector<HTMLSelectElement>('.cursus-user-select');
  const filter = () => {
    const cursus = select?.value;
    const fits = (el: Element | null) => !cursus || !!el?.getAttribute('data-cursus')?.split(/\s+/).includes(cursus);
    let shown = 0;
    for (const item of section.querySelectorAll<HTMLElement>('.main-project-item')) {
      item.hidden = !fits(item);
      if (!item.hidden) shown++;
    }
    for (const drop of section.querySelectorAll<HTMLElement>('.collapsable')) drop.hidden = !fits(drop.querySelector('[data-cursus]'));
    section.hidden = !shown;
  };
  select?.addEventListener('change', () => setTimeout(filter, 0));
  filter();

  if (login) void addOutstanding(section, login);
}

/** ★ n before a mark: how many "Outstanding project" flags that project got (from our server). */
async function addOutstanding(section: HTMLElement, login: string) {
  const counts = await fetchOutstanding(login);
  if (!counts) return;
  for (const row of section.querySelectorAll<HTMLElement>('.project-item')) {
    // The project a row stands for: a project's own row (data-project), or the link to its attempt.
    const href = [...row.querySelectorAll<HTMLAnchorElement>('a[href*="/projects_users/"]')].pop()?.getAttribute('href') ?? '';
    const slug = row.classList.contains('main-project-item') && !row.classList.contains('parent-item') ? row.dataset.project : href.match(/\/projects\/([^/]+)\/projects_users\//)?.[1];
    const n = slug ? counts[slug] : 0;
    if (!n || row.querySelector('.ir-outstanding')) continue;
    const star = document.createElement('span');
    star.className = 'ir-outstanding';
    star.textContent = `★ ${n}`;
    star.title = `${n} outstanding flag${n === 1 ? '' : 's'}`;
    const mark = row.querySelector(':scope > .pull-right, :scope > .marked-title > .pull-right');
    if (mark) mark.before(star);
    else row.append(star);
  }
}
