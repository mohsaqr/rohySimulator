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
| `vendor/webgazer/face_mesh/*` | WebGazer-vendored FaceMesh assets | Apache 2.0 (FaceMesh) |

These are consumed at runtime by the standalone demo. The `peerDependencies`
entry in `package.json` lists the npm-installable equivalents for
attached-mode integration.

## Gaze engines (npm dependencies)

| Package | License | Notes |
|---|---|---|
| `webeyetrack@^0.0.2` | Per upstream — verify before redistribution | Default gaze engine. Pure-WebAssembly pipeline; no global side effects in the page. |
| `webgazer@^3.5.3` | **GPL-3.0-or-later** | Selectable alternate gaze engine. WebGazer is more accurate in our testing but its copyleft license has redistribution implications. See note below. |

### WebGazer license note for integrators

WebGazer.js is GPL-3.0-or-later. When you select the `webgazer` gaze
engine and ship Oyon as part of a host application, WebGazer's code
becomes part of the deployed bundle, and GPL-3.0-or-later obligations
attach to *that bundle* — typically: distribute source on request,
preserve the license notice, and ensure derivatives remain compatible.

This does **not** affect Oyon's own MIT-licensed source code, nor does
it affect the default WebEyeTrack path. It does affect any combined
work that statically links WebGazer.

If your host application is itself proprietary or under a copyleft-
incompatible license, prefer the WebEyeTrack engine (the default), or
load WebGazer at runtime from a separate page/iframe context with its
own license disclosure. We document the trade-off here rather than hide
WebGazer behind an optional install, because WebGazer's accuracy is a
deliberate user-facing choice and we want it to be easy to pick.

## Reporting issues

If you believe a bundled artifact's license is misrepresented above,
open a GitHub issue and we will correct it promptly.
