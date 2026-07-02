#!/usr/bin/env node
/*
 * Trim ONNX Runtime WASM from the production bundle.
 *
 * Why this exists:
 *   Vite/Rollup follows `import` statements inside `onnxruntime-web` and
 *   speculatively emits its bundled `.wasm` files (~49 MB total) into our
 *   `dist/`. At runtime, `OnnxEmotionClassifier` configures
 *   `ort.env.wasm.wasmPaths` to point at a CDN (or self-host) — see
 *   `src/config/cdnDefaults.js`. So the bundled wasm files are dead
 *   weight on disk: they aren't fetched by the browser.
 *
 * What this does:
 *   Removes `dist/wasm/*.wasm` after the build. Idempotent; safe to run
 *   when the build was skipped. If you intend to *self-host* wasm via the
 *   bundle output, run `npm run build:full` instead, which skips this
 *   step.
 *
 * Why it's not a Vite plugin:
 *   A plugin that intercepts the asset emit would need to mark these as
 *   `external`, but ORT's wasm imports are not bare specifiers — they're
 *   `new URL('./...', import.meta.url)` references that Rollup can't
 *   externalize without source-level patching. A post-build delete is
 *   the smallest correct intervention.
 */
import { readdirSync, statSync, unlinkSync, rmdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Optional argv: the dist directory to trim (default 'dist'; the element
// build passes 'dist-element').
const distDir = process.argv[2] || 'dist';
const wasmDir = resolve(here, '..', distDir, 'wasm');

let deleted = 0;
let bytes = 0;
try {
  const entries = readdirSync(wasmDir);
  for (const name of entries) {
    if (!name.endsWith('.wasm')) continue;
    const file = resolve(wasmDir, name);
    const size = statSync(file).size;
    unlinkSync(file);
    deleted += 1;
    bytes += size;
  }
  // Remove the now-empty directory.
  if (readdirSync(wasmDir).length === 0) {
    rmdirSync(wasmDir);
  }
} catch (err) {
  if ((err && err.code === 'ENOENT') || (err && err.errno === -2)) {
    // dist/wasm/ doesn't exist — build was skipped or already trimmed.
    process.exit(0);
  }
  throw err;
}

if (deleted > 0) {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  process.stdout.write(
    `trim-bundled-wasm: removed ${deleted} file${deleted === 1 ? '' : 's'} (${mb} MB)\n`,
  );
}
