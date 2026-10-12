// Pure glue between Rohy and the embedded <oyon-app> element (Oyon v3).
//
// Kept free of React and the DOM so unit tests can pin the exact payloads
// that cross the two host contracts:
//   in  — the element's `settings` attribute (EditableSettings keys), built
//         from the tenant runtime config GET /addons/oyon/config returns;
//   out — the POST /addons/oyon/emotion-records body, built from the
//         windows the element emits on `oyon:window`.

// The Express server mounts the vendored OyonR tree at /oyon (server.js),
// so /oyon/standalone is the `asset-base` root the element expects:
//   vendor/mediapipe/wasm/*  vendor/onnxruntime-web/*  vendor/webgazer/*
//   models/mediapipe/face_landmarker.task  models/emotion/*.onnx
// With asset-base set, the element never touches a CDN — every model and
// WASM file loads same-origin, which is what keeps air-gapped deploys
// working (the bundles arrive via OyonR/scripts/download-models.sh).
import { OYON_WINDOW_BATCH_SCHEMA_VERSION } from 'oyon/version';
import { baseUrl } from '../../config/api';

// Through baseUrl(): the element loads its models and WASM from here, and an
// install served at /rohy/ has them at /rohy/oyon/standalone.
export const OYON_ASSET_BASE = baseUrl('/oyon/standalone');

// Map the tenant runtime config (server field names, see DEFAULT_RUNTIME in
// server/routes/oyon-routes.js) onto the element's EditableSettings keys
// (<oyon-app settings> attribute). Renames: window_ms → aggregate_window_ms,
// min_switch_confidence → switch_confidence; the rest pass through. Only
// fields that are actually present and well-typed are forwarded — absent
// keys keep the element's own defaults, and the element re-validates
// key-by-key on its side, so a stale or malformed config can never poison
// the capture runtime.
export function elementSettings(runtimeConfig) {
    const cfg = runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {};
    const out = {};
    if (typeof cfg.model_profile === 'string' && cfg.model_profile.trim() !== '') {
        out.model_profile = cfg.model_profile;
    }
    assignFiniteNumber(out, 'sample_interval_ms', cfg.sample_interval_ms);
    assignFiniteNumber(out, 'aggregate_window_ms', cfg.window_ms);
    assignFiniteNumber(out, 'min_valid_frames', cfg.min_valid_frames);
    assignFiniteNumber(out, 'smoothing_alpha', cfg.smoothing_alpha);
    assignFiniteNumber(out, 'min_hold_ms', cfg.min_hold_ms);
    assignFiniteNumber(out, 'switch_confidence', cfg.min_switch_confidence);
    // Oyon 3 signal flags (migration 0040). Unlike the numeric knobs above these
    // are forwarded whenever the server supplies them, INCLUDING when false —
    // that is the whole point. The element's own DEFAULT_SETTINGS turns
    // gaze/eye/facial/posture/respiration/heart-rate ON, so omitting a key does
    // not mean "off", it means "whatever this browser's persisted store says".
    // Before these were forwarded, a tenant had no way to disable any signal.
    for (const key of SIGNAL_FLAG_KEYS) {
        assignBoolean(out, key, cfg[key]);
    }
    return out;
}

// EditableSettings booleans the server owns. Names match the element's keys
// exactly — the server already fans `signal_window_share` out into the
// per-modality `*_window_share` fields, so this is a straight pass-through.
const SIGNAL_FLAG_KEYS = Object.freeze([
    'facial_signals_enabled',
    'posture_tracking_enabled',
    'heart_rate_enabled',
    'respiration_enabled',
    'illumination_enabled',
    'eye_tracking_enabled',
    'gaze_tracking_enabled',
    'enable_dynamics',
    'facial_signals_window_share',
    'posture_window_share',
    'heart_rate_window_share',
    'respiration_window_share',
    'illumination_window_share',
    'engagement_window_share',
    'gaze_window_share',
]);

function assignFiniteNumber(target, key, value) {
    const n = Number(value);
    if (value != null && Number.isFinite(n)) target[key] = n;
}

// Only a real boolean is forwarded. The element merges the `settings` attribute
// key-by-key with a matching-primitive-type check, so passing a truthy string
// or a 0/1 int would be dropped on its side and read as "no opinion" here.
function assignBoolean(target, key, value) {
    if (typeof value === 'boolean') target[key] = value;
}

// Build the POST /addons/oyon/emotion-records body from the element's
// `oyon:window` payload. Field semantics preserved from the v1 widget:
//   - session_id is stamped from the ROHY session prop (not from whatever
//     the element happened to have at flush time) so a session switch can
//     never mis-key a late window;
//   - the server is the source of truth for consent_version — it overwrites
//     the per-event value with the accepted consent row's version. The
//     payload validator still requires the field, hence the placeholder.
export function persistBody(windows, { sessionId, caseId, room } = {}) {
    const events = Array.isArray(windows) ? windows : [];
    return {
        schema_version: OYON_WINDOW_BATCH_SCHEMA_VERSION,
        session_id: sessionId,
        events: events.map(ev => ({
            ...sanitizeWindowForPersistence(ev),
            session_id: sessionId,
            case_id: caseId || null,
            // Simulator-room stamp — the room active when the window flushed
            // (windows are ~10 s, room hops are rare; this is the honest
            // cheap version of chatoyon's dominant-page stamp).
            room: room || null,
            capture_mode: ev.capture_mode || 'local-browser',
            consent_version: ev.consent_version || 'placeholder',
        })),
    };
}

function sanitizeWindowForPersistence(ev) {
    if (!ev || typeof ev !== 'object') return {};
    const out = { ...ev };
    if (out.settings_snapshot && typeof out.settings_snapshot === 'object') {
        const { gaze_aois: _gazeAois, ...settings } = out.settings_snapshot;
        out.settings_snapshot = settings;
    }
    return out;
}
