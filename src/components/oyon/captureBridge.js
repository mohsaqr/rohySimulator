// Pure glue between Rohy and the embedded <oyon-app> element (Oyon v2).
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
export const OYON_ASSET_BASE = '/oyon/standalone';

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
    return out;
}

function assignFiniteNumber(target, key, value) {
    const n = Number(value);
    if (value != null && Number.isFinite(n)) target[key] = n;
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
        session_id: sessionId,
        events: events.map(ev => ({
            ...ev,
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
