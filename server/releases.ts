// Self-hosted extension updates: serves the signed .xpi files and Firefox's updates.json from
// RELEASES_DIR (a folder the release script copies into; read-only here).
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';

const DIR = process.env.RELEASES_DIR || new URL('./releases/', import.meta.url).pathname;
const XPI = /^\/xpi\/(intra-reimagined-\d+\.\d+\.\d+\.xpi)$/;

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

/** /install → the newest .xpi listed in updates.json (the link to share with new users). */
async function sendLatest(res: ServerResponse) {
  try {
    const j = JSON.parse(await readFile(join(DIR, 'updates.json'), 'utf8')) as {
      addons: Record<string, { updates: { version: string; update_link: string }[] }>;
    };
    const all = Object.values(j.addons).flatMap((a) => a.updates);
    const num = (v: string) => v.split('.').map(Number).reduce((acc, n) => acc * 1000 + n, 0);
    const latest = all.sort((a, b) => num(b.version) - num(a.version))[0];
    if (!latest) throw new Error('no releases');
    res.writeHead(302, { Location: latest.update_link, 'Cache-Control': 'no-store' });
    res.end();
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"no release published yet"}');
  }
}

/** Handles /install, /updates.json and /xpi/<file>; returns false for any other path. */
export function serveRelease(pathname: string, res: ServerResponse): boolean {
  if (pathname === '/install') {
    void sendLatest(res);
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
