// Dark mode: toggles `html.ir-dark` (styles in dark.css). Runs at document_start so the page
// never flashes white; a per-origin mirror gives an instant first guess before the async
// extension storage answers.
//
// dark.css recolors intra's known building blocks. Intra has many one-off boxes too, so a pass
// over the page tags whatever is still light (backgrounds, borders) or dark (text) with .ir-dk-*
// classes, judged from the original light-theme colors. Saturated colors, images and emojis are
// never touched, so they keep their true colors.
import { getSettings, onSettingsChange } from './store';

const MIRROR_KEY = 'intra-reimagined:dark';
const DONE = 'irDk'; // data-ir-dk on elements already looked at
// Our own UI is designed dark already; intra's sidebar is natively dark.
const SKIP = '#ir-hero, #ir-palette, #ir-side-tools, #ir-logo, .page-sidebar, svg, img, video, canvas, iframe';

let observer: MutationObserver | undefined;

function apply(dark: boolean) {
  document.documentElement.classList.toggle('ir-dark', dark);
  try {
    localStorage.setItem(MIRROR_KEY, dark ? '1' : '0');
  } catch {
    /* storage blocked: extension storage still drives it */
  }
  if (dark) startTagging();
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

// ---------- tagging ----------

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const parse = (c: string): Rgba | undefined => {
  const m = c.match(/[\d.]+/g);
  if (!m || m.length < 3) return undefined;
  const [r, g, b, a = 1] = m.map(Number);
  return { r, g, b, a };
};
const light = (c: Rgba) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
const neutral = (c: Rgba) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 24; // greys, not brand colors

/**
 * Tags one element, reading its colors with our dark styles switched off for the read, so the
 * judgement is always made on intra's original (light) colors.
 */
function tag(el: HTMLElement) {
  el.dataset[DONE] = '';
  if (el === document.body) return; // the page background is dark.css's job
  const s = getComputedStyle(el);
  if (s.display === 'none') return;

  const bg = parse(s.backgroundColor);
  if (bg && bg.a > 0.4 && neutral(bg) && !s.backgroundImage.includes('url(')) {
    const l = light(bg);
    if (l > 0.93) el.classList.add('ir-dk-bg');
    else if (l > 0.8) el.classList.add('ir-dk-bg2');
  }

  const fg = parse(s.color);
  if (fg && neutral(fg) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) {
    const l = light(fg);
    // Only when the text sits on something that turns dark (not on a colored badge/button).
    if (l < 0.62 && sitsOnNeutral(el)) el.classList.add(l < 0.35 ? 'ir-dk-text' : 'ir-dk-muted');
  }

  for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
    if (parseFloat(s[`border${side}Width`]) <= 0) continue;
    const bc = parse(s[`border${side}Color`]);
    if (bc && bc.a > 0.2 && neutral(bc) && light(bc) > 0.7) {
      el.classList.add('ir-dk-border');
      break;
    }
  }
}

/** Is the first opaque background behind `el` a neutral (light) one, i.e. one we darken? */
function sitsOnNeutral(el: HTMLElement): boolean {
  for (let e: HTMLElement | null = el; e && e !== document.body; e = e.parentElement) {
    if (e.matches('.ir-dk-bg, .ir-dk-bg2')) return true;
    const bg = parse(getComputedStyle(e).backgroundColor);
    if (bg && bg.a > 0.4) return neutral(bg) && light(bg) > 0.8;
  }
  return true; // the page background
}

function tagTree(root: ParentNode) {
  const html = document.documentElement;
  html.classList.add('ir-dk-reading'); // no transitions kicked off by the flip below
  html.classList.remove('ir-dark'); // read intra's own colors
  try {
    const all = root instanceof HTMLElement ? [root, ...root.querySelectorAll<HTMLElement>('*')] : [...root.querySelectorAll<HTMLElement>('*')];
    for (const el of all) {
      if (DONE in el.dataset || el.closest(SKIP)) continue;
      tag(el);
    }
  } finally {
    html.classList.add('ir-dark');
    getComputedStyle(html).color; // settle styles before transitions come back
    html.classList.remove('ir-dk-reading');
  }
}

// ---------- interactive states ----------
// Hover/focus/active styles only apply while you interact, so the tagging pass can't see them.
// Instead, read intra's stylesheets once and write dark versions of the rules that use a light
// background or dark text in those states (e.g. `.notification-item:hover { background: #fff }`).

const STATE = /:hover|:focus|:active|\.active\b|\.open\b|\.selected\b|\.current\b/;
const STATES_STYLE_ID = 'ir-dark-states';
const doneSheets = new WeakSet<CSSStyleSheet>();

/** Splits a selector list on top-level commas (not the ones inside :not(...) etc.). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

function darkStateRule(rule: CSSStyleRule): string | undefined {
  const sels = splitSelectors(rule.selectorText).filter((sel) => STATE.test(sel) && !/^(html|body|:root)\b/.test(sel));
  if (!sels.length) return undefined;
  const decls: string[] = [];
  const bg = parse(rule.style.backgroundColor);
  if (bg && bg.a > 0.4 && neutral(bg) && light(bg) > 0.8) decls.push('background-color: var(--ir-surface-3) !important');
  const fg = parse(rule.style.color);
  if (fg && neutral(fg) && light(fg) < 0.62) decls.push(`color: var(${light(fg) < 0.35 ? '--ir-text' : '--ir-muted'}) !important`);
  const bc = parse(rule.style.borderColor || rule.style.borderTopColor);
  if (bc && bc.a > 0.2 && neutral(bc) && light(bc) > 0.7) decls.push('border-color: var(--ir-border) !important');
  if (!decls.length) return undefined;
  return `${sels.map((sel) => `html.ir-dark ${sel}`).join(', ')} { ${decls.join('; ')} }`;
}

function themeInteractiveStates() {
  const out: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const r of rules) {
      if (r instanceof CSSStyleRule) {
        const d = darkStateRule(r);
        if (d) out.push(d);
      } else if (r instanceof CSSMediaRule || r instanceof CSSSupportsRule) {
        walk(r.cssRules); // flattening is fine: these only recolor
      }
    }
  };
  for (const sheet of document.styleSheets) {
    if (doneSheets.has(sheet) || sheet.ownerNode instanceof Element && sheet.ownerNode.id.startsWith('ir')) continue;
    try {
      walk(sheet.cssRules);
      doneSheets.add(sheet);
    } catch {
      /* cross-origin sheet (not readable) or still loading: retried on the next call */
    }
  }
  if (!out.length) return;
  let style = document.getElementById(STATES_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STATES_STYLE_ID;
    document.head.appendChild(style);
  }
  style.append(out.join('\n') + '\n');
}

function startTagging() {
  if (observer) return;
  const run = () => {
    themeInteractiveStates();
    if (document.readyState !== 'complete') window.addEventListener('load', themeInteractiveStates, { once: true });
    tagTree(document.body);
    // New content (intra's ajax lists, dropdowns, tabs): tag it in batches.
    let pending: HTMLElement[] = [];
    let scheduled = false;
    observer = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof HTMLElement) pending.push(n);
      if (scheduled || !pending.length) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const batch = pending;
        pending = [];
        if (!document.documentElement.classList.contains('ir-dark')) return;
        for (const n of batch) if (n.isConnected) tagTree(n);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.body && document.readyState !== 'loading') run();
  else document.addEventListener('DOMContentLoaded', run, { once: true });
}
