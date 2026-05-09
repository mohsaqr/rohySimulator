# MediaPipe + ONNX Facial Expression Recognition Plan

## Goal

Add an opt-in camera-based facial expression recognition layer to the virtual patient simulator so researchers/educators can study affective signals while a student solves a case.

The system should infer visible facial expression patterns, not claim direct access to the student's true internal emotional state. Outputs must be treated as uncertain analytics signals.

## Core Design

Use a two-part local browser pipeline:

```text
Laptop camera
  -> MediaPipe Face Landmarker
  -> face landmarks, blendshapes, crop, pose, quality
  -> ONNX Runtime Web FER model
  -> expression probabilities + valence/arousal + confidence
  -> 5-10 second aggregation windows
  -> emotion_windows + sparse learning_events
```

## Why MediaPipe

MediaPipe should be used for face tracking, not final emotion classification.

It provides:

- fast browser-compatible face detection/landmarking,
- facial blendshapes such as smile, brow movement, eye squint, jaw open,
- head pose/geometry signals,
- face crop/alignment inputs for the FER model,
- quality checks such as no face, face too small, occlusion, or bad pose.

MediaPipe does not by itself produce reliable high-level labels such as anxiety, confusion, or frustration. It gives the visual features needed by the next stage.

Use:

- upstream project: `google-ai-edge/mediapipe`
- browser package: `@mediapipe/tasks-vision`
- task: Face Landmarker
- options: `runningMode: "VIDEO"`, `numFaces: 1`, `outputFaceBlendshapes: true`

## Why ONNX

ONNX should run the actual facial expression model.

It provides:

- local inference in the browser,
- no cloud inference cost,
- model portability from PyTorch/TensorFlow/Hugging Face/OpenVINO pipelines,
- WebGPU acceleration with WASM fallback,
- easy future model replacement.

Use:

- package: `onnxruntime-web`
- preferred execution order: `webgpu`, then `wasm`
- model format: compact quantized ONNX
- target input size: 112x112, 160x160, or 224x224 face crop
- target output:
  - probabilities for `neutral`, `happy`, `sad`, `surprise`, `anger`, `fear`, `disgust`
  - optional `contempt`
  - optional valence/arousal
  - confidence and entropy

Selected models:

- HSEmotion EfficientNet-B0 MTL is the default benchmark-backed profile.
- EmotiEffLib MobileViT MTL remains bundled as an alternative.
- EmotiEffLib MobileFaceNet MTL is bundled as an alternative.
- All selected profiles output expression logits, valence, and arousal.

## Repo Integration

Current app fit:

- React/Vite frontend.
- Session state lives in `src/App.jsx`.
- Existing telemetry uses `src/services/eventLogger.js`.
- Backend analytics already writes `learning_events`.
- Oyon aggregate windows should live in a dedicated `emotion_windows`
  table; sparse markers can still align with `learning_events`.

Do not create a separate analytics silo. Keep Oyon tied to the current
session analytics flow through shared session/user/case/tenant keys.

## Frontend Components

Add these later:

- `src/components/emotion/EmotionConsentModal.jsx`
- `src/components/emotion/EmotionCaptureController.jsx`
- `src/components/emotion/EmotionStatusControl.jsx`
- `src/components/emotion/EmotionDebugPanel.jsx` for dev/admin only
- `src/workers/emotionWorker.js`
- `src/services/emotion/mediaPipeFaceTracker.js`
- `src/services/emotion/onnxEmotionClassifier.js`
- `src/services/emotion/emotionAggregator.js`
- `src/services/emotion/emotionTelemetry.js`

Mount `EmotionCaptureController` in `App.jsx` only when:

- user is logged in,
- active case exists,
- `sessionId` exists,
- session is validated,
- case is not ended,
- student explicitly opted in.

## Runtime Flow

1. Student starts or resumes a virtual patient case.
2. App asks for explicit FER consent for this session.
3. If accepted, app requests camera permission with `audio: false`.
4. Video stream stays in browser.
5. Worker samples frames at 1-3 FPS.
6. MediaPipe detects/tracks the face and returns landmarks/blendshapes.
7. Browser crops and aligns the face.
8. ONNX model predicts expression probabilities.
9. Aggregator smooths predictions over 5-10 seconds.
10. Client sends only aggregated telemetry batches.
11. Backend writes validated rows tied to `session_id`, `user_id`, `case_id`, and `tenant_id`.

## Data Policy

Default policy:

- no raw video storage,
- no raw frame/image storage,
- no audio capture,
- no per-frame telemetry writes,
- no third-party cloud inference,
- no emotion labels shown to the student during the case unless a research protocol explicitly wants that.

