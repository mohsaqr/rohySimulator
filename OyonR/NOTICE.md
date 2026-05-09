# Third-party notices

Oyon's source code is released under the MIT License (see `LICENSE`).
The repository also bundles or references the following third-party
artifacts. Each carries its own license; verify compliance before
production deployment.

## Model weights (under `standalone/models/emotion/`)

| File | Source | Upstream license |
|---|---|---|
| `mobilevit_va_mtl.onnx` | [sb-ai-lab / EmotiEffLib](https://github.com/sb-ai-lab/EmotiEffLib) | Per upstream — verify before redistribution |
| `mbf_va_mtl.onnx` | [sb-ai-lab / EmotiEffLib](https://github.com/sb-ai-lab/EmotiEffLib) | Per upstream — verify before redistribution |
| `enet_b0_8_va_mtl.onnx` | [HSEmotion](https://github.com/HSE-asavchenko/hsemotion-onnx) | Per upstream — verify before redistribution |

If you redistribute Oyon, **re-verify the upstream license** of each
model you ship. Some research-published weights are intended for
non-commercial use only.

## Face landmark model

| File | Source | Upstream license |
|---|---|---|
| `standalone/models/mediapipe/face_landmarker.task` | [Google MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) | Apache 2.0 (per MediaPipe) |

## Runtime libraries (under `standalone/vendor/`)

| Path | Source | License |
|---|---|---|
| `vendor/mediapipe/wasm/*` | `@mediapipe/tasks-vision` | Apache 2.0 |
| `vendor/onnxruntime-web/*` | `onnxruntime-web` | MIT |

These are consumed at runtime by the standalone demo. The `peerDependencies`
entry in `package.json` lists the npm-installable equivalents for
attached-mode integration.

## Reporting issues

If you believe a bundled artifact's license is misrepresented above,
open a GitHub issue and we will correct it promptly.
