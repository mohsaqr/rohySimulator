import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWasmPaths } from '../src/inference/OnnxEmotionClassifier.js';
import { normalizeWasmBaseUrl } from '../src/inference/MediaPipeFaceTracker.js';
import { MEDIAPIPE_TASKS_WASM_CDN } from '../src/config/cdnDefaults.js';

const stubOrt = (version) => ({ env: { versions: { web: version } } });

// Falsy / non-string inputs pass through.
assert.equal(resolveWasmPaths(stubOrt('1.25.1'), null), null);
assert.equal(resolveWasmPaths(stubOrt('1.25.1'), undefined), undefined);
assert.equal(resolveWasmPaths(stubOrt('1.25.1'), ''), '');

// A custom (non-jsDelivr) URL is returned unchanged regardless of runtime version.
{
  const custom = 'https://my-host.example/oyon/vendor/onnxruntime-web/';
  assert.equal(resolveWasmPaths(stubOrt('1.25.1'), custom), custom);
}
{
  const selfHosted = 'https://github.com/mohsaqr/Oyon/releases/download/assets-v1/';
  assert.equal(resolveWasmPaths(stubOrt('1.25.1'), selfHosted), selfHosted);
}
{
  const local = '/oyon/vendor/';
  assert.equal(resolveWasmPaths(stubOrt('1.25.1'), local), local);
}

// jsDelivr URL with matching version → unchanged.
{
  const url = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.1/dist/';
  assert.equal(resolveWasmPaths(stubOrt('1.25.1'), url), url);
}

// jsDelivr URL with mismatched version → version substituted.
{
  const stale = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  const adapted = resolveWasmPaths(stubOrt('1.25.1'), stale);
  assert.equal(adapted, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.1/dist/');
}

// jsDelivr URL with no runtime version available → unchanged (fallback to static pin).
{
  const stale = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  assert.equal(resolveWasmPaths({ env: { versions: {} } }, stale), stale);
  assert.equal(resolveWasmPaths({}, stale), stale);
  assert.equal(resolveWasmPaths(null, stale), stale);
}

// `common` version is used as fallback when `web` is missing.
{
  const stale = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  const ortCommonOnly = { env: { versions: { common: '1.26.0' } } };
  assert.equal(resolveWasmPaths(ortCommonOnly, stale),
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/');
}

// Pre-release / build-metadata versions in the URL parse correctly.
{
  const stale = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0-dev.20240101/dist/';
  assert.equal(resolveWasmPaths(stubOrt('1.25.1'), stale),
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.1/dist/');
}

// ─── MediaPipe wasm base URL ──────────────────────────────────────────────

// FilesetResolver joins `${base}/${file}`, so a slash-terminated base would
// produce `wasm//vision_wasm_internal.js` (jsDelivr → HTTP 400). The tracker
// normalizes at its single consumption point.
assert.equal(
  normalizeWasmBaseUrl('https://cdn.example/npm/pkg/wasm/'),
  'https://cdn.example/npm/pkg/wasm',
);
assert.equal(normalizeWasmBaseUrl('/oyon/vendor/mediapipe/wasm'), '/oyon/vendor/mediapipe/wasm');
assert.equal(normalizeWasmBaseUrl('base///'), 'base');
assert.equal(normalizeWasmBaseUrl(null), null);
assert.ok(!normalizeWasmBaseUrl(MEDIAPIPE_TASKS_WASM_CDN).endsWith('/'),
  'the CDN default itself must normalize clean');

// Drift guard: the MediaPipe CDN pin must match the installed
// @mediapipe/tasks-vision version. There is no runtime version handshake
// (unlike ORT's resolveWasmPaths), so a loader/wasm skew after a dependency
// bump would otherwise fail silently — this assertion is the guard.
{
  const pinMatch = /@mediapipe\/tasks-vision@([0-9][0-9A-Za-z.\-+]*)\//.exec(MEDIAPIPE_TASKS_WASM_CDN);
  assert.ok(pinMatch, 'CDN constant must pin an explicit tasks-vision version');
  const installed = JSON.parse(
    readFileSync(new URL('../node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
  ).version;
  assert.equal(pinMatch[1], installed,
    `MEDIAPIPE_TASKS_WASM_CDN pins ${pinMatch[1]} but @mediapipe/tasks-vision ${installed} is installed — ` +
    'update src/config/cdnDefaults.js so the FilesetResolver loader and CDN wasm agree');
}

console.log('wasm-paths.test.js passed');
