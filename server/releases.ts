// Self-hosted extension releases from RELEASES_DIR (a folder the release script copies into;
// read-only here): the signed .xpi files and Firefox's updates.json, plus unpacked Chrome zips.
//
//   /install       a page: Firefox → install button for the newest .xpi and how updates work;
//                  anything else → the Chrome zip, how to load it unpacked and how to update it
//   /firefox/latest.xpi  → the newest .xpi (opening it installs it: the extension's update card)
//   /chrome/latest.zip, /chrome/intra-reimagined-<v>-chrome.zip
//   /chrome/latest.json  → { version }: Chrome copies check it to tell the user about updates
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DIR = process.env.RELEASES_DIR || new URL('./releases/', import.meta.url).pathname;
const XPI = /^\/xpi\/(intra-reimagined-\d+\.\d+\.\d+\.xpi)$/;
const CHROME_ZIP = /^intra-reimagined-(\d+\.\d+\.\d+)-chrome\.zip$/;
const num = (v: string) => v.split('.').map(Number).reduce((acc, n) => acc * 1000 + n, 0);

async function sendFile(res: ServerResponse, file: string, type: string, cache: string) {
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': String(s.size), 'Cache-Control': cache });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  }
}

/** The newest .xpi listed in updates.json, if any. */
async function latestFirefox(): Promise<{ version: string; update_link: string } | undefined> {
  try {
    const j = JSON.parse(await readFile(join(DIR, 'updates.json'), 'utf8')) as {
      addons: Record<string, { updates: { version: string; update_link: string }[] }>;
    };
    return Object.values(j.addons)
      .flatMap((a) => a.updates)
      .sort((a, b) => num(b.version) - num(a.version))[0];
  } catch {
    return undefined;
  }
}

/** /firefox/latest.xpi → the newest .xpi. */
async function sendLatest(res: ServerResponse) {
  const latest = await latestFirefox();
  if (!latest) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"no release published yet"}');
    return;
  }
  res.writeHead(302, { Location: latest.update_link, 'Cache-Control': 'no-store' });
  res.end();
}

