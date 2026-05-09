# Oyon Handoff

Date: 2026-05-08

## Summary

`Oyon` is a standalone facial expression recognition sidecar built under:

```text
Oyon/
```

It is intentionally separate from Rohy. No Rohy source files were edited. The current implementation runs as its own local browser app and can later be wired to Rohy by passing user/session/case/logging adapters.

Current live pipeline:

```text
laptop camera
  -> MediaPipe Face Landmarker
  -> face crop / landmarks / overlay
  -> ONNX Runtime Web
  -> EmotiEffLib MobileViT emotion + valence/arousal model
  -> temporal smoothing
  -> readable prediction card
```

No raw video frames are stored.

## How To Run

From the repo root:

```bash
npm start
```

Open:

```text
http://127.0.0.1:5173/standalone/
```

The app is named **Oyon** in the UI.

## What Is Implemented

### Standalone App

Main files:

```text
standalone/index.html
standalone/standalone-demo.js
```

The standalone app includes:

- camera start/pause/resume/stop,
- smaller centered camera preview,
- face overlay markings,
- readable prediction card,
- settings/help panel,
- local browser inference,
- local sidecar code only.

### Face Markings

The camera preview draws:

- green face-corner brackets,
- subtle scanner/grid overlay,
- blue landmark dots,
- live prediction badge near the detected face.

The overlay uses real MediaPipe face geometry and is aligned to the cropped `object-fit: cover` video view.

### Settings & Help

The page has a **Settings & Help** panel with:

- model selector,
- sample interval,
- smoothing strength,
- minimum label hold time,
- switch confidence threshold,
- aggregate log window,
- short explanations for privacy, valence/arousal, interpretation limits, and model choice.

Settings persist in `localStorage`:

```text
standalone-fer-settings
```

### Smoothing

Raw frame-by-frame emotion predictions were too jittery. A smoothing layer was added:

```text
src/smoothing/PredictionSmoother.js
```

It applies:

- EWMA probability smoothing,
- minimum hold time before changing the visible headline label,
- confidence threshold before switching labels.

Default settings:

```js
sampleIntervalMs: 1000
smoothingAlpha: 0.28
minHoldMs: 3000
minSwitchConfidence: 0.5
windowMs: 10000
minValidFrames: 6
```

### Models

Model assets are local under:

```text
standalone/models/emotion/
```

Available profiles:

1. **HSEmotion EfficientNet-B0 MTL + valence/arousal**
   - Default model.
   - File: `enet_b0_8_va_mtl.onnx`
   - Source: `HSE-asavchenko/hsemotion-onnx`
   - Outputs 8 emotion logits + valence + arousal.

2. **EmotiEffLib MobileViT + valence/arousal**
   - Alternative.
   - File: `mobilevit_va_mtl.onnx`
   - Source: `sb-ai-lab/EmotiEffLib`
   - Outputs 8 emotion logits + valence + arousal.

3. **EmotiEffLib MobileFaceNet MTL + valence/arousal**
   - Alternative.
   - File: `mbf_va_mtl.onnx`
   - Source: `sb-ai-lab/EmotiEffLib`
   - Outputs 8 emotion logits + valence + arousal.

Configs:

```text
src/config/emotiEffMobileVitMtl.js
src/config/emotiEffMbfMtl.js
src/config/hseEmotionMtl.js
src/config/openvinoRetail0003.js
```

### Runtime

Core runtime:

```text
src/core/EmotionRuntime.js
```

It owns:

- camera lifecycle,
- sampling loop,
- face tracker invocation,
- ONNX classifier invocation,
- aggregation,
- transport.

### MediaPipe

Face tracking:

```text
src/inference/MediaPipeFaceTracker.js
```

Local assets:

```text
standalone/models/mediapipe/face_landmarker.task
standalone/vendor/mediapipe/wasm/
```

MediaPipe is used for face localization and landmarks, not final emotion classification.

### ONNX Runtime Web

Classifier:

```text
src/inference/OnnxEmotionClassifier.js
```

Local ONNX Runtime assets:

```text
standalone/vendor/onnxruntime-web/
```

