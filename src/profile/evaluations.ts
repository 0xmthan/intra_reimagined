// Home page Evaluations card: patronage reviews ("You are ready to review your patronage with ...")
// fill it at campuses that run patronages through external forms, burying real evaluations. They
// move into a collapsed "Patronage reviews (n)" section at the bottom. Intra's "Hide" toggle (it
// only collapses the whole card) goes away. The header gets an "Open 1h slot" button, and your open
// (not yet booked) slots show with a way to remove each.
import { SLOTS_CHANGED } from '../slots';

const SECTION_ID = 'ir-patronage-reviews';

const isPatronageReview = (item: Element) =>
  !!item.querySelector('a[href*="/patronages_reports/"]') || /review your patronage/i.test(item.textContent ?? '');

export function tidyEvaluations() {
  const card = [...document.querySelectorAll<HTMLElement>('.container-inner-item')].find(
    (b) => b.querySelector('h4.profile-title')?.firstChild?.textContent?.trim() === 'Evaluations',
  );
  if (!card || document.getElementById(SECTION_ID)) return;

  // The Hide toggle, and the collapse it drives (kept open).
  card.querySelector('h4 a[href="#collapseEvaluations"]')?.remove();
  // Feedbacks logs: the header's "As evaluator" card has a button for it (hero.ts).
  card.querySelector('h4 a[href$="/feedbacks"]')?.remove();
  const list = card.querySelector<HTMLElement>('#collapseEvaluations') ?? card.querySelector<HTMLElement>('.overflowable-item');
  if (!list) return;
  list.classList.add('in');

  const items = [...list.querySelectorAll(':scope > .project-item')];
  const reviews = items.filter(isPatronageReview);
  if (reviews.length === items.length) {
    // Nothing real coming up: the home grid shows this card as a slim strip (home-grid.ts, styles.css).
    card.parentElement?.setAttribute('data-empty', '');
    const empty = document.createElement('div');
    empty.className = 'ir-eval-empty';
    empty.textContent = 'No evaluations coming up.';
    list.prepend(empty);
  }
  void addSlots(card, list);
  if (!reviews.length) return;

  const section = document.createElement('details');
  section.id = SECTION_ID;
  const summary = document.createElement('summary');
  summary.className = 'ir-proj-head';
  summary.textContent = `Patronage reviews (${reviews.length})`;
  section.append(summary, ...reviews);
  list.append(section);
}

// ---------- evaluation slots (intra's /slots page API) ----------
const MIN = 60_000;
type Slot = { id: number | string; ids?: string; start: string; end: string; reserved: boolean };

// Firefox: the page's own fetch, so intra sees a same-origin request (its CSRF check wants that).
const pageFetch: typeof fetch = (globalThis as { content?: { fetch?: typeof fetch } }).content?.fetch?.bind(
  (globalThis as { content?: object }).content,
) ?? fetch;

const csrf = () => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

async function post(url: string, data: Record<string, string>) {
  const res = await pageFetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-CSRF-Token': csrf(), 'X-Requested-With': 'XMLHttpRequest' },
    body: new URLSearchParams(data),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: number; message?: string };
  if (!res.ok || (json.status && json.status !== 200)) throw new Error(json.message?.replace(/<[^>]+>/g, '') || `Error ${res.status}`);
  return json;
}

