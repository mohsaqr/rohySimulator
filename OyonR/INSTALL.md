# Installing Oyon

Oyon supports two install modes:

1. **Standalone** — clone the repo, run the demo page locally.
2. **Attached** — consume Oyon as a workspace package or git dependency
   from a host app (e.g. Rohy).

Pick the mode that matches what you want to do. Both modes are listed
below in full; you do not need to do (1) before (2).

---

## 1. Standalone mode

### Requirements

- Node.js ≥ 18 (tested on 22).
- A modern browser with `getUserMedia` support (Chrome 90+, Safari 14+,
  Firefox 90+).
- A working webcam.
- ~70 MB free disk for `node_modules` after install.

### Steps

```bash
git clone https://github.com/mohsaqr/Oyon.git
cd Oyon
npm install
npm start
```

Vite prints a local URL — typically `http://127.0.0.1:5173/`. Open
**`http://127.0.0.1:5173/standalone/`** to load the demo page.

> The trailing `/standalone/` matters. Vite's root index is intentionally
> empty; the demo lives one folder down so the same Vite instance can
> later host other examples without colliding.

The first time the page runs:

1. The browser asks for camera permission. Grant it.
2. The face tracker fetches `standalone/models/mediapipe/face_landmarker.task`
   (~11 MB) and the chosen ONNX model (15–35 MB depending on profile).
   These are bundled in the repo, so no network is needed after clone.
3. After ~2 seconds, the camera tile shows a face box and the prediction
   card starts updating.

### Re-fetching model weights

The clone bundles all model weights and runtime WASM. If you ever
need to refresh them from upstream, run:

```bash
npm run download-models
```

The script is idempotent — only missing files are downloaded. See
[`scripts/README.md`](scripts/README.md) for the source repos and the
Git LFS migration recipe (for when the bundled-binary clone size
becomes a problem).

### Switching models

The settings drawer (top-right "Settings & help" → Model tab) lets you
pick from five profiles. Selection is persisted in `localStorage` so
the page reloads with your last choice.

### Running the tests

```bash
npm test
# 3 suites: aggregation, validation, local-transport
```

Tests run in plain Node (no browser) and exercise the data-handling
classes only. Browser-side integration is exercised by opening the
standalone page.

### What gets stored on disk

- `node_modules/` — npm dependencies.
- `localStorage['standalone-fer-settings']` — your settings drawer
  values (browser-side).
- `localStorage['standalone-fer-events']` — aggregate windows from your
  local sessions, capped at 2000 entries.

**Nothing else.** No video, image, raw frame, or audio data is written
to disk by Oyon. Clear `localStorage` to wipe history.

---

## 2. Attached mode (host app integration)

This section covers consuming Oyon from a separate app. Rohy is the
reference host, but the contract is host-agnostic.

### Pick a linkage strategy

Three options, in increasing order of operational independence:

| Strategy | When to use |
|---|---|
| **A. npm workspace** | Host repo can include Oyon as a sibling folder; simplest dev loop, instant edits, single `npm install`. |
| **B. git submodule** | Host repo wants a pinned Oyon revision under its own folder, but its own dev process. |
| **C. published package** | Once Oyon is on a private npm registry or as a GitHub package; cleanest for production but requires publish step. |

The recommended default during pilot is **(A) workspace**, switching to
(C) once the API surface is stable.

### Strategy A — npm workspace (recommended)

In your host's root `package.json`:

```json
{
  "workspaces": ["path/to/Oyon"]
}
```

Where `path/to/Oyon` is the relative path to a clone of this repo.
Then `npm install` once at the host root.

After install, Oyon is resolvable as `oyon`:

```js
import { useRohyFer } from 'oyon/react';
import { validateEmotionBatch } from 'oyon/validation';
```

(The package's `exports` field defines four entry points: `.`, `/react`,
`/adapter`, `/validation`. No deep imports into `src/`.)

### Strategy B — git submodule

```bash
git submodule add https://github.com/mohsaqr/Oyon.git vendor/oyon
git submodule update --init --recursive
```

Then either treat `vendor/oyon` as a workspace (Strategy A applied to
the submodule path) or import from a relative path:

```js
import { useRohyFer } from '../../vendor/oyon/src/react/useRohyFer.js';
```

The relative-import path is clunky. Workspace + submodule together is
the cleanest combination.

### Strategy C — published package

Not yet published. To publish privately:

```bash
cd Oyon
npm version patch
npm publish --registry=https://npm.your-org.example/
```

Then in the host:

```bash
npm install oyon
```