The current standalone app forces WASM execution first for reliability. Earlier WebGPU/default loading failed because ORT could not find its `.wasm` and `.mjs` backend files. These are now vendored locally.

### Transport

Two transports exist:

```text
src/transport/LocalEmotionTransport.js
src/transport/HttpEmotionTransport.js
```

The standalone demo uses `LocalEmotionTransport`; later Rohy can use `HttpEmotionTransport`.

### Validation

Payload validation:

```text
src/validation/validateEmotionPayload.js
```

It rejects raw media fields such as:

```text
frame, frames, image, images, video, blob, base64, pixels, landmarks
```

This is important: the intended Rohy integration should send only aggregate windows, not raw images or video.

### Backend Templates

Backend templates exist but are not installed into Rohy:

```text
examples/rohy-backend/0011_emotion_windows.sql
examples/rohy-backend/emotion-routes.template.js
examples/rohy-backend/ATTACH_BACKEND.md
```

These are copyable templates for later. They were not mounted into Rohy.

## Separation From Rohy

This is the central design point.

`Oyon` must remain a sidecar, not a deep Rohy feature.

Current separation:

- No files under `src/`, `server/`, or `migrations/` in Rohy were edited.
- All work lives under the Oyon package/repository.
- The sidecar does not import Rohy contexts.
- The sidecar does not import Rohy services.
- The sidecar does not depend on Rohy auth.
- The sidecar does not depend on Rohy database tables.
- The sidecar does not need a Rohy session to run.

Later Rohy wiring should be adapter-based:

```text
Rohy provides:
  user id
  tenant id
  session id
  case id
  auth token
  backend endpoint
  consent policy

Oyon provides:
  camera handling
  MediaPipe face tracking
  ONNX inference
  smoothing
  aggregate emotion windows
```

The intended integration point is:

```text
src/adapters/rohyAttach.js
```

or the React wrapper:

```text
src/react/useRohyFer.js
src/react/EmotionCapturePanel.js
```

When integrated later, Rohy should only mount a small adapter and provide callbacks. The FER module should not be rewritten into Rohy internals.

## Intended Later Rohy Wiring

Later, Rohy should provide something like:

```js
getSession: () => ({
  sessionId,
  userId: user.id,
  caseId: activeCase.id,
  tenantId: user.tenant_id,
})
```

and:

```js
getToken: () => localStorage.getItem('token')
```

Then switch transport:

```text
LocalEmotionTransport
  -> HttpEmotionTransport
```

and post aggregate batches to:

```text
POST /api/sessions/:sessionId/emotions/batch
```

## Important Interpretation Limits

The UI should not claim:

```text
student is anxious
student is confused
student is stressed
```

Use language like:

```text
estimated facial expression
possible facial affect signal
negative/positive valence estimate
activation/arousal estimate
low confidence window
```

This must not be used for grading, ranking, punishment, or automated decisions.

## Verification

The latest checks passed:

```bash
node --check standalone/standalone-demo.js
npm run check
npm test
```

`npm test` covers:

- aggregation,
- payload validation,
- local transport.

## Files To Know

High-level docs:

```text
README.md
docs/STANDALONE.md
docs/ARCHITECTURE.md
docs/MODEL_SELECTION.md
```

Standalone UI:

```text
standalone/index.html
standalone/standalone-demo.js
```

Core:

```text
src/core/EmotionRuntime.js
src/inference/MediaPipeFaceTracker.js
src/inference/OnnxEmotionClassifier.js
src/smoothing/PredictionSmoother.js
src/aggregation/EmotionAggregator.js
```

Models/config:

```text
src/config/emotiEffMobileVitMtl.js
src/config/hseEmotionMtl.js
src/config/hseEmotionB2.js
standalone/models/emotion/
```

Future Rohy integration:

```text
src/adapters/rohyAttach.js
src/react/useRohyFer.js
examples/rohy-backend/
```

## Next Suggested Work

1. Add face quality state to the UI:
   - no face,
   - face too small,
   - poor angle,
   - low confidence.

2. Add an export button for aggregate windows only.

3. Add a small calibration/debug page for model comparison.

4. Later, only after approval, wire Rohy user/session/case/logs through the adapter.

5. Keep the sidecar separate.