/** Your slots from now to two weeks out, merged into runs. */
async function fetchSlots(): Promise<Slot[]> {
  const now = new Date();
  const q = new URLSearchParams({ start: new Date(+now - 2 * 60 * MIN).toISOString(), end: new Date(+now + 14 * 1440 * MIN).toISOString() });
  const res = await fetch(`/slots.json?${q}`, { credentials: 'include', headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const raw = (await res.json()) as { id: number; ids?: string; start?: string; end?: string; begin_at?: string; end_at?: string; className?: string | string[] }[];
  return raw
    .map((e) => ({
      id: e.id,
      ids: e.ids,
      start: e.start ?? e.begin_at ?? '',
      end: e.end ?? e.end_at ?? '',
      reserved: String(e.className ?? '').includes('reserved'),
    }))
    .filter((s) => Date.parse(s.end) > Date.now())
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** "Today 15:00–16:00", "Tomorrow 09:30–10:30", "Sat 14:00–15:00", next week on "Mon 30 Nov 14:00–15:00". */
function slotWhen(s: Slot) {
  const { day, time } = slotParts(s);
  return `${day} ${time}`;
}

/** The day ("Today", "Sat", "Mon 30 Nov") and the time ("14:45–16:30") apart. */
function slotParts(s: Slot) {
  const a = new Date(s.start), b = new Date(s.end);
  const t = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = Math.round((new Date(a).setHours(0, 0, 0, 0) - +today) / (1440 * MIN));
  const label =
    day === 0 ? 'Today'
    : day === 1 ? 'Tomorrow'
    : day < 7 ? a.toLocaleDateString('en-GB', { weekday: 'short' })
    : a.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return { day: label, time: `${t(a)}–${t(b)}` };
}

/** The first quarter hour at least 30 minutes from now (intra refuses slots that start sooner). */
function nextStart() {
  const d = new Date(Date.now() + 30 * MIN);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

async function addSlots(card: HTMLElement, list: HTMLElement) {
  const actions = card.querySelector('h4.profile-title > .pull-right');
  if (!actions || card.querySelector('.ir-slot-open')) return;
  const box = document.createElement('div');
  box.className = 'ir-slots';
  const empty = list.querySelector('.ir-eval-empty');
  if (empty) empty.after(box);
  else list.prepend(box);

  const note = (text: string) => {
    box.querySelector('.ir-slot-error')?.remove();
    const e = document.createElement('span');
    e.className = 'ir-slot-error';
    e.textContent = text;
    box.append(e);
    setTimeout(() => e.remove(), 6000);
  };

  const render = async () => {
    const slots = (await fetchSlots().catch(() => [])).filter((s) => !s.reserved);
    box.replaceChildren();
    card.classList.toggle('ir-slot-on', slots.length > 0);
    if (!slots.length) return;
    // One label, then each slot's time with its ×: stays one line for a few slots.
    const label = document.createElement('span');
    label.className = 'ir-slot-label';
    label.title = 'Open for evaluations: anyone can book them';
    label.append(document.createElement('i'), slots.length === 1 ? 'Slot open' : `${slots.length} slots open`);
    box.append(label);
    // Slots on the same day share its name: "Sat 14:45–16:30 × 18:15–19:30 ×".
    let lastDay = '';
    for (const s of slots) {
      const { day, time } = slotParts(s);
      const pill = document.createElement('span');
      pill.className = 'ir-slot';
      pill.title = slotWhen(s);
      if (day !== lastDay) {
        const d = document.createElement('b');
        d.textContent = day;
        pill.append(d);
        lastDay = day;
      } else pill.classList.add('same-day');
      const text = document.createElement('span');
      text.textContent = time;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = 'Remove this slot';
      x.addEventListener('click', async () => {
        x.disabled = true;
        try {
          await post(`/slots/${encodeURIComponent(String(s.id))}.json`, { ids: s.ids ?? String(s.id), _method: 'delete', confirm: 'false' });
        } catch (e) {
          note((e as Error).message);
        }
        await render();
      });
      pill.append(text, x);
      box.append(pill);
    }
  };

  const open = document.createElement('a');
  open.href = '#';
  open.className = 'btn simple-link ir-slot-open';
  open.textContent = '+ Open 1h slot';
  open.title = 'Open an evaluation slot for one hour, starting at the next quarter hour 30 min from now';
  open.addEventListener('click', async (e) => {
    e.preventDefault();
    if (open.dataset.busy) return;
    open.dataset.busy = '1';
    const begin = nextStart();
    const end = new Date(+begin + 60 * MIN);
    try {
      await post('/slots.json', { 'slot[begin_at]': begin.toISOString(), 'slot[end_at]': end.toISOString() });
    } catch (err) {
      note((err as Error).message);
    }
    delete open.dataset.busy;
    await render();
  });
  actions.prepend(open);
  document.addEventListener(SLOTS_CHANGED, () => void render()); // the Manage slots window closed
  await render();
}
