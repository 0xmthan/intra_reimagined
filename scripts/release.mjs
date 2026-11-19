// Bumps the version, builds, signs and publishes the extension.
//
//   pnpm release [patch|minor|major|<x.y.z>]   sign on AMO ("unlisted": not shown on AMO) and publish
//                                              the signed .xpi + updates.json on our server
//   pnpm package [patch|minor|major|<x.y.z>]   only write the zips to release/ (no signing)
//
// Users install https://intra.mthan.dev/install once; after that Firefox updates them from
// https://intra.mthan.dev/updates.json (manifest update_url), checked hourly by background.ts.
// Chromium browsers get a page there instead, with this version's Chrome zip to load unpacked
// (no auto-updates: Chrome only allows those from its Web Store).
//
// .env.release (gitignored):
//   WEB_EXT_API_KEY, WEB_EXT_API_SECRET  AMO API credentials (addons.mozilla.org/developers/addon/api/key/)
//   IR_UPDATES_BASE   public base URL of the server       (default https://intra.mthan.dev)
//   IR_DEPLOY         scp target for the releases folder   (default syn-local:Documents/intra-reimagined/releases)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manual = process.argv.includes('--manual');
const bump = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'patch';

if (existsSync('.env.release')) process.loadEnvFile('.env.release');
const BASE = (process.env.IR_UPDATES_BASE || 'https://intra.mthan.dev').replace(/\/+$/, '');
const DEPLOY = process.env.IR_DEPLOY || 'syn-local:Documents/intra-reimagined/releases';
const ADDON_ID = JSON.parse(readFileSync('public/manifest.json', 'utf8')).browser_specific_settings.gecko.id;

const missing = ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET'].filter((k) => !process.env[k]);
if (!manual && missing.length) {
  console.error(`Missing ${missing.join(', ')} (set them in .env.release), or use \`pnpm package\`.`);
  process.exit(1);
}

// 1. Bump the version (AMO never signs the same version twice).
const original = readFileSync('package.json', 'utf8');
const pkg = JSON.parse(original);
const [maj, min, pat] = pkg.version.split('.').map(Number);
const version = /^\d+\.\d+\.\d+$/.test(bump)
  ? bump
  : { major: `${maj + 1}.0.0`, minor: `${maj}.${min + 1}.0`, patch: `${maj}.${min}.${pat + 1}` }[bump];
if (!version) throw new Error(`Unknown bump "${bump}"`);
pkg.version = version;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`${manual ? 'Packaging' : 'Releasing'} ${version}`);

// Until AMO has signed it, a failure puts the old version back so a retry reuses this number.
let signed = false;
const run = (cmd, args, cwd) => {
  try {
    execFileSync(cmd, args, { stdio: 'inherit', env: process.env, cwd });
  } catch {
    if (!signed) writeFileSync('package.json', original);
    console.error(`\nFailed${signed ? ` after signing; package.json stays at ${version}` : `; package.json is back at ${JSON.parse(original).version}`}.`);
    process.exit(1);
  }
};

// 2. Build the extension zip and the source zip.
run('pnpm', ['build']);
mkdirSync('release', { recursive: true });
const ext = `release/intra-reimagined-${version}.zip`;
const src = `release/intra-reimagined-${version}-source.zip`;
rmSync(ext, { force: true });
rmSync(src, { force: true });
run('zip', ['-qr', resolve(ext), '.'], 'dist'); // manifest.json must sit at the zip's root
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && existsSync(f));
run('zip', ['-q', src, ...files]);

// Chrome zip: the same build, minus what only Firefox understands (its settings and update URL,
// and the event-page background that Chrome replaces with the service worker).
const chromeName = `intra-reimagined-${version}-chrome.zip`;
const chrome = `release/${chromeName}`;
const chromeDir = '.release-chrome';
rmSync(chrome, { force: true });
rmSync(chromeDir, { recursive: true, force: true });
cpSync('dist', chromeDir, { recursive: true });
const cm = JSON.parse(readFileSync(`${chromeDir}/manifest.json`, 'utf8'));
delete cm.browser_specific_settings;
cm.background = { service_worker: cm.background.service_worker };
writeFileSync(`${chromeDir}/manifest.json`, JSON.stringify(cm, null, 2) + '\n');
run('zip', ['-qr', resolve(chrome), '.'], chromeDir);
rmSync(chromeDir, { recursive: true, force: true });

if (manual) {
  console.log(`\nReady:\n  extension: ${resolve(ext)}\n  chrome:    ${resolve(chrome)}\n  source:    ${resolve(src)}`);
  process.exit(0);
}

// 3. Sign as "unlisted" and download the signed .xpi (waits for Mozilla's automated review).
const tmp = '.release-signed';
rmSync(tmp, { recursive: true, force: true });
run('pnpm', [
  'exec', 'web-ext', 'sign',
  '-s', 'dist',
  '-a', tmp,
  '--channel', 'unlisted',
  '--upload-source-code', src,
  '--approval-timeout', String(20 * 60_000),
]);
signed = true;
const signedXpi = readdirSync(tmp).find((f) => f.endsWith('.xpi'));
if (!signedXpi) {
  console.error('Signed, but no .xpi was downloaded; get it from https://addons.mozilla.org/developers/addons');
  process.exit(1);
}
const xpiName = `intra-reimagined-${version}.xpi`;
const xpi = `release/${xpiName}`;
copyFileSync(`${tmp}/${signedXpi}`, xpi);
rmSync(tmp, { recursive: true, force: true });

// 4. updates.json: start from what the server publishes (so no version is ever dropped), add this one.
let updates = { addons: { [ADDON_ID]: { updates: [] } } };
try {
  const res = await fetch(`${BASE}/updates.json`, { cache: 'no-store' });
  if (res.ok) updates = await res.json();
} catch {
  /* first release, or server unreachable: start fresh */
}
const entry = (updates.addons[ADDON_ID] ??= { updates: [] });
entry.updates = entry.updates.filter((u) => u.version !== version);
entry.updates.push({
  version,
  update_link: `${BASE}/xpi/${xpiName}`,
  update_hash: `sha256:${createHash('sha256').update(readFileSync(xpi)).digest('hex')}`,
});
writeFileSync('release/updates.json', JSON.stringify(updates, null, 2) + '\n');

// 5. Publish: the .xpi first, then the updates.json that points at it.
const [host, dir] = DEPLOY.split(':');
run('ssh', [host, `mkdir -p '${dir}'`]);
run('scp', ['-q', xpi, `${DEPLOY}/${xpiName}`]);
run('scp', ['-q', chrome, `${DEPLOY}/${chromeName}`]);
run('scp', ['-q', 'release/updates.json', `${DEPLOY}/updates.json`]);

console.log(`\nPublished ${version}.`);
console.log(`  install / share:  ${BASE}/install`);
console.log(`  this version:     ${BASE}/xpi/${xpiName}`);
console.log(`  chrome zip:       ${BASE}/chrome/${chromeName}`);
console.log('Installed copies pick it up within the hour.');
