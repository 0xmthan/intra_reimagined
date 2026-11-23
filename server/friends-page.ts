// /friends: your friends list on the web, for checking on them from a phone. Log in with 42 (the
// same flow as the extension: auth.ts returns here with a token in the URL fragment), then the page
// shows what the extension's friends panel shows (from /v1/me/friends/stats), minus milestone
// days. The + button in the header toggles edit mode: add friends by login, remove them with × (the
// same PUT/DELETE /v1/me/friends/:login the extension uses). The background is your banner, frozen on its first frame (GIFs don't animate), under
// frosted glass.
//
//   GET /friends             the page
//   GET /friends/app.css, /friends/app.js
import type { ServerResponse } from 'node:http';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="30" fill="#00babc"/><g transform="translate(64 64) scale(.88) rotate(-22) translate(-64 -64)" fill="none" stroke-linecap="round"><path d="M12 64A52 14 0 0 1 116 64" stroke="#fff" stroke-width="7"/><circle cx="64" cy="64" r="27" fill="#fff" stroke="none"/><path d="M116 64A52 14 0 0 1 12 64" stroke="#00babc" stroke-width="15"/><path d="M116 64A52 14 0 0 1 12 64" stroke="#fff" stroke-width="7"/></g></svg>`;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0d11">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="robots" content="noindex">
<title>Friends · Intra Reimagined</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(ICON)}">
<link rel="apple-touch-icon" href="data:image/svg+xml,${encodeURIComponent(ICON)}">
<link rel="stylesheet" href="/friends/app.css">
<script src="/friends/app.js" defer></script>
</head>
<body>
<canvas id="bg" aria-hidden="true"></canvas>
<div class="shade" aria-hidden="true"></div>
<main class="panel" id="app">
  <section id="signin" hidden>
    <div class="logo">${ICON}</div>
    <h1>Your friends, anywhere</h1>
    <p>Log in with 42 to see your Intra Reimagined friends list: who's on campus, their seat, level and logtime.</p>
    <button id="login" class="primary">Log in with 42</button>
    <p class="error" id="login-error" hidden></p>
  </section>
  <section id="list" hidden>
    <header>
      <h2><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/></svg>Friends <span class="count" id="count"></span></h2>
      <span class="ago" id="ago"></span>
      <button class="icon" id="edit" title="Add or remove friends" aria-label="Add or remove friends" aria-pressed="false"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/></svg></button>
      <button class="icon" id="refresh" title="Refresh" aria-label="Refresh"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button>
      <button class="icon" id="logout" title="Log out" aria-label="Log out"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5M15 12H4"/></svg></button>
    </header>
    <form id="add" autocomplete="off">
      <input id="add-login" type="text" placeholder="Add a friend by login" aria-label="Login to add" maxlength="32" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go">
      <button class="primary" id="add-btn" type="submit">Add</button>
    </form>
    <p class="error" id="list-error" hidden></p>
    <div id="rows"></div>
  </section>
</main>
</body>
</html>`;

