// Multi-AOI gaze: "WHAT on the screen is the trainee looking at?" — maps any
// on-screen element's DOM rect into a gaze Area-of-Interest that Oyon's
// aggregator turns into per-window dwell time (gaze.aoi_dwell_ms.<id>), and
// keeps a live registry of every published AOI so the capture widget can
// forward the full set to the <oyon-app> element in one setGazeAois() call.
//
// Generalized from patientAoi.js (the single patient-face AOI, itself ported
// from chatoyon-plus src/lib/sensing/agentAoi.mjs) — same coordinate contract,
// same store pattern; the store just grew from one slot to a Map keyed by a
// stable AOI id. patientAoi.js remains as a back-compat shim over this module.
//
// Coordinate contract (Oyon GazeAggregator): [-0.5, 0.5] on both axes, origin
// = PHYSICAL SCREEN center, x/y = the rect's top-left corner. The geometric
// (mediapipe) gaze engine emits gain-scaled gaze DIRECTION normalized into
// that range — zone-level accuracy, not pixel-level — so every AOI is a
// GENEROUS box with a minimum size, and the honest reading of the metric is
// "gazing toward that region", not literal fixation. Overlapping AOIs each
// accumulate dwell independently (GazeAggregator.computeAoiDwell), so shares
// need not sum to 1.
//
// Privacy invariant: only aggregate zone/AOI dwell stats ever leave the
// browser — never a raw (x, y) point stream.
//
// Pure module — the DOM/live parts (ResizeObserver, rAF) live in
// useAoiPublisher.js / AoiRegion.jsx, which call reportAoi() with what they
// measure.

/** The face region inside the avatar stage: the head fills the square stage,
 *  the face sits center-horizontal in the upper ~3/4. Fractions of the rect. */
export const FACE_BOX = Object.freeze({ left: 0.19, top: 0.08, width: 0.62, height: 0.7 });

/** Minimum AOI edge in gaze units — geometric gaze can't resolve tinier
 *  targets, so smaller boxes are padded out from their center. */
export const MIN_AOI_SIZE = 0.12;

export const PATIENT_AOI_ID = 'patient_face';

/** Friendly names for the AOI ids Rohy publishes; analytics falls back to the
 *  raw id for anything unknown (e.g. windows from a newer/older client). */
export const AOI_LABELS = Object.freeze({
    patient_face: 'Patient',
    ecg_trace: 'ECG',
    vitals_values: 'Vitals',
    chat_panel: 'Chat',
    lesson_content: 'Lesson',
});

const AOI_ALIASES = Object.freeze({
    patient: PATIENT_AOI_ID,
    patient_face: PATIENT_AOI_ID,
    patientface: PATIENT_AOI_ID,
    'patient-face': PATIENT_AOI_ID,
    ecg: 'ecg_trace',
    ecg_trace: 'ecg_trace',
    ecgtrace: 'ecg_trace',
    'ecg-trace': 'ecg_trace',
    vitals: 'vitals_values',
    vitals_values: 'vitals_values',
    vitalsvalues: 'vitals_values',
    'vitals-values': 'vitals_values',
    chat: 'chat_panel',
    chat_panel: 'chat_panel',
    chatpanel: 'chat_panel',
    'chat-panel': 'chat_panel',
});

/** Canonical AOI id for analytics aggregation. Older capture rows used short
 *  ids ("patient", "ecg", "chat", "vitals") while the current publisher uses
 *  stable DOM-target ids ("patient_face", "ecg_trace", ...). Merge both eras
 *  before labels are rendered, otherwise the UI gets duplicate columns with
 *  the same human label. Unknown ids stay lowercased for deterministic output. */
export function canonicalAoiId(id) {
    const key = String(id ?? '').trim().toLowerCase();
    if (!key) return key;
    return AOI_ALIASES[key] ?? key;
}

/** Display label for an AOI id — friendly name when known (matched
 *  case-insensitively: real data carries ids from two capture eras that
 *  differ only by case, e.g. "Chat" vs "chat"), otherwise the id capitalized
 *  nicely (first letter upper, known acronym 'ecg' → 'ECG'). */
