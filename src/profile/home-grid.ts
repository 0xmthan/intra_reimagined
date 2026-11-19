// Home page layout: intra lays its cards out as equal 1:1 boxes. This tags each card by its title
// so styles.css can place them on a grid sized to what they hold (Logtime wide, Projects tall)
// and give them the header's card look. Cards added later (our Patronages card) tag themselves.
const BY_TITLE: Record<string, string> = {
  agenda: 'agenda',
  evaluations: 'evals',
  logtime: 'logtime',
  projects: 'projects',
  skills: 'skills',
  'skills & expertises': 'skills',
  expertises: 'skills',
  'last achievements': 'achievements',
  patronages: 'patronages',
};

export function layoutHome() {
  const first = document.querySelector('.col-lg-4.fixed-height');
  const grid = first?.parentElement;
  if (!grid || grid.classList.contains('ir-home-grid')) return;
  for (const col of grid.children) {
    if (!(col instanceof HTMLElement)) continue;
    const title = col.querySelector('h4.profile-title')?.firstChild?.textContent?.trim().toLowerCase() ?? '';
    col.dataset.irCard = BY_TITLE[title] ?? (col.id === 'link-skill-chart' ? 'hidden' : 'other');
  }
  grid.classList.add('ir-home-grid');
  // The skills chart measures itself when drawn: let it fit its new box.
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}
