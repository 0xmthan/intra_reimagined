import { defineConfig } from 'vite';

// Content scripts can't be ES modules, so build a single self-contained IIFE.
export default defineConfig(({ mode }) => ({
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
