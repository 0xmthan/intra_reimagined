// Home page: Skills (intra's radar chart) and Expertises (your rated languages and tools) were two
// half-empty cards. This folds Expertises into the Skills card, with a Skills | Expertises switch
// in its header, and removes the Expertises card. Both keep intra's own markup.
const KEY = 'intra-reimagined:skills-tab';
type Tab = 'skills' | 'expertises';

const cardTitled = (title: string) =>
  [...document.querySelectorAll<HTMLElement>('.container-inner-item')].find(
    (b) => b.querySelector('h4.profile-title')?.firstChild?.textContent?.trim() === title,
  );

export function mergeSkillsAndExpertises() {
  const skills = cardTitled('Skills');
  const expertises = cardTitled('Expertises');
  const chart = skills?.querySelector<HTMLElement>('#skill-chart');
  const list = expertises?.querySelector<HTMLElement>('.overflowable-item');
  if (!skills || !expertises || !chart || !list || skills.querySelector('.ir-skills-tabs')) return;

  const title = skills.querySelector('h4.profile-title')!;
  const tabs = document.createElement('div');
  tabs.className = 'ir-sort ir-skills-tabs';
  tabs.setAttribute('role', 'tablist');
  const buttons = (['skills', 'expertises'] as Tab[]).map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.tab = t;
    b.setAttribute('role', 'tab');
    b.textContent = t === 'skills' ? 'Skills' : 'Expertises';
    return b;
  });
  tabs.append(...buttons);
  title.classList.add('ir-skills-title');
  if (title.firstChild?.nodeType === Node.TEXT_NODE) title.firstChild.textContent = 'Skills & expertises';
  title.append(tabs);

  // The expertises list, with intra's two links under it.
  const panel = document.createElement('div');
  panel.className = 'ir-expertises';
  const links = document.createElement('div');
  links.className = 'ir-expertises-links';
  for (const a of expertises.querySelectorAll<HTMLAnchorElement>('h4 a')) {
    a.className = 'simple-link';
    if (a.textContent?.trim() === 'Expertises') a.textContent = 'Manage yours';
    links.append(a);
  }
  panel.append(list, links);
  skills.append(panel);
  expertises.parentElement!.remove(); // the now-empty grid column

  const show = (tab: Tab) => {
    chart.hidden = tab !== 'skills';
    panel.hidden = tab !== 'expertises';
    for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    // The chart measures itself when drawn; let it re-fit after being hidden.
    if (tab === 'skills') window.dispatchEvent(new Event('resize'));
    try {
      localStorage.setItem(KEY, tab);
    } catch {
      /* not remembered */
    }
  };
  tabs.addEventListener('click', (e) => {
    const tab = (e.target as Element).closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
    if (tab) show(tab);
  });
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  show(saved === 'expertises' ? 'expertises' : 'skills');
}
