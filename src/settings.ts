// Settings: a gear in intra's left icon sidebar that opens intra's own settings page
// (/users/<login>/edit), where we add an "Intra Reimagined" entry to its side menu.
import { setHTML } from './html';
import { myLogin } from './me';
import { installUrl, updateInfo } from './update';
import { fetchIrUser, saveIrHidden } from './profile/data';

/** The installed version, from the manifest (vite.config.ts copies it from package.json). */
const VERSION = ((globalThis as { browser?: { runtime: { getManifest(): { version: string } } } }).browser ??
  (globalThis as { chrome?: { runtime: { getManifest(): { version: string } } } }).chrome)?.runtime.getManifest().version;

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
  return `https://profile.intra.42.fr/users/${myLogin() ?? 'me'}/edit${HASH}`;
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

/** "Show the Intra Reimagined badge on my profile": only once the server knows you (signed in). */
async function addBadgeToggle(section: HTMLElement) {
  const login = myLogin();
  const ir = login ? await fetchIrUser(login) : undefined;
  if (!ir) return;
  const row = document.createElement('div');
  row.className = 'col-sm-12 ir-setting-row';
  setHTML(row, `
    <label class="ir-setting-check">
      <input type="checkbox" ${ir.hidden ? '' : 'checked'}>
      Show the Intra Reimagined badge on my profile
    </label>
    <p class="ir-setting-help">Other Intra Reimagined users see it next to your name.</p>
    <p class="ir-setting-error" hidden></p>`);
  section.append(row);
  const box = row.querySelector('input')!;
  const err = row.querySelector<HTMLElement>('.ir-setting-error')!;
  box.addEventListener('change', async () => {
    box.disabled = true;
    err.hidden = true;
    const r = await saveIrHidden(!box.checked);
    box.disabled = false;
    if (r.error) {
      box.checked = !box.checked;
      err.textContent = r.error;
      err.hidden = false;
    }
  });
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
      <h4 class="font-weight-bold text-uppercase">Intra Reimagined${VERSION ? ` <span class="ir-setting-version">v${VERSION}</span>` : ''}</h4>
    </div>`);
  pane.appendChild(section);
  addBadgeToggle(section);

  // Chrome copies don't update themselves: point at the new version next to the current one.
  updateInfo().then((u) => {
    const tag = section.querySelector('.ir-setting-version');
    if (!u?.latest || !tag) return;
    const link = document.createElement('a');
    link.href = installUrl();
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'ir-setting-update';
    link.textContent = `update to v${u.latest}`;
    tag.append(' · ', link);
  });


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
