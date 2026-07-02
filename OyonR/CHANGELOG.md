# Changelog

## 2.2.0 — 2026-06-29

### Added
- **Host-neutral integration front door** — Oyon now attaches to any host
  (LMS, analytics platform, anything with a session) without Rohy-shaped
  naming: `createOyonAttachment` (`oyon/attach`), the `useOyon` React hook
  (`oyon/react`), and `createOyonAddon` (`oyon/addon`). Unlike the Rohy
  factories, these **preserve arbitrary context keys** (`course_id`,
  `activity_id`, `cohort`, …) on every window instead of squeezing identity
  into four fixed fields — so a host keeps its own join taxonomy. The Rohy
  APIs (`createRohyFerAttachment`, `useRohyFer`, `createRohyOyonAddon`,
  `oyon/adapter`) are now thin **back-compat wrappers**;
  `createOyonAddon({ rohy: true })` selects Rohy's endpoint + session shape
  and the addon exposes a `variant` (`'oyon' | 'rohy'`). New
  `tests/oyon-attach.test.js` and `tests/oyon-addon.test.js` in the gate; a
  host-neutral Next.js recipe (client component + App-Router batch endpoint)
  in `examples/nextjs/`.
- **Compatibility doc** (`docs/COMPATIBILITY.md`): the durable
  supported/out-of-scope-by-construction matrix, browser table,
  secure-context + CSP requirements, gaze-engine licensing, and a
  pre-integration checklist — the honest "where Oyon runs" statement.
  **Documentation index** (`docs/README.md`) maps all docs by goal
  (canonical vs. historical). README gains a "Where it runs" requirements box.
- **Gaze Calibrate button** in the standalone app's camera dock
  (`CalibrateButton`): surfaces the 9-point calibration flow wherever capture
  is live and gaze is enabled (previously only reachable from Settings).
- **Integration manual** (`docs/INTEGRATION_MANUAL.md`): the end-to-end
  guide for adding Oyon to an existing system — mode selection (embed /
  React / headless / addon / CDN), the full window-payload schema, and
  four analytics destinations: local-only IndexedDB, the host's existing
  database (additive 3-table schema with a Postgres DDL translation,
  batch-endpoint contract, idempotency, consent, query examples), a
  separate analytics service (CORS/auth/ownership trade-offs spelled out),
  and event-stream ingestion. Plus assets/CSP, privacy checklist,
  verification steps, and a troubleshooting table. README and
  docs/INTEGRATION.md now point at it.
- **Claude Code agent skill** (`.claude/skills/integrate-oyon/SKILL.md`):
  a playbook that lets a Claude agent perform the integration in a host
  repo — survey the stack, drive the three decisions (mode, data
  destination, signals), implement per mode, and verify against the store
  rather than the UI, with the known pitfalls encoded.
- **Comprehensive test harness** (docs/TESTING.md): three layers — the
  33-suite node chain (now incl. `exports-map.test.js` packaging contract
  and a MediaPipe CDN-pin↔installed-version drift guard in
  `wasm-paths.test.js`), the build/typecheck gates, and a new **Playwright
  E2E suite** (`npm run test:e2e`, ~1 min) that runs real MediaPipe/ONNX
  inference in Chromium against a synthetic canvas face: standalone capture
  journey (identity stamping, IndexedDB persistence, camera release,
  restart = new session), FilterBar scoping over seeded multi-user data +
  session export, and the full `<oyon-app>` embed contract (host history/
  style isolation, late `getToken` auth against a mocked backend,
  session-id coherence, teardown on removal, local-first persistence under
  backend failure). `npm run test:all` runs everything.
  `@playwright/test` added as a dev-only dependency.

## 2.1.0 — 2026-06-11

### Added
- **`<oyon-app>` embeddable element** (`oyon/app-element` subpath +
  `standalone/app/dist-element/oyon-app.element.js`): the full branded Oyon
  app — capture dock, live view, every analytics dashboard, settings — as a
  single custom element. Shadow-DOM isolated (host styles stay out, Oyon
  styles stay in), memory-history router (host URL untouched), one script
  tag + one tag to integrate. Models/WASM load from public CDNs by default
  (no asset step); `asset-base` for self-hosted/CSP setups. Host API:
  `user-id`/`user-label`/`session-id`/`api-base-url`/`page` attributes,
  `getToken` property, `start()`/`stop()` methods, `oyon:window` /
  `oyon:status` composed events. Docs: `docs/EMBEDDING.md`; demo host page:
  `examples/embed-host.html`. Built by `npm run app:build:element`
  (`vite.element.config.ts` — additive; the standalone app build is
  untouched).
