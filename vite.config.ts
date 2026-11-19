import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/** dist/manifest.json takes its version from package.json, the single source of truth. */
function manifest(): Plugin {
  return {
    name: 'ir-manifest',
    closeBundle() {
      const path = 'dist/manifest.json';
      const m = JSON.parse(readFileSync(path, 'utf8'));
      m.version = pkg.version;
      writeFileSync(path, JSON.stringify(m, null, 2) + '\n');
    },
  };
}

// Two self-contained IIFE scripts, built one at a time (lib mode can't make several IIFEs at
// once): the content script (default) and the background script (IR_ENTRY=background).
const entry = process.env.IR_ENTRY === 'background' ? 'background' : 'content';

export default defineConfig(({ mode }) => ({
  plugins: [manifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: false, // the two builds share dist/; `pnpm build` clears it first
    sourcemap: mode === 'development' ? 'inline' : false,
    minify: mode !== 'development',
    lib: {
      entry: `src/${entry}.ts`,
      formats: ['iife'],
      name: entry === 'content' ? 'IntraReimagined' : 'IntraReimaginedBackground',
      fileName: () => `${entry}.js`,
    },
  },
}));