export function aoiLabel(id) {
    const key = canonicalAoiId(id);
    const known = AOI_LABELS[key];
    if (known) return known;
    if (key === 'ecg') return 'ECG';
    if (!key) return String(id ?? '');
    return key.charAt(0).toUpperCase() + key.slice(1);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Map an element's viewport rect to a physical-screen gaze AOI.
 *
 * @param {string} id  Stable AOI id (becomes the aoi_dwell_ms key).
 * @param {{left:number, top:number, width:number, height:number}} rect
 *   The element's getBoundingClientRect() (CSS px, viewport-relative).
 * @param {object} env  Window/screen geometry (all CSS px):
 *   innerWidth/innerHeight        viewport size (required)
 *   screenX/screenY               window position on the physical screen
 *   outerWidth/outerHeight        window size incl. browser chrome
 *   screenWidth/screenHeight      the physical screen size
 *   Screen fields are optional — absent/degenerate values fall back to
 *   viewport-relative mapping (correct when the browser is maximized).
 * @param {object} [opts]
 * @param {{left:number, top:number, width:number, height:number}|null} [opts.insetBox]
 *   Optional sub-region of the rect, as fractions of it (e.g. FACE_BOX picks
 *   the face out of the avatar stage). Omitted → the full rect is the target.
 * @returns {{id:string,x:number,y:number,width:number,height:number}|null}
 *   Null when the rect is degenerate or fully off-viewport.
 */
export function elementAoi(id, rect, env, { insetBox = null } = {}) {
    if (typeof id !== 'string' || !id) return null;
    if (!rect || !isNum(rect.left) || !isNum(rect.top) || !isNum(rect.width) || !isNum(rect.height)) return null;
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (!env || !isNum(env.innerWidth) || !isNum(env.innerHeight) || env.innerWidth <= 0 || env.innerHeight <= 0) return null;
    // Fully outside the viewport (scrolled away) → no target to look at.
    if (rect.left + rect.width <= 0 || rect.top + rect.height <= 0) return null;
    if (rect.left >= env.innerWidth || rect.top >= env.innerHeight) return null;

    // The target box inside the element rect (viewport CSS px).
    const box = insetBox ?? { left: 0, top: 0, width: 1, height: 1 };
    const target = {
        left: rect.left + rect.width * box.left,
        top: rect.top + rect.height * box.top,
        width: rect.width * box.width,
        height: rect.height * box.height,
    };

    // Viewport px → physical-screen fraction. When the screen geometry is
    // usable, offset by the window position + browser chrome (left border ≈
    // (outer-inner)/2, top chrome ≈ outer-inner); otherwise treat the viewport
    // AS the screen (maximized-browser assumption).
    const screenOk =
        isNum(env.screenWidth) && env.screenWidth >= env.innerWidth &&
        isNum(env.screenHeight) && env.screenHeight >= env.innerHeight &&
        isNum(env.screenX) && isNum(env.screenY);
    let x;
    let y;
    let w;
    let h;
    if (screenOk) {
        const chromeX = isNum(env.outerWidth) ? Math.max(0, (env.outerWidth - env.innerWidth) / 2) : 0;
        const chromeY = isNum(env.outerHeight) ? Math.max(0, env.outerHeight - env.innerHeight) : 0;
        x = (env.screenX + chromeX + target.left) / env.screenWidth - 0.5;
        y = (env.screenY + chromeY + target.top) / env.screenHeight - 0.5;
        w = target.width / env.screenWidth;
        h = target.height / env.screenHeight;
    } else {
        x = target.left / env.innerWidth - 0.5;
        y = target.top / env.innerHeight - 0.5;
        w = target.width / env.innerWidth;
        h = target.height / env.innerHeight;
    }

    // Pad tiny targets out from their center to the resolvable minimum.
    if (w < MIN_AOI_SIZE) {
        x -= (MIN_AOI_SIZE - w) / 2;
        w = MIN_AOI_SIZE;
    }
    if (h < MIN_AOI_SIZE) {
        y -= (MIN_AOI_SIZE - h) / 2;
        h = MIN_AOI_SIZE;
    }

    // Clamp into the gaze square, keeping the size (shift, then trim).
    x = Math.max(-0.5, Math.min(0.5 - w, x));
    y = Math.max(-0.5, Math.min(0.5 - h, y));
    w = Math.min(w, 1);
    h = Math.min(h, 1);

    return { id, x, y, width: w, height: h };
}

/**
 * Map the avatar stage's viewport rect to the patient-face AOI (the FACE_BOX
 * inset applies only to the avatar — other AOIs target their full rect).
 */
export function patientFaceAoi(rect, env) {
    return elementAoi(PATIENT_AOI_ID, rect, env, { insetBox: FACE_BOX });
}

// ---------------------------------------------------------------------------
// Live AOI registry — each publisher (useAoiPublisher) reports what it
// measures under its stable id; OyonCaptureWidget forwards the full set to
// the <oyon-app> element. Plain module state, Map insertion order = the
// stable order of getAois() (a null slot keeps its place, so an AOI that
// disappears and comes back doesn't reshuffle the list).
// ---------------------------------------------------------------------------

/** @type {Map<string, {id:string,x:number,y:number,width:number,height:number}|null>} */
const registry = new Map();
const listeners = new Set();

/** Publish one AOI (null = that element is gone/off-screen). Dedupes no-ops. */
export function reportAoi(id, aoi) {
    if (typeof id !== 'string' || !id) return;
    const next = aoi ?? null;
    const prev = registry.get(id) ?? null;
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    registry.set(id, next);
    const list = getAois();
    for (const cb of listeners) {
        try {
            cb(list);
        } catch {
            /* listener errors never break reporting */
        }
    }
}

/** The current AOI for one id, or null when absent/off-screen. */
export function getAoi(id) {
    return registry.get(id) ?? null;
}

/** All currently-visible AOIs, in stable (first-report) order — exactly the
 *  array the <oyon-app> element's setGazeAois() expects. */
export function getAois() {
    return [...registry.values()].filter((aoi) => aoi !== null);
}

/** Subscribe to registry changes — fires with the FULL getAois() array on any
 *  change to any AOI. Returns an unsubscribe function. */
export function onAois(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

/** Test-only: wipe the registry (listeners stay). Never used by app code —
 *  publisher lifecycles report null on unmount instead. */
export function resetAois() {
    registry.clear();
}
