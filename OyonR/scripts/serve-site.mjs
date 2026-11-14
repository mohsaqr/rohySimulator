#!/usr/bin/env node
/*
 * Serve the assembled site in standalone/app/dist-site/ exactly as a real
 * deploy would.
 *
 *   node scripts/serve-site.mjs [port]        # default 8080
 *
 * WHY NOT `python3 -m http.server`. Two of this site's requirements are not
 * optional, and the stock one-liners get both wrong:
 *
 *   1. `.wasm` MUST be served as `application/wasm`. WebAssembly's streaming
 *      compilation REJECTS any other type, so onnxruntime and MediaPipe fail
 *      at the moment of instantiation — after the page has loaded and looked
 *      fine. python's http.server sends application/octet-stream.
 *
 *   2. The app is a client-routed SPA, so /analyze/gaze is not a file. Without
 *      a fallback to index.html every deep link and every refresh 404s.
 *
 * The MIME table mirrors the dev server's (vite.config.ts, the
 * oyon-serve-legacy-assets plugin) so behaviour is identical either side of a
 * build. Like the dev server, this deliberately sets NO COOP/COEP: the app
 * does not require cross-origin isolation, and imposing it here would diverge
 * from how the app is known to run.
 *
 * Binds 127.0.0.1, which browsers treat as a SECURE CONTEXT — getUserMedia
 * works without a certificate. A LAN address would not.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'standalone/app/dist-site',
);
const PORT = Number(process.argv[2] ?? 8080);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  // The one that must not be guessed — see the header comment.
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.binarypb': 'application/octet-stream',
  '.proto': 'application/octet-stream',
};

try {
  statSync(path.join(ROOT, 'index.html'));
} catch {
  console.error(`serve-site: no site at ${ROOT}\n  run: bash scripts/build-site.sh`);
  process.exit(1);
}

/*
 * Returns the file to send, or a sentinel saying why not.
 *
 * `isDir` is distinguished from plain "missing" on purpose. A directory with
 * no index.html is a real 404, but its URL has no extension, so letting it
 * reach the SPA fallback would answer an asset-tree request with the app's
 * HTML — the exact masked failure this server exists to avoid.
 */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const candidate = path.resolve(ROOT, '.' + decoded);
  // Traversal guard — the resolved path must stay inside the site root.
  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) return null;
  let stats;
  try {
    stats = statSync(candidate);
  } catch {
    return null;
  }
  if (stats.isFile()) return { file: candidate, size: stats.size };
  if (stats.isDirectory()) {
    try {
      const index = path.join(candidate, 'index.html');
      return { file: index, size: statSync(index).size };
    } catch {
      return { isDir: true };
    }
  }
  return null;
}

createServer((req, res) => {
  const urlPath = req.url ?? '/';
  let hit = resolveFile(urlPath);

  /*
   * SPA fallback — but ONLY for paths that look like routes. An asset that is
   * genuinely missing must still 404: silently handing back index.html would
   * turn a missing model into a confusing "unexpected token <" parse error
   * instead of an obvious 404 in the network tab.
   */
  let fellBack = false;
  if (!hit && !path.extname(urlPath.split('?')[0])) {
    hit = resolveFile('/index.html');
    fellBack = true;
  }

  if (hit?.isDir) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 ${urlPath} is a directory with no index.html`);
    console.log(`  404  ${urlPath}  (directory)`);
    return;
  }

  if (!hit) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`404 ${urlPath}`);
    console.log(`  404  ${urlPath}`);
    return;
  }

  const ext = path.extname(hit.file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': String(hit.size),
    // No caching: this is a local preview, and a stale bundle after a rebuild
    // is a worse failure mode than re-reading from disk.
    'Cache-Control': 'no-store',
  });
  createReadStream(hit.file).pipe(res);
  if (fellBack) console.log(`  spa  ${urlPath} → index.html`);
}).listen(PORT, HOST, () => {
  console.log(`Oyon site  →  http://${HOST}:${PORT}/`);
  console.log(`serving    ${ROOT}`);
  console.log(`secure context: yes (127.0.0.1) — camera and mic will work`);
});
