# Changelog

## 0.1.0 — 2026-05-08

Initial public extraction from the rohySimulator workspace.

### Added
- Standalone browser demo with MediaPipe + ONNX Runtime Web pipeline.
- EmotiEffLib MobileViT emotion model with MediaPipe face tracking.
- EmotiEffLib MobileFaceNet MTL as an experimental alternative profile.
- HSEmotion EfficientNet-B0 MTL as the default benchmark-backed profile.
- Live UI: face overlay (DOM-positioned), affect circumplex, valence/
  arousal trace timeline (60 s rolling), settings drawer, FPS / latency
  / sample telemetry strip.
- React hook (`oyon/react`) and adapter (`oyon/adapter`) for attaching
  to a host app.
- Payload validator (`oyon/validation`) that rejects raw frame fields.
- Backend templates for an Express host: SQL migration + emotion-routes
  module, in `examples/rohy-backend/`.
- Documentation: design overview, implementation plan, integration plan,
  model selection rationale, host-side integration mock.

### Privacy / governance posture
- No raw frames stored; validators on both ends enforce the rule.
- Per-session opt-in; one-click pause / stop releases the camera.
- EU AI Act Art. 5 caveats documented in the integration plan.