Store only:

- dominant estimated expression,
- full probability vector,
- valence/arousal if model supports it,
- confidence/entropy,
- face quality metrics,
- model name/version,
- aggregation window start/end,
- valid frame count and missing-face ratio.

## Backend Plan

Create a dedicated `emotion_windows` table with a migration after approval:

- `tenant_id TEXT NOT NULL`
- `session_id TEXT NOT NULL`
- `user_id TEXT NOT NULL`
- `case_id TEXT`
- `dominant_emotion TEXT`
- `probabilities TEXT`
- `valence REAL`
- `arousal REAL`
- `confidence REAL`
- `entropy REAL`
- `window_start DATETIME`
- `window_end DATETIME`
- `valid_frames INTEGER`
- `missing_face_ratio REAL`
- `quality JSON`
- `model_name TEXT`
- `model_version TEXT`
- `capture_mode TEXT`
- `consent_version TEXT`
- `created_at DATETIME`

Add indexes:

- `(tenant_id, session_id, window_start)`
- `(tenant_id, user_id, window_start DESC)`

Add route:

- `POST /api/sessions/:sessionId/emotions/batch`

Validation:

- authenticated user only,
- same tenant,
- session ownership unless educator/admin,
- batch size cap,
- allowed labels only,
- probability values in `[0, 1]`,
- confidence/entropy bounded,
- JSON size limit,
- timestamps must be close to session time,
- reject raw image/frame payloads.

Read route:

- `GET /api/sessions/:sessionId/emotions`
- owner/admin/educator only.

Also emit sparse `learning_events` entries with `verb: EXPRESSED_EMOTION` for timeline alignment.

## UI Plan

Student UI:

- short consent dialog before camera starts,
- visible camera active indicator,
- pause/resume/stop controls,
- no live emotion score during case by default.

Educator/research UI:

- timeline overlay aligned with chat, orders, labs, vitals, alarms, and scenario events,
- expression probability bands over time,
- valence/arousal trend if supported,
- missing/low-quality capture regions,
- filters for confidence and face quality,
- export with pseudonymization.

Use cautious labels:

- "estimated facial expression"
- "possible frustration signal"
- "negative-valence/high-activation signal"
- "low-confidence window"

Avoid:

- "the student is anxious"
- "the student is confused"
- "the student is stressed"
- any grading or ranking language.

## Implementation Phases

### Phase 0: Approval

- Confirm research/ethics/legal constraints.
- Confirm whether EU AI Act restrictions apply to deployment context.
- Write consent text and retention policy.
- Decide whether this is research-only or educator-facing.

### Phase 1: Camera + MediaPipe Prototype

- Build camera permission flow.
- Add MediaPipe Face Landmarker in worker.
- Show dev-only landmarks/blendshape/quality output.
- No backend writes.

### Phase 2: ONNX FER Prototype

- Select one compact ONNX model.
- Implement face crop/alignment.
- Run ONNX Runtime Web with WebGPU/WASM fallback.
- Benchmark latency and memory.
- Output probabilities and confidence locally.

### Phase 3: Aggregation + Backend

- Add 5-10 second window aggregation.
- Add migration and batch endpoint.
- Add validation and tenant/session ownership checks.
- Include purge/anonymization/retention updates.

### Phase 4: Analytics

- Add session timeline view.
- Add case/session aggregate view.
- Add export with pseudonymization.
- Add quality and confidence filters.

### Phase 5: Validation Study

- Compare against voluntary self-report checkpoints.
- Test lighting, glasses, head pose, speech, occlusion, skin tone, age, and camera quality.
- Report calibration and subgroup performance.
- Revise model/thresholds before broader use.

## Acceptance Criteria

- Camera never starts without explicit opt-in.
- Student can pause/stop capture at any time.
- No raw image/video/audio is stored by default.
- Inference runs locally.
- App remains responsive during the simulation.
- Telemetry is aggregated, uncertainty-aware, and tied to the active session.
- Backend enforces tenant and ownership boundaries.
- Data retention and user purge cover emotion logs.
- Educator UI communicates uncertainty and avoids deterministic emotion claims.

## Primary Sources

- MediaPipe: https://github.com/google-ai-edge/mediapipe
- MediaPipe Face Landmarker Web docs: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- ONNX Runtime Web: https://onnxruntime.ai/docs/get-started/with-javascript/web.html
- ONNX Runtime WebGPU: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- ONNX Runtime WebNN: https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html
- EU AI Act Article 5: https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-5
- EU AI Act Recital 44: https://ai-act-service-desk.ec.europa.eu/en/ai-act/recital-44
