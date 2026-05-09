# Standalone Mode

The FER module does not need to be inside Rohy now.

Current standalone shape:

- standalone session/user/case ids,
- aggregate windows stored in browser `localStorage`,
- real MediaPipe face tracking by default,
- real ONNX Runtime Web emotion inference by default,
- optional mock classifier for UI and offline development,
- no Rohy imports,
- no Rohy database writes.

Open `standalone/index.html` through a local static server to test the sidecar lifecycle.

Example:

```bash
cd Oyon
npm start
```

Then open:

```text
http://127.0.0.1:5173/standalone/
```

The standalone demo runs the current production-shaped browser pipeline:

- runtime start/pause/resume/stop,
- camera permission and release,
- MediaPipe face detection and landmarks,
- ONNX emotion classification,
- temporal smoothing,
- aggregation windows,
- local log storage,
- no Rohy dependency.

Model and runtime assets are bundled under
`standalone/models/` and `standalone/vendor/`.

Default timing is intentionally low-frequency for learning analytics:
1 Hz camera sampling, 10-second aggregate windows, six valid face
samples required per window, 3-second label hold, and a 50% switch
threshold. The settings drawer exposes these values for local overrides.

## Later Rohy Wiring

When Rohy is ready, only replace the standalone context and transport:

```text
standalone contextProvider -> Rohy user/session/case provider
LocalEmotionTransport -> HttpEmotionTransport
local storage logs -> /api/sessions/:sessionId/emotions/batch
```

The FER runtime itself should remain separate.