const CSS = `
:root {
  --text: #f2f4f7; --muted: rgba(242, 244, 247, 0.62); --faint: rgba(242, 244, 247, 0.4);
  --line: rgba(255, 255, 255, 0.08); --accent: #00babc; --ok: #6ee7a8;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  min-height: 100dvh; background: #0b0d11; color: var(--text);
  font: 15px/1.4 futura-pt, Futura, 'Trebuchet MS', system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex; justify-content: center; align-items: flex-start;
  padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
}
/* The banner, drawn once (first frame) onto a canvas covering the screen. */
#bg { position: fixed; inset: 0; width: 100%; height: 100%; z-index: -2; background: radial-gradient(120% 80% at 0% 0%, rgba(0, 186, 188, 0.25), transparent 60%), #0b0d11; }
.shade { position: fixed; inset: 0; z-index: -1; background: linear-gradient(180deg, rgba(8, 10, 14, 0.15), rgba(8, 10, 14, 0.45)); }

/* Glass, like the extension's friends panel. */
.panel {
  width: min(460px, 100%); margin-top: 4vh;
  background: rgba(16, 18, 24, 0.58);
  -webkit-backdrop-filter: blur(28px) saturate(1.4); backdrop-filter: blur(28px) saturate(1.4);
  border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 20px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
/* Phones: the panel is the whole screen (the banner only shows through the glass). */
@media (max-width: 520px) {
  body { padding: 0; }
  .panel {
    width: 100%; min-height: 100dvh; margin: 0; border: 0; border-radius: 0; box-shadow: none;
    padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom);
  }
  .panel #signin { padding-top: 18vh; }
}

#signin { padding: 32px 26px 28px; text-align: center; }
.logo svg { width: 64px; height: 64px; display: block; margin: 0 auto 18px; border-radius: 16px; }
h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; }
#signin p { margin: 0 0 22px; color: var(--muted); }
button { font: inherit; color: inherit; cursor: pointer; }
.primary { width: 100%; padding: 13px 18px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; font-weight: 600; }
.primary:hover { filter: brightness(1.08); }
.primary:disabled { opacity: 0.6; cursor: default; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.error { margin: 12px 16px 0; color: #ff8a8a; font-size: 13px; }

header { display: flex; align-items: center; gap: 6px; padding: 16px 12px 10px 20px; }
h2 { margin: 0; flex: 1; display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
h2 svg { color: var(--accent); }
.count { color: var(--faint); letter-spacing: 0; }
.ago { font-size: 12px; color: var(--faint); margin-right: 2px; }
.icon { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 10px; background: none; color: var(--muted); }
.icon:hover { background: rgba(255, 255, 255, 0.07); color: var(--text); }
.icon.spin svg { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

#rows { padding: 0 8px 10px; }
.group { margin: 12px 12px 4px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.row { display: flex; align-items: center; border-radius: 14px; }
.row:hover { background: rgba(255, 255, 255, 0.04); }
.main { flex: 1; min-width: 0; display: flex; gap: 14px; align-items: flex-start; padding: 12px; color: inherit; text-decoration: none; }

/* Edit mode (the + button): the add form and a remove button on every row. */
#add { display: flex; gap: 8px; padding: 2px 16px 6px 20px; }
#add input { flex: 1; min-width: 0; padding: 10px 14px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; background: rgba(255, 255, 255, 0.06); color: var(--text); font: inherit; font-size: 16px; }
#add input::placeholder { color: var(--faint); }
#add input:focus { outline: none; border-color: var(--accent); }
#add .primary { width: auto; padding: 10px 18px; }
#list:not(.editing) #add, #list:not(.editing) .remove { display: none; }
#edit[aria-pressed="true"] { background: rgba(0, 186, 188, 0.16); color: var(--accent); }
.remove { flex: none; margin-right: 6px; }
.remove:hover { background: rgba(255, 138, 138, 0.14); color: #ff8a8a; }
.remove:disabled { opacity: 0.4; cursor: default; }
.pic { position: relative; flex: none; width: 52px; height: 52px; }
.pic img, .pic span { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; display: block; background: rgba(255, 255, 255, 0.08); }
.pic.on::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 12px; height: 12px; border-radius: 50%; background: #3ddc84; box-shadow: 0 0 0 2.5px rgba(16, 18, 24, 0.85); }
.info { min-width: 0; flex: 1; }
.top { display: flex; align-items: baseline; gap: 8px; }
.login { font-weight: 600; font-size: 16px; }
.lvl { color: var(--faint); font-size: 12.5px; }
.lvl b { color: var(--muted); font-weight: 600; font-size: 14px; }
.seat { margin-left: auto; align-self: center; padding: 1px 9px; border-radius: 999px; font-size: 12.5px; background: rgba(61, 220, 132, 0.14); color: var(--ok); white-space: nowrap; }
.name { color: var(--muted); font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nums { display: flex; gap: 16px; margin-top: 6px; font-size: 13px; }
.nums b { font-weight: 600; }
.nums i { font-style: normal; color: var(--faint); margin-left: 3px; }
.hours { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 3px; font-size: 12px; color: var(--faint); }
.empty { margin: 8px 12px 14px; color: var(--muted); font-size: 14px; }
`;

