// Live student face position, fed by the Oyon element's per-frame
// `oyon:sample` host events (dispatched on the <oyon-app> element with
// bubbles+composed, so they reach the document from inside App.jsx's fixed
// pill mount). The element includes `face` — the normalized [0,1] MediaPipe
// bbox of the tracked face — whenever a face is visible.
//
// Gaze target is the DEVIATION from an adaptive baseline, not the absolute
// image position: webcams sit above (or beside) the screen, so the student's
// resting face center is systematically off image-center — mapping absolute
// position made the avatar stare permanently down (bug 03.07.2026). The
// baseline is a slow EMA of the face center: sitting still = eye contact
// wherever the camera is; moving = the avatar follows; settling somewhere
// new = eye contact re-establishes there over ~BASELINE_TAU seconds.
//
// This module is a deliberately tiny mutable singleton: PatientAvatar polls
// it from an r3f useFrame loop every frame, so the read path must be
// allocation-free and never trigger React renders. When capture is off (no
// consent, camera stopped, no face) the snapshot goes stale and consumers
// ease back to neutral.

const state = {
    cx: 0.5, cy: 0.5,          // latest face center
    bx: 0.5, by: 0.5,          // adaptive eye-contact baseline (slow EMA)
    ax: 0.5, ay: 0.5,          // movement anchor (last position that counted as a move)
    ts: 0,                      // last sample time
    lastMoveTs: 0,              // last time the face actually MOVED
};
let listening = false;

// Baseline EMA time constant: how long the student must hold a new position
// before it becomes the new "eye contact" point. Long on purpose — at 12s
// the avatar re-centered so fast that following read as "he doesn't look
// anywhere"; a held lean should keep his gaze for the better part of a
// minute before eye contact re-establishes.
const BASELINE_TAU_MS = 45_000;
// A tracking gap longer than this re-acquires the baseline at the next
// sample (fresh sit-down shouldn't inherit a stale baseline).
const REACQUIRE_MS = 3_000;
// Glance-and-return (operator feedback 04.07.2026 "stuck to one side"): the
// avatar follows MOVEMENT, not position. A move refreshes attention; once
// the student stops moving — even while holding an off-center lean — the
// gaze holds briefly, then eases back to eye contact. People glance at
// motion; they don't lock sideways.
const MOVE_EPSILON = 0.02;        // normalized distance that counts as a move
const ATTENTION_HOLD_MS = 1_500;  // full attention right after a move
const ATTENTION_TAU_MS = 2_500;   // then exponential release back to contact

function onSample(e) {
    const face = e.detail?.face;
    if (
        !face
        || !Number.isFinite(face.x)
        || !Number.isFinite(face.y)
        || !Number.isFinite(face.width)
        || !Number.isFinite(face.height)
    ) return;

    const now = performance.now();
    const cx = face.x + face.width / 2;
    const cy = face.y + face.height / 2;
    const dt = state.ts ? now - state.ts : Infinity;

    if (dt > REACQUIRE_MS) {
        // First sample (or tracking resumed after a gap): current position
        // IS eye contact.
        state.bx = cx;
        state.by = cy;
        state.ax = cx;
        state.ay = cy;
        state.lastMoveTs = now; // a fresh acquire earns a moment of attention
    } else {
        const alpha = 1 - Math.exp(-dt / BASELINE_TAU_MS);
        state.bx += (cx - state.bx) * alpha;
        state.by += (cy - state.by) * alpha;
        // Anchor-based move detection (sample-rate independent): only a real
        // displacement refreshes attention; sitting still — anywhere — lets
        // the gaze release back to eye contact.
        if (Math.hypot(cx - state.ax, cy - state.ay) > MOVE_EPSILON) {
            state.ax = cx;
            state.ay = cy;
            state.lastMoveTs = now;
        }
    }
    state.cx = cx;
    state.cy = cy;
    state.ts = now;
}

/** Idempotent: install the document-level listener once per page. */
export function ensureStudentPresenceListener() {
    if (listening) return;
    document.addEventListener('oyon:sample', onSample);
    listening = true;
    // Dev-only live inspection: `__oyonGaze()` in the console shows the raw
    // face center, the adaptive baseline, deviation, and staleness — the
    // first thing to look at when "the avatar isn't following".
    if (import.meta.env?.DEV) {
        window.__oyonGaze = () => ({
            ...state,
            ageMs: state.ts ? Math.round(performance.now() - state.ts) : null,
            gaze: getStudentGaze(),
            glance: getGlanceOverride(),
        });
        // NB: call the hook, not a fresh `import()` of this module — the dev
        // server can serve a second instance whose singleton the app ignores.
        window.__oyonGlance = requestAvatarGlance;
    }
}

