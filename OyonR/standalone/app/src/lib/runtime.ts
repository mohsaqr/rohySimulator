/*
 * useStandaloneRuntime — React hook that constructs and drives an
 * `EmotionRuntime` for the new app shell. This is the Phase B port of the
 * imperative `createRuntime()` at standalone/standalone-demo.js:541.
 *
 * Boundaries enforced:
 *   - The runtime is created once per hook instance and re-used across
 *     start/stop cycles. We never re-construct it on React re-render —
 *     the camera permission prompt would re-trigger.
 *   - Status, error, and the latest window are mirrored into React state
 *     via runtime events. The hook never reads them imperatively.
 *   - Cleanup on unmount calls `runtime.stop()` so a hot-reload doesn't
 *     leak a live camera track.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CameraController,
  EmotionAggregator,
  EmotionRuntime,
  LocalEmotionTransport,
  LocalLogTransport,
  LocalMetricTransport,
  MEDIAPIPE_FACE_LANDMARKER_URL,
  MEDIAPIPE_TASKS_WASM_CDN,
  MediaPipeFaceTracker,
  OnnxEmotionClassifier,
  OyonLogger,
  OyonMetricRecorder,
  createGazeAdapter,
  createOyonSettings,
  type EmotionWindow,
  type GazeEngine,
  type OyonSettings,
  type WebEyeTrackAdapter,
  type WebGazerAdapter,
} from 'oyon';
import { DEFAULT_MODEL_PROFILE, MODEL_PROFILES, type ModelProfileId } from './modelProfiles';
import { IdbEmotionTransport } from './idbTransport';
import { DualWriteTransport } from './dualWriteTransport';
import { snapshotSettings, useSettings, type EditableSettings } from './settingsStore';
import { useIdentity, DEFAULT_USER_ID } from './identityStore';
import { useBridgeStore, type HostBridgeStore } from './hostBridge';
import { TeeTransport, createRemoteLeg } from './syncTransport';
import { normalizeEmotionWindows } from './windowTime';

/*
 * Coerce any value to a valid ModelProfileId. Persisted settings can carry a
 * stale/unknown model_profile (old build, hand-edited storage, a future
 * rename, or a migrated record). MODEL_PROFILES[bad] is undefined, and the
 * unguarded `.label`/`.config` reads then crash the whole RuntimeProvider.
 * Fall back to the default instead of taking the app down.
 */
function safeModelProfile(id: unknown): ModelProfileId {
  return typeof id === 'string' && id in MODEL_PROFILES
    ? (id as ModelProfileId)
    : DEFAULT_MODEL_PROFILE;
}

/*
 * Instance-aware identity source. The capture session id / user id / label are
 * PER-INSTANCE in embed mode: the <oyon-app> element writes its `user-id` /
 * `user-label` / `session-id` attributes into THIS element's bridge store
 * (hostBridge identity fields), so a coexisting chrome="none" viewer (which has
 * no session-id) can never clobber the capture instance's sessionIdOverride and
 * mis-attribute capture to a generated standalone-* session.
 *
 *   embedded  → read identity from this instance's bridge store.
 *   standalone (no <oyon-app> ⇒ bridge.embedded === false) → read the module
 *               useIdentity store, exactly as before (TopBar Participant pill).
 *
 * userId never resolves null: an embedded element always seeds DEFAULT_USER_ID
 * via applyIdentityAttributes, but we coalesce here as a belt-and-braces guard.
 */
function resolveIdentity(bridgeStore: HostBridgeStore): {
  userId: string;
  userLabel: string | null;
  sessionIdOverride: string | null;
} {
  const b = bridgeStore.getState();
  if (b.embedded) {
    return {
      userId: b.userId ?? DEFAULT_USER_ID,
      userLabel: b.userLabel,
      sessionIdOverride: b.sessionIdOverride,
    };
  }
  const id = useIdentity.getState();
  return {
    userId: id.userId,
    userLabel: id.userLabel,
    sessionIdOverride: id.sessionIdOverride,
  };
}

/*
 * WebEyeTrack's WebcamClient(videoElementId) owns its OWN <video> + camera
 * stream by DOM id (it does not consume the runtime's CameraController
 * stream the way WebGazer does). The element must exist in the DOM before
 * the adapter init()s, so RuntimeProvider renders a hidden, always-mounted
 * <video> with this id. Without a videoElementId the adapter throws
 * "WebEyeTrackAdapter: videoElementId is required." on construction.
 */
export const GAZE_VIDEO_ELEMENT_ID = 'oyon-gaze-video';

export type RuntimeStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'starting-camera'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface UseStandaloneRuntimeOptions {
  modelProfile?: ModelProfileId;
  /** Default gaze engine. WebGazer is the project preference (memory:
   *  feedback_webgazer_default) — accuracy beats license posture for our
   *  niche; the GPL implication is documented in NOTICE.md. */
  gazeEngine?: GazeEngine;
  /** When provided, the hook will mirror the camera's MediaStream into this
   *  element after `start()` resolves so a visible preview is shown. */
  videoRef?: { current: HTMLVideoElement | null };
}

export interface FaceBox {
  /** Normalized [0,1] bbox in MediaPipe convention. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceSampleSnapshot {
  facePresent: boolean;
  bbox: FaceBox | null;
  reason?: string;
}

export interface PredictionSnapshot {
  /** Per-sample top label and probabilities. Surfaces at ~1Hz so /live
   *  shows emotion updates without waiting for the 10-second window. */
  label: string;
  probabilities: Record<string, number>;
  confidence: number;
  ts: number;
}

