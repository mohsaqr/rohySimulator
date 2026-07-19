import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const requiredAssets = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

describe('Oyon ONNX Runtime packaging contract', () => {
  const installer = read('OyonR/scripts/download-models.sh');
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
    expect(requiredProbeBlock).toContain(asset);
    expect(freshInstall).toContain(`standalone/vendor/onnxruntime-web/${asset}`);
    expect(release).toContain(`standalone/vendor/onnxruntime-web/${asset}`);
    expect(airgap).toContain(asset);
  });

  it('boots the published image with its required browser origin', () => {
    expect(releaseBootBlock).toContain('-e FRONTEND_URL=http://localhost:4000');
  });
});