const JS = `'use strict';
(() => {
  const KEY = 'ir-friends-token';
  const CACHE = 'ir-friends-cache';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const store = {
    get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
    set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch {} },
    del: (k, s = localStorage) => { try { s.removeItem(k); } catch {} },
  };

  // ---------- coming back from 42 ----------
  const frag = new URLSearchParams(location.hash.slice(1));
  if (frag.has('ir-state')) {
    const nonce = store.get('ir-nonce', sessionStorage);
    store.del('ir-nonce', sessionStorage);
    const tok = frag.get('ir-auth');
    if (tok && nonce && frag.get('ir-state') === nonce) store.set(KEY, tok);
    else if (frag.get('ir-auth-error')) setTimeout(() => showError('login-error', 'Login was cancelled or failed. Try again.'));
    history.replaceState(null, '', location.pathname);
  }

  let token = store.get(KEY);
  const parts = token ? token.split('.') : [];
  if (!token || parts.length !== 3 || Number(parts[1]) < Date.now()) { store.del(KEY); token = null; }
  const me = token ? parts[0] : null;

  function showError(id, msg) { const e = $(id); e.textContent = msg; e.hidden = !msg; }

  function signOut() {
    store.del(KEY); store.del(CACHE);
    location.reload();
  }

  if (!token) {
    $('signin').hidden = false;
    $('login').addEventListener('click', () => {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const nonce = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      store.set('ir-nonce', nonce, sessionStorage);
      $('login').disabled = true;
      location.href = '/auth/start?' + new URLSearchParams({ state: nonce, return: location.origin + '/friends' });
    });
    return;
  }

  $('list').hidden = false;
  $('logout').addEventListener('click', signOut);
  $('refresh').addEventListener('click', () => load(true));

  async function api(path, method = 'GET') {
    const res = await fetch(path, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, cache: 'no-store' });
    if (res.status === 401) { signOut(); throw new Error('signed out'); }
    if (!res.ok) {
      const e = new Error('HTTP ' + res.status);
      e.status = res.status;
      try { e.reason = (await res.json()).error; } catch {}
      throw e;
    }
    return res.json();
  }

  // ---------- adding and removing ----------
  function setEditing(on) {
    $('list').classList.toggle('editing', on);
    $('edit').setAttribute('aria-pressed', String(on));
    if (!on) showError('list-error', '');
    if (on && matchMedia('(hover: hover)').matches) $('add-login').focus();
  }
  $('edit').addEventListener('click', () => setEditing(!$('list').classList.contains('editing')));

  $('add').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = $('add-login'), btn = $('add-btn');
    const login = input.value.trim().toLowerCase();
    if (!login) return;
    if (!/^[a-z0-9-]{1,32}$/.test(login)) return showError('list-error', "That doesn't look like a 42 login.");
    if (login === me) return showError('list-error', "You can't add yourself.");
    if (data && data.friends[login]) return showError('list-error', login + ' is already on your list.');
    btn.disabled = true;
    try {
      await api('/v1/me/friends/' + encodeURIComponent(login), 'PUT');
      input.value = '';
      showError('list-error', '');
      await load(true);
    } catch (e) {
      showError('list-error',
        e.status === 404 ? 'No student called ' + login + '.' :
        e.status === 409 ? (e.reason ? 'You can have ' + e.reason + '.' : 'Your list is full.') :
        e.status === 429 ? 'Too many changes at once. Wait a minute and try again.' :
        e.reason || "Couldn't add " + login + '. Try again.');
    } finally {
      btn.disabled = false;
    }
  });

  async function remove(login, btn) {
    btn.disabled = true;
    try {
      await api('/v1/me/friends/' + encodeURIComponent(login), 'DELETE');
      if (data) { delete data.friends[login]; store.set(CACHE, JSON.stringify(data)); }
      showError('list-error', '');
      render();
      if (busy) again = true; // a refresh already in flight may still list them
    } catch (e) {
      btn.disabled = false;
      showError('list-error', e.status === 429 ? 'Too many changes at once. Wait a minute and try again.' : "Couldn't remove " + login + '. Try again.');
    }
  }

  // ---------- background: the banner's first frame ----------
  const canvas = $('bg');
  let frame;
  function paint() {
    if (!frame) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = innerWidth, h = innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    const s = Math.max(w / frame.width, h / frame.height); // cover
    const dw = frame.width * s, dh = frame.height * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(frame, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  api('/v1/users/' + encodeURIComponent(me) + '/banner').then(async (j) => {
    if (!j || typeof j.url !== 'string' || !/^\\/banners\\/[a-f0-9]{64}\\.(png|jpg|gif|webp)$/.test(j.url)) return;
    const img = new Image();
    img.src = j.url;
    await img.decode();
    // A bitmap is one still frame (the first, for a GIF): nothing animates.
    frame = await createImageBitmap(img);
    paint();
    addEventListener('resize', paint);
  }).catch(() => {});

  // ---------- the list ----------
  const fmtH = (h) => h >= 100 ? Math.round(h).toLocaleString('en') : h.toFixed(1).replace(/\\.0$/, '');
  function ago(at) {
    const s = Math.round((Date.now() - at) / 1000);
    if (s < 45) return 'updated just now';
    const m = Math.round(s / 60);
    return m < 60 ? 'updated ' + m + ' min ago' : 'updated ' + Math.round(m / 60) + 'h ago';
  }
  // Like ago(), for times that can be months or years back.
  function since(t) {
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 60) return m < 1 ? 'just now' : m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 48) return h + 'h ago';
    const d = Math.round(h / 24);
    if (d < 14) return d + 'd ago';
    if (d < 60) return Math.round(d / 7) + 'w ago';
    if (d < 365) return Math.round(d / 30.4) + 'mo ago';
    return Math.round(d / 365) + 'y ago';
  }
  function monday() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
  }
  // Photos come through our server (42's CDN refuses visitors without a 42 session): see /photo.
  const safeImg = (u) => typeof u === 'string' && u.startsWith('/photo?') ? u : null;

  const X = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function row(login, s) {
    const r = el('div', 'row');
    const x = el('button', 'icon remove');
    x.type = 'button'; x.title = 'Remove ' + login; x.setAttribute('aria-label', 'Remove ' + login);
    x.innerHTML = X;
    x.addEventListener('click', () => remove(login, x));
    const a = el('a', 'main');
    a.href = 'https://profile.intra.42.fr/users/' + encodeURIComponent(login);
    a.target = '_blank'; a.rel = 'noopener';
    const pic = el('div', 'pic' + (s.seat ? ' on' : ''));
    const src = safeImg(s.image);
    if (src) { const i = el('img'); i.src = src; i.alt = ''; i.loading = 'lazy'; pic.append(i); } else pic.append(el('span'));
    const info = el('div', 'info');
    const top = el('div', 'top');
    top.append(el('span', 'login', login));
    if (typeof s.level === 'number') { const l = el('span', 'lvl', 'Lvl '); l.append(el('b', null, s.level.toFixed(2))); top.append(l); }
    if (s.seat) top.append(el('span', 'seat', s.seat));
    info.append(top);
    if (s.name && s.name !== login) info.append(el('div', 'name', s.name));
    if (typeof s.wallet === 'number' || typeof s.evalPoints === 'number') {
      const n = el('div', 'nums');
      const num = (v, unit, title) => { const x = el('span'); x.title = title; x.append(el('b', null, v == null ? '…' : String(v)), el('i', null, unit)); return x; };
      n.append(num(s.wallet, '₳', 'Wallet'), num(s.evalPoints, 'Evp', 'Evaluation points'));
      info.append(n);
    }
    if (s.hours) {
      const h = el('div', 'hours');
      h.append(el('span', null, fmtH(s.hours.week) + 'h this week'), el('span', null, fmtH(s.hours.total) + 'h all time'));
      if (!s.seat && typeof s.hours.last === 'number') {
        const l = el('span', null, 'on campus ' + since(s.hours.last));
        l.title = 'Last logged in on campus: ' + new Date(s.hours.last).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
        h.append(l);
      }
      info.append(h);
    }
    a.append(pic, info);
    r.append(a, x);
    return r;
  }

  let data = null;
  function render() {
    const rows = $('rows');
    rows.replaceChildren();
    if (!data) return;
    const logins = Object.keys(data.friends);
    $('count').textContent = String(logins.length);
    $('ago').textContent = ago(data.at);
    if (!logins.length) {
      rows.append(el('p', 'empty', 'No friends yet. Add one by login above.'));
      if (!$('list').classList.contains('editing')) setEditing(true);
      return;
    }
    const f = data.friends;
    const lvl = (l) => (typeof f[l].level === 'number' ? f[l].level : -1);
    const order = logins.sort((a, b) => Number(!!f[b].seat) - Number(!!f[a].seat) || lvl(b) - lvl(a) || a.localeCompare(b));
    const here = order.filter((l) => f[l].seat), away = order.filter((l) => !f[l].seat);
    if (here.length) { rows.append(el('div', 'group', 'On campus · ' + here.length)); here.forEach((l) => rows.append(row(l, f[l]))); }
    if (away.length) { rows.append(el('div', 'group', 'Off campus · ' + away.length)); away.forEach((l) => rows.append(row(l, f[l]))); }
  }

  try { data = JSON.parse(store.get(CACHE) || 'null'); } catch {}
  render();

  // A load asked for mid-load (after adding or removing someone) runs again once that one is done,
  // so the list never ends up on a response from before the change.
  let busy = null, again = false;
  async function load(manual) {
    if (busy) { if (manual) again = true; return busy; }
    busy = loadOnce(manual).finally(() => { busy = null; if (again) { again = false; return load(true); } });
    return busy;
  }
  async function loadOnce(manual) {
    $('refresh').classList.add('spin');
    try {
      const j = await api('/v1/me/friends/stats?photos=proxy&week=' + monday());
      data = { friends: j.friends || {}, at: Date.now() };
      store.set(CACHE, JSON.stringify(data));
      showError('list-error', '');
      render();
    } catch (e) {
      if (manual || !data) showError('list-error', "Couldn't load your friends. Tap ↻ to try again.");
    } finally {
      $('refresh').classList.remove('spin');
    }
  }
  load();
  setInterval(() => { if (!document.hidden) load(); else if (data) $('ago').textContent = ago(data.at); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && data && Date.now() - data.at > 30_000) load(); });
})();
`;

/** Handles /friends and its files; returns false for any other path. */
export function serveFriendsPage(pathname: string, res: ServerResponse): boolean {
  if (pathname === '/friends' || pathname === '/friends/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': CSP,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(HTML);
    return true;
  }
  if (pathname === '/friends/app.css' || pathname === '/friends/app.js') {
    const css = pathname.endsWith('.css');
    res.writeHead(200, {
      'Content-Type': css ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(css ? CSS : JS);
    return true;
  }
  return false;
}
