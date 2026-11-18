// Bumps the version, builds, and either submits to addons.mozilla.org (AMO) or just packages it.
//
//   pnpm release [patch|minor|major|<x.y.z>]   submit to the public AMO listing (default: patch)
//   pnpm package [patch|minor|major|<x.y.z>]   only write the zips to release/ for a manual upload
//
// `release` needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET in .env.release (gitignored) or the
// environment: https://addons.mozilla.org/developers/addon/api/key/
//
// The bundle is minified, so AMO requires the original source: we zip every non-ignored file in
// the repo alongside it (reviewers rebuild it with `pnpm install && pnpm build`).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manual = process.argv.includes('--manual');
const bump = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'patch';

if (existsSync('.env.release')) process.loadEnvFile('.env.release');
const missing = ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET'].filter((k) => !process.env[k]);
if (!manual && missing.length) {
  console.error(`Missing ${missing.join(', ')} (set them in .env.release), or use \`pnpm package\`.`);
  process.exit(1);
}

// 1. Bump the version (AMO never accepts the same version twice).
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

// On any failure, put the old version back so the next attempt reuses this number.
const run = (cmd, args, cwd) => {
  try {
    execFileSync(cmd, args, { stdio: 'inherit', env: process.env, cwd });
  } catch {
    writeFileSync('package.json', original);
    console.error(`\nFailed; package.json is back at ${JSON.parse(original).version}.`);
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

if (manual) {
  console.log(`\nReady for manual upload at https://addons.mozilla.org/developers/addons:`);
  console.log(`  extension: ${resolve(ext)}`);
  console.log(`  source:    ${resolve(src)}   (when asked "Do you need to submit source code?": yes)`);
  process.exit(0);
}

// 3. Submit. Metadata (summary, categories, license) is only used for the very first submission.
run('pnpm', [
  'exec', 'web-ext', 'sign',
  '-s', 'dist',
  '-a', 'release',
  '--channel', 'listed',
  '--amo-metadata', 'amo-metadata.json',
  '--upload-source-code', src,
  '--approval-timeout', '0',
]);

console.log(`\nSubmitted ${version} to AMO. It goes live after the automated review; check`);
console.log('https://addons.mozilla.org/developers/addons for its status.');