/**
 * Latest gaze deviation `{ dx, dy }` — the face center's offset from the
 * adaptive eye-contact baseline, scaled by attention (1 right after a move,
 * decaying toward 0 while the student holds still so the avatar releases
 * back to eye contact instead of pinning sideways). Null when no face has
 * been seen within `maxAgeMs` (consumer should ease back to neutral).
 */
export function getStudentGaze(maxAgeMs = 1500) {
    const now = performance.now();
    if (!state.ts || now - state.ts > maxAgeMs) return null;
    const idle = now - state.lastMoveTs;
    const attention = idle <= ATTENTION_HOLD_MS
        ? 1
        : Math.exp(-(idle - ATTENTION_HOLD_MS) / ATTENTION_TAU_MS);
    return {
        dx: (state.cx - state.bx) * attention,
        dy: (state.cy - state.by) * attention,
    };
}

// --- Scripted glances (e.g. the patient checking his own monitor) ----------

let glance = null;

/**
 * Ask the avatar to look somewhere specific for a while — e.g. at the ECG
 * when an alarm fires. Overrides student-following until it expires. Pitch
 * is clamped to ≤ 0 (up): the never-look-down policy applies to scripted
 * glances too.
 */
export function requestAvatarGlance(yaw, pitch = 0, durationMs = 6_000) {
    glance = { yaw, pitch: Math.min(0, pitch), until: performance.now() + durationMs };
}

/** Active scripted glance `{ yaw, pitch }`, or null when none/expired. */
export function getGlanceOverride() {
    if (!glance || performance.now() > glance.until) return null;
    return glance;
}

// Gaze ranges (radians): eyeballs move a lot, the head follows subtly.
const EYE_YAW_RANGE = 0.55;
// Deviations are small fractions of the frame (leaning sideways shifts the
// face center by ~0.1–0.2), so amplify before clamping to the range. At 5,
// a ~0.1 lean already drives the eyes to full deflection — the response
// should be unmissable, not polite.
const DEVIATION_GAIN = 5;
// Vertical policy (operator directive 04.07.2026): the patient must NEVER
// look down and only RARELY up. Webcam-above-screen geometry turns ordinary
// movements (leaning in to read or type) into downward face shifts, so
// vertical deviations are mostly artifacts, not the student going anywhere.
// Downward gaze is dropped outright; upward gaze needs a clear deliberate
// move (deadzone) and is capped small.
const EYE_PITCH_UP_MAX = 0.18;   // rad — the only vertical excursion allowed
const PITCH_UP_DEADZONE = 0.05;  // upward deviation ignored below this

/**
 * Map a gaze deviation (offset from the eye-contact baseline) to world-axis
 * angles for a head that faces +Z (toward the r3f camera).
 *
 * Sign derivation: the webcam and the avatar both face the student, so the
 * unmirrored camera image is the avatar's own view. A face moving toward the
 * image right (dx > 0) is a student moving toward the avatar's right; the
 * avatar's right is world -X, and rotating +Z toward -X is a NEGATIVE
 * rotation about world +Y — hence yaw = -dx. Image y grows downward and a
 * positive world-X rotation tips the gaze downward — but downward gaze is
 * forbidden (see the vertical policy above), so pitch is ≤ 0 (up) only.
 *
 * @return {{yaw: number, pitch: number}} radians about world Y (yaw) / X (pitch)
 */
export function faceGazeAngles(dx, dy) {
    const clamp = (v) => Math.max(-0.5, Math.min(0.5, v * DEVIATION_GAIN));
    // Upward-only pitch: dy < 0 is the student rising in the frame. Ignore
    // everything below the deadzone, amplify, cap at the small up max.
    const upward = Math.max(0, -dy - PITCH_UP_DEADZONE);
    const upUnit = Math.min(0.5, upward * DEVIATION_GAIN);
    return {
        yaw: -clamp(dx) * 2 * EYE_YAW_RANGE,
        pitch: upUnit > 0 ? -upUnit * 2 * EYE_PITCH_UP_MAX : 0,
    };
}

// Test-only: reset the singleton between cases.
export function _resetStudentPresenceForTests() {
    state.cx = 0.5;
    state.cy = 0.5;
    state.bx = 0.5;
    state.by = 0.5;
    state.ax = 0.5;
    state.ay = 0.5;
    state.ts = 0;
    state.lastMoveTs = 0;
    glance = null;
    if (listening) {
        document.removeEventListener('oyon:sample', onSample);
        listening = false;
    }
}
