// Removes intra's white top bar on desktop and moves what it held into the bottom of the left
// sidebar: search (our palette, see search.ts), notifications, "Have a problem?" and the account
// menu. The bell and the account dropdown are intra's own elements, moved (not copied), so intra's
// scripts keep driving them: fetching notifications, marking them read, the Bootstrap dropdown.
// On narrow screens intra's mobile layout needs its top bar (hamburger menu), so everything goes
// back where it came from below 769px, and when the setting is switched off.
import { setHTML } from './html';
import { openSearch } from './search';

const TOOLS_ID = 'ir-side-tools';
const DESKTOP = '(min-width: 769px)'; // intra switches to its mobile layout at max-width: 768px
const ON_CLASS = 'ir-no-topbar';

const ICON = {
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/></svg>',
};

/** An element we moved, and where to put it back. */
interface Moved {
  el: Element;
  parent: Node;
  next: Node | null;
}

let moved: Moved[] = [];
let media: MediaQueryList | undefined;
let enabled = false;

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

function move(el: Element | null, into: Element) {
  if (!el?.parentNode) return;
  moved.push({ el, parent: el.parentNode, next: el.nextSibling });
  into.appendChild(el);
}

function mount() {
  const sidebar = document.querySelector('.main-left-navbar');
  const navbar = document.querySelector('.main-navbar');
  if (!sidebar || !navbar || document.getElementById(TOOLS_ID)) return;

  const helpHref = navbar.querySelector<HTMLAnchorElement>('.help-btn')?.href;
  const tools = document.createElement('div');
  tools.id = TOOLS_ID;
  setHTML(
    tools,
    `<li class="ir-tool"><a href="#" class="ir-search-btn" aria-label="Search">${ICON.search}<span class="ir-tool-label">Search <kbd>${isMac ? '⌘' : 'Ctrl '}K</kbd></span></a></li>
     <li class="ir-tool ir-bell"><span class="ir-tool-label">Notifications</span></li>
     ${helpHref ? `<li class="ir-tool ir-help"><a href="${helpHref}" aria-label="Have a problem?">${ICON.help}<span class="ir-tool-label">Have a problem?</span></a></li>` : ''}
     <li class="ir-tool ir-account"></li>`,
  );
  sidebar.appendChild(tools);

  tools.querySelector('.ir-search-btn')!.addEventListener('click', (e) => {
    e.preventDefault();
    openSearch();
  });

  // intra's bell: keep its count badge, swap the icon-font glyph for ours.
  const bell = navbar.querySelector('[data-notification-drop]');
  if (bell) {
    const slot = tools.querySelector('.ir-bell')!;
    move(bell, slot);
    if (!bell.querySelector('.ir-bell-icon')) {
      const icon = document.createElement('span');
      icon.className = 'ir-bell-icon';
      setHTML(icon, ICON.bell);
      bell.prepend(icon);
    }
    slot.appendChild(slot.querySelector('.ir-tool-label')!); // label after the bell for the hover rule
  } else {
    tools.querySelector('.ir-bell')?.remove();
  }

  move(navbar.querySelector('.main-navbar-user-nav > .dropdown'), tools.querySelector('.ir-account')!);

  document.documentElement.classList.add(ON_CLASS);
}

function unmount() {
  for (const { el, parent, next } of moved.reverse()) {
    parent.insertBefore(el, next && next.parentNode === parent ? next : null);
  }
  moved = [];
  document.getElementById(TOOLS_ID)?.remove();
  document.documentElement.classList.remove(ON_CLASS);
}

const sync = () => (enabled && media?.matches ? mount() : unmount());

/** Turn the sidebar tools on or off (from the settings switch). */
export function setSidebarTools(on: boolean) {
  enabled = on;
  if (!media) {
    media = matchMedia(DESKTOP);
    media.addEventListener('change', sync);
    document.addEventListener('keydown', onShortcut);
  }
  sync();
}

/** ⌘K / Ctrl+K anywhere, or "/" when not typing, opens search (only while the top bar is gone). */
function onShortcut(e: KeyboardEvent) {
  if (!document.getElementById(TOOLS_ID)) return;
  const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
  const cmdK = e.key.toLowerCase() === 'k' && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;
  if (cmdK || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey)) {
    e.preventDefault();
    openSearch();
  }
}
