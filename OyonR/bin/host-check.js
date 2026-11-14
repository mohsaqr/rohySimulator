import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function hasExtension(root, extension) {
  if (!root || !existsSync(root)) return false;
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory() && hasExtension(path, extension)) return true;
    if (stat.isFile() && entry.endsWith(extension)) return true;
  }
  return false;
}

function check(id, status, detail) {
  return { id, status, detail };
}

/**
 * Build a machine-readable host-install report. Inputs are injectable so the
 * command can be tested without mutating a consumer's installation.
 */
export function buildHostCheckReport({
  packageRoot,
  publicRoot = null,
  peerRoots = {},
  expectedVersion,
  hostContractVersion,
  batchSchemaVersion,
}) {
  const checks = [];
  const manifest = readJson(join(packageRoot, 'package.json'));
  if (!manifest) {
    checks.push(check('package-manifest', 'fail', 'package.json is missing or invalid'));
  } else if (manifest.version !== expectedVersion) {
    checks.push(check(
      'package-version',
      'fail',
      `package.json=${manifest.version}; runtime=${expectedVersion}`,
    ));
  } else {
    checks.push(check('package-version', 'pass', expectedVersion));
  }

  const elementPath = join(
    packageRoot,
    'standalone',
    'app',
    'dist-element',
    'oyon-app.element.js',
  );
  if (!existsSync(elementPath) || statSync(elementPath).size === 0) {
    checks.push(check(
      'app-element',
      'fail',
      'prebuilt standalone/app/dist-element/oyon-app.element.js is missing',
    ));
  } else {
    const source = readFileSync(elementPath, 'utf8');
    const missing = ['oyon-app', 'start', 'stop', 'setWindows', 'setRecords', 'setGazeAois']
      .filter((token) => !source.includes(token));
    // A dependency the build could not resolve is compiled in as a module
    // that throws this message. With inlined dynamic imports it throws when
    // the element loads, in every host page.
    const unresolved = [...new Set(
      [...source.matchAll(/Could not resolve \\?"([^"\\]+)\\?" imported by/g)].map((match) => match[1]),
    )];
    if (missing.length) {
      checks.push(check('app-element', 'fail', `bundle is missing host tokens: ${missing.join(', ')}`));
    } else if (unresolved.length) {
      checks.push(check(
        'app-element',
        'fail',
        `bundle was built with unresolved imports and throws at load: ${unresolved.join(', ')}`,
      ));
    } else {
      checks.push(check('app-element', 'pass', `${statSync(elementPath).size} bytes`));
    }
  }

  const elementTypes = join(packageRoot, 'types', 'app-element.d.ts');
  checks.push(
    existsSync(elementTypes)
      ? check('app-element-types', 'pass', 'types/app-element.d.ts')
      : check('app-element-types', 'fail', 'types/app-element.d.ts is missing'),
  );

  for (const [name, root] of Object.entries(peerRoots)) {
    if (!root) {
      checks.push(check(`peer:${name}`, 'fail', 'not resolvable from the host'));
      continue;
    }
    const peerManifest = readJson(join(root, 'package.json'));
    checks.push(check(
      `peer:${name}`,
      peerManifest ? 'pass' : 'fail',
      peerManifest?.version ?? 'package.json missing',
    ));
  }

  if (publicRoot) {
    const mediaPipe = join(publicRoot, 'oyon', 'vendor', 'mediapipe');
    const ort = join(publicRoot, 'oyon', 'vendor', 'onnxruntime-web');
    checks.push(hasExtension(mediaPipe, '.wasm')
      ? check('asset:mediapipe-wasm', 'pass', mediaPipe)
      : check('asset:mediapipe-wasm', 'fail', `no .wasm found under ${mediaPipe}`));
    checks.push(hasExtension(ort, '.wasm')
      ? check('asset:onnxruntime-wasm', 'pass', ort)
      : check('asset:onnxruntime-wasm', 'fail', `no .wasm found under ${ort}`));

    const models = join(publicRoot, 'oyon', 'models');
    const faceLandmarker = join(models, 'mediapipe', 'face_landmarker.task');
    checks.push(existsSync(faceLandmarker) && statSync(faceLandmarker).size > 0
      ? check('asset:face-landmarker', 'pass', faceLandmarker)
      : check('asset:face-landmarker', 'fail', `${faceLandmarker} is missing`));
    checks.push(hasExtension(models, '.onnx')
      ? check('asset:emotion-models', 'pass', models)
      : check('asset:emotion-models', 'fail', `no self-hosted .onnx found under ${models}`));
  }

  return {
    ok: !checks.some((entry) => entry.status === 'fail'),
    version: expectedVersion,
    hostContractVersion,
    batchSchemaVersion,
    publicRoot,
    checks,
  };
}
