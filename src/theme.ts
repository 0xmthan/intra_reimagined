// Dark mode, always on: `html.ir-dark` (styles in dark.css), set at document_start so the page
// never flashes white.
//
// dark.css recolors intra's known building blocks. Intra has many one-off boxes too, so a pass
// over the page tags whatever is still light (backgrounds, borders) or dark (text) with .ir-dk-*
// classes, judged from the original light-theme colors. Saturated colors, images and emojis are
// never touched, so they keep their true colors.

import { saveIrTheme } from './profile/data';

const DONE = 'irDk'; // data-ir-dk on elements already looked at
// Our own UI is designed dark already; intra's sidebar is natively dark.
const SKIP = '#ir-hero, .ir-theme-swatch, #ir-palette, #ir-side-tools, #ir-logo, .page-sidebar, svg, img, video, canvas, iframe';

let observer: MutationObserver | undefined;

export function initTheme() {
  initPrefs();
  if (currentMode() === 'dark') goDark();
}

function goDark() {
  document.documentElement.classList.add('ir-dark');
  startTagging();
}

// ---------- mode and accent ----------
// Both are picked in settings and live in storage.local so every intra site shares them, mirrored
// to each site's localStorage so they apply at document_start without waiting on the async read.
// Light mode leaves intra's own (light) colors alone; our UI follows the --ir-* tokens.

export const MODES = [
  { id: 'dark', name: 'Dark', color: '#14171d' },
  { id: 'light', name: 'Light', color: '#f4f5f7' },
] as const;
export const ACCENTS = [
  { id: 'default', name: 'Default', color: '#00babc' },
  { id: 'green', name: 'Green', color: '#3ddc84' },
  // Your coalition's color (on someone's shared profile: theirs). Its tokens are worked out from
  // that color (see paintAccent); until it's known, it looks like Default.
  { id: 'coalition', name: 'Coalition', color: '#00babc' },
] as const;
export type Mode = (typeof MODES)[number]['id'];
export type Accent = (typeof ACCENTS)[number]['id'];

interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
interface Ext {
  storage: { local: StorageArea; onChanged: { addListener(cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void } };
}
const ext = (globalThis as { browser?: Ext }).browser ?? (globalThis as { chrome?: Ext }).chrome;

/** storage key → the <html> attribute it sets, its choices, and the one that sets nothing. */
const PREFS = {
  mode: { attr: 'data-ir-mode', ids: MODES.map((m) => m.id) as string[], fallback: 'dark' },
  accent: { attr: 'data-ir-accent', ids: ACCENTS.map((a) => a.id) as string[], fallback: 'default' },
};
type Pref = keyof typeof PREFS;

// On someone else's profile that shares its theme, the page shows theirs: our own choices still
// get saved, but don't touch the page until we leave.
let visiting = false;

function apply(pref: Pref, value: unknown, persist = true) {
  const { attr, ids, fallback } = PREFS[pref];
  const v = typeof value === 'string' && ids.includes(value) ? value : fallback;
  const html = document.documentElement;
  if (persist && visiting) return void remember(pref, v, fallback);
  if (v === fallback) html.removeAttribute(attr);
  else html.setAttribute(attr, v);
  if (persist) remember(pref, v, fallback);
  paintAccent();
  if (pref === 'mode') {
    if (v === 'dark') goDark();
    else html.classList.remove('ir-dark'); // the .ir-dk-* tags only style under html.ir-dark
  }
}

/** Shows someone else's shared theme on their profile (not saved: only for this page). */
export function showVisitedTheme(t: { mode: string; accent: string }, coalColor?: string) {
  visiting = true;
  visitedCoal = coalColor;
  apply('mode', t.mode, false);
  apply('accent', t.accent, false);
}

/**
 * Your theme as the server has it (from your own profile): the server wins, so a theme picked on
 * another device shows up here. Never saved there yet: send the local one up.
 */
export function syncOwnTheme(t: { mode: string; accent: string; saved?: boolean } | undefined) {
  if (!t) return;
  if (t.saved) {
    if (t.mode !== currentMode()) void setPref('mode', t.mode as Mode);
    if (t.accent !== currentAccent()) void setPref('accent', t.accent as Accent);
  } else if (currentMode() !== 'dark' || currentAccent() !== 'default') {
    void saveIrTheme({ mode: currentMode(), accent: currentAccent() });
  }
}

function remember(pref: Pref, v: string, fallback: string) {
  try {
    if (v === fallback) localStorage.removeItem(`ir-${pref}`);
    else localStorage.setItem(`ir-${pref}`, v);
  } catch {
    /* no localStorage: storage.local still has it */
  }
}

const read = (pref: Pref) => document.documentElement.getAttribute(PREFS[pref].attr) ?? PREFS[pref].fallback;
export const currentMode = () => read('mode') as Mode;
export const currentAccent = () => read('accent') as Accent;

export async function setPref(pref: 'mode', v: Mode): Promise<void>;
export async function setPref(pref: 'accent', v: Accent): Promise<void>;
export async function setPref(pref: Pref, v: string) {
  apply(pref, v);
  try {
    await ext?.storage.local.set({ [pref]: v });
  } catch {
    /* kept for this site only */
  }
}

// ---------- coalition accent ----------
// The coalition color is kept like the prefs: storage.local for every intra site, mirrored to each
// site's localStorage so it paints at document_start. The tokens go inline on <html>, so they win
// over the stylesheet's accent blocks, and are redone when the mode flips.

const COAL_KEY = 'coalitionColor';
const COAL_LOCAL = 'ir-coalition-color';
const ACCENT_VARS = ['--ir-accent', '--ir-accent-rgb', '--ir-accent-hi', '--ir-accent-soft', '--ir-accent-muted'] as const;
let ownCoal: string | undefined;
let visitedCoal: string | undefined;

type Rgb = [number, number, number];

function toRgb(c: string): Rgb | undefined {
  const m = c.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (m) {
    const h = m.length === 3 ? [...m].map((x) => x + x).join('') : m;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
  }
  const p = /^rgba?\(/i.test(c.trim()) ? parse(c) : undefined;
  return p ? [p.r, p.g, p.b] : undefined;
}

function rgbToHsl([r, g, b]: Rgb): Rgb {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255)) as Rgb;
}

