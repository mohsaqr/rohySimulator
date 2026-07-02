import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { makeAliases } from './vite.aliases';

/*
 * <oyon-app> element build — the embeddable delivery mode.
 *
 * Library mode, single self-contained ES module: React, the router, the
 * query client, and the whole app tree are compiled in (a host needs no
 * framework), CSS is inlined as a string (element.tsx adopts it into the
 * shadow root), and dynamic imports are flattened so one file serves the
 * script-tag recipe.
 *
 * The standalone build (vite.config.ts) is untouched — this is a second,
 * additive target. Models/WASM are NOT bundled: embedded mode loads them
 * from the public CDNs by default or from `asset-base` when self-hosted.
 */
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: makeAliases(__dirname, repoRoot),
  },
  define: {
    // React's UMD-style dev checks read process.env.NODE_ENV; in a host page
    // there is no bundler to substitute it.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    // NOT lib mode: Vite lib mode force-inlines every asset as base64,
    // which would embed ~49 MB of ORT wasm into the JS. A regular build
    // with a single JS entry emits the wasm as separate files instead —
    // dead weight on disk (runtime fetches wasm from CDN / asset-base),
    // deleted post-build by trim-bundled-wasm.mjs.
    outDir: 'dist-element',
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'esnext',
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/element.tsx'),
      output: {
        format: 'es',
        inlineDynamicImports: true,
        entryFileNames: 'oyon-app.element.js',
        assetFileNames: (info) => {
          const name = info.name ?? '';
          if (name.endsWith('.wasm')) return 'wasm/[name]-[hash][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    chunkSizeWarningLimit: 6000,
  },
});
