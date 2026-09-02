import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/rohy/' : '/',
  resolve: {
    // rohy-3d-patient-room is a file:-linked package whose own node_modules
    // carries a second copy of three; force resolution to the host's copy so
    // exactly one three.js instance is bundled.
    dedupe: ['three'],
    alias: [
      // Keep onnxruntime-web out of the SPA bundle. `oyon/signal-capture`
      // statically reaches the voice VAD, which lazily imports ONNX — and a
      // bundler must emit everything it can reach, so dist/ grew by ~48.7 MB
      // of .wasm plus ~500 KB of glue for a code path Rohy never runs
      // (voice_enabled is forced false). The <oyon-app> element loads its own
      // runtime same-origin from /oyon/standalone/vendor/onnxruntime-web, so
      // this was a duplicate of bytes already shipped.
      //
      // The stub throws with an explanatory message rather than being empty.
      // Aliased by PACKAGE NAME, not by Oyon's internal file path: the package
      // name survives a vendored-engine bump, an internal path does not — and
      // a stale path alias would silently put the 48.7 MB back.
      // Pinned by src/components/oyon/onnxRuntimeStub.test.js.
      {
        find: /^onnxruntime-web(\/.*)?$/,
        replacement: fileURLToPath(new URL('./src/components/oyon/onnxRuntimeStub.js', import.meta.url)),
      },
    ],
  },
  // ES module workers are kept enabled in case future inference moves off-thread.
  worker: {
    format: 'es',
  },
  server: {
    host: true, // Listen on all network interfaces (0.0.0.0)
    port: 5173,
    // Cross-origin isolation: enables SharedArrayBuffer so ONNX Runtime Web
    // can run multi-threaded WASM (5–10× faster inference, the difference
    // between a 4-second-per-frame pill and a 150ms-per-frame one).
    // Mirrored on the prod express server in server/security-headers.js.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/standalone': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/oyon': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      // Uploaded media (lesson images/files/videos, avatars) is served as
      // static /uploads by the Express backend, not Vite — proxy it in dev so
      // uploaded assets resolve instead of hitting the SPA fallback.
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      // Help & Support article links point at DOCS_BASE (/rohy/docs/...).
      // In dev the docs are served by the Express backend, not Vite, so
      // proxy them through or every Help link hits Vite's SPA fallback.
      '/rohy/docs': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
