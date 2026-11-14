import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildHostCheckReport } from '../bin/host-check.js';

const root = mkdtempSync(join(tmpdir(), 'oyon-host-check-'));
const write = (path, value = 'fixture') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
};

try {
  const packageRoot = join(root, 'oyon');
  const publicRoot = join(root, 'public');
  const mediaPipe = join(root, 'peers', 'mediapipe');
  const ort = join(root, 'peers', 'ort');

  write(join(packageRoot, 'package.json'), JSON.stringify({ name: 'oyon', version: '3.0.3' }));
  write(
    join(packageRoot, 'standalone', 'app', 'dist-element', 'oyon-app.element.js'),
    'customElements.define("oyon-app",class{start(){}stop(){}setWindows(){}setRecords(){}setGazeAois(){}});',
  );
  write(join(packageRoot, 'types', 'app-element.d.ts'));
  write(join(mediaPipe, 'package.json'), JSON.stringify({ version: '0.10.22' }));
  write(join(ort, 'package.json'), JSON.stringify({ version: '1.20.0' }));
  write(join(publicRoot, 'oyon', 'vendor', 'mediapipe', 'wasm', 'vision.wasm'));
  write(join(publicRoot, 'oyon', 'vendor', 'onnxruntime-web', 'ort.wasm'));
  write(join(publicRoot, 'oyon', 'models', 'mediapipe', 'face_landmarker.task'));
  write(join(publicRoot, 'oyon', 'models', 'emotion', 'model.onnx'));

  const report = buildHostCheckReport({
    packageRoot,
    publicRoot,
    peerRoots: {
      '@mediapipe/tasks-vision': mediaPipe,
      'onnxruntime-web': ort,
    },
    expectedVersion: '3.0.3',
    hostContractVersion: '3.1',
    batchSchemaVersion: 'oyon-window-batch-v3',
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.find((entry) => entry.id === 'asset:emotion-models').status, 'pass');

  write(
    join(packageRoot, 'standalone', 'app', 'dist-element', 'oyon-app.element.js'),
    'customElements.define("oyon-app",class{start(){}stop(){}setWindows(){}setRecords(){}});',
  );
  const broken = buildHostCheckReport({
    packageRoot,
    peerRoots: {
      '@mediapipe/tasks-vision': mediaPipe,
      'onnxruntime-web': ort,
    },
    expectedVersion: '3.0.3',
    hostContractVersion: '3.1',
    batchSchemaVersion: 'oyon-window-batch-v3',
  });
  assert.equal(broken.ok, false);
  assert.match(
    broken.checks.find((entry) => entry.id === 'app-element').detail,
    /setGazeAois/,
  );

  // A bundle that predates host contract 3.2 has no setRecords: hosts that
  // feed records must be told, not find out from a missing method.
  write(
    join(packageRoot, 'standalone', 'app', 'dist-element', 'oyon-app.element.js'),
    'customElements.define("oyon-app",class{start(){}stop(){}setWindows(){}setGazeAois(){}});',
  );
  const stale = buildHostCheckReport({
    packageRoot,
    peerRoots: {
      '@mediapipe/tasks-vision': mediaPipe,
      'onnxruntime-web': ort,
    },
    expectedVersion: '3.0.3',
    hostContractVersion: '3.2',
    batchSchemaVersion: 'oyon-window-batch-v3',
  });
  assert.equal(stale.ok, false);
  assert.match(stale.checks.find((entry) => entry.id === 'app-element').detail, /setRecords/);

  // A bundle built without an optional dependency carries Vite's throwing
  // stub; with inlined dynamic imports it throws when the element loads.
  for (const stub of [
    'throw new Error(`Could not resolve "webgazer" imported by "oyon".`)',
    'throw new Error("Could not resolve \\"webgazer\\" imported by \\"oyon\\".")',
  ]) {
    write(
      join(packageRoot, 'standalone', 'app', 'dist-element', 'oyon-app.element.js'),
      `customElements.define("oyon-app",class{start(){}stop(){}setWindows(){}setRecords(){}setGazeAois(){}});${stub}`,
    );
    const throwing = buildHostCheckReport({
      packageRoot,
      peerRoots: {
        '@mediapipe/tasks-vision': mediaPipe,
        'onnxruntime-web': ort,
      },
      expectedVersion: '3.0.3',
      hostContractVersion: '3.2',
      batchSchemaVersion: 'oyon-window-batch-v3',
    });
    assert.equal(throwing.ok, false, 'a bundle that throws at load must fail the host check');
    assert.match(throwing.checks.find((entry) => entry.id === 'app-element').detail, /unresolved imports.*webgazer/);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('host-check.test.js passed');
