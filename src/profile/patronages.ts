// Your home page (/) has no Patronages tab; your full profile page (/users/<you>) does. Fetch that
// page and show its patronages (who you patron, who patrons you) as one more card in the home grid,
// using intra's own markup so intra's styles (and our dark mode) apply as on the profile page.
import { myLogin } from '../me';

const CARD_ID = 'ir-home-patronages';

export async function addHomePatronages() {
  const login = myLogin();
  const grid = document.querySelector('.col-lg-4.fixed-height')?.parentElement;
  if (!login || !grid || document.getElementById(CARD_ID)) return;

  let pane: Element | null;
  try {
    const res = await fetch(`/users/${encodeURIComponent(login)}`, { credentials: 'include', headers: { Accept: 'text/html' } });
    if (!res.ok) return;
    pane = new DOMParser().parseFromString(await res.text(), 'text/html').querySelector('#patronages');
  } catch {
    return;
  }
  if (!pane?.querySelector('.patronage-item') || document.getElementById(CARD_ID)) return;

  const col = document.createElement('div');
  col.id = CARD_ID;
  col.className = 'col-lg-4 col-md-6 col-xs-12 fixed-height';
  const box = document.createElement('div');
  box.className = 'container-inner-item boxed';
  box.style.overflow = 'auto';
  const title = document.createElement('h4');
  title.className = 'profile-title';
  title.textContent = 'Patronages';
  // The pane is a hidden tab on the profile page; here it's the card's content, always shown.
  // It keeps its id: intra's patronage styles hang off #patronages (the home page has none).
  const content = document.importNode(pane, true);
  content.classList.add('active');
  box.append(title, content);
  col.append(box);
  grid.append(col);
}
