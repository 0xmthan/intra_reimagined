// Someone's profile page (/users/<login>), laid out like your home page: intra's four 1:1 boxes
// (an untitled logtime calendar, a Marks / Achievements / Patronages tab box, Projects, Skills)
// become cards on the home grid (home-grid.ts, styles.css):
//
//   Projects (in progress + marks)  | Logtime (reworked)
//                                   | Skills        | Achievements
//                                   | Patronages (family tree)
//
// intra's own nodes are moved, not copied, so its scripts (skills chart, dropdowns) keep working.
import { renderFamilyTree } from './family';
import { reworkLogtime } from './logtime';
import { appendMarks } from './projects';

const titled = (box: Element | null | undefined, title: string) =>
  box?.querySelector('h4.profile-title')?.firstChild?.textContent?.trim() === title;

function card(kind: string, title: string) {
  const col = document.createElement('div');
  col.dataset.irCard = kind;
  const box = document.createElement('div');
  box.className = 'container-inner-item boxed';
  const h = document.createElement('h4');
  h.className = 'profile-title';
  h.textContent = title;
  box.append(h);
  col.append(box);
  return { col, box, h };
}

export function layoutUserPage() {
  const login = location.pathname.match(/^\/users\/([a-z0-9-]{1,32})\/?$/i)?.[1];
  const calendar = document.querySelector('#user-locations');
  const grid = calendar?.closest('.container-fullsize');
  if (!login || !grid || grid.classList.contains('ir-home-grid')) return;
  const cols = [...grid.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
  const colOf = (test: (box: Element) => boolean) => cols.find((c) => { const b = c.querySelector('.container-inner-item'); return !!b && test(b); });

  const logCol = colOf((b) => !!b.querySelector('#user-locations'));
  const tabsCol = colOf((b) => !!b.querySelector('#marks'));
  const projCol = colOf((b) => titled(b, 'Projects'));
  const skillsCol = colOf((b) => titled(b, 'Skills'));
  if (!logCol || !tabsCol || !projCol || !skillsCol) return;

  // Logtime: give the box its title (intra has none here), then the reworked card.
  const logBox = logCol.querySelector<HTMLElement>('.container-inner-item')!;
  const logTitle = document.createElement('h4');
  logTitle.className = 'profile-title';
  logTitle.textContent = 'Logtime';
  logBox.prepend(logTitle);
  logCol.dataset.irCard = 'logtime';
  void reworkLogtime(login, logBox);

  // Projects: in progress, then their marks (from the tab box).
  const projBox = projCol.querySelector<HTMLElement>('.container-inner-item')!;
  projBox.querySelector('h4 a[href$="/feedbacks"]')?.remove(); // the header's "As evaluator" card has it
  const list = projBox.querySelector<HTMLElement>('.overflowable-item');
  const marks = tabsCol.querySelector('#marks .overflowable-item');
  if (list && marks?.querySelector('.main-project-item')) {
    if (list.querySelector('.project-item')) {
      const h = document.createElement('div');
      h.className = 'ir-proj-head';
      h.textContent = 'In progress';
      list.prepend(h);
    }
    appendMarks(list, marks);
  }
  projCol.dataset.irCard = 'projects';
  skillsCol.dataset.irCard = 'skills';

  // Achievements and Patronages: the tab box's other two panes, each its own card.
  const achievements = card('achievements', 'Achievements');
  const achPane = tabsCol.querySelector<HTMLElement>('#achievements');
  if (achPane) {
    achPane.classList.remove('tab-pane');
    achPane.classList.add('overflowable-item');
    // The pane has its own header ("Last achievements", "See all achievements"): use it as the title.
    const own = achPane.querySelector('h4.profile-title');
    if (own) achievements.h.replaceWith(own);
    // intra's big two-per-row tiles don't fit a card: use the compact one-per-row ones the home
    // page has (same markup, "mini", without the Achieved/date line).
    for (const item of achPane.querySelectorAll<HTMLElement>('.achievement-item')) {
      item.className = 'achievement-item col-xs-12';
      item.querySelector('.achievement-item--container')?.classList.add('mini');
      item.querySelector('.achievement-item--status')?.remove();
    }
    achievements.box.append(achPane);
  }
  const patronages = card('patronages', 'Patronages');
  const patPane = tabsCol.querySelector<HTMLElement>('#patronages');
  if (patPane) {
    patPane.classList.add('active');
    patronages.box.append(patPane);
    renderFamilyTree(patPane, document, patronages.h);
  }
  tabsCol.remove();
  grid.append(achievements.col, patronages.col);

  for (const c of grid.children) c.classList.remove('fixed-height');
  grid.classList.add('row', 'ir-home-grid', 'ir-user-grid');
  // The skills chart measures itself when drawn: let it fit its new box.
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}
