import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const requiredAssets = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];
const requiredStaticPaths = [
  'standalone/',
  'standalone/logs.html',
  'standalone/vendor/onnxruntime-web/ort.min.mjs',
  'standalone/vendor/onnxruntime-web/ort-wasm-simd-threaded.mjs',
  'standalone/vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  'standalone/vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs',
  'standalone/vendor/onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm',
  'standalone/vendor/mediapipe/vision_bundle.mjs',
  'standalone/vendor/ladyna/dist/index.js',
  'standalone/vendor/rohy-tna/NetworkGraph.js',
  'standalone/vendor/rohy-tna/SequencePlots.js',
  'standalone/vendor/rohy-tna/tnaColors.js',
  'standalone/models/mediapipe/face_landmarker.task',
  'standalone/models/emotion/enet_b0_8_va_mtl.onnx',
  'standalone/models/emotion/mobilevit_va_mtl.onnx',
  'standalone/models/emotion/mbf_va_mtl.onnx',
];

describe('Oyon ONNX Runtime packaging contract', () => {
  const installer = read('OyonR/scripts/download-models.sh');
  const verifier = read('scripts/verify-oyon-install.mjs');
  const packageJson = JSON.parse(read('package.json'));
  const techTest = read('scripts/tech-test.sh');
  const freshInstall = read('.github/workflows/install-from-scratch.yml');
  const release = read('.github/workflows/release.yml');
  const airgap = read('deploy/bundle-airgap.sh');
  const requiredProbeBlock = techTest.slice(
    techTest.indexOf('# REQUIRED set:'),
    techTest.indexOf('# OPTIONAL set:'),
  );
  const releaseBootBlock = release.slice(
    release.indexOf('- name: Boot the container as if on a fresh box'),
    release.indexOf('- name: Wait for /api/health'),
  );

  it.each(requiredAssets)('requires %s in every install and verification path', (asset) => {
    expect(installer).toContain(asset);
    expect(verifier).toContain(asset);
    expect(requiredProbeBlock).toContain(asset);
    expect(freshInstall).toContain(`standalone/vendor/onnxruntime-web/${asset}`);
    expect(release).toContain(`standalone/vendor/onnxruntime-web/${asset}`);
    expect(airgap).toContain(asset);
  });

  it('fails installation and builds when required Oyon assets are incomplete', () => {
    expect(packageJson.scripts.postinstall).toBe('npm run setup:oyon');
    expect(packageJson.scripts['setup:oyon']).toContain('npm run verify:oyon');
    // `toContain`, matching setup:oyon above: what matters is that
    // verify:oyon gates the build, not that it is the only thing prebuild
    // does. prebuild also runs license:sync, and an exact match here would
    // fail every time a build step is legitimately composed alongside it.
    expect(packageJson.scripts.prebuild).toContain('npm run verify:oyon');
  });

  it('downloads models atomically and verifies immutable checksums', () => {
    expect(installer).toContain('.part.$$');
    expect(installer).toContain('--retry 3');
    expect(installer).toContain('verify_sha256');
    expect(installer).toContain('checksum mismatch');
    expect(installer).not.toContain('EmotiEffLib/main/');
    expect(installer).toContain('EmotiEffLib/520a051c64cd191521e5934655314e769a319684/');
  });

  it('verifies every multi-file Oyon element runtime family', () => {
    for (const family of [
      'voiceAnalysisWorker-',
      'voiceFrameWorklet-',
      'ort\\.bundle\\.min-',
      'ort\\.webgpu\\.bundle\\.min-',
      'ort-wasm-simd-threaded\\.asyncify-',
      'ort-wasm-simd-threaded\\.jsep-',
    ]) {
      expect(verifier).toContain(family);
    }
  });

  it('boots the published image with its required browser origin', () => {
    expect(releaseBootBlock).toContain('-e FRONTEND_URL=http://localhost:4000');
  });

  it.each(requiredStaticPaths)('probes %s in fresh-install and release images', (path) => {
    expect(freshInstall).toContain(path);
    expect(release).toContain(path);
  });
});
