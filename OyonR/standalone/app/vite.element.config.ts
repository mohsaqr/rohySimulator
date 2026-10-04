import { defineConfig, type Plugin } from 'vite';
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

/*
 * WebGazer is an OPTIONAL peer (GPL-3.0, ~1.3 MB) that the adapter loads with
 * `await import('webgazer')`. With `inlineDynamicImports` there is no lazy
 * chunk to defer it to, so whatever that import resolves to is evaluated at
 * the element's TOP LEVEL, and the result used to depend on the build
 * machine's node_modules:
 *   - webgazer absent (a clean `npm ci` — it is not in the lockfile): Vite's
 *     missing-optional-peer stub, `throw new Error('Could not resolve
 *     "webgazer" imported by "oyon".')`, ran at load and killed the element
 *     in every host (Rohy hand-patched its vendored copy for 3.3.2);
 *   - webgazer present (a stale install): the whole GPL library was inlined
 *     and executed on load in every host, used or not.
 * Resolve it to an empty module instead, always. The adapter treats an
 * import with no usable WebGazer as "not bundled" and falls back to its
 * script tag (`scriptUrl`), so `gaze-engine="webgazer"` still works; the
 * default mediapipe engine never touches it. scripts/verify-element-bundle.mjs
 * fails the build if either failure mode reappears.
 */
const WEBGAZER_STUB_ID = '\0oyon-webgazer-not-bundled';
function webgazerNotBundled(): Plugin {
  return {
    name: 'oyon-webgazer-not-bundled',
    enforce: 'pre',
    resolveId(source) {
      return source === 'webgazer' ? WEBGAZER_STUB_ID : null;
    },
    load(id) {
      return id === WEBGAZER_STUB_ID ? 'export default null;\n' : null;
    },
  };
}

export default defineConfig({
  plugins: [webgazerNotBundled(), react()],
  resolve: {
    alias: makeAliases(__dirname, repoRoot),
  },
  define: {
    // React's UMD-style dev checks read process.env.NODE_ENV; in a host page
    // there is no bundler to substitute it.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  worker: {
    // Same as vite.config.ts: the voice analysis worker's module graph
    // (onnxruntime-web dynamic imports) needs a code-splitting-capable
    // worker format; Vite's default 'iife' cannot host it. The worker is
    // emitted as a sibling file next to oyon-app.element.js.
    format: 'es',
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
