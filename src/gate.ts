// First-contact popups, shown before the extension changes anything on the page:
//  - on profile-v3: "Intra Reimagined only works on profile.intra.42.fr" → Continue / Switch
//  - on v2 without a login: "Log in with 42" → Log in / Skip (skip = leave intra untouched)
// Either dismissal holds until the browser restarts: background.ts writes a new `browserSession`
// id at every browser start, and a dismissal is stored with the id it was made in. (Content
// scripts can't count on reading storage.session in Firefox, so this uses storage.local.)
// The popup lives in a shadow root so intra's CSS (and ours) can't reach it.
import { setHTML } from './html';

interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
const local = ((globalThis as { browser?: { storage: { local: StorageArea } } }).browser ??
  (globalThis as { chrome?: { storage: { local: StorageArea } } }).chrome)?.storage.local;
const SESSION = 'browserSession';
const KEY = 'dismissed';

/** Was this popup dismissed earlier in this browser session? (Unreadable storage = no.) */
export async function dismissed(key: string): Promise<boolean> {
  try {
    const r = (await local?.get([SESSION, KEY])) ?? {};
    return (r[KEY] as Record<string, unknown> | undefined)?.[key] === (r[SESSION] ?? 'none');
  } catch {
    return false;
  }
}

export async function dismiss(key: string) {
  try {
    const r = (await local?.get([SESSION, KEY])) ?? {};
    await local?.set({ [KEY]: { ...(r[KEY] as object | undefined), [key]: r[SESSION] ?? 'none' } });
  } catch {
    // no storage: the popup simply comes back on the next page
  }
}

/** The extension's mark (public/icon.svg without its square): white planet, ring cut out in teal. */
const PLANET = `<svg viewBox="0 0 128 128" aria-hidden="true"><g transform="translate(64 64) scale(.88) rotate(-22) translate(-64 -64)" fill="none" stroke-linecap="round">
  <path d="M12 64A52 14 0 0 1 116 64" stroke="#fff" stroke-width="7"/>
  <circle cx="64" cy="64" r="27" fill="#fff" stroke="none"/>
  <path d="M116 64A52 14 0 0 1 12 64" stroke="#00babc" stroke-width="15"/>
  <path d="M116 64A52 14 0 0 1 12 64" stroke="#fff" stroke-width="7"/>
</g></svg>`;

interface Prompt {
  title: string;
  body: string;
  primary: string;
  secondary: string;
  /** Small print under the buttons. */
  note?: string;
}

const CSS = `
:host { all: initial; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483647;
  display: grid; place-items: center; padding: 16px;
  background: rgba(8, 10, 14, 0.55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  font: 15px/1.5 futura-pt, Helvetica, Arial, sans-serif;
  animation: fade 160ms ease-out;
  --bg: #ffffff; --text: #1d2129; --muted: #5b6270; --border: rgba(0, 0, 0, 0.08);
  --ghost: rgba(0, 0, 0, 0.05); --ghost-hover: rgba(0, 0, 0, 0.09);
}
@media (prefers-color-scheme: dark) {
  .backdrop {
    --bg: #14171d; --text: #e2e4ea; --muted: #a1a7b5; --border: rgba(255, 255, 255, 0.09);
    --ghost: rgba(255, 255, 255, 0.06); --ghost-hover: rgba(255, 255, 255, 0.11);
  }
}
.card {
  width: min(400px, 100%); box-sizing: border-box;
  padding: 28px 26px 22px; border-radius: 16px;
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.3);
  animation: rise 200ms cubic-bezier(.2, .8, .2, 1);
}
.badge {
  width: 44px; height: 44px; border-radius: 12px; margin-bottom: 16px;
  display: grid; place-items: center;
  background: #00babc;
}
.badge svg { width: 44px; height: 44px; }
h2 { margin: 0 0 6px; font-size: 19px; font-weight: 600; line-height: 1.3; }
p { margin: 0; color: var(--muted); }
.actions { display: flex; flex-direction: column; gap: 8px; margin-top: 22px; }
button {
  font: inherit; font-weight: 600; cursor: pointer;
  padding: 11px 16px; border-radius: 10px; border: 0;
  transition: background 120ms, filter 120ms;
}
button:focus-visible { outline: 2px solid #00babc; outline-offset: 2px; }
.primary { background: #00babc; color: #fff; }
.primary:hover { filter: brightness(1.08); }
.secondary { background: var(--ghost); color: var(--text); }
.secondary:hover { background: var(--ghost-hover); }
.note { margin-top: 14px; font-size: 12.5px; text-align: center; color: var(--muted); }
@keyframes fade { from { opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
@media (prefers-reduced-motion: reduce) { .backdrop, .card { animation: none; } }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Shows the popup; resolves true for the primary button, false for the secondary one (or Escape). */
export function ask(p: Prompt): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('intra-reimagined-popup');
    const root = host.attachShadow({ mode: 'closed' });
    setHTML(root, `<style>${CSS}</style>
      <div class="backdrop">
        <div class="card" role="dialog" aria-modal="true" aria-labelledby="t" aria-describedby="d">
          <div class="badge">${PLANET}</div>
          <h2 id="t">${esc(p.title)}</h2>
          <p id="d">${esc(p.body)}</p>
          <div class="actions">
            <button class="primary" data-v="1">${esc(p.primary)}</button>
            <button class="secondary" data-v="0">${esc(p.secondary)}</button>
          </div>
          ${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}
        </div>
      </div>`);
    const done = (v: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(false);
    };
    root.addEventListener('click', (e) => {
      const v = (e.target as Element).closest<HTMLElement>('button')?.dataset.v;
      if (v) done(v === '1');
    });
    document.addEventListener('keydown', onKey, true);
    // At document_start there's no <body> yet; the root element is always there.
    document.documentElement.appendChild(host);
    root.querySelector<HTMLButtonElement>('.primary')?.focus();
  });
}

const PILL_CSS = `
:host { all: initial; }
button {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
  display: flex; align-items: center; gap: 0; height: 36px; padding: 0 9px;
  border: 0; border-radius: 18px; cursor: pointer;
  background: #00babc; color: #fff; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  font: 600 13px/1 futura-pt, Helvetica, Arial, sans-serif;
  opacity: 0.85; transition: opacity 150ms, gap 150ms;
}
svg { width: 20px; height: 20px; flex: none; }
span { max-width: 0; overflow: hidden; white-space: nowrap; transition: max-width 200ms ease; }
button:hover, button:focus-visible { opacity: 1; gap: 8px; }
button:hover span, button:focus-visible span { max-width: 140px; }
button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { button, span { transition: none; } }
`;

/** After "Skip": a small corner button (IR, expands to "Log in with 42" on hover) to log in later. */
export function loginPill(onClick: () => void) {
  if (document.querySelector('intra-reimagined-login')) return;
  const host = document.createElement('intra-reimagined-login');
  const root = host.attachShadow({ mode: 'closed' });
  setHTML(root, `<style>${PILL_CSS}</style>
    <button aria-label="Log in to Intra Reimagined with 42" title="Log in to Intra Reimagined">${PLANET}<span>Log in with 42</span></button>`);
  root.querySelector('button')!.addEventListener('click', onClick);
  document.documentElement.appendChild(host);
}