export interface GazeSnapshot {
  /** Normalized [-0.5, 0.5] coords from the gaze adapter — origin at
   *  screen center, +X right, +Y down. Mirrors the WebEyeTrack convention. */
  x: number;
  y: number;
  /** Adapter-reported quality in [0, 1]. */
  quality: number;
  /** Adapter-reported 'idle' | 'inference' | 'calib' | etc. */
  state?: string;
  ts: number;
}

export interface EyeSampleSnapshot {
  valid: boolean;
  smoothed: boolean;
  blinkLeft: boolean;
  blinkRight: boolean;
  eyeOpennessMean: number | null;
  gazeZone: string | null;
  ts: number;
}

export interface UseStandaloneRuntimeResult {
  status: RuntimeStatus;
  error: unknown;
  lastWindow: EmotionWindow | null;
  /** Most recent per-frame face sample — drives the live face-overlay
   *  canvas on the camera preview. */
  lastFace: FaceSampleSnapshot | null;
  /** Most recent per-sample prediction — drives the live emotion display
   *  at ~1Hz so /live doesn't have to wait 10s for a window. */
  lastPrediction: PredictionSnapshot | null;
  /** Most recent privacy-safe eye/engagement sample from the face stream. */
  lastEye: EyeSampleSnapshot | null;
  /** Most recent gaze sample from the active adapter — drives the floating
   *  gaze dot. Null before the adapter emits its first sample. */
  lastGaze: GazeSnapshot | null;
  eyeSampleCount: number;
  gazeSampleCount: number;
  /** Rolling buffer of the most recent windows (newest at the end). Capped
   *  at RECENT_WINDOW_CAP so memory stays bounded for long sessions. */
  recentWindows: EmotionWindow[];
  windowCount: number;
  settings: OyonSettings;
  modelLabel: string;
  modelHint: string;
  gazeEngine: GazeEngine;
  /** The active gaze adapter — exposed so /calibrate can call `calibrate()`
   *  imperatively after the user clicks Calibrate. `null` before start(). */
  gazeAdapter: WebEyeTrackAdapter | WebGazerAdapter | null;
  /** True while a synthetic gaze stream is driving `lastGaze` (no camera /
   *  WebGazer / calibration). Demo affordance for /live so the gaze dot is
   *  visible offline — see setMockGaze. */
  mockGaze: boolean;
  /** Start/stop the synthetic gaze stream. Feeds the exact same state the
   *  real adapter feeds, so the floating dot + tile light up identically. */
  setMockGaze: (on: boolean) => void;
  /** Gaze-adapter health after start(). status is the adapter's own state
   *  ('inference' = streaming, 'error' = failed, etc.); error is a human
   *  message when init/start failed. Null before start(). Surfaces the
   *  failure EmotionRuntime otherwise swallows. */
  gazeDiag: { status: string | null; error: string | null } | null;
  /** The live EmotionRuntime instance, or null before first start. The
   *  GazeCalibrationPanel needs this to drive `calibrateGaze()`. */
  runtime: EmotionRuntime | null;
  /** Live MediaStream — populated after start(), null after stop(). Both
   *  the main CameraPreview and the floating MiniCamera read this to
   *  bind their <video> elements imperatively. */
  cameraStream: MediaStream | null;
  sessionId: string | null;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
}

const RECENT_WINDOW_CAP = 60;

/*
 * Asset paths, resolved by delivery mode:
 *   - standalone (default): origin-relative `/standalone/...` paths served by
 *     the dev server (vite.config.ts middleware) or the standalone deploy.
 *   - embedded with `asset-base`: the host self-hosts the
 *     `npx oyon install-assets` layout under that root.
 *   - embedded without `asset-base`: the library's public CDN defaults —
 *     zero asset steps for the host.
 */
const MEDIAPIPE_WASM = '/standalone/vendor/mediapipe/wasm';
const MEDIAPIPE_MODEL = '/standalone/models/mediapipe/face_landmarker.task';
const WEBGAZER_FACE_MESH = '/standalone/vendor/webgazer/face_mesh';

function resolveAssetPaths(bridgeStore: HostBridgeStore) {
  const bridge = bridgeStore.getState();
  if (bridge.assetBase) {
    // Matches the layout `npx oyon install-assets <dir>` + `npx oyon
    // download-models <dir>` produce under `<dir>/oyon/` (bin/oyon.js):
    //   vendor/mediapipe/wasm/*, models/mediapipe/face_landmarker.task.
    // asset-base points at that `oyon` directory (e.g. "/oyon").
    // vendor/webgazer/face_mesh is NOT produced by the CLI — hosts opting
    // into the webgazer engine copy standalone/vendor/webgazer there
    // manually (documented in docs/EMBEDDING.md).
    const base = bridge.assetBase.replace(/\/$/, '');
    return {
      mediapipeWasm: `${base}/vendor/mediapipe/wasm`,
      mediapipeModel: `${base}/models/mediapipe/face_landmarker.task`,
      webgazerFaceMesh: `${base}/vendor/webgazer/face_mesh`,
      // Air-gapped hosts (asset-base set) must never touch a CDN: also
      // redirect the ONNX runtime WASM and the emotion model weights to the
      // same self-hosted layout (`vendor/onnxruntime-web/`,
      // `models/emotion/<file>.onnx` — what `npx oyon download-models`
      // produces and what standalone/ ships). null ⇒ keep the model
      // profile's own (CDN) defaults.
      onnxWasm: `${base}/vendor/onnxruntime-web/`,
      emotionModelDir: `${base}/models/emotion`,
    };
  }
  if (bridge.embedded) {
    return {
      // Trailing-slash normalization happens inside MediaPipeFaceTracker
      // (normalizeWasmBaseUrl) — pass the constants through untouched.
      mediapipeWasm: MEDIAPIPE_TASKS_WASM_CDN,
      mediapipeModel: MEDIAPIPE_FACE_LANDMARKER_URL,
      // No CDN mirror for WebGazer's legacy face-mesh tree; embedded WebGazer
      // requires `asset-base` (documented in docs/EMBEDDING.md). The default
      // mediapipe gaze engine needs nothing.
      webgazerFaceMesh: WEBGAZER_FACE_MESH,
      onnxWasm: null,
      emotionModelDir: null,
    };
  }
  return {
    mediapipeWasm: MEDIAPIPE_WASM,
    mediapipeModel: MEDIAPIPE_MODEL,
    webgazerFaceMesh: WEBGAZER_FACE_MESH,
    onnxWasm: null,
    emotionModelDir: null,
  };
}

