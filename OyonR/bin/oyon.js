#!/usr/bin/env node
// Oyon CLI — install browser-side assets into a host app's public directory.
//
// Usage:
//   npx oyon install-assets <out-dir>          Copy WASM runtimes from peer deps
//   npx oyon download-models <out-dir>         Download ONNX + MediaPipe models
//   npx oyon paths                             Print resolved peer-dep asset paths
//   npx oyon --help

import { mkdirSync, existsSync, cpSync, readdirSync, statSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  MEDIAPIPE_TASKS_WASM_CDN,
  ONNX_RUNTIME_WASM_CDN,
} from '../src/config/cdnDefaults.js';

const require = createRequire(import.meta.url);
const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(SELF_DIR, '..');

const HELP = `oyon — install browser-side assets for the Oyon FER package.

Commands:
  install-assets <dir>     Copy MediaPipe + ONNX Runtime WASM into <dir>/oyon/vendor/
  download-models <dir>    Download ONNX model weights into <dir>/oyon/models/
  paths                    Print resolved asset locations from peer dependencies
  help                     Show this message

Examples:
  npx oyon install-assets ./public
  npx oyon download-models ./public --force
`;

function resolvePeerAsset(specifier, cwd = process.cwd()) {
  // Try the host's node_modules first, then fall back to Oyon's own.
  for (const base of [cwd, PKG_ROOT]) {
    const localRequire = createRequire(join(base, 'package.json'));
    try {
      return dirname(localRequire.resolve(specifier));
    } catch {
      // fall through
    }
  }
  return null;
}

function mediapipeWasmDir() {
  const pkgDir = resolvePeerAsset('@mediapipe/tasks-vision/package.json');
  if (!pkgDir) return null;
  const candidate = join(pkgDir, 'wasm');
  return existsSync(candidate) ? candidate : null;
}

function ortWasmDir() {
  const pkgDir = resolvePeerAsset('onnxruntime-web/package.json');
  if (!pkgDir) return null;
  const candidate = join(pkgDir, 'dist');
  return existsSync(candidate) ? candidate : null;
}

function copyWasmAssets(outRoot) {
  const targetDir = join(outRoot, 'oyon', 'vendor');
  mkdirSync(targetDir, { recursive: true });

  const mp = mediapipeWasmDir();
  const ort = ortWasmDir();
  const report = [];

  if (mp) {
    const dest = join(targetDir, 'mediapipe', 'wasm');
    cpSync(mp, dest, { recursive: true });
    report.push({ name: 'mediapipe/tasks-vision', src: mp, dest });
  } else {
    report.push({ name: 'mediapipe/tasks-vision', src: null, error: 'peer dep not installed' });
  }

  if (ort) {
    const dest = join(targetDir, 'onnxruntime-web');
    cpSync(ort, dest, { recursive: true });
    report.push({ name: 'onnxruntime-web', src: ort, dest });
  } else {
    report.push({ name: 'onnxruntime-web', src: null, error: 'peer dep not installed' });
  }

  return { targetDir, report };
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    total += stat.isDirectory() ? dirSize(full) : stat.size;
  }
  return total;
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// Default to upstream sources. To pull from the self-hosted assets-v1
// release instead, set OYON_ASSETS_BASE in the environment, e.g.
//   OYON_ASSETS_BASE=https://github.com/mohsaqr/Oyon/releases/download/assets-v1 \
//     npx oyon download-models ./public
// (Self-hosted release works only after the repo is public.)
const ASSETS_BASE = process.env.OYON_ASSETS_BASE || null;

const MODELS = ASSETS_BASE ? [
  { label: 'MediaPipe Face Landmarker (float16)', url: `${ASSETS_BASE}/face_landmarker.task`, rel: 'mediapipe/face_landmarker.task' },
  { label: 'EmotiEffLib MobileViT MTL',           url: `${ASSETS_BASE}/mobilevit_va_mtl.onnx`, rel: 'emotion/mobilevit_va_mtl.onnx' },
  { label: 'EmotiEffLib MobileFaceNet MTL',       url: `${ASSETS_BASE}/mbf_va_mtl.onnx`,       rel: 'emotion/mbf_va_mtl.onnx' },
  { label: 'HSEmotion EfficientNet-B0 MTL',       url: `${ASSETS_BASE}/enet_b0_8_va_mtl.onnx`, rel: 'emotion/enet_b0_8_va_mtl.onnx' },
] : [
  {
    label: 'MediaPipe Face Landmarker (float16)',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    rel: 'mediapipe/face_landmarker.task',
  },
  {
    label: 'EmotiEffLib MobileViT MTL',
    url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mobilevit_va_mtl.onnx',
    rel: 'emotion/mobilevit_va_mtl.onnx',
  },
  {
    label: 'EmotiEffLib MobileFaceNet MTL',
    url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/mbf_va_mtl.onnx',
    rel: 'emotion/mbf_va_mtl.onnx',
  },
  {
    label: 'HSEmotion EfficientNet-B0 MTL',
    url: 'https://raw.githubusercontent.com/sb-ai-lab/EmotiEffLib/main/models/affectnet_emotions/onnx/enet_b0_8_va_mtl.onnx',
    rel: 'emotion/enet_b0_8_va_mtl.onnx',
  },
];

