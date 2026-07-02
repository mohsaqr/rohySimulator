import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createReadStream, statSync } from 'node:fs';
import { makeAliases } from './vite.aliases';

/*
 * serveLegacyAssets — intercepts `/standalone/models/...`,
 * `/standalone/vendor/...`, `/standalone/<file>.task`, and `/web/...`
 * requests and streams the corresponding file from `<repoRoot>/...`.
 *
 * `/web/` is where the WebEyeTrack (default gaze engine) BlazeGaze model
 * lives (`<repoRoot>/web/model.json` + weight shard). The upstream
 * webeyetrack worker fetches `/web/model.json` origin-relative; without
 * this the SPA fallback returns index.html and BlazeGaze dies with
 * "Failed to parse model JSON". Not shipped in the npm package.
 *
 * Vite's default behavior is to fall through unknown URLs to `index.html`
 * (SPA fallback). MediaPipe and ONNX Runtime then try to parse the HTML
 * as JS / wasm and crash with a confusing 404-shaped error. This middleware
 * resolves the legacy asset layout so the new shell can keep using the
 * same on-disk vendor + model tree the original demo uses.
 *
 * `server.fs.allow` still gates which paths the middleware is *willing*
 * to read; we tighten the URL prefix to `/standalone/` and the filename
 * to a known extension as a defense-in-depth check.
 */
function serveLegacyAssets(repoRoot: string): Plugin {
  const allowedPrefixes = ['/standalone/models/', '/standalone/vendor/', '/web/'];
  const allowedExt = new Set([
    '.wasm',
    '.js',
    '.task',
    '.onnx',
    '.bin',
    '.json',
    '.tflite',
    '.data',
    '.binarypb', // MediaPipe face-mesh model files used by WebGazer
    '.proto',
  ]);
  return {
    name: 'oyon-serve-legacy-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!allowedPrefixes.some((p) => url.startsWith(p))) return next();
        const ext = path.extname(url).toLowerCase();
        if (!allowedExt.has(ext)) return next();

        const filePath = path.resolve(repoRoot, '.' + url);
        // Path traversal guard — file must live under the repo root.
        if (!filePath.startsWith(repoRoot + path.sep)) return next();

        let stats;
        try {
          stats = statSync(filePath);
        } catch {
          return next();
        }
        if (!stats.isFile()) return next();

        const mime: Record<string, string> = {
          '.wasm': 'application/wasm',
          '.js': 'application/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.task': 'application/octet-stream',
          '.onnx': 'application/octet-stream',
          '.bin': 'application/octet-stream',
          '.tflite': 'application/octet-stream',
          '.data': 'application/octet-stream',
          '.binarypb': 'application/octet-stream',
          '.proto': 'application/octet-stream',
        };
        res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(stats.size));
        res.setHeader('Cache-Control', 'public, max-age=300');
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

// Phase B: this app consumes the Oyon library at ../../src and shares model +
// vendor assets with the legacy standalone surface.
//
//   - `oyon` alias → root src/index.js
//   - `server.fs.allow` lifted to the repo root so the dev server can serve
//     files outside this package (the library source plus standalone/models
//     and standalone/vendor).
//   - publicDir disabled; the legacy standalone/ already provides static
//     /standalone/models and /standalone/vendor at the same URLs the library
//     expects. We re-expose those via a small middleware below.
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react(), serveLegacyAssets(repoRoot)],
  resolve: {
    // Shared with vite.element.config.ts — see vite.aliases.ts.
    alias: makeAliases(__dirname, repoRoot),
  },
  optimizeDeps: {
    // Pre-bundle the library so HMR cost is amortized; otherwise every save
    // re-walks src/. The transitive peer deps are listed explicitly so the
    // optimizer doesn't bail when it sees a deep import like
    // @mediapipe/tasks-vision/wasm.
    include: ['@mediapipe/tasks-vision', 'onnxruntime-web'],
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor bundles into their own chunks so the app
        // shell stays small. The ORT runtime + MediaPipe assets are
        // primarily lazy — only `/capture` (and downstream pages) needs
        // them, so a research user on `/analyze` shouldn't pay for them.
        manualChunks: {
          'vendor-tanstack': [
            '@tanstack/react-router',
            '@tanstack/react-query',
          ],
          'vendor-radix': [
            '@radix-ui/react-slot',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-toast',
          ],
          'vendor-onnx': ['onnxruntime-web'],
          'vendor-mediapipe': ['@mediapipe/tasks-vision'],
        },
        // Group emitted assets by extension; helps a researcher reading
        // the dist/ tree see what's code vs. what's a model/runtime asset.
        assetFileNames: (info) => {
          const name = info.name ?? '';
          if (name.endsWith('.wasm')) return 'wasm/[name]-[hash][extname]';
          if (name.endsWith('.css')) return 'assets/[name]-[hash][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    // The largest remaining chunks are lazy gaze-engine payloads produced
    // by dynamic imports inside the adapters. They are not part of the
    // initial app shell; keep the warning threshold aligned with that
    // deliberate split so builds do not report expected lazy payloads as
    // shell regressions.
    chunkSizeWarningLimit: 3000,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: false,
    fs: {
      // Allow the dev server to read files anywhere under the repo root —
      // required because the library lives at ../../src and the MediaPipe /
      // ONNX assets live at ../../standalone/{models,vendor}.
      allow: [repoRoot],
    },
  },
});
