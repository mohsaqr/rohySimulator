# Facial Emotion Recognition Plan

## Scope

Build an opt-in facial expression analytics layer for the virtual patient simulator. The laptop camera runs only during an active case session, performs inference in the browser where possible, and stores time-windowed emotion/expression telemetry aligned with existing `sessions` and `learning_events` data.

This should be framed as "facial expression signals" or "affective indicators", not ground-truth student emotions. It must not be used for grading, progression, punishment, or automated individual decisions.

## Current Repo Fit

- Frontend: React/Vite app with session state in `src/App.jsx`.
- Telemetry: `src/services/eventLogger.js` emits xAPI-style events through `NotificationCenter` and `BackendSurface`.
- Backend analytics: `server/routes/analytics-routes.js` writes `learning_events`.
- Oyon aggregate windows should use a dedicated `emotion_windows` table
  keyed by tenant, session, user, and case.

The implementation should stay aligned with the existing analytics path
without overloading legacy `emotion_logs` semantics.

## Recommended Architecture

### 1. Browser Capture Layer

- Add `src/components/emotion/EmotionCaptureController.jsx`.
- Mount it in `App.jsx` only when:
  - user is authenticated,
  - `sessionId` is present and validated,
  - the session has not ended,
  - the user has explicitly opted in for this session.
- Use `navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })`.
- Keep a visible camera status control with pause, resume, and stop.
- Do not start camera on login or settings pages.

### 2. Face Tracking Layer

Use MediaPipe Face Landmarker for the first production slice:

- Package: `@mediapipe/tasks-vision`.
- Configure `runningMode: "VIDEO"`, `numFaces: 1`, `outputFaceBlendshapes: true`, and optionally `outputFacialTransformationMatrixes: true`.
- Run in a Web Worker because MediaPipe video detection is synchronous and can block the UI thread.
- Process at 1-3 FPS for analytics, not 30 FPS. Higher frame rates add privacy and CPU cost without much learning-analytics value.
- Track quality metrics:
  - face present,
  - face box size,
  - yaw/pitch proxy,
  - lighting/blur proxy,
  - landmark confidence,
  - camera paused/denied/unavailable.

### 3. FER Model Layer

Use a two-stage model strategy.

Phase A, pragmatic MVP:
- Start with MediaPipe blendshapes and a transparent mapping to facial action/expression features.
- Store continuous expression features and low-confidence labels only when stable over a time window.
- This gives robust real-time telemetry without pretending to infer internal mental states precisely.

Phase B, state-of-the-art model:
- Add ONNX Runtime Web with WebGPU acceleration and WASM fallback.
- Use a compact FER model exported to ONNX, preferably MobileViT/EfficientNet/EmotiEffNet-family, fine-tuned on AffectNet/RAF-DB-style labels.
- Output:
  - class probability distribution: neutral, happy, sadness, surprise, anger, fear, disgust, optionally contempt,
  - valence/arousal continuous scores,
  - confidence/entropy,
  - model version.
- Target less than 30 ms inference per sampled frame on a modern laptop at 224x224 or smaller crops.
- Prefer local bundled model assets under `public/models/emotion/` after license review.

### 4. Temporal Aggregation

Never write per-frame emotion rows.

In the browser:
- Smooth predictions with EWMA or a small temporal model.
- Aggregate into 5-10 second windows.
- Emit a row only when a window has enough valid face frames.
- Store:
  - dominant expression if confidence threshold is met,
  - full probability vector,
  - valence/arousal mean and variance,
  - valid frame count,
  - missing/occluded ratio,
  - quality flags.

This makes the data useful for case analytics and avoids high-volume biometric traces.

### 5. Backend Storage

Add a migration after legal/ethics approval:

- Create a dedicated `emotion_windows` table:
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
  - `capture_mode TEXT CHECK (...)`
  - `consent_version TEXT`
  - `created_at DATETIME`
- Add indexes on `(tenant_id, session_id, window_start)` and `(tenant_id, user_id, window_start DESC)`.

Add routes in `server/routes/analytics-routes.js` or a dedicated `emotion-routes.js`:

- `POST /api/sessions/:sessionId/emotions/batch`
  - authenticated,
  - ownership/tenant check using existing helper pattern,
  - rejects ended sessions unless server policy allows late flush,
  - caps batch size,
  - validates emotion labels, JSON sizes, confidence ranges, and timestamps.
