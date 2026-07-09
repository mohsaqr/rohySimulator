import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/rohy/' : '/',
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
