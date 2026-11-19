// Banner editor, opened by the pen button on your own profile header: keep your coalition's cover
// (the default) or upload your own image or GIF. The server checks and stores it (server/banners.ts);
// here we only pre-check type and size so mistakes get a message before uploading.
import { setHTML } from '../html';
import { BANNER_MAX_BYTES, BANNER_TYPES, saveBanner } from './data';

interface Options {
  /** Current custom banner URL, or null when the coalition cover is used. */
  current: string | null;
  /** The coalition cover, for the "default" preview. */
  coalCover?: string;
  /** intra's own "edit profile" page (the pen's old job), still reachable from here. */
  editHref?: string;
  onSaved: (url: string | null) => void;
}

const HOST = 'ir-banner-editor';
const cssUrl = (u: string) => `url("${u.replace(/["\\\n]/g, '')}")`;

export function openBannerEditor(o: Options) {
  if (document.querySelector(HOST)) return;
  const host = document.createElement(HOST);
  const root = host.attachShadow({ mode: 'open' });
  setHTML(
    root,
    `<style>${CSS}</style>
    <div class="backdrop">
      <div class="card" role="dialog" aria-modal="true" aria-labelledby="t">
        <h2 id="t">Profile banner</h2>
        <p class="sub">Shown behind your profile header to everyone using Intra Reimagined.</p>
        <div class="preview"><div class="scrim"></div><span class="tag"></span></div>
        <div class="choices">
          <button class="choice" data-pick="coal">
            <span class="thumb coal"></span>
            <span><b>Coalition</b><small>Your coalition's cover (default)</small></span>
          </button>
          <button class="choice" data-pick="file">
            <span class="thumb custom"><span class="plus">+</span></span>
            <span><b>Your own image or GIF</b><small>PNG, JPG, GIF or WebP · up to 10 MB · wide images look best</small></span>
          </button>
        </div>
        <input type="file" accept="${BANNER_TYPES.join(',')}" hidden>
        <p class="error" role="alert"></p>
        <div class="actions">
          ${o.editHref ? `<a class="link" href="">Edit intra profile</a>` : '<span></span>'}
          <span class="buttons">
            <button class="ghost" data-act="cancel">Cancel</button>
            <button class="primary" data-act="save" disabled>Save</button>
          </span>
        </div>
      </div>
    </div>`,
  );
  const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!;
  if (o.editHref) $<HTMLAnchorElement>('.link').href = o.editHref;

  // pending: what Save would do. undefined = nothing changed.
  let pending: { file: File | null; preview: string | null } | undefined;
  const coal = o.coalCover ? cssUrl(o.coalCover) : 'none';
  $<HTMLElement>('.thumb.coal').style.backgroundImage = coal;

  const show = (url: string | null, label: string) => {
    $<HTMLElement>('.preview').style.backgroundImage = url ? cssUrl(url) : coal;
    $('.tag').textContent = label;
    root.querySelectorAll('.choice').forEach((c) => c.classList.toggle('on', (c as HTMLElement).dataset.pick === (url ? 'file' : 'coal')));
    if (url) $<HTMLElement>('.thumb.custom').style.backgroundImage = cssUrl(url);
  };
  const error = (msg: string) => ($('.error').textContent = msg);
  show(o.current, o.current ? 'Your banner' : 'Coalition cover');

  const input = $<HTMLInputElement>('input[type=file]');
  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    const pick = t.closest<HTMLElement>('[data-pick]')?.dataset.pick;
    if (pick === 'coal') {
      error('');
      pending = o.current ? { file: null, preview: null } : undefined;
      show(null, 'Coalition cover');
      $<HTMLButtonElement>('[data-act=save]').disabled = !pending;
    } else if (pick === 'file') input.click();
    else if (t.closest('[data-act=cancel]') || t === $('.backdrop')) close();
    else if (t.closest('[data-act=save]')) void save();
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!BANNER_TYPES.includes(file.type)) return error('Only PNG, JPG, GIF or WebP images.');
    if (file.size > BANNER_MAX_BYTES) return error(`Too big (${(file.size / 1024 / 1024).toFixed(1)} MB): up to 10 MB.`);
    error('');
    // A data: URL for the preview (blob: URLs made in a content script don't always load in the page).
    const reader = new FileReader();
    reader.onload = () => {
      const preview = typeof reader.result === 'string' ? reader.result : null;
      pending = { file, preview };
      show(preview, 'Preview');
      $<HTMLButtonElement>('[data-act=save]').disabled = false;
    };
    reader.readAsDataURL(file);
  });

  async function save() {
    if (!pending) return close();
    const btn = $<HTMLButtonElement>('[data-act=save]');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const r = await saveBanner(pending.file);
    btn.textContent = 'Save';
    if ('error' in r) {
      btn.disabled = false;
      return error(r.error);
    }
    o.onSaved(r.url);
    close();
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  function close() {
    document.removeEventListener('keydown', onKey, true);
    host.remove();
  }
  document.addEventListener('keydown', onKey, true);
  document.documentElement.append(host);
  $<HTMLButtonElement>('[data-pick=file]').focus();
}

const CSS = `
:host { all: initial; }
.backdrop {
  position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; padding: 16px;
  background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  font: 15px/1.45 futura-pt, Helvetica, Arial, sans-serif; color: #e2e4ea;
  animation: fade 140ms ease-out;
}
.card {
  width: min(560px, 100%); box-sizing: border-box; max-height: calc(100vh - 32px); overflow: auto;
  padding: 24px; border-radius: 16px; background: #14171d; border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}
h2 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
.sub { margin: 0 0 16px; color: #a1a7b5; font-size: 14px; }
.preview {
  position: relative; aspect-ratio: 16 / 5; border-radius: 12px; overflow: hidden;
  background: #1b1f27 center / cover no-repeat;
}
.scrim { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(11, 13, 17, 0.7)); }
.tag {
  position: absolute; left: 12px; bottom: 10px; padding: 3px 10px; border-radius: 999px;
  background: rgba(0, 0, 0, 0.45); font-size: 12px; color: #fff;
}
.choices { display: grid; gap: 8px; margin-top: 14px; }
.choice {
  display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 12px; text-align: left;
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: inherit;
  font: inherit; cursor: pointer;
}
.choice:hover { background: rgba(255, 255, 255, 0.07); }
.choice.on { border-color: #00babc; background: rgba(0, 186, 188, 0.1); }
.choice b { display: block; font-weight: 600; }
.choice small { display: block; color: #a1a7b5; font-size: 12.5px; }
.thumb {
  flex: none; width: 72px; height: 40px; border-radius: 8px; display: grid; place-items: center;
  background: #252a35 center / cover no-repeat;
}
.plus { font-size: 22px; color: #a1a7b5; }
.thumb.custom[style*="url"] .plus { display: none; }
.error { min-height: 1.2em; margin: 10px 0 0; color: #ff7a7a; font-size: 13.5px; }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
.link { color: #a1a7b5; font-size: 13.5px; }
.link:hover { color: #e2e4ea; }
.buttons { display: flex; gap: 8px; margin-left: auto; }
.buttons button { font: inherit; font-weight: 600; padding: 9px 18px; border-radius: 10px; border: 0; cursor: pointer; }
.ghost { background: rgba(255, 255, 255, 0.07); color: #e2e4ea; }
.ghost:hover { background: rgba(255, 255, 255, 0.12); }
.primary { background: #00babc; color: #fff; }
.primary:disabled { opacity: 0.45; cursor: default; }
:focus-visible { outline: 2px solid #00babc; outline-offset: 2px; }
@keyframes fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .backdrop { animation: none; } }
`;