- `GET /api/sessions/:sessionId/emotions`
  - owner/admin/educator only,
  - returns aggregates, not raw images.
- Optional admin export route that redacts or pseudonymizes user identity.

Also emit a sparse `learning_events` record with `verb: EXPRESSED_EMOTION` only for session timeline alignment.

### 6. Analytics UI

Add two surfaces:

- Student-facing capture control:
  - opt-in consent,
  - camera active/paused indicator,
  - no distracting live emotion labels during the case unless explicitly enabled for research.
- Educator/research dashboard:
  - session timeline overlay: emotion-expression windows aligned with messages, orders, vitals, labs, alarms, and scenario events,
  - aggregate view per case: uncertainty, frustration/stress proxies over time, missing-face periods,
  - quality filter so low-confidence windows are excluded from interpretation.

Avoid "student was anxious" wording. Use "facial expression model estimated high negative valence/activation" or "possible frustration signal".

## Governance Requirements

- Explicit per-session consent.
- Easy pause/stop.
- No raw video/image persistence by default.
- Local-only inference by default.
- Clear research/analytics purpose.
- No grading or automated interventions from FER alone.
- Retention policy tied to existing retention sweep.
- Tenant isolation and purge/anonymization must include `emotion_windows`.
- Document model limitations, fairness testing, and calibration.

Important regulatory note: the EU AI Act bans emotion inference systems in education/workplace contexts except medical or safety uses. Even outside the EU, this is a serious ethics and compliance risk for a university learning system. Treat deployment as research-governed and opt-in unless counsel/ethics approval says otherwise.

## Implementation Phases

### Phase 0: Approval and Framing

- Decide allowed use: research-only, optional formative feedback, or educator dashboard.
- Draft consent text and data retention language.
- Decide exact labels: expression categories, valence/arousal, or blendshape/action-unit signals.
- Define non-use policy: not for grading, discipline, admissions, or ranking.

### Phase 1: Local Prototype

- Create `EmotionCaptureController`.
- Implement camera permission flow.
- Integrate MediaPipe Face Landmarker in a worker.
- Display debug-only face quality and blendshape stream.
- No backend writes yet except local console/testing.

### Phase 2: Aggregated Telemetry

- Add browser aggregator.
- Send batches through a new emotion endpoint.
- Write migration and backend validation.
- Add tests:
  - permission denied,
  - no camera,
  - session ownership,
  - tenant isolation,
  - ended session behavior,
  - batch validation.

### Phase 3: FER Model Upgrade

- Add ONNX Runtime Web.
- Select and license-review a compact model.
- Export/quantize ONNX.
- Implement WebGPU -> WASM fallback.
- Store model metadata with every batch.
- Benchmark CPU, memory, and FPS on low/mid/high laptops.

### Phase 4: Analytics Dashboard

- Add session-level timeline.
- Add educator aggregate view.
- Add quality/uncertainty filters.
- Add export with pseudonymization.

### Phase 5: Validation Study

- Compare model outputs against consented self-report checkpoints.
- Measure calibration and subgroup performance.
- Track false positives during speech, occlusion, glasses, lighting changes, head turns.
- Update thresholds and documentation before broader deployment.

## Acceptance Criteria

- Camera never starts without explicit consent.
- No raw image/video leaves the browser by default.
- App remains responsive during case solving.
- Emotion telemetry is windowed, uncertainty-aware, and aligned with session events.
- Student can pause/stop capture at any time.
- Backend enforces tenant and session ownership.
- Emotion logs are included in purge/anonymization and retention workflows.
- Educator UI communicates uncertainty and avoids deterministic emotion claims.

## Sources Checked

- MediaPipe Face Landmarker Web JS documentation: real-time landmarks, blendshapes, video mode, worker recommendation.
- ONNX Runtime Web documentation: WebGPU and WebNN execution providers for browser inference.
- OpenVINO emotion-recognition-retail-0003 documentation: lightweight reference model and AffectNet validation.
- 2025 FER review literature: current trends include lightweight edge models, ViTs/GNNs, multimodal FER, fairness, and ethical deployment.
- EU AI Act Article 5 and Recital 44: emotion inference in education/workplace contexts is prohibited except medical/safety use, and reliability/generalizability concerns are explicit.
