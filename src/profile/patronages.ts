// Your home page (/) has no Patronages tab; your full profile page (/users/<you>) does. Fetch that
// page and show its patronages (who you patron, who patrons you) as one more card in the home grid,
// using intra's own markup so intra's styles (and our dark mode) apply as on the profile page.
import { myLogin } from '../me';
import { renderFamilyTree } from './family';
import { fetchProfilePage } from './data';

const CARD_ID = 'ir-home-patronages';

export async function addHomePatronages() {
  const login = myLogin();
  const grid = document.querySelector('.col-lg-4.fixed-height')?.parentElement;
  if (!login || !grid || document.getElementById(CARD_ID)) return;

  const page = await fetchProfilePage(login);
  const pane = page?.querySelector('#patronages');
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
  renderFamilyTree(content, page);
  box.append(title, content);
  col.append(box);
  grid.append(col);
}
