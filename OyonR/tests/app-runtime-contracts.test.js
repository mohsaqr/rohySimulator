import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtime = readFileSync('standalone/app/src/lib/runtime.ts', 'utf8');
const provider = readFileSync('standalone/app/src/lib/RuntimeProvider.tsx', 'utf8');
const preview = readFileSync('standalone/app/src/components/capture/CameraPreview.tsx', 'utf8');

assert.match(runtime, /sessionIdRef/, 'runtime must keep one stable session id per capture run');
assert.doesNotMatch(
  provider,
  /standalone-\$\{runtime\.windowCount\}/,
  'TopBar session id must not be synthesized from windowCount',
);
assert.doesNotMatch(
  provider,
  /runtime\.start\(\)\.catch/,
  'RuntimeProvider must not auto-start camera without a user gesture',
);
assert.match(
  preview,
  /srcObject = runtime\.cameraStream/,
  'CameraPreview must rebind the existing MediaStream after route changes',
);

console.log('app-runtime-contracts.test.js passed');