const hex = (rgb: Rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The accent tokens for a coalition color: its hue and saturation, with the lightness pulled into
 * a range that reads on our surfaces (lighter on dark, darker on light), like the built-in accents.
 */
function accentTokens(color: string, mode: string): Record<(typeof ACCENT_VARS)[number], string> | undefined {
  const rgb = toRgb(color);
  if (!rgb) return undefined;
  const [h, s, l] = rgbToHsl(rgb);
  const at = (light: number, sat = s) => hslToRgb(h, clamp(sat, 0, 1), clamp(light, 0, 1));
  const dark = clamp(l, 0.42, 0.62);
  const base = mode === 'light' ? clamp(l, 0.32, 0.48) : dark;
  const main = at(base);
  return {
    '--ir-accent': hex(main),
    '--ir-accent-rgb': main.join(', '),
    '--ir-accent-hi': hex(mode === 'light' ? at(base - 0.1) : at(Math.min(base + 0.16, 0.8))),
    '--ir-accent-soft': hex(mode === 'light' ? at(base - 0.06) : at(Math.min(base + 0.1, 0.74))),
    '--ir-accent-muted': hex(at(dark - 0.04, s * 0.75)), // the header stays dark in both modes
  };
}

/** Sets (or clears) the coalition accent's tokens for the current accent, mode and page. */
function paintAccent() {
  const style = document.documentElement.style;
  const color = read('accent') === 'coalition' ? (visiting ? visitedCoal : ownCoal) : undefined;
  const tokens = color ? accentTokens(color, read('mode')) : undefined;
  for (const v of ACCENT_VARS) {
    if (tokens) style.setProperty(v, tokens[v]);
    else style.removeProperty(v);
  }
}

/** Your coalition's color, once seen (on your profile, or fetched by settings). */
export const coalitionColor = () => ownCoal;

/** Remembers your coalition's color (from your own profile) for the Coalition accent everywhere. */
export function rememberCoalitionColor(color: string | undefined) {
  if (!color || !toRgb(color) || color === ownCoal) return;
  ownCoal = color;
  try {
    localStorage.setItem(COAL_LOCAL, color);
  } catch {
    /* storage.local still has it */
  }
  ext?.storage.local.set({ [COAL_KEY]: color }).catch(() => {});
  paintAccent();
}

function initPrefs() {
  try {
    ownCoal = localStorage.getItem(COAL_LOCAL) ?? undefined;
  } catch {
    /* unreadable: the storage.local read below sets it */
  }
  const keys = Object.keys(PREFS) as Pref[];
  for (const k of keys) {
    try {
      const cached = localStorage.getItem(`ir-${k}`);
      if (cached) {
        const { attr } = PREFS[k];
        document.documentElement.setAttribute(attr, cached); // checked by the storage.local read below
      }
    } catch {
      /* unreadable: the storage.local read below sets it */
    }
  }
  paintAccent();
  const takeCoal = (v: unknown) => {
    if (typeof v !== 'string' || !toRgb(v)) return;
    ownCoal = v;
    try {
      localStorage.setItem(COAL_LOCAL, v);
    } catch {
      /* kept for this page */
    }
  };
  try {
    ext?.storage.local.get([...keys, COAL_KEY]).then((r) => {
      takeCoal(r[COAL_KEY]);
      keys.forEach((k) => apply(k, r[k])); // paints the accent too
    }, () => {});
    // Picked in another tab: follow along.
    ext?.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (COAL_KEY in changes) {
        takeCoal(changes[COAL_KEY].newValue);
        paintAccent();
      }
      for (const k of keys) if (k in changes) apply(k, changes[k].newValue);
    });
  } catch {
    /* no extension storage (shouldn't happen in a content script) */
  }
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