async function downloadOne(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function downloadModels(outRoot, { force = false } = {}) {
  const targetDir = join(outRoot, 'oyon', 'models');
  mkdirSync(targetDir, { recursive: true });
  const results = [];
  for (const m of MODELS) {
    const dest = join(targetDir, m.rel);
    if (existsSync(dest) && statSync(dest).size > 0 && !force) {
      results.push({ ...m, dest, status: 'skipped (already present)' });
      continue;
    }
    process.stdout.write(`→ ${m.label}\n  ↓ ${m.url}\n`);
    try {
      await downloadOne(m.url, dest);
      results.push({ ...m, dest, status: 'downloaded' });
    } catch (err) {
      results.push({ ...m, dest, status: `failed: ${err.message}` });
    }
  }
  return { targetDir, results };
}

function tryRunShellScript(outRoot, force) {
  const sh = join(PKG_ROOT, 'scripts', 'download-models.sh');
  if (!existsSync(sh)) return false;
  if (process.platform === 'win32') return false;
  // The bundled shell script targets PKG_ROOT/standalone — only useful when
  // the host wants assets in that exact layout. Skip in favour of fetch().
  return false;
}

function printPaths() {
  const mp = mediapipeWasmDir();
  const ort = ortWasmDir();
  console.log('Resolved peer-dep asset directories:');
  console.log(`  @mediapipe/tasks-vision/wasm:   ${mp ?? '<not installed>'}`);
  console.log(`  onnxruntime-web/dist:           ${ort ?? '<not installed>'}`);
  console.log('');
  console.log('Public CDN URLs (default in oyon runtime):');
  // Imported from src/config/cdnDefaults.js so this output can never drift
  // from what the runtime actually fetches.
  console.log(`  ${MEDIAPIPE_TASKS_WASM_CDN}`);
  console.log(`  ${ONNX_RUNTIME_WASM_CDN}`);
  console.log('');
  console.log('Self-hosted alternative (requires the Oyon repo to be public):');
  console.log('  https://github.com/mohsaqr/Oyon/releases/download/assets-v1/');
  console.log('  Set OYON_ASSETS_BASE=<url> to make the CLI download from there.');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }

  if (cmd === 'paths') {
    printPaths();
    return;
  }

  if (cmd === 'install-assets') {
    const outDir = rest[0];
    if (!outDir) {
      console.error('error: missing output directory.\n');
      console.error(HELP);
      process.exit(2);
    }
    const out = resolve(process.cwd(), outDir);
    const { targetDir, report } = copyWasmAssets(out);
    for (const r of report) {
      if (r.error) {
        console.error(`  ✗ ${r.name}: ${r.error}`);
      } else {
        console.log(`  ✓ ${r.name} → ${r.dest} (${fmtBytes(dirSize(r.dest))})`);
      }
    }
    const failed = report.some(r => r.error);
    if (failed) {
      console.error('\nInstall peer deps in your host app and re-run:');
      console.error('  npm install @mediapipe/tasks-vision onnxruntime-web');
      process.exit(1);
    }
    console.log(`\nDone. Configure Oyon runtime to load assets from your /oyon/vendor/ URL.`);
    return;
  }

  if (cmd === 'download-models') {
    const outDir = rest[0];
    if (!outDir) {
      console.error('error: missing output directory.\n');
      console.error(HELP);
      process.exit(2);
    }
    const force = rest.includes('--force');
    const out = resolve(process.cwd(), outDir);
    const { targetDir, results } = await downloadModels(out, { force });
    for (const r of results) {
      const ok = r.status.startsWith('downloaded') || r.status.startsWith('skipped');
      const mark = ok ? '✓' : '✗';
      console.log(`  ${mark} ${r.label}: ${r.status}`);
    }
    const anyFailed = results.some(r => r.status.startsWith('failed'));
    if (anyFailed) process.exit(1);
    console.log(`\nDone. Models live under ${targetDir}.`);
    return;
  }

  console.error(`unknown command: ${cmd}\n`);
  console.error(HELP);
  process.exit(2);
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
