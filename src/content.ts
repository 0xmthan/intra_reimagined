// Intra Reimagined: small, incremental tweaks on top of the original intra UI.
// Each tweak gets its own function so it can be reviewed and toggled on its own.
import baseCss from './styles.css?inline';
import darkCss from './dark.css?inline';

const css = baseCss + darkCss;
import { addSettingsButton } from './settings';
import { isProfilePage } from './pace/timeline';
import { runPaceBridge } from './pace/bridge';
import { V2_ORIGIN, V3_ORIGIN } from './pace/types';
import { initTheme } from './theme';
import { pinLogo } from './logo';
import { mountHero } from './profile/hero';
import { addHomePatronages } from './profile/patronages';
import { notifyUpdate } from './update';
import { initSearchShortcut, setSidebarTools } from './topbar';
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
  initSearchShortcut();
  // Our header and sidebar tools need the parsed page; hide what they replace until then.
  if (location.origin === V2_ORIGIN && isProfilePage()) document.documentElement.classList.add(HERO_PENDING);
  document.documentElement.classList.add(TOOLS_PENDING);

  await domReady();
  pinLogo();
  tidySidebar();
  addClustersButton();
  addSettingsButton();
  setSidebarTools(true);
  document.documentElement.classList.remove(TOOLS_PENDING);
  if (location.origin === V2_ORIGIN && isProfilePage()) mountHero();
  document.documentElement.classList.remove(HERO_PENDING); // mounted, or not happening: show intra's banner again
  if (location.origin === V2_ORIGIN) initNews();
  if (location.origin === V2_ORIGIN && location.pathname === '/') addHomePatronages();
  notifyUpdate();
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
/**
 * On profile-v3: we only redesign the classic profile (v2), so offer to go back (once per browser
 * session). intra sends everyone with "Profile V3" switched on to v3 from every v2 page except its
 * settings, so a plain link to v2 would bounce straight back: send them to the switch itself.
 */
async function offerV2() {
  if (await dismissed('stayOnV3')) return;
  const go = await ask({
    title: 'Intra Reimagined is installed',
    body: "It only works on the classic profile. If intra keeps bringing you to this new one, Profile V3 is switched on in your intra settings: turn it off there to use Intra Reimagined.",
    primary: 'Open Profile V3 settings',
    secondary: 'Stay on this page',
  });
  if (go) location.href = `${V2_ORIGIN}/v3_early_access`;
  else dismiss('stayOnV3');
}

const HERO_PENDING = 'ir-hero-pending';
const TOOLS_PENDING = 'ir-topbar-pending';

main();
