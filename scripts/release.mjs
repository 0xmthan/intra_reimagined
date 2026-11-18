// Bumps the version, builds, and submits it to the public addons.mozilla.org (AMO) listing.
// Firefox (desktop and Android) then updates every install on its own.
//
//   pnpm release [patch|minor|major|<x.y.z>]   (default: patch)
//
// Needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET in .env.release (gitignored) or the environment:
// https://addons.mozilla.org/developers/addon/api/key/
//
// The bundle is minified, so AMO requires the original source: we zip every non-ignored file
// in the repo and upload it alongside (reviewers rebuild it with `pnpm install && pnpm build`).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

if (existsSync('.env.release')) process.loadEnvFile('.env.release');

const missing = ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')} (set them in .env.release).`);
  process.exit(1);
}

// 1. Bump the version (AMO never accepts the same version twice).
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const bump = process.argv[2] ?? 'patch';
const [maj, min, pat] = pkg.version.split('.').map(Number);
const version = /^\d+\.\d+\.\d+$/.test(bump)
  ? bump
  : { major: `${maj + 1}.0.0`, minor: `${maj}.${min + 1}.0`, patch: `${maj}.${min}.${pat + 1}` }[bump];
if (!version) throw new Error(`Unknown bump "${bump}"`);
pkg.version = version;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`Releasing ${version}`);

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', env: process.env });

// 2. Build, and zip the source for AMO's reviewers.
run('pnpm', ['build']);
const out = '.release';
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && existsSync(f));
execFileSync('zip', ['-q', `${out}/source.zip`, ...files]);

// 3. Submit. Metadata (summary, categories, license) is only used for the very first submission.
run('pnpm', [
  'exec', 'web-ext', 'sign',
  '-s', 'dist',
  '-a', out,
  '--channel', 'listed',
  '--amo-metadata', 'amo-metadata.json',
  '--upload-source-code', `${out}/source.zip`,
  '--approval-timeout', '0',
]);
rmSync(out, { recursive: true, force: true });

console.log(`\nSubmitted ${version} to AMO. It goes live after the automated review; check`);
console.log('https://addons.mozilla.org/developers/addons for its status.');
