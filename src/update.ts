// "New version available": tell the user when the server has a newer version than this one.
//  - Chrome only auto-updates Web Store extensions, so the Chrome zip is updated by hand.
//  - Firefox updates itself from updates.json, but only checks about once a day (and an extension
//    can't make it check sooner: runtime.requestUpdateCheck isn't in Firefox). Opening the new .xpi
//    installs it over this one, so the card's button does that.
// Checked at most every 30 minutes (the server caches the answer for 5); "Later" hides it for a day.
import { PLANET } from './gate';
import { setHTML } from './html';

const IR_API = (import.meta.env.VITE_IR_API as string | undefined)?.replace(/\/+$/, '');
const CHECK_KEY = 'updateCheck'; // { at, latest }
const SNOOZE_KEY = 'updateSnooze'; // { version, until }
const CHECK_EVERY = 30 * 60_000;
const SNOOZE_FOR = 24 * 3_600_000;

interface Manifest {
  version: string;
  browser_specific_settings?: unknown;
}
interface Ext {
  runtime: { getManifest(): Manifest };
  storage: { local: { get(k: string): Promise<Record<string, unknown>>; set(i: Record<string, unknown>): Promise<void> } };
}
const ext = ((globalThis as { browser?: Ext }).browser ?? (globalThis as { chrome?: Ext }).chrome) as Ext | undefined;

const num = (v: string) => v.split('.').map(Number).reduce((acc, n) => acc * 1000 + (n || 0), 0);

/** Firefox copies carry Firefox's settings in their manifest; the Chrome zip doesn't. */
const isFirefox = () => !!ext?.runtime.getManifest().browser_specific_settings;

/** The newest version the server offers for this browser, or undefined. */
async function fetchLatest(): Promise<string | undefined> {
  if (isFirefox()) {
    const res = await fetch(`${IR_API}/updates.json`, { credentials: 'omit' });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { addons?: Record<string, { updates?: { version?: unknown }[] }> };
    const versions = Object.values(j.addons ?? {})
      .flatMap((a) => a.updates ?? [])
      .map((u) => u.version)
      .filter((v): v is string => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v));
    return versions.sort((a, b) => num(b) - num(a))[0];
  }
  const res = await fetch(`${IR_API}/chrome/latest.json`, { credentials: 'omit' });
  const v = res.ok ? ((await res.json()) as { version?: unknown }).version : undefined;
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : undefined;
}

/** The installed version and, if the server has a newer build for this browser, its version. */
export async function updateInfo(): Promise<{ current: string; latest?: string } | undefined> {
  const manifest = ext?.runtime.getManifest();
  if (!ext || !IR_API || !manifest) return undefined;
  const current = manifest.version;
  let latest: string | undefined;
  try {
    const cached = (await ext.storage.local.get(CHECK_KEY))[CHECK_KEY] as { at: number; latest?: string } | undefined;
    if (cached && Date.now() - cached.at < CHECK_EVERY) latest = cached.latest;
    else {
      latest = await fetchLatest();
      await ext.storage.local.set({ [CHECK_KEY]: { at: Date.now(), latest } });
    }
  } catch {
    return { current };
  }
  return { current, latest: latest && num(latest) > num(current) ? latest : undefined };
}

/** Firefox: the newest .xpi (opening it installs it over this one). Chrome: the install page, at its update steps. */
export const installUrl = () => (isFirefox() ? `${IR_API}/firefox/latest.xpi` : `${IR_API}/install#update`);

/** Corner card on intra pages when a newer version is out (unless snoozed for it). */
export async function notifyUpdate() {
  const info = await updateInfo();
  if (!info?.latest || document.querySelector('intra-reimagined-update')) return;
  const snooze = (await ext!.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY] as { version: string; until: number } | undefined;
  if (snooze?.version === info.latest && snooze.until > Date.now()) return;

  const host = document.createElement('intra-reimagined-update');
  const root = host.attachShadow({ mode: 'closed' });
  setHTML(
    root,
    `<style>${CSS}</style>
    <div class="card" role="status">
      <div class="logo">${PLANET}</div>
      <div class="text">
        <b>Update available</b>
        <span>Intra Reimagined ${info.latest} is out (you have ${info.current}).${isFirefox() ? ' Firefox asks to install it, then you\'re on the new one.' : ''}</span>
        <div class="actions">
          <a class="primary" href="${installUrl()}" target="_blank" rel="noopener">${isFirefox() ? 'Update' : 'Download'}</a>
          <button class="later">Later</button>
        </div>
      </div>
    </div>`,
  );
  const close = () => host.remove();
  root.querySelector('.later')!.addEventListener('click', () => {
    void ext!.storage.local.set({ [SNOOZE_KEY]: { version: info.latest, until: Date.now() + SNOOZE_FOR } });
    close();
  });
  root.querySelector('.primary')!.addEventListener('click', close);
  document.documentElement.appendChild(host);
}

const CSS = `
:host { all: initial; }
.card {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
  display: flex; gap: 12px; width: min(340px, calc(100vw - 32px)); box-sizing: border-box;
  padding: 14px 16px; border-radius: 14px;
  background: var(--ir-surface); color: var(--ir-text); border: 1px solid rgba(var(--ir-ink), 0.09);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
  font: 14px/1.45 futura-pt, Helvetica, Arial, sans-serif;
  animation: rise 220ms cubic-bezier(.2, .8, .2, 1);
}
.logo { flex: none; width: 36px; height: 36px; border-radius: 10px; background: #00babc; display: grid; place-items: center; }
.logo svg { width: 36px; height: 36px; }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
b { font-size: 15px; font-weight: 600; }
span { color: var(--ir-muted); }
.actions { display: flex; gap: 8px; margin-top: 10px; }
.actions > * {
  font: inherit; font-weight: 600; cursor: pointer; text-decoration: none;
  padding: 7px 14px; border-radius: 8px; border: 0;
}
.primary { background: var(--ir-accent); color: #fff; }
.primary:hover { filter: brightness(1.08); }
.later { background: rgba(var(--ir-ink), 0.07); color: var(--ir-text); }
.later:hover { background: rgba(var(--ir-ink), 0.12); }
:focus-visible { outline: 2px solid var(--ir-accent); outline-offset: 2px; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
@media (prefers-reduced-motion: reduce) { .card { animation: none; } }
`;
