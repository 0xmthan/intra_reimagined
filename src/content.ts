// Intra Reimagined: small, incremental tweaks on top of the original intra UI.
// Each tweak gets its own function so it can be reviewed and toggled on its own.
import baseCss from './styles.css?inline';
import darkCss from './dark.css?inline';

const css = baseCss + darkCss;
import { addSettingsButton } from './settings';
import { addPaceTimeline, isProfilePage } from './pace/timeline';
import { runPaceBridge } from './pace/bridge';
import { V2_ORIGIN, V3_ORIGIN } from './pace/types';
import { initTheme } from './theme';
import { pinLogo } from './logo';
import { mountHero, unmountHero } from './profile/hero';
import { getSettings, onSettingsChange } from './store';
import { setSidebarTools } from './topbar';
import { tidySidebar } from './sidebar-links';
import { addClustersButton, initEmbed, isEmbedFrame } from './clusters';
import { initNews } from './news';
import { NEEDS_LOGIN, connect, consumeAuthRedirect, getToken, loginHint, setLoginHint } from './auth';
import { ask, dismiss, dismissed, loginPill } from './gate';

const STYLE_ID = 'intra-reimagined-styles';

// Runs at document_start, before <head> exists, so attach to the root element.
function injectStyles() {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  (document.head ?? document.documentElement).appendChild(style);
}

const domReady = () =>
  new Promise<void>((resolve) => {
    if (document.readyState !== 'loading') resolve();
    else document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });

async function main() {
  // Inside the hidden profile-v3 frame we only act as the pace-data bridge.
  if (location.origin === V3_ORIGIN) {
    if (window !== window.top) runPaceBridge();
    else offerV2();
    return;
  }
  // The clusters map framed in our Clusters window: themed, but none of the page chrome.
  if (isEmbedFrame()) {
    if (document.getElementById(STYLE_ID)) return;
    injectStyles();
    initTheme();
    await domReady();
    initEmbed();
    return;
  }
  if (window !== window.top || document.getElementById(STYLE_ID)) return;
  consumeAuthRedirect();
  if (NEEDS_LOGIN && loginHint()) {
    // Logged in last time on this site: style the page right away, confirm in the background.
    getToken().then((t) => {
      if (t) return;
      setLoginHint(false);
      location.reload(); // signed out since: start over without the redesign (the popup asks again)
    });
  } else if (!(await loggedIn())) return; // skipped the login: leave intra exactly as it is
  if (document.getElementById(STYLE_ID)) return;

  injectStyles();
  initTheme();
  // Settings are async and our header / sidebar tools need the parsed page, so hide what they
  // replace right away (per-origin mirrors of the settings decide it), until they're in place.
  if (location.origin === V2_ORIGIN && isProfilePage() && hint(HERO_HINT)) document.documentElement.classList.add(HERO_PENDING);
  if (hint(TOOLS_HINT)) document.documentElement.classList.add(TOOLS_PENDING);

  await domReady();
  pinLogo();
  tidySidebar();
  addClustersButton();
  addSettingsButton();
  initSidebarTools();
  if (location.origin === V2_ORIGIN && isProfilePage()) await initProfileHeader();
  document.documentElement.classList.remove(HERO_PENDING); // mounted, or not happening: show intra's banner again
  if (location.origin === V2_ORIGIN) initNews();
}

/** Logged in with 42, or asks to (once per browser session; after Skip, a corner button offers it). */
async function loggedIn(): Promise<boolean> {
  if (!NEEDS_LOGIN) return true;
  if (await getToken()) return setLoginHint(true), true;
  // 42's own sign-in and OAuth pages: that's where "Log in" leads, so never cover them.
  if (/^(api|auth|signin)\.intra\.42\.fr$/.test(location.hostname)) return false;
  if (await dismissed('skipLogin')) return loginPill(connect), false;
  const login = await ask({
    title: 'Log in to Intra Reimagined',
    body: 'Connect your 42 account to turn on the redesigned intra: the new profile header, dark mode, evaluator stats and your piscine.',
    primary: 'Log in with 42',
    secondary: 'Skip for now',
    note: 'Skip leaves intra untouched until you restart the browser.',
  });
  if (login) connect();
  else {
    dismiss('skipLogin');
    loginPill(connect);
  }
  return false;
}

/** On profile-v3: we only redesign v2, so offer to go there (once per browser session). */
async function offerV2() {
  if (await dismissed('stayOnV3')) return;
  const go = await ask({
    title: 'Intra Reimagined is installed',
    body: 'It only works on the classic intra (profile.intra.42.fr). This page stays as it is.',
    primary: 'Switch to profile.intra.42.fr',
    secondary: 'Continue on this page',
  });
  if (go) location.href = `${V2_ORIGIN}/`;
  else dismiss('stayOnV3');
}

async function initSidebarTools() {
  const on = (await getSettings()).sidebarTools;
  setHint(TOOLS_HINT, on);
  setSidebarTools(on);
  document.documentElement.classList.remove(TOOLS_PENDING);
  onSettingsChange((s) => {
    setHint(TOOLS_HINT, s.sidebarTools);
    setSidebarTools(s.sidebarTools);
  });
}

/** New header (default) or the classic banner + our timeline; switchable live from settings. */
async function initProfileHeader() {
  const apply = (useNew: boolean) => {
    if (useNew) {
      document.getElementById('ir-pace-timeline')?.remove();
      document.getElementById('ir-max-deadline')?.remove();
      mountHero();
    } else {
      unmountHero();
      addPaceTimeline();
    }
  };
  let current = (await getSettings()).newHeader;
  setHint(HERO_HINT, current);
  apply(current);
  onSettingsChange((s) => {
    if (s.newHeader !== current) apply((current = s.newHeader));
    setHint(HERO_HINT, s.newHeader);
  });
}

// Per-origin mirrors of on-by-default settings, readable at document_start (see main).
const HERO_PENDING = 'ir-hero-pending';
const HERO_HINT = 'intra-reimagined:newHeader';
const TOOLS_PENDING = 'ir-topbar-pending';
const TOOLS_HINT = 'intra-reimagined:sidebarTools';

function hint(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

function setHint(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

main();
