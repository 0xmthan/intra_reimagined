// Intra Reimagined: small, incremental tweaks on top of the original intra UI.
// Each tweak gets its own function so it can be reviewed and toggled on its own.
import css from './styles.css?inline';
import { addSettingsButton } from './settings';
import { addPaceTimeline, isProfilePage } from './pace/timeline';
import { runPaceBridge } from './pace/bridge';
import { V2_ORIGIN, V3_ORIGIN } from './pace/types';
import { initTheme } from './theme';
import { pinLogo } from './logo';

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
  if (window !== window.top || document.getElementById(STYLE_ID)) return;

  injectStyles();
  initTheme();

  await domReady();
  pinLogo();
  addSettingsButton();
  if (location.origin === V2_ORIGIN && isProfilePage()) addPaceTimeline();
}

main();