- **FilterBar — scope/session/user filtering for all dashboards.** Analyze
  and Sessions views now inherit a shared filter: scope `Current` (live
  session) / `Past` / `All` (aggregated), plus session and user
  multi-selects (user select appears when >1 distinct `user_id` exists).
  Pure filter logic in `standalone/app/src/lib/filterWindows.js`
  (node-tested), store in `filterStore.ts`, composition in
  `useFilteredWindows.ts` (enrich first, filter second — dynamics stay
  computed over the true timeline).
- **Identity capture.** New identity store; the runtime's contextProvider
  reads it live, so `user_id` is stamped per window (was hardcoded
  `'standalone-user'`). Standalone: the Participant pill in the TopBar is
  now editable. Embedded: the `user-id`/`user-label` attributes drive it.
- **Local-first optional sync.** When the element gets `api-base-url`
  (+ `getToken`), windows tee to `HttpEmotionTransport` wrapped in
  `FallbackEmotionTransport` — IndexedDB stays authoritative, remote
  failures never lose windows (`standalone/app/src/lib/syncTransport.ts`).
- Tests: `tests/app-filter-windows.test.js`, `tests/app-tna-pooling.test.js`,
  `tests/app-embed-contracts.test.js` (32-suite chain).

### Changed
- **Sequence/TNA pools per session.** The sequence dashboard builds one
  emotion-state chain per session and pools transition counts (dynajs
  `tna()` over multiple sequences) instead of merging all windows into one
  mega-sequence — aggregating distinct sessions no longer fabricates a
  transition between one session's last state and the next session's first.
  Multi-session transition counts/centralities change accordingly.
- Sessions view respects the FilterBar scope.

### Fixed
- `MEDIAPIPE_TASKS_WASM_CDN` pointed at `@mediapipe/tasks-vision@0.10.22`,
  which was never published as stable (only RCs) — the CDN default 404'd
  for any consumer that relied on it. Now pinned to 0.10.35 (the version
  this repo installs and the element bundles), with a drift-guard test
  asserting the pin matches the installed package.

