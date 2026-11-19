// Fewer sidebar icons: E-learning, Forum (Stack Overflow) and Companies move out of the main
// sidebar into Meta's own side menu. On E-learning and Companies pages, Meta is the active icon.
import { setHTML } from './html';

const META = 'https://meta.intra.42.fr';

const MOVED = [
  { match: /^https:\/\/elearning\.intra\.42\.fr/, label: 'E-learning' },
  { match: /^https:\/\/stackoverflowteams\.com\//, label: 'Forum' },
  { match: /^https:\/\/companies\.intra\.42\.fr/, label: 'Companies' },
];

export function tidySidebar() {
  const nav = document.querySelector('.main-left-navbar');
  if (!nav) return;

  const links: { href: string; label: string; icon: string }[] = [];
  let movedWasActive = false;
  for (const a of nav.querySelectorAll<HTMLAnchorElement>(':scope > div > li > a, :scope > li > a')) {
    const m = MOVED.find((x) => x.match.test(a.href));
    if (!m) continue;
    links.push({ href: a.href, label: m.label, icon: a.querySelector('[class^="icon-"]')?.className ?? '' });
    if (a.classList.contains('active')) movedWasActive = true;
    a.closest('li')!.classList.add('ir-moved');
  }

  // Their pages now live under Meta.
  if (movedWasActive) nav.querySelector<HTMLAnchorElement>(`a[href^="${META}"]`)?.classList.replace('inactive', 'active');

  if (location.origin === META) addToMetaMenu(links);
}

function addToMetaMenu(links: { href: string; label: string; icon: string }[]) {
  const list = document.querySelector('.app-sidebar-left .sidebar-tags-list');
  if (!list || list.querySelector('.ir-meta-link') || !links.length) return;
  const anchor = list.querySelector(':scope > hr');
  for (const l of links) {
    const li = document.createElement('li');
    li.className = 'sidebar-item ir-meta-link';
    setHTML(li, `<a class="sidebar-link" href="${l.href}"><span class="square-xs ${l.icon} inline text-center"></span> ${l.label} </a>`);
    list.insertBefore(li, anchor);
  }
}
