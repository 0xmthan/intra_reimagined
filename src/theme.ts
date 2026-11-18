// Dark mode: toggles `html.ir-dark` (styles in styles.css). Runs at document_start so the
// page never flashes white; a per-origin mirror gives an instant first guess before the
// async extension storage answers.
import { getSettings, onSettingsChange } from './store';

const MIRROR_KEY = 'intra-reimagined:dark';

function apply(dark: boolean) {
  document.documentElement.classList.toggle('ir-dark', dark);
  try {
    localStorage.setItem(MIRROR_KEY, dark ? '1' : '0');
  } catch {
    /* storage blocked: extension storage still drives it */
  }
}

export function initTheme() {
  try {
    if (localStorage.getItem(MIRROR_KEY) === '1') apply(true);
  } catch {
    /* ignore */
  }
  getSettings().then((s) => apply(s.darkMode));
  onSettingsChange((s) => apply(s.darkMode));
}
