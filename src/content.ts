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

  injectStyles();
  initTheme();

  await domReady();
  pinLogo();
  tidySidebar();
  addClustersButton();
  addSettingsButton();
  initSidebarTools();
  if (location.origin === V2_ORIGIN && isProfilePage()) initProfileHeader();
  if (location.origin === V2_ORIGIN) initNews();
}

async function initSidebarTools() {
  setSidebarTools((await getSettings()).sidebarTools);
  onSettingsChange((s) => setSidebarTools(s.sidebarTools));
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
  apply(current);
  onSettingsChange((s) => {
    if (s.newHeader !== current) apply((current = s.newHeader));
  });
}

main();