/**
 * Merge a host-supplied settings override (the <oyon-app> `settings` JSON
 * attribute) into a start-time settings snapshot. Deliberately conservative:
 * only keys that already exist on EditableSettings are considered, and each
 * value must match the snapshot's type for that key (number/string/boolean).
 * Everything else is ignored — a host can therefore only retune known knobs,
 * never inject new ones. Enum-ish strings (model_profile, gaze_engine) are
 * range-checked downstream exactly like persisted-store values
 * (safeModelProfile, GazeAdapterFactory normalization).
 */
function applySettingsOverride(
  editable: EditableSettings,
  override: Record<string, unknown> | null,
): void {
  if (!override) return;
  const target = editable as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (!(key in target)) continue;
    const current = target[key];
    if (typeof value !== typeof current) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    target[key] = value;
  }
}

interface BuildArgs {
  editable: EditableSettings;
  camera: CameraController;
  transport: LocalEmotionTransport | DualWriteTransport | TeeTransport;
  logTransport: LocalLogTransport;
  metricTransport: LocalMetricTransport;
  contextProvider: () => Record<string, unknown>;
  /** The owning element's per-instance bridge store — drives asset resolution
   *  (assetBase / embedded) from THIS instance's state, not the module store. */
  bridgeStore: HostBridgeStore;
}

function buildRuntime({
  editable,
  camera,
  transport,
  logTransport,
  metricTransport,
  contextProvider,
  bridgeStore,
}: BuildArgs): {
  runtime: EmotionRuntime;
  settings: OyonSettings;
  gazeAdapter: WebEyeTrackAdapter | WebGazerAdapter;
} {
  const profile = MODEL_PROFILES[safeModelProfile(editable.model_profile)];
  const assets = resolveAssetPaths(bridgeStore);
  const classifierConfig = { ...(profile.config as Record<string, unknown>) };
  if (assets.onnxWasm) classifierConfig.wasmPaths = assets.onnxWasm;
  if (assets.emotionModelDir && typeof classifierConfig.modelUrl === 'string') {
    // Keep the profile's weight file, re-rooted under the host's asset tree.
    const file = classifierConfig.modelUrl.split('/').pop();
    if (file) classifierConfig.modelUrl = `${assets.emotionModelDir}/${file}`;
  }
  const classifier = new OnnxEmotionClassifier(classifierConfig);

  const settings = createOyonSettings({
    profile_id: 'learning-analytics',
    model_profile: editable.model_profile,
    sample_interval_ms: editable.sample_interval_ms,
    aggregate_window_ms: editable.aggregate_window_ms,
    min_valid_frames: editable.min_valid_frames,
    smoothing_alpha: editable.smoothing_alpha,
    min_hold_ms: editable.min_hold_ms,
    switch_confidence: editable.switch_confidence,
    logging_mode: 'windows-and-runtime',
    enable_dynamics: true,
    eye_tracking_enabled: editable.eye_tracking_enabled,
    gaze_tracking_enabled: editable.gaze_tracking_enabled,
    gaze_engine: editable.gaze_engine,
    gaze_calibration_required: editable.gaze_calibration_required,
    gaze_zone_grid: editable.gaze_zone_grid,
    gaze_min_quality_score: editable.gaze_min_quality_score,
    // Host-supplied AOIs (el.setGazeAois BEFORE start) win over the persisted
    // setting; live updates while running go through controls.setGazeAois.
    gaze_aois: bridgeStore.getState().gazeAois ?? undefined,
  });
  const classifierLabels = (profile.config as { labels?: unknown }).labels;
  const aggregatorOptions: ConstructorParameters<typeof EmotionAggregator>[0] = {
    windowMs: settings.aggregate_window_ms,
    minValidFrames: settings.min_valid_frames,
    sampleIntervalMs: settings.sample_interval_ms,
  };
  if (Array.isArray(classifierLabels)) {
    aggregatorOptions.labels = classifierLabels.filter(
      (label): label is string => typeof label === 'string' && label.trim().length > 0,
    );
  }

  // WebGazer / WebEyeTrack adapter — mirrors the legacy demo's wiring at
  // standalone-demo.js:499–535. The CRITICAL settings:
  //   - stream: () => camera.stream
  //       WebGazer otherwise opens its own getUserMedia(), which conflicts
  //       with the runtime's CameraController and the init promise hangs
  //       forever — that's the "stuck at starting-camera" bug.
  //   - faceMeshSolutionPath: '/standalone/vendor/webgazer/face_mesh'
  //       WebGazer fetches MediaPipe FaceMesh JSON/binary from this path;
  //       without it, requests hit a 404 fallback.
  //   - viewport: () => ({ width, height })
  //       For pixel→normalized math on resize.
  const cam = camera as unknown as { stream: MediaStream | null };
  const gazeAdapter = createGazeAdapter({
    engine: editable.gaze_engine,
    // WebEyeTrack needs this; WebGazer ignores it and
    // uses the runtime stream below instead.
    videoElementId: GAZE_VIDEO_ELEMENT_ID,
    onGaze: () => {
      /* runtime installs its own onGaze on top; this is a placeholder */
    },
    onError: (err: unknown) => {
      console.warn('[gaze adapter]', err);
    },
    minQualityScore: editable.gaze_min_quality_score,
    webgazer: {
      showVideoPreview: false,
      showFaceOverlay: false,
      showFaceFeedbackBox: false,
      showPredictionPoints: false,
      // Persist WebGazer's trained regression model to localStorage so
      // calibration survives reloads and new sessions. This is the whole
      // reason WebGazer is the preferred engine here — WebEyeTrack has no
      // persistable calibration. Consented research context: persisting the
      // user's own calibration locally is expected and wanted.
      saveDataAcrossSessions: true,
      regression: 'ridge',
      faceMeshSolutionPath: assets.webgazerFaceMesh,
      viewport: () => ({
        width: window.innerWidth || document.documentElement.clientWidth || 1,
        height: window.innerHeight || document.documentElement.clientHeight || 1,
      }),
      stream: () => cam.stream,
    },
  });

  // `gazeAdapter` is accepted at runtime — see standalone-demo.js line ~568
  // for the same pattern. The hand-written .d.ts doesn't yet declare it on
  // EmotionRuntimeOptions, so we cast the options object once below.
  const runtimeOptions = {
    sampleIntervalMs: settings.sample_interval_ms,
    consentVersion: 'standalone-app-v1',
    settings,
    faceTracker: new MediaPipeFaceTracker({
      wasmBaseUrl: assets.mediapipeWasm,
      modelAssetPath: assets.mediapipeModel,
    }),
    classifier,
    aggregator: new EmotionAggregator(aggregatorOptions),
    transport,
    logger: new OyonLogger({
      transports: [logTransport],
      contextProvider,
    }),
    metrics: new OyonMetricRecorder({
      transports: [metricTransport],
      contextProvider,
    }),
    camera,
    contextProvider,
    gazeAdapter,
  };
  const runtime = new EmotionRuntime(
    runtimeOptions as unknown as ConstructorParameters<typeof EmotionRuntime>[0],
  );

  return { runtime, settings, gazeAdapter };
}

