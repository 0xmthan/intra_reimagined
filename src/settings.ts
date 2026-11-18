// Settings: a gear in intra's left icon sidebar that opens intra's own settings page
// (/users/<login>/edit), where we add an "Intra Reimagined" entry to its side menu.
import { getSettings, onSettingsChange, setSetting, type Settings } from './store';
import { setHTML } from './html';

type BoolSetting = keyof Settings;

const TOGGLES: { key: BoolSetting; title: string; desc: string }[] = [
  { key: 'darkMode', title: 'Dark mode', desc: 'Use a dark theme on every intra page.' },
  { key: 'newHeader', title: 'New profile header', desc: "Redesigned header on profile pages. Turn off for intra's original banner." },
];

const BUTTON_ID = 'ir-settings-button';
const PILL_ID = 'ir-settings-pill';
const SECTION_ID = 'ir-settings-section';
const HASH = '#intra-reimagined';

// intra's own settings pages: they all share the stacked "SETTINGS" side menu.
const SETTINGS_PATHS = [
  /^\/users\/[^/]+\/edit\/?$/,
  /^\/gitlab_users/,
  /^\/languages/,
  /^\/mails/,
  /^\/securities/,
  /^\/oauth\/applications/,
  /^\/expertises_users/,
  /^\/v3_early_access/,
];

const onProfileSite = () => location.origin === 'https://profile.intra.42.fr';
const onSettingsPage = () => onProfileSite() && SETTINGS_PATHS.some((re) => re.test(location.pathname));
const onEditPage = () => onProfileSite() && /^\/users\/[^/]+\/edit\/?$/.test(location.pathname);

function settingsUrl() {
  // The navbar's "View my profile" link carries the logged-in user's login.
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.main-navbar a[href*="/users/"]')) {
    const m = a.href.match(/^https:\/\/profile\.intra\.42\.fr\/users\/([^/?#]+)$/);
    if (m) return `https://profile.intra.42.fr/users/${m[1]}/edit${HASH}`;
  }
  return `https://profile.intra.42.fr/users/me/edit${HASH}`;
}

export function addSettingsButton() {
  const list = document.querySelector('.main-left-navbar > div') ?? document.querySelector('.main-left-navbar');
  if (!list || document.getElementById(BUTTON_ID)) return;

  const active = onSettingsPage();
  // Mirror intra's own sidebar markup so it picks up the same styling and hover label.
  const li = document.createElement('li');
  li.id = BUTTON_ID;
  setHTML(li, `
    <a class="${active ? 'active' : 'inactive'}" href="${settingsUrl()}" aria-label="Settings">
      <span class="icon-setting-gear"></span>
      <span class="visible-overlay"> Settings </span>
    </a>`);
  list.appendChild(li);

  // On settings pages the gear is the current section, not Profile.
  if (active) {
    for (const a of list.querySelectorAll(`a.active`)) {
      if (!a.closest(`#${BUTTON_ID}`)) a.classList.replace('active', 'inactive');
    }
  }

  if (onEditPage()) addSettingsSection();
}

/** Adds our entry to the edit page's "SETTINGS" side menu and its content pane. */
function addSettingsSection() {
  const pills = document.querySelector('.page-content .nav-pills.nav-stacked');
  const pane = document.querySelector('.page-content .col-sm-10');
  if (!pills || !pane || document.getElementById(PILL_ID)) return;

  const pill = document.createElement('li');
  pill.id = PILL_ID;
  pill.setAttribute('role', 'presentation');
  setHTML(pill, `<a href="${HASH}"><span class="iconf-setting-gear"></span> Intra Reimagined </a>`);
  pills.appendChild(pill);

  const section = document.createElement('div');
  section.id = SECTION_ID;
  section.className = 'container-inner-item';
  section.hidden = true;
  setHTML(section, `
    <div class="col-sm-12">
      <h4 class="font-weight-bold text-uppercase">Intra Reimagined</h4>
      ${TOGGLES.map(
        (t) => `
      <div class="ir-setting">
        <div class="ir-setting-text">
          <label class="ir-setting-title" for="ir-toggle-${t.key}">${t.title}</label>
          <div class="ir-setting-desc">${t.desc}</div>
        </div>
        <label class="ir-switch">
          <input type="checkbox" id="ir-toggle-${t.key}" data-key="${t.key}" role="switch">
          <span class="ir-switch-track"></span>
        </label>
      </div>`,
      ).join('')}
    </div>`);
  pane.appendChild(section);

  const inputs = [...section.querySelectorAll<HTMLInputElement>('input[data-key]')];
  const sync_ = (s: Settings) => inputs.forEach((i) => (i.checked = s[i.dataset.key as BoolSetting]));
  getSettings().then(sync_);
  onSettingsChange(sync_);
  for (const input of inputs) {
    input.addEventListener('change', () => setSetting(input.dataset.key as BoolSetting, input.checked));
  }

  const show = (ours: boolean) => {
    for (const child of pane.children) {
      (child as HTMLElement).hidden = ours ? child !== section : child === section;
    }
    for (const li of pills.querySelectorAll('li[role="presentation"]')) {
      const isOurs = li === pill;
      // Remember which pill intra marked active so we can restore it.
      if (!isOurs && li.classList.contains('active')) li.setAttribute('data-ir-was-active', '');
      li.classList.toggle('active', ours ? isOurs : li.hasAttribute('data-ir-was-active'));
    }
  };

  const sync = () => show(location.hash === HASH);
  window.addEventListener('hashchange', sync);
  sync();
}