async function sendFirefoxPage(res: ServerResponse) {
  const x = await latestFirefox();
  res.writeHead(x ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(firefoxPage(x?.version));
}

/** The newest Chrome zip in RELEASES_DIR, if any. */
async function latestChrome(): Promise<{ file: string; version: string } | undefined> {
  const files = await readdir(DIR).catch(() => [] as string[]);
  return files
    .map((file) => ({ file, version: file.match(CHROME_ZIP)?.[1] ?? '' }))
    .filter((z) => z.version)
    .sort((a, b) => num(b.version) - num(a.version))[0];
}

// Firefox and its forks (Zen, Floorp, LibreWolf, Firefox for Android) say "Firefox/" in their UA.
const isFirefox = (req: IncomingMessage) => /\bFirefox\//.test(String(req.headers['user-agent'] ?? ''));

async function sendChromePage(res: ServerResponse) {
  const z = await latestChrome();
  res.writeHead(z ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(chromePage(z?.version));
}

/** Handles /install, /updates.json, /xpi/<file> and /chrome/<file>; returns false for any other path. */
export function serveRelease(pathname: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (pathname === '/install') {
    void (isFirefox(req) ? sendFirefoxPage(res) : sendChromePage(res));
    return true;
  }
  if (pathname === '/firefox/latest.xpi') {
    void sendLatest(res);
    return true;
  }
  if (pathname === '/chrome/latest.json') {
    void latestChrome().then((z) => {
      // Public, and read by the extension from intra pages: any origin may ask.
      res.writeHead(z ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(z ? { version: z.version } : { error: 'no chrome build yet' }));
    });
    return true;
  }
  if (pathname === '/chrome/latest.zip') {
    void latestChrome().then((z) => {
      res.writeHead(z ? 302 : 404, z ? { Location: `/chrome/${z.file}`, 'Cache-Control': 'no-store' } : { 'Content-Type': 'text/plain' });
      res.end(z ? undefined : 'No Chrome build published yet.');
    });
    return true;
  }
  const cz = pathname.match(/^\/chrome\/(.+)$/)?.[1];
  if (cz && CHROME_ZIP.test(cz)) {
    void sendFile(res, join(DIR, cz), 'application/zip', 'public, max-age=31536000, immutable');
    return true;
  }
  if (pathname === '/updates.json') {
    // Short cache: Firefox should see a new version within minutes of a release.
    void sendFile(res, join(DIR, 'updates.json'), 'application/json; charset=utf-8', 'public, max-age=60');
    return true;
  }
  const m = pathname.match(XPI);
  if (m) {
    // A version's file never changes once published.
    void sendFile(res, join(DIR, m[1]), 'application/x-xpinstall', 'public, max-age=31536000, immutable');
    return true;
  }
  return false;
}

const PLANET = `<svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="30" fill="#00babc"/><g transform="translate(64 64) scale(.88) rotate(-22) translate(-64 -64)" fill="none" stroke-linecap="round"><path d="M12 64A52 14 0 0 1 116 64" stroke="#fff" stroke-width="7"/><circle cx="64" cy="64" r="27" fill="#fff" stroke="none"/><path d="M116 64A52 14 0 0 1 12 64" stroke="#00babc" stroke-width="15"/><path d="M116 64A52 14 0 0 1 12 64" stroke="#fff" stroke-width="7"/></g></svg>`;

/** The install page around `content`: same look for every browser. */
function page(content: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install Intra Reimagined</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(PLANET)}">
<style>
  :root { --bg: #f4f5f7; --card: #fff; --text: #1d2129; --muted: #5b6270; --line: rgba(0,0,0,.08); --code: rgba(0,0,0,.05); color-scheme: light dark; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0d11; --card: #14171d; --text: #e2e4ea; --muted: #a1a7b5; --line: rgba(255,255,255,.09); --code: rgba(255,255,255,.07); } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(560px, 100%); background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 32px 28px; }
  .logo { width: 56px; height: 56px; display: block; margin-bottom: 18px; }
  h1 { margin: 0 0 4px; font-size: 24px; line-height: 1.25; }
  .sub { margin: 0 0 24px; color: var(--muted); }
  .btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 13px 18px; border-radius: 11px; background: #00babc; color: #fff; font-weight: 600; text-decoration: none; }
  .btn:hover { filter: brightness(1.08); }
  ol { margin: 26px 0 0; padding-left: 22px; }
  h2 { margin: 30px 0 4px; padding-top: 22px; border-top: 1px solid var(--line); font-size: 19px; line-height: 1.3; scroll-margin-top: 16px; }
  h2 + .sub { margin-bottom: 0; }
  h2 + .sub + ol { margin-top: 16px; }
  li { margin: 0 0 14px; padding-left: 4px; }
  li::marker { color: #00babc; font-weight: 700; }
  code { padding: 2px 6px; border-radius: 6px; background: var(--code); font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; user-select: all; overflow-wrap: anywhere; }
  .note { margin: 22px 0 0; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
  li a { color: #00babc; }
  .note a { color: inherit; }
</style>
</head>
<body>
<main>
  ${PLANET.replace('<svg ', '<svg class="logo" ')}
${content}
</main>
</body>
</html>`;
}

/** Chromium browsers: download the zip, load it unpacked; update by hand. */
function chromePage(version: string | undefined) {
  return page(`
  <h1>Install Intra Reimagined</h1>
  ${version
    ? `<p class="sub">For Chrome, Brave, Edge, Arc, Vivaldi and other Chromium browsers · version ${version}</p>
  <a class="btn" href="/chrome/latest.zip" download>Download for Chrome</a>
  <ol>
    <li>Unzip the download into a folder you'll keep (the browser loads it from there, so don't delete it).</li>
    <li>Open <code>chrome://extensions</code> in a new tab and turn on <b>Developer mode</b> (top right).</li>
    <li>Click <b>Load unpacked</b> and choose the unzipped folder. Then open <a href="https://profile.intra.42.fr">intra</a> and log in with 42.</li>
  </ol>
  <h2 id="update">Updating</h2>
  <p class="sub">Chrome doesn't update it by itself: the extension shows an "Update available" card when a new version is out. Then:</p>
  <ol>
    <li>Download the new version with the button above and unzip it.</li>
    <li>Put the new files in your <b>old folder</b>, in place of what's there (delete the old files first, then move the new ones in). Same folder, same place: that keeps you logged in with your settings. A new folder would be a separate copy that starts from scratch.</li>
    <li>In <code>chrome://extensions</code>, click the reload arrow <b>↻</b> on Intra Reimagined, then reload your intra tabs.</li>
  </ol>
  <p class="note">Using Firefox? Open this page in Firefox to install it with automatic updates. Phones: only Firefox for Android supports it.</p>`
    : `<p class="sub">There's no Chrome build yet. On Firefox, open this page in Firefox to install it.</p>`}`);
}

/** Firefox (and forks): install the signed .xpi; it updates itself. */
function firefoxPage(version: string | undefined) {
  return page(`
  <h1>Install Intra Reimagined</h1>
  ${version
    ? `<p class="sub">For Firefox, Zen, Floorp, LibreWolf and Firefox for Android · version ${version}</p>
  <a class="btn" href="/firefox/latest.xpi">Install for Firefox</a>
  <ol>
    <li>Click the button: Firefox asks whether to allow this site to install an add-on. Click <b>Continue to installation</b>, then <b>Add</b>.</li>
    <li>Open <a href="https://profile.intra.42.fr">intra</a> and log in with 42.</li>
  </ol>
  <h2 id="update">Updating</h2>
  <p class="sub">Firefox updates it by itself, but only checks about once a day. When a new version is out, the extension also shows an "Update available" card. To get it right away:</p>
  <ol>
    <li>Click <b>Update</b> on that card (or the button above): Firefox asks to install the new version over the old one. You stay logged in with your settings.</li>
    <li>Or open <code>about:addons</code>, click the gear ⚙ and choose <b>Check for Updates</b>. While you're there, make sure <b>Update Add-ons Automatically</b> is ticked.</li>
  </ol>
  <p class="note">Using Chrome, Brave, Edge or Arc? Open this page there for the Chrome version.</p>`
    : `<p class="sub">No Firefox version is published yet.</p>`}`);
}