/*
 * Viewer STUB — chrome="none" embed mode (host-fed windows, no capture).
 *
 * A pure analytics viewer must construct ZERO capture machinery: no
 * classifier, no CameraController, and crucially NO gaze adapter. The
 * default gaze engine is WebGazer, whose constructor pops a browser alert
 * on plain-HTTP pages — so even merely *building* the adapter at mount is a
 * visible defect for a viewer-only embed. This stub returns inert values
 * satisfying UseStandaloneRuntimeResult so the /settings and
 * /analyze/comparison `useRuntime()` consumers (and RuntimeProvider's
 * session-context bridge) keep working, while `createGazeAdapter` /
 * `getUserMedia` / WebGazer are never reached.
 *
 * It calls a FIXED set of hooks (useState + useMemo only) every render, so
 * delegating to it from useStandaloneRuntime cannot trip React's
 * rules-of-hooks: `chromeless` is set once at element mount and never
 * changes for an element instance's lifetime, so the branch taken in
 * useStandaloneRuntime is stable across that instance's renders.
 */
function useViewerStubRuntime(
  opts: UseStandaloneRuntimeOptions = {},
): UseStandaloneRuntimeResult {
  const editableAtConstruct = useSettings.getState();
  const modelProfile = safeModelProfile(
    opts.modelProfile ?? editableAtConstruct.model_profile,
  );
  const profileMeta = MODEL_PROFILES[modelProfile];
  const gazeEngine: GazeEngine =
    opts.gazeEngine ?? (editableAtConstruct.gaze_engine as GazeEngine);

  // mockGaze state is kept so setMockGaze is a real setter (inert: no
  // interval is ever started here, so it never produces samples).
  const [mockGaze, setMockGaze] = useState(false);

  // createOyonSettings is a pure config object builder — it touches no
  // camera/gaze/classifier machinery — so it is safe in the viewer.
  const settings = useMemo<OyonSettings>(
    () => createOyonSettings({ model_profile: modelProfile }),
    [modelProfile],
  );

  const noop = useMemo(
    () => ({
      start: async () => {
        console.warn('[oyon] chrome="none" viewer mode: start() is a no-op (no capture).');
      },
      stop: async () => {
        /* no capture to stop */
      },
      pause: () => {},
      resume: () => {},
      setMockGaze,
    }),
    [],
  );

  return {
    status: 'idle',
    error: null,
    lastWindow: null,
    lastFace: null,
    lastPrediction: null,
    lastEye: null,
    lastGaze: null,
    eyeSampleCount: 0,
    gazeSampleCount: 0,
    recentWindows: [],
    windowCount: 0,
    settings,
    modelLabel: profileMeta.label,
    modelHint: profileMeta.hint,
    gazeEngine,
    gazeAdapter: null,
    mockGaze,
    setMockGaze: noop.setMockGaze,
    gazeDiag: null,
    runtime: null,
    cameraStream: null,
    sessionId: null,
    start: noop.start,
    pause: noop.pause,
    resume: noop.resume,
    stop: noop.stop,
  };
}

