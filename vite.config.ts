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

// Content scripts can't be ES modules, so build a single self-contained IIFE.
export default defineConfig(({ mode }) => ({
  plugins: [manifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'development' ? 'inline' : false,
    minify: mode !== 'development',
    lib: {
      entry: 'src/content.ts',
      formats: ['iife'],
      name: 'IntraReimagined',
      fileName: () => 'content.js',
    },
  },
}));