### Fixed (post-review hardening, same release)
- **Element bundle no longer touches host history at import.** `router.ts`
  constructed a browser-history router at module level, which (inside the
  element bundle's import graph) called `history.replaceState` on the host
  page, monkey-patched `window.history.pushState/replaceState`, and added
  global listeners even when `<oyon-app>` was never mounted. Routers are
  now constructed only inside the entry points (verified live: fresh host
  page keeps `history.state === null` and native push/replaceState).
- **Trailing-slash WASM URL normalized in the library**
  (`MediaPipeFaceTracker.normalizeWasmBaseUrl`): zero-config consumers no
  longer fetch the 400-ing `wasm//vision_wasm_internal.js` (the prior fix
  only covered the app's own call site).
- **`asset-base` now matches the CLI layout** (`{base}/models/mediapipe/
  face_landmarker.task`) and `docs/EMBEDDING.md`'s recipe no longer doubles
  the `oyon/` segment; documented that WebGazer's vendor tree must be
  copied manually (the CLI doesn't produce it).
- **`getToken` is read lazily per request** — setting `el.getToken` after
  the element connects (the documented recipe) now works; previously the
  provider was snapshotted (and discarded) at connect time, silently
  sending unauthenticated sync requests.
- **`session-id` override is coherent**: resolved once at capture start
  into the same id used by stored windows, the `oyon:window` event, and the
  FilterBar's Current scope (previously windows carried the override while
  events/scope used the generated id). Documented as applying at next
  capture start.
- **Removing `<oyon-app>` from the DOM stops capture** (deferred via
  microtask so host re-parenting moves survive); previously the camera
  kept running with no handle left to stop it.
- **Session export matches the displayed row**: exports now use the same
  FilterBar-scoped windows and the same session-id derivation as the list
  (previously raw unfiltered data with a divergent predicate — wrong or
  empty bundles).
- `oyon paths` and the docs now print/reference the live CDN constants
  instead of hardcoded stale pins.
- Shadow stylesheet is parsed once and adopted idempotently (re-parenting
  no longer re-parses or accumulates duplicate sheets); shared
  enrichment/summary caches stop the FilterBar and routes from duplicating
  the full dynamics pass per window batch; `tnaPooling` now derives session
  identity from the same helper the filter layer uses.

## 2.0.0 — 2026-06-10

The **v2 line**: emotion + engagement + screen-point gaze, consolidated on
`main`. The emotion-only line lives on branch `v1` (1.0.0).

### Breaking
- **Default `gaze_engine` is now `'mediapipe'`** (was `'webgazer'`), and
  unknown engine names normalize to `'mediapipe'` (was `'webgazer'`). The
  MediaPipe landmark engine derives gaze from the face tracker the runtime
  already runs — one camera, one FaceMesh lifecycle, no WebGazer
  global-singleton state. WebGazer and WebEyeTrack remain fully supported as
  explicit opt-ins (`gaze_engine: 'webgazer' | 'webeyetrack'`); hosts that
  need calibrated screen-point accuracy should keep opting into WebGazer.
  Motivated by the chatoyon host-integration post-mortem: 2500+ persisted
  windows with emotion + engagement but zero gaze blocks while WebGazer was
  nominally "running".
- **Enabled-but-empty gaze windows now emit honest empty blocks.** When
  `gaze_tracking_enabled` is on and the pipeline is available, in-loop window
  boundaries always attach a `gaze` block — a dry window carries
  `n_points: 0, total_frames: 0, valid_frame_ratio: 0` instead of silently
  omitting the key. Consumers that treated the absence of `gaze` as "gaze
  off" should check `n_points` instead. (The stop()-flush window still omits
  an empty block — no gaze-only noise at shutdown.)
- Gaze windows now carry an engine-accurate `model_version`
  (`mediapipe-landmarks` / `webgazer` / `webeyetrack-0.0.2`) instead of
  always `webeyetrack-0.0.2`.

### Added
- `MediaPipeLandmarkGazeAdapter` (`oyon/gaze/mediapipe-adapter`):
  calibration-free gaze from MediaPipe iris landmarks. Implements the
  standard adapter contract plus `handleFace(face, ts)`, `diagnostics()`
  (`adapterStatus`, `rawFrames`, `validSamples`, `invalidSamples`,
  `lastSampleAt`, `lastError`, `calibrationRuns`), and
  `requiresCalibration: false` (bypasses the runtime's
  `gaze_calibration_required` gate — the capability travels with the
  adapter, so host-injected face-derived adapters work without settings
  coordination). `dispose()` is idempotent and non-terminal: same-instance
  restart (stop → start → gaze flows again) is supported and tested.
- `EmotionRuntime.sampleOnce()` feeds every face-tracker result to any gaze
  adapter exposing `handleFace()` (capability-detected). Single-pipeline
  design: `CameraController → MediaPipeFaceTracker → emotion + engagement + gaze`.
- Structured absence logging: `oyon.gaze.persistent_empty` (warn, after 3
  consecutive empty windows, includes adapter diagnostics) and
  `oyon.gaze.gated_awaiting_calibration` (info, once, when the calibration
  gate suppresses gaze).
- `GazeAggregator.flush(end, meta, { emitEmpty })` — empty buffer can yield
  an honest zero window instead of null.
- `MockFaceTracker` accepts `irisOffsets: { l, r }` (+ `setIrisOffsets()`)
  and then returns a full 478-point landmark array whose geometry makes
  `extractEyeFeatures()` recover exactly those offsets.
- Tests: `tests/mediapipe-gaze-adapter.test.js` (lifecycle, mapping,
  clamping, blink rules, diagnostics, callback-error isolation, mock
  geometry round-trip) and `tests/runtime-mediapipe-gaze.test.js`
  (default-engine e2e without calibration, honest-empty + persistent-empty
  warning, gate logging, same-instance restart).
- Demos: both the vanilla demo and the React app expose the `mediapipe`
  engine in their gaze-engine selectors. The demos keep WebGazer as their
  own explicit default (calibrated screen-point accuracy + persistent
  calibration); the library default is `mediapipe`.

### Also shipped in 2.0.0 — gaze stages 5–8 (previously unreleased)

- Stage 5 of the screen-point gaze pipeline: a default calibration UI so hosts
  that just want to drop Oyon in don't have to render one themselves.
  - `GazeCalibrationDriver` in `src/ui/` — pure-JS state machine that walks
    through the 9-point sequence (configurable). Injected `clickDispatcher` /
    `setTimer` / `clock` keep it testable in Node without a DOM shim.
  - `<oyon-gaze-calibration>` custom element in `src/ui/GazeCalibrationOverlay.js`
    — full-viewport overlay that renders the moving target dot, dispatches
    synthetic `MouseEvent('click')` at each dot's pixel position to drive
    `webeyetrack@0.0.2`'s click-based calibration anchor, and emits
    `calibration:{start,show,capture,progress,complete,aborted}` DOM events.
    Esc aborts cleanly.
  - `GazeCalibrationPanel` in `src/react/` — thin React mirror over the
    custom element. Forwards DOM events as props; exposes `start()` /
    `abort()` via `useImperativeHandle`.
  - New subpath exports: `oyon/ui/gaze-calibration`,
    `oyon/ui/gaze-calibration-driver`, `oyon/react/gaze-calibration`.
  - Main entry re-exports `defineGazeCalibrationOverlay`,
    `GazeCalibrationDriver`, and `DEFAULT_CALIBRATION_POINTS`.
- Tests: `tests/gaze-calibration-overlay.test.js` (9 cases — order /
  click coords / abort / hook-throw / runtime failure surfacing).
- Stage 7 of the screen-point gaze pipeline: combined preview UI and
  React panel surface.
  - `standalone/preview.html` (new) — combined engagement + gaze demo
    with synthetic input. Adds a 'Gaze' panel (3x3 zone heatmap, status
    badges, live moving dot inside a synthetic viewport box) and a
    'Calibrate (overlay demo)' button that runs the Stage 5 overlay
    against the runtime + `MockWebEyeTrackAdapter`. Drives a scripted
    gaze sample per tick via `mockAdapter.emitSample(...)` so gaze
    blocks accompany every engagement window.
  - `standalone/engagement-preview.html` — turned into a meta-refresh
    redirect to `preview.html`; existing bookmarks keep working.
  - `src/react/EmotionCapturePanel.js` — extended with two compact
    subpanels (engagement headline + gaze histogram). Surface is
    additive: consumers not running engagement / gaze see the same
    minimal panel as before. Uses `useRohyFer`'s existing `lastWindow`
    hook, no new React surface.
- Tests: `tests/standalone-preview-data.test.js` (4 cases — locks in
  the preview's data path so a refactor that breaks it catches at
  `npm test` rather than in a browser nobody opens in CI; case D is a
  real-time regression for the runtime fix below).

### Fixed
- `EmotionRuntime` was dropping the gaze window that
  `GazeAggregator.consumeFrame()` returns when wall-clock crosses
  `aggregate_window_ms`. The runtime then called `flush()` at the
  emotion-window boundary, found the buffer empty (already drained by
  the auto-flush), and emitted windows without a `gaze` block. The bug
  hid behind synchronous tests because wall clock barely advances in a
  tight `for` loop — only a `setInterval`-paced consumer (any real-time
  demo, including `standalone/preview.html`) triggered it. Fix:
  `_handleGazeSample()` now captures the auto-flushed window and stashes
  it; the three emission paths (`sampleOnce`, `addMissingSample`,
  `stop`) drain the stash via a new `_consumeGazeWindow(ts)` helper
  before falling back to an explicit `flush()`. Regression covered by
  case D of `tests/standalone-preview-data.test.js`, which uses real
  `setTimeout` to advance wall clock.

### Notes
- The real `WebEyeTrackAdapter.calibrate()` still returns
  `'upstream_calibration_requires_click_events'`; the overlay is the
  workaround that drives the worker via synthetic clicks. When
  `webeyetrack` ships a programmatic calibration API, the adapter can be
  simplified and the overlay can become optional rather than required.

## 0.4.0 — 2026-05-13

Opt-in screen-point gaze pipeline. When enabled and the user has calibrated,
each aggregate window payload gains a `gaze` block describing where on the
screen the user looked during the window — as aggregate statistics
(centroid, dispersion, zone proportions, AOI dwell), never raw points.

### Added
- Screen-point gaze pipeline (opt-in via `gaze_tracking_enabled` setting).
  - `WebEyeTrackAdapter` in `src/inference/` wrapping the optional peer
    `webeyetrack@^0.0.2` (MIT, Vanderbilt + Trinity + St. Mary's, 2025;
    arXiv:2508.19544). Lazy-imports the dep at `init()` so it remains
    truly optional.
  - `MockWebEyeTrackAdapter` in `src/mocks/` implementing the full
    adapter contract for tests, demos, and runtime smoke checks.
  - `GazeSmoother` in `src/smoothing/` — EWMA on (x, y) with a quality
    gate; below-threshold or blink samples pass through with
    `smoothed: false` and do not advance state.
  - `GazeAggregator` in `src/aggregation/` — window roll-up emitting
    `{ n_points, centroid, dispersion, zone_proportions (3x3 named or
    NxN indexed), aoi_dwell_ms, calibration_age_ms, calibration_quality,
    valid_frame_ratio, off_screen_ratio, model_version }`. Scalar-only
    buffer, no upstream object references retained.
  - `EmotionRuntime` wiring: adapter callback → smoother → aggregator;
    force-flush at the emotion window boundary so all blocks describe
    the same window. New `runtime.calibrateGaze(points)` programmatic
    API; new status events `gaze:calibrating`, `gaze:calibrated`,
    `gaze:calibration_failed`; new logs/metrics
    (`oyon.gaze.window`, `oyon.gaze.calibration_quality`,
    `oyon.gaze.dispersion`).
  - New subpath exports `oyon/gaze` → `GazeAggregator` and
    `oyon/gaze/adapter` → `WebEyeTrackAdapter` (types from
    `types/gaze.d.ts`).
  - Main entry re-exports `GazeSmoother`, `GazeAggregator`,
    `WebEyeTrackAdapter`, and `normalizeGazeResult`.
- Eight new settings (all default-off / opt-in):
  `gaze_tracking_enabled`, `gaze_window_share`,
  `gaze_calibration_required`, `gaze_min_calibration_samples`,
  `gaze_min_quality_score`, `gaze_zone_grid`, `gaze_aois` (validated
  rectangles, max 32), `gaze_drop_off_screen`. Toggling
  `gaze_tracking_enabled` changes `settings_hash`.
- Validator (`oyon/validation`):
  - New `validateGazeBlock` enforcing the aggregate-only contract.
  - Top-level deny `gaze_points_raw` (already in 0.3.0); inside the
    `gaze` block adds explicit denies for `gaze_raw`, `gaze_trace`,
    `points`, `points_raw`, `eye_patch`, `eye_image`.
  - Naming-convention deny for any `gaze.*_array|*_trace|*_raw` key.
  - Array length cap (≤100) inside `gaze` as defense in depth.
  - Validates centroid range `[-0.6, 0.6]`, zone-proportion keys (all
    3x3 named or all `r<n>c<n>`), AOI dwell shape, ratio fields.
- Optional peer dep: `webeyetrack` (`peerDependenciesMeta.webeyetrack.optional`).
- `docs/SCREEN_POINT_GAZE.md` — reference doc covering payload, settings,
  privacy invariants, AOI configuration, calibration, host integration,
  known limitations, and "bring your own adapter" extension path.

### Compatibility
- Default-off invariant: `gaze_tracking_enabled: false` (the default) is
  byte-equivalent to v0.3.0 window output. No required changes for
  existing consumers.

### Tests
- 20 suites pass (added `web-eye-track-adapter`, `gaze-smoother`,
  `gaze-aggregator`, `runtime-gaze`; extended `validation` and `settings`).

## 0.3.0 — 2026-05-13

Opt-in eye-tracking pipeline. Per-window engagement metrics (blink rate, eye
openness, head-pose-normalized gaze entropy, gaze zone proportions, derived
focus score) alongside the existing affect signals.

### Added
- Eye tracking pipeline (opt-in via `eye_tracking_enabled` setting).
  - `EyeFeatureExtractor`, `EyeSmoother`, `EngagementAggregator` in
    `src/inference/`, `src/smoothing/`, `src/aggregation/`.
  - New subpath export `oyon/engagement` resolving to
    `src/aggregation/EngagementAggregator.js` (types from
    `types/engagement.d.ts`).
  - Main entry re-exports `extractEyeFeatures`,
    `normalizeIrisByHeadPose`, `classifyGazeZone`, `EyeSmoother`, and
    `EngagementAggregator` for hosts that import from `oyon` directly.
  - Per-window `engagement` block carrying blink rate, eye openness
    (mean + std), head-pose-normalized gaze entropy, gaze zone
    proportions, and a weighted focus score. The composite score's
    component values are emitted alongside it.
  - MediaPipe blendshapes + facial transformation matrix surfaced on
    the tracker result (always; cost is negligible).
- Settings: `eye_tracking_enabled`, `blink_mask_threshold`,
  `gaze_zone_neutral_deg`, `engagement_window_share`,
  `blink_rate_baseline_hz`, `gaze_entropy_grid_n`,
  `focus_score_weights`.
- Validator: rejects `iris_landmarks_raw`, `gaze_points_raw`,
  `pupil_diameter_px`, and any key starting with `eye_image_` — both
  at the top of an event and inside the `engagement` sub-object.
- TypeScript declarations: `types/engagement.d.ts` (new) and
  re-exports from `types/index.d.ts`. `EmotionWindow.engagement` is
  now typed as optional.
- Docs: `docs/EYE_TRACKING.md` covering pipeline, metric formulas,
  head-pose normalization, blink masking, settings, and limitations.
- Example backend: server-side validator stub in
  `examples/rohy-backend/emotion-routes.template.js` mirrors the new
  client deny-list.
- Example addon migration: optional `engagement_metrics JSONB`
  column appended to `examples/rohy-addon/001_oyon_addon.sql`.

### Notes
- `eye_tracking_enabled` defaults to `false`. Existing v0.2.2
  consumers see no behavior or payload change.
- Hosts that persist windows server-side may want a JSON column for
  the new `engagement` field; the column type, retention policy, and
  indexing are the host's choice. Oyon does not prescribe a schema.

## 0.2.2 — 2026-05-09

Self-hosted asset URLs available as opt-in alongside public CDN defaults.

### Added
- `assets-v1` GitHub Release on `mohsaqr/Oyon` mirrors all 17 runtime
  asset files (WASM bundles + ONNX model weights, ~163 MB total).
- New exports from the main entry: `SELF_HOSTED_ONNX_RUNTIME_WASM`,
  `SELF_HOSTED_MEDIAPIPE_TASKS_WASM`,
  `SELF_HOSTED_MEDIAPIPE_FACE_LANDMARKER_URL`,
  `SELF_HOSTED_EMOTION_MODEL_*_URL`,
  `SELF_HOSTED_DEFAULT_EMOTION_MODEL_URL`, and `SELF_HOSTED_DEFAULTS`
  (frozen object holding the full set). Hosts pass these explicitly to
  swap from public CDNs to the self-hosted release.
- `OYON_ASSETS_BASE` env var lets `npx oyon download-models` pull from
  any base URL, including the self-hosted release once available.

### Unchanged
- Default `cdnDefaults.js` URLs still point at the public CDNs
  (jsDelivr / Google Storage / raw.githubusercontent). The repo is
  currently private, so release-asset URLs require auth — flipping
  the default to self-hosted requires the repo to be public first.

### Why "keep both"
- Public CDNs work today, zero-config, no auth.
- Self-hosted release is ready for the day the repo flips to public —
  at that point switching the runtime default is a one-line change in
  `cdnDefaults.js` (or hosts can opt in already by passing
  `SELF_HOSTED_DEFAULTS` to `EmotionRuntime`).
- GitHub Releases bandwidth is unlimited and free, unlike Git LFS
  (1 GB/mo on the free tier).

### Asset release strategy
- The asset tag (`assets-vN`) is bumped only when underlying WASM or
  model versions change, NOT on every code release.

## 0.2.1 — 2026-05-09

Zero-config defaults — `npm install oyon` is now sufficient to run.

### Added
- `src/config/cdnDefaults.js` — single source of truth for fallback CDN
  URLs (jsDelivr for WASM, Google Storage for MediaPipe model, GitHub raw
  for emotion models). Exported from the main entry as
  `ONNX_RUNTIME_WASM_CDN`, `MEDIAPIPE_TASKS_WASM_CDN`,
  `MEDIAPIPE_FACE_LANDMARKER_URL`, `DEFAULT_EMOTION_MODEL_URL`, etc.

### Changed
- `MediaPipeFaceTracker` defaults `wasmBaseUrl` and `modelAssetPath` to
  CDN URLs instead of `'/models/mediapipe/...'`.
- `OnnxEmotionClassifier` defaults `wasmPaths` and `modelUrl` to CDN
  URLs; default labels and indices now match the HSE B0 8-class MTL
  model (was a stale 7-class FER list pointing at a non-existent path).
- All four model config files (`HSE_*`, `EMOTIEFF_MOBILEVIT_*`,
  `EMOTIEFF_MBF_*`) now reference the CDN constants instead of
  `/standalone/models/...` repo-relative paths.

### Migration
- Hosts that already self-host assets and pass explicit `wasmBaseUrl` /
  `modelUrl` options are unaffected.
- Hosts that relied on the (broken) default `'/models/emotion/fer.onnx'`
  path now get a real working model on first start.
- For CSP-restricted hosts that need to block third-party CDNs:
  `npx oyon install-assets ./public && npx oyon download-models ./public`,
  then pass `mediaPipe.wasmBaseUrl: '/oyon/vendor/mediapipe/wasm/'` etc.

## 0.2.0 — 2026-05-09

Packaging release — Oyon is now consumable as a published npm package.

### Added
- **Distributable build** via Rollup: `dist/oyon.esm.js` (single-file ESM,
  ~70 KB), `dist/oyon.umd.js` and `dist/oyon.umd.min.js` (~42 KB minified)
  for `<script>`-tag CDN use. Source maps included.
- **TypeScript declarations** under `types/` for every subpath export,
  enabling IntelliSense and module resolution from TS hosts.
- **CLI** (`npx oyon …`): `install-assets <dir>` copies MediaPipe + ONNX
  Runtime WASM from peer-installed `node_modules/` into the host's public
  dir; `download-models <dir>` fetches model weights from upstream;
  `paths` prints resolved peer-dep asset locations.
- **CDN example** at `examples/cdn/index.html` showing UMD + jsDelivr
  consumption with no build step.
- **Conditional `exports`** map: each subpath now resolves `types`,
  `import`, and `default` properly across Node, bundlers, and TS.
- **GitHub Action** at `.github/workflows/publish.yml` — tag-triggered
  publish with provenance and `prepublishOnly` gates (check + tests +
  build).
- **`/bundle` subpath** export that points at the single-file ESM build,
  for environments that can't follow the multi-file source tree.
- `unpkg` and `jsdelivr` package manifest fields for CDN auto-routing.

### Changed
- `package.json` — removed `private: true`; added `module`, `types`,
  `unpkg`, `jsdelivr`, `bin`, `sideEffects`, `engines`, `homepage`,
  `bugs`, `publishConfig`. React peer dep relaxed from `^19` to `>=18`.
- `files` array trimmed: `standalone/`, `mock/`, `tests/`, `docs/`, and
  `examples/` no longer ship in the npm tarball. Tarball drops from
  ~157 MB → 170 KB compressed (760 KB unpacked).
- Added `.npmignore` as belt-and-suspenders against accidental publishes
  of the asset tree.

### Migration
- Hosts using the workspace install today don't need to change anything;
  imports remain `import { useRohyFer } from 'oyon/react'`.
- Hosts that were copying `standalone/vendor/*` should switch to either
  `npx oyon install-assets ./public` (copies from peer deps) or point
  Oyon's runtime at the jsDelivr CDN URLs.

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