export function useStandaloneRuntime(
  opts: UseStandaloneRuntimeOptions = {},
): UseStandaloneRuntimeResult {
  // chrome="none" embed: pure analytics viewer. Read the flag ONCE from THIS
  // instance's per-element bridge store and delegate to the stub, which
  // constructs NO capture machinery (no classifier, no camera, no gaze adapter
  // → no WebGazer alert). The flag is set at element mount and never changes
  // for this instance, so this branch is stable across renders and does not
  // violate rules-of-hooks. Reading the per-instance store (not the shared
  // module store) is what lets a viewer instance get the stub while a sibling
  // capture instance independently gets the real runtime.
  const bridgeStore = useBridgeStore();
  if (bridgeStore.getState().chromeless) {
    return useViewerStubRuntime(opts);
  }
  return useRealRuntime(opts);
}

function useRealRuntime(
  opts: UseStandaloneRuntimeOptions = {},
): UseStandaloneRuntimeResult {
  // THIS instance's own bridge store. Everything below that touches the bridge
  // (asset/api resolution, host-event dispatch, control registration) reads it
  // — so a capture instance and a viewer instance never clobber each other and
  // every host event fires on the OWNING element. Standalone (no provider) this
  // resolves to the default module store → unchanged behavior.
  const bridgeStore = useBridgeStore();
  // Dispatch a host DOM event via THIS instance's emitHostEvent (no-op
  // standalone / when the element didn't wire one up). Replaces the module-level
  // emitHostEvent helper so events reach the owning element, not a shared one.
  const emitHostEvent = useCallback(
    (type: string, detail: unknown): void => {
      bridgeStore.getState().emitHostEvent?.(type, detail);
    },
    [bridgeStore],
  );
  // Pull the *current* editable settings, but only when the runtime is
  // constructed — live edits do not hot-restart capture (per memory
  // feedback_no_auto_reload). The Settings page shows a "Restart capture
  // to apply" banner when state diverges.
  const editableAtConstruct = useSettings.getState();
  const modelProfile = safeModelProfile(
    opts.modelProfile ?? editableAtConstruct.model_profile,
  );
  const profileMeta = MODEL_PROFILES[modelProfile];
  // Precedence: explicit hook opts (tests) > host <oyon-app gaze-engine>
  // attribute (per-instance, never persisted) > the user's settings store.
  const gazeEngine: GazeEngine =
    opts.gazeEngine ??
    (bridgeStore.getState().gazeEngineOverride as GazeEngine | null) ??
    (editableAtConstruct.gaze_engine as GazeEngine);

  const [status, setStatus] = useState<RuntimeStatus>('idle');
  const [error, setError] = useState<unknown>(null);
  const [lastWindow, setLastWindow] = useState<EmotionWindow | null>(null);
  const [lastFace, setLastFace] = useState<FaceSampleSnapshot | null>(null);
  const [lastPrediction, setLastPrediction] = useState<PredictionSnapshot | null>(null);
  const [lastEye, setLastEye] = useState<EyeSampleSnapshot | null>(null);
  const [lastGaze, setLastGaze] = useState<GazeSnapshot | null>(null);
  const [eyeSampleCount, setEyeSampleCount] = useState(0);
  const [gazeSampleCount, setGazeSampleCount] = useState(0);
  const [mockGaze, setMockGaze] = useState(false);
  // Gaze-adapter health. EmotionRuntime swallows adapter init failure into a
  // logger.warn (invisible to the user); we read the adapter's own
  // status/lastError after start so the UI can show WHY gaze isn't
  // streaming instead of silently rendering nothing.
  const [gazeDiag, setGazeDiag] = useState<{
    status: string | null;
    error: string | null;
  } | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recentWindows, setRecentWindows] = useState<EmotionWindow[]>([]);
  const [windowCount, setWindowCount] = useState(0);
  // Throttle face-sample state updates so React doesn't re-render at the
  // raw face-tracker rate (~30 Hz). 10 Hz feels live without churn.
  const lastFaceUpdateRef = useRef(0);
  const lastGazeUpdateRef = useRef(0);

  // Single CameraController instance — survives start/stop cycles so the
  // permission prompt only fires once per page load.
  const cameraRef = useRef<CameraController | null>(null);
  const runtimeRef = useRef<EmotionRuntime | null>(null);
  const settingsRef = useRef<OyonSettings | null>(null);
  const gazeAdapterRef = useRef<WebEyeTrackAdapter | WebGazerAdapter | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Stable context provider — the runtime calls this often and spreads the
  // result into every persisted window (EmotionRuntime.sendWindows), so the
  // identity store is read live: changing user-id mid-capture stamps the
  // next window without rebuilding the runtime.
  const contextProvider = useCallback(() => {
    const identity = resolveIdentity(bridgeStore);
    return {
      // The capture session id is RESOLVED ONCE in start() (host override
      // wins there) and held in sessionIdRef for the whole capture, so the
      // stamped windows, the oyon:window host event, and sessionContext's
      // currentSessionId (the FilterBar 'Current' scope) all agree. The
      // override fallback here only covers context reads before start().
      session_id:
        sessionIdRef.current ??
        identity.sessionIdOverride ??
        `standalone-${modelProfile}-${Date.now().toString(36)}`,
      user_id: identity.userId,
      case_id: 'standalone-case',
      tenant_id: 'standalone-app',
      model_profile: modelProfile,
    };
  }, [modelProfile, bridgeStore]);

  // Lazy-construct on first start so we don't ask for camera at mount time.
  const ensureRuntime = useCallback((): EmotionRuntime => {
    if (runtimeRef.current) return runtimeRef.current;

    cameraRef.current ??= new CameraController();
    // Storage strategy (Phase C.3): primary = IndexedDB for capacity;
    // secondary = LocalEmotionTransport (5–10 MB) for resilience. The
    // library's FallbackEmotionTransport is a single-transport drop
    // handler with a different contract, so we use a small local
    // DualWriteTransport that expresses primary→secondary cascade.
    const idb = new IdbEmotionTransport({
      storeName: 'emotion_windows',
      dbName: 'oyon-app',
    });
    const local = new LocalEmotionTransport({ storageKey: 'oyon-app-windows' });
    const localChain = new DualWriteTransport({
      primary: idb,
      secondary: local,
      onFallback: (err: unknown) => {
        console.warn('[transport] IDB write failed, falling back to localStorage', err);
      },
    });
    // Optional sync leg (embedded hosts passing api-base-url): local-first —
    // the local chain stays authoritative, the remote leg is best-effort.
    const bridge = bridgeStore.getState();
    const transport = bridge.apiBaseUrl
      ? new TeeTransport({
          local: localChain,
          remote: createRemoteLeg({
            apiBaseUrl: bridge.apiBaseUrl,
            getToken: bridge.getToken,
            onDrop: (payload) => {
              console.warn('[transport] remote sync dropped a batch', payload);
            },
          }),
        })
      : localChain;

    // Re-snapshot at start time so the user's edits since the last call
    // (if any) take effect on this run.
    const editableNow = snapshotSettings(useSettings.getState());
    // Host <oyon-app settings> attribute (tenant-level runtime parameters)
    // merges over the persisted store for THIS instance — key-by-key, only
    // known EditableSettings keys with matching primitive types, so a host
    // typo or a stale field can never poison the runtime config.
    applySettingsOverride(editableNow, bridge.settingsOverride);
    // Host <oyon-app gaze-engine> attribute overrides the persisted store for
    // THIS instance (and wins over a gaze_engine key inside `settings` — the
    // dedicated attribute is the more specific signal); explicit hook opts
    // (tests) win over both.
    const hostEngine = bridge.gazeEngineOverride;
    if (hostEngine) editableNow.gaze_engine = hostEngine as EditableSettings['gaze_engine'];
    if (opts.modelProfile) editableNow.model_profile = opts.modelProfile;
    if (opts.gazeEngine) editableNow.gaze_engine = opts.gazeEngine;

    const { runtime, settings, gazeAdapter } = buildRuntime({
      editable: editableNow,
      camera: cameraRef.current,
      transport,
      logTransport: new LocalLogTransport({ storageKey: 'oyon-app-logs' }),
      metricTransport: new LocalMetricTransport({ storageKey: 'oyon-app-metrics' }),
      contextProvider,
      bridgeStore,
    });
    gazeAdapterRef.current = gazeAdapter;

    runtime.on('status', (payload) => {
      const next = payload?.state as RuntimeStatus | undefined;
      if (next) setStatus(next);
      if (next) emitHostEvent('oyon:status', { state: next });
    });
    runtime.on('error', (err) => {
      setError(err);
      setStatus('error');
    });
    runtime.on('window', (windows) => {
      if (!windows?.length) return;
      const normalized = normalizeEmotionWindows(windows);
      if (!normalized.length) return;
      const identity = resolveIdentity(bridgeStore);
      emitHostEvent('oyon:window', {
        windows: normalized,
        sessionId: sessionIdRef.current,
        userId: identity.userId,
      });
      const tail = normalized[normalized.length - 1];
      setLastWindow(tail ?? null);
      setWindowCount((n) => n + normalized.length);
      setRecentWindows((prev) => {
        const merged = [...prev, ...normalized];
        // Drop oldest if we exceed the cap — newest is at the end.
        return merged.length > RECENT_WINDOW_CAP
          ? merged.slice(merged.length - RECENT_WINDOW_CAP)
          : merged;
      });
    });
    // `sample` fires per-frame (see src/core/EmotionRuntime.js:304). The
    // hand-written .d.ts only declares status/error/window so we cast.
    // Throttle face/prediction state updates to ~10 Hz; gaze stays raw
    // because the dot needs to feel live.
    (runtime.on as (k: string, h: (p: unknown) => void) => unknown)('sample', (payload: unknown) => {
      try {
        const evt = payload as {
          face?: {
            facePresent?: boolean;
            quality?: { bbox?: FaceBox } | null;
            reason?: string;
          };
          prediction?: {
            dominant_emotion?: string;
            probabilities?: Record<string, number>;
            confidence?: number;
            // Present (a number in [-1,1]) only for valence/arousal-capable
            // classifiers; null otherwise. Emitted by EmotionRuntime per sample
            // (src/core/EmotionRuntime.js) — forwarded to the host on oyon:sample.
            valence?: number | null;
            arousal?: number | null;
          } | null;
          eye?: {
            valid?: boolean;
            smoothed?: boolean;
            blink_l?: boolean;
            blink_r?: boolean;
            eye_openness_l?: number | null;
            eye_openness_r?: number | null;
            gaze_zone?: string | null;
            ts_ms?: number | null;
          } | null;
        };
        const now = performance.now();

        // Per-frame host signal: emit the live emotion at FULL source rate.
        // Oyon is research-grade — the affect stream is NOT gated or throttled
        // for the host (see CLAUDE.md "Data policy"). Fires on EVERY sample
        // (~camera rate), unconditionally, with the full per-frame signal
        // (dominant + confidence + valence + arousal + the whole probability
        // vector). The 100ms block below throttles ONLY React re-renders (perf),
        // never what the host receives. No-op standalone (emitHostEvent only
        // reaches a host in embed mode).
        const samplePred = evt.prediction;
        if (samplePred && typeof samplePred === 'object' && samplePred.probabilities) {
          const sLabel =
            typeof samplePred.dominant_emotion === 'string'
              ? samplePred.dominant_emotion
              : pickDominant(samplePred.probabilities);
          const sProbs = Object.values(samplePred.probabilities).filter(
            (v): v is number => typeof v === 'number' && Number.isFinite(v),
          );
          const sConf =
            typeof samplePred.confidence === 'number' && Number.isFinite(samplePred.confidence)
              ? samplePred.confidence
              : sProbs.length ? Math.max(...sProbs) : 0;
          emitHostEvent('oyon:sample', {
            dominant: sLabel,
            confidence: sConf,
            valence: typeof samplePred.valence === 'number' && Number.isFinite(samplePred.valence) ? samplePred.valence : null,
            arousal: typeof samplePred.arousal === 'number' && Number.isFinite(samplePred.arousal) ? samplePred.arousal : null,
            probabilities: samplePred.probabilities,
            ts: Date.now(),
          });
        }

        if (now - lastFaceUpdateRef.current >= 100) {
          lastFaceUpdateRef.current = now;
          const face = evt.face;
          if (face) {
            const bbox = face.quality?.bbox ?? null;
            const usableBbox = bbox
              && Number.isFinite(bbox.x)
              && Number.isFinite(bbox.y)
              && Number.isFinite(bbox.width)
              && Number.isFinite(bbox.height)
                ? bbox
                : null;
            setLastFace({
              facePresent: Boolean(face.facePresent),
              bbox: usableBbox,
              reason: face.reason,
            });
          }
          const pred = evt.prediction;
          if (pred && typeof pred === 'object' && pred.probabilities) {
            const label =
              typeof pred.dominant_emotion === 'string'
                ? pred.dominant_emotion
                : pickDominant(pred.probabilities);
            const probValues = Object.values(pred.probabilities).filter(
              (v): v is number => typeof v === 'number' && Number.isFinite(v),
            );
            const conf =
              typeof pred.confidence === 'number' && Number.isFinite(pred.confidence)
                ? pred.confidence
                : probValues.length
                  ? Math.max(...probValues)
                  : 0;
            const ts = Date.now();
            // React state for the live UI (throttled to ~10Hz). The host-facing
            // oyon:sample stream is emitted UNCONDITIONALLY at full rate above —
            // not from here.
            setLastPrediction({
              label,
              probabilities: pred.probabilities,
              confidence: conf,
              ts,
            });
          }
          const eye = evt.eye;
          if (eye) {
            const openness = [eye.eye_openness_l, eye.eye_openness_r].filter(
              (v): v is number => typeof v === 'number' && Number.isFinite(v),
            );
            setLastEye({
              valid: eye.valid === true,
              smoothed: eye.smoothed === true,
              blinkLeft: eye.blink_l === true,
              blinkRight: eye.blink_r === true,
              eyeOpennessMean: openness.length
                ? openness.reduce((sum, v) => sum + v, 0) / openness.length
                : null,
              gazeZone: typeof eye.gaze_zone === 'string' ? eye.gaze_zone : null,
              ts: typeof eye.ts_ms === 'number' && Number.isFinite(eye.ts_ms)
                ? eye.ts_ms
                : Date.now(),
            });
            setEyeSampleCount((n) => n + 1);
          }
        }
      } catch (err) {
        console.warn('[runtime] dropped malformed sample payload', err);
      }
    });

    // Chain a sibling onGaze AFTER the runtime installs its handler so
    // the live floating dot updates on every adapter sample. The runtime
    // wraps `gazeAdapter.options.onGaze` during construction — we then
    // wrap THAT and call both. Same pattern as standalone-demo.js.
    const adapter = gazeAdapter as unknown as {
      options?: { onGaze?: (sample: unknown) => void };
    };
    if (adapter.options) {
      const runtimeHandler = adapter.options.onGaze;
      adapter.options.onGaze = (sample: unknown) => {
        try {
          runtimeHandler?.(sample);
        } catch (err) {
          console.warn('[gaze] runtime handler threw', err);
        }
        const s = sample as {
          x?: number;
          y?: number;
          quality?: number;
          valid?: boolean;
          gaze_state?: string;
        };
        const x = typeof s?.x === 'number' && Number.isFinite(s.x) ? s.x : null;
        const y = typeof s?.y === 'number' && Number.isFinite(s.y) ? s.y : null;
        if (x == null || y == null) return;
        const now = performance.now();
        if (now - lastGazeUpdateRef.current < 33) return; // ~30 Hz cap
        lastGazeUpdateRef.current = now;
        setLastGaze({
          x,
          y,
          quality: typeof s.quality === 'number' && Number.isFinite(s.quality) ? s.quality : 0,
          state: s.gaze_state,
          ts: Date.now(),
        });
        setGazeSampleCount((n) => n + 1);
      };
    }

    runtimeRef.current = runtime;
    settingsRef.current = settings;
    return runtime;
  }, [modelProfile, gazeEngine, contextProvider, bridgeStore, emitHostEvent]);

  const start = useCallback(async () => {
    setError(null);
    setStatus('initializing');
    try {
      if (!sessionIdRef.current) {
        // Host-supplied session id (the <oyon-app> session-id attribute)
        // wins; it applies at capture start, not mid-capture, so one
        // capture = one coherent session id everywhere.
        sessionIdRef.current =
          resolveIdentity(bridgeStore).sessionIdOverride ??
          `standalone-${modelProfile}-${Date.now().toString(36)}`;
        setSessionId(sessionIdRef.current);
      }
      const runtime = ensureRuntime();
      await runtime.start();
      // Expose the camera stream as React state so MiniCamera and
      // CameraPreview can both bind to it imperatively. `stream` is a
      // public field on CameraController (src/capture/CameraController.js
      // line 8) but missing from the hand-written .d.ts.
      const cam = cameraRef.current as unknown as { stream: MediaStream | null };
      if (cam?.stream) {
        setCameraStream(cam.stream);
        if (opts.videoRef?.current) {
          opts.videoRef.current.srcObject = cam.stream;
          await opts.videoRef.current.play().catch(() => {
            /* autoplay blocked is harmless here — the user clicked Start */
          });
        }
      }
      // Probe gaze-adapter health. runtime.start() awaits the adapter's
      // init()/start() internally and swallows failures, so by here the
      // adapter's own status/lastError reflect what actually happened.
      const ga = gazeAdapterRef.current as unknown as {
        status?: () => string | null;
        lastError?: () => unknown;
      } | null;
      if (ga) {
        const gs = ga.status?.() ?? null;
        const ge = ga.lastError?.() ?? null;
        if (ge || gs === 'error') {
          const msg =
            ge instanceof Error ? ge.message : ge ? String(ge) : `status=${gs}`;
          console.error('[oyon gaze adapter] not streaming —', gs, ge);
          setGazeDiag({ status: gs, error: msg });
        } else {
          setGazeDiag({ status: gs, error: null });
        }
      }
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, [ensureRuntime, modelProfile, opts.videoRef, bridgeStore]);

  const stop = useCallback(async () => {
    setStatus('stopping');
    try {
      await runtimeRef.current?.stop();
      setCameraStream(null);
      sessionIdRef.current = null;
      setSessionId(null);
      if (opts.videoRef?.current) {
        opts.videoRef.current.srcObject = null;
      }
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, [opts.videoRef]);

  const pause = useCallback(() => {
    runtimeRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    runtimeRef.current?.resume();
  }, []);

  // Expose start/stop (+ the live AOI setter) to the <oyon-app> element's
  // imperative methods. Registration is idempotent and harmless standalone
  // (nothing reads it).
  useEffect(() => {
    bridgeStore.getState().registerControls({
      start,
      stop,
      setGazeAois: (aois) => {
        // Live swap on the running runtime; before start() the bridge value
        // (written by the element) is picked up at construction instead.
        (runtimeRef.current as unknown as { setGazeAois?: (a: unknown) => void } | null)
          ?.setGazeAois?.(aois);
      },
    });
    return () => {
      bridgeStore.getState().registerControls(null);
    };
  }, [start, stop, bridgeStore]);

  // Synthetic gaze stream. Drives the SAME lastGaze/gazeSampleCount state
  // the real adapter feeds, so /live's tile and the floating dot animate
  // with no camera, no WebGazer, no calibration. A smooth Lissajous-ish
  // path stays inside the normalized [-0.5, 0.5] viewport; quality slowly
  // breathes so the ok/warn color split is visible too.
  useEffect(() => {
    if (!mockGaze) return;
    const startedAt = performance.now();
    const id = window.setInterval(() => {
      const t = (performance.now() - startedAt) / 1000;
      const x = 0.34 * Math.sin(t * 0.9) + 0.05 * Math.sin(t * 2.7);
      const y = 0.28 * Math.sin(t * 1.3 + 1) + 0.04 * Math.cos(t * 3.1);
      const quality = Math.max(0, Math.min(1, 0.62 + 0.33 * Math.sin(t * 0.5)));
      setLastGaze({ x, y, quality, state: 'mock', ts: Date.now() });
      setGazeSampleCount((n) => n + 1);
    }, 50);
    return () => window.clearInterval(id);
  }, [mockGaze]);

  // NO teardown on unmount — deliberate.
  //
  // RuntimeProvider is mounted at AppShell level and survives route changes
  // (see its docstring); the runtime is an app-lifetime singleton. The only
  // things that ever "unmount" it are React 18 StrictMode's dev
  // double-invoke and HMR — neither of which should kill a live camera +
  // gaze adapter. The previous cleanup called runtime.stop() (which
  // dispose()s the gaze adapter); StrictMode then could not re-init it
  // ("cannot init after dispose()") and gaze silently never started.
  //
  // Real teardown happens when the browser tears the page down (tab close /
  // navigation / full reload) — the OS reclaims camera tracks there. HMR
  // recreates the module graph anyway. So: keep the singleton alive.
  useEffect(() => {
    return () => {
      /* intentionally empty — see comment above */
    };
  }, []);

  const settings = useMemo<OyonSettings>(
    () => settingsRef.current ?? createOyonSettings({ model_profile: modelProfile }),
    [modelProfile, status],
  );

  return {
    status,
    error,
    lastWindow,
    lastFace,
    lastPrediction,
    lastEye,
    lastGaze,
    eyeSampleCount,
    gazeSampleCount,
    recentWindows,
    windowCount,
    settings,
    modelLabel: profileMeta.label,
    modelHint: profileMeta.hint,
    gazeEngine,
    gazeAdapter: gazeAdapterRef.current,
    mockGaze,
    setMockGaze,
    gazeDiag,
    runtime: runtimeRef.current,
    cameraStream,
    sessionId,
    start,
    pause,
    resume,
    stop,
  };
}

function pickDominant(probs: Record<string, number>): string {
  let best = '';
  let bestVal = -Infinity;
  for (const [k, v] of Object.entries(probs)) {
    if (typeof v === 'number' && v > bestVal) {
      bestVal = v;
      best = k;
    }
  }
  return best;
}
