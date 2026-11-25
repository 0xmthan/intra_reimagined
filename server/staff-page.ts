// /staff: the profile view log for 42 staff (logins in STAFF_LOGINS). Log in with 42 (same flow as
// /friends), then a table of who opened whose profile and when, newest first, filterable by either
// login and refreshed every 30 seconds. Data comes from GET /v1/staff/views.
//
//   GET /staff             the page
//   GET /staff/app.css, /staff/app.js
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

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Profile views · Intra Reimagined</title>
<link rel="stylesheet" href="/staff/app.css">
<script src="/staff/app.js" defer></script>
</head>
<body>
<main>
  <section id="signin" hidden>
    <h1>Profile view log</h1>
    <p>Staff only. Log in with your 42 account.</p>
    <button id="login" class="primary">Log in with 42</button>
    <p class="error" id="login-error" hidden></p>
  </section>
  <section id="log" hidden>
    <header>
      <h1>Profile views</h1>
      <span class="muted" id="ago"></span>
      <button id="logout">Log out</button>
    </header>
    <form id="filter" autocomplete="off">
      <input id="viewer" placeholder="Viewer login" maxlength="32" autocapitalize="none" spellcheck="false">
      <input id="viewed" placeholder="Viewed login" maxlength="32" autocapitalize="none" spellcheck="false">
      <button class="primary" type="submit">Filter</button>
      <button type="button" id="clear">Clear</button>
    </form>
    <p class="error" id="log-error" hidden></p>
    <div class="scroll">
      <table>
        <thead><tr><th>Time</th><th>Viewer</th><th>Viewed</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <p class="muted" id="count"></p>
  </section>
</main>
</body>
</html>`;

const CSS = `
:root { color-scheme: dark; --text: #f2f4f7; --muted: rgba(242, 244, 247, 0.6); --line: rgba(255, 255, 255, 0.09); --accent: #00babc; }
* { box-sizing: border-box; }
body { margin: 0; background: #0b0d11; color: var(--text); font: 15px/1.4 system-ui, -apple-system, sans-serif; }
main { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
h1 { margin: 0; font-size: 20px; font-weight: 600; }
#signin { max-width: 360px; margin: 12vh auto 0; text-align: center; }
#signin p { color: var(--muted); }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
header h1 { flex: 1; }
.muted { color: var(--muted); font-size: 13px; }
button { font: inherit; color: inherit; cursor: pointer; padding: 9px 14px; border: 1px solid var(--line); border-radius: 10px; background: rgba(255, 255, 255, 0.05); }
.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
#signin .primary { width: 100%; padding: 12px; }
#filter { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
#filter input { flex: 1 1 160px; min-width: 0; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px; background: rgba(255, 255, 255, 0.05); color: var(--text); font: inherit; font-size: 16px; }
#filter input:focus { outline: none; border-color: var(--accent); }
.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 9px 14px; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
tr:last-child td { border-bottom: 0; }
td a { color: inherit; }
td button { padding: 0; border: 0; background: none; text-decoration: underline dotted; }
.error { color: #ff8a8a; font-size: 14px; }
`;

const JS = `'use strict';
(() => {
  const KEY = 'ir-staff-token';
  const $ = (id) => document.getElementById(id);
  const store = {
    get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
    set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch {} },
    del: (k, s = localStorage) => { try { s.removeItem(k); } catch {} },
  };
  function showError(id, msg) { const e = $(id); e.textContent = msg; e.hidden = !msg; }

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

  function signOut() { store.del(KEY); location.reload(); }

  if (!token) {
    $('signin').hidden = false;
    $('login').addEventListener('click', () => {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const nonce = btoa(String.fromCharCode(...bytes)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      store.set('ir-nonce', nonce, sessionStorage);
      $('login').disabled = true;
      location.href = '/auth/start?' + new URLSearchParams({ state: nonce, return: location.origin + '/staff' });
    });
    return;
  }

  $('log').hidden = false;
  $('logout').addEventListener('click', signOut);

  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
  let loadedAt = 0;

  function loginCell(login, field) {
    const td = document.createElement('td');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = login;
    b.title = 'Show only ' + login + ' as ' + field;
    b.addEventListener('click', () => { $(field).value = login; load(); });
    td.append(b);
    return td;
  }

  async function load() {
    const q = new URLSearchParams({ limit: '500' });
    for (const f of ['viewer', 'viewed']) { const v = $(f).value.trim().toLowerCase(); if (v) q.set(f, v); }
    try {
      const res = await fetch('/v1/staff/views?' + q, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, cache: 'no-store' });
      if (res.status === 401) return signOut();
      if (res.status === 403) return showError('log-error', 'This account is not on the staff list.');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { views } = await res.json();
      const rows = views.map((v) => {
        const tr = document.createElement('tr');
        const t = document.createElement('td');
        t.textContent = fmt.format(new Date(v.viewedAt));
        tr.append(t, loginCell(v.viewer, 'viewer'), loginCell(v.viewed, 'viewed'));
        return tr;
      });
      $('rows').replaceChildren(...rows);
      $('count').textContent = views.length ? views.length + ' views (newest first, up to 500)' : 'No views match.';
      loadedAt = Date.now();
      showError('log-error', '');
      tick();
    } catch {
      showError('log-error', "Couldn't load the log. Retrying in 30 seconds.");
    }
  }
  function tick() {
    const s = Math.round((Date.now() - loadedAt) / 1000);
    $('ago').textContent = loadedAt ? 'Updated ' + (s < 5 ? 'just now' : s + 's ago') : '';
  }

  $('filter').addEventListener('submit', (ev) => { ev.preventDefault(); load(); });
  $('clear').addEventListener('click', () => { $('viewer').value = ''; $('viewed').value = ''; load(); });
  load();
  setInterval(() => { if (!document.hidden) load(); }, 30_000);
  setInterval(tick, 5_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
`;

/** Handles /staff and its files; returns false for any other path. */
export function serveStaffPage(pathname: string, res: ServerResponse): boolean {
  if (pathname === '/staff' || pathname === '/staff/') {
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
  if (pathname === '/staff/app.css' || pathname === '/staff/app.js') {
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
