// Home page Evaluations card: patronage reviews ("You are ready to review your patronage with ...")
// fill it at campuses that run patronages through external forms, burying real evaluations. They
// move into a collapsed "Patronage reviews (n)" section at the bottom. Intra's "Hide" toggle (it
// only collapses the whole card) goes away.
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
  if (!reviews.length) return;

  const section = document.createElement('details');
  section.id = SECTION_ID;
  const summary = document.createElement('summary');
  summary.className = 'ir-proj-head';
  summary.textContent = `Patronage reviews (${reviews.length})`;
  section.append(summary, ...reviews);
  list.append(section);
}