GitHub Packages registry works the same way with a `.npmrc` configured
for `@mohsaqr` scope.

### Backend templates

The example Express route, the SQL migration, and an attach checklist
are in [`examples/rohy-backend/`](examples/rohy-backend/). They are
not run automatically — copy them into your host backend and adjust
imports per [`examples/rohy-backend/ATTACH_BACKEND.md`](examples/rohy-backend/ATTACH_BACKEND.md).

Recommended schema and routes are detailed in
[`docs/INTEGRATION_PLAN.md`](docs/INTEGRATION_PLAN.md). The plan
recommends a *new* `emotion_windows` table over extending the host's
existing `emotion_logs` — see §4 of the plan for the reasoning.

### Asset hosting

Oyon ships with two kinds of static assets under `standalone/`:

- `vendor/mediapipe/wasm/*` — MediaPipe WASM runtime (~3 MB).
- `vendor/onnxruntime-web/*` — ONNX Runtime WASM (~10 MB).
- `models/mediapipe/face_landmarker.task` (~11 MB).
- `models/emotion/*.onnx` — selected model weights (15–35 MB each).

In **standalone mode** Vite serves these directly. In **attached
mode** the host needs to serve them under a URL the browser can fetch.
Two ways:

1. **Build-time copy** (recommended). Add a `vite-plugin-static-copy`
   step to the host's Vite config that copies
   `path/to/Oyon/standalone/{vendor,models}` into the host's `public/oyon/`.
   Then point Oyon's runtime options at `/oyon/vendor/...` and
   `/oyon/models/...`.
2. **Runtime mount.** Have the host's Express (or equivalent) serve
   `path/to/Oyon/standalone/` under `/oyon/`. Simpler but couples
   production to the Oyon source-tree layout.

See [`docs/INTEGRATION_PLAN.md`](docs/INTEGRATION_PLAN.md) and the
"Step 4 — Asset path" section of the integration mechanics for
copy-paste examples.

### Feature flag

Oyon expects the host to gate it behind an env flag. The host should
**only** mount Oyon's adapter / hook / route when the flag is on.
Default off. Recommended flag name: `OYON_ENABLED=1`.

The adapter respects an `enabled` parameter on `useRohyFer({ enabled })`,
so wiring this up is one boolean read away from your existing config
mechanism.

### Smoke test

After integration, the smoke check is:

1. Host server starts with `OYON_ENABLED=0`. `/api/sessions/:id/emotions/batch`
   returns 404. Frontend chip/pill is not rendered.
2. Restart with `OYON_ENABLED=1`. The frontend pill appears next to the
   timer in an active case session. Route exists.
3. Click pill → consent → camera permission → capture starts.
4. After ~10 seconds, a row appears in `emotion_windows`.
5. Pause/Resume/Stop work; camera light follows actual capture state.
6. End the session: capture stops and the camera releases.

---

## 3. Removing / uninstalling

**Standalone:**

```bash
rm -rf Oyon
# In your browser DevTools → Application → Local Storage → clear standalone-fer-* keys
```

**Attached (workspace):**

1. Remove the `workspaces` entry that points to Oyon.
2. Delete the `<OyonMount />` line from your host's tree.
3. Delete the `if (process.env.OYON_ENABLED) router.use(emotionRoutes)` line.
4. Delete `server/routes/emotion-routes.js` and `src/components/emotion/`.
5. Run `DROP TABLE emotion_windows;` if the migration was applied.
6. `npm install` to re-link.

That's the full uninstall. Oyon does not write to your host's
existing tables; nothing else needs to be cleaned.

---

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Camera tile is black, but predictions are updating | Two `<video>` elements share the same `MediaStream`; some browsers drop the loser after 3–5 s | Reroute inference through the visible video. The standalone-demo wires this in `startSelectedModel()`. |
| `Camera capture is not available in this browser` error | `getUserMedia` requires a secure context | Serve over HTTPS or use `localhost`/`127.0.0.1`. LAN IPs do not qualify. |
| Models fail to load with 404 | Vendor / model paths point to a URL the browser cannot fetch | Verify `mediaPipe.wasmBaseUrl` and `onnx.wasmPaths` resolve under your host's static path. |
| ONNX session creates but inference returns NaN | Input scale / mean / std mismatch | Check the model config under `src/config/`; values are model-specific. |
| `JS error: Cannot read property '0' of undefined` toast | Empty probabilities object passed to the prediction renderer | Check that the classifier returned non-empty probabilities; look for a thrown ORT error in the console. |

If you hit something not in this table, open a GitHub issue with the
profile, browser, and the toast text.
