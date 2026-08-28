// Oyon per-tenant settings row: the ONE place that knows what a tenant's
// settings look like before anyone has saved them.
//
// The row is materialised lazily — the first reader inserts the defaults.
// That means every reader MUST go through ensureSettings(); a raw
// `SELECT ... FROM oyon_settings` on a fresh tenant sees no row and invents
// its own idea of the default. ISSUE-0014 was exactly that fork: the setup
// wizard's sidebar pill read the table raw (→ "Off") while the step body
// read through ensureSettings() (→ checkbox on), and the two only agreed
// after the admin toggled the checkbox once.
//
// This module lives in lib/, not in oyon-routes.js, because the Oyon
// router is imported only when OYON_ENABLED=1 (it pulls in the `oyon`
// package). /setup/status must be able to answer regardless.
import { dbGet, dbRun } from '../routes/_helpers.js';

// Runtime defaults match the hard-coded values previously baked into the
// frontends. Migration 0012 stamps the same defaults onto oyon_settings, so
// these are only used if the migration hasn't run yet (defensive).
export const DEFAULT_RUNTIME = {
    model_profile: 'hse-emotion-mtl',
    // 500ms ≈ 2 Hz. Earlier we tried 333ms (3Hz) but inference + ONNX
    // preprocessing run on the React main thread (no app-level worker —
    // see HANDOFF.md, MediaPipe + module workers don't compose cleanly),
    // so 3Hz stalls the simulator UI on mid-tier hardware. 500ms keeps the
    // pill responsive without monopolising the main thread. Admins can
    // tune per tenant in Settings → Oyon → Capture engine.
    sample_interval_ms: 500,
    window_ms: 10000,
    min_valid_frames: 3,
    smoothing_alpha: 0.28,
    min_hold_ms: 3000,
    min_switch_confidence: 0.5,
};

/**
 * Return the tenant's oyon_settings row, creating it from the runtime
 * defaults if it does not exist yet. Idempotent.
 */
export async function ensureSettings(currentTenantId) {
    // Insert ALL runtime fields explicitly. Earlier code relied on the SQL
    // column DEFAULTs from migration 0012, which still has 1000ms baked in.
    // Migration 0013 only patched existing rows, so any tenant created
    // afterwards would silently regress to the laggy 1Hz default. Sourcing
    // from DEFAULT_RUNTIME here keeps fresh-tenant behaviour aligned with
    // the runtime contract regardless of what the SQL DEFAULTs say.
    await dbRun(
        `INSERT INTO oyon_settings (
            tenant_id,
            model_profile, sample_interval_ms, window_ms, min_valid_frames,
            smoothing_alpha, min_hold_ms, min_switch_confidence
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id) DO NOTHING`,
        [
            String(currentTenantId),
            DEFAULT_RUNTIME.model_profile,
            DEFAULT_RUNTIME.sample_interval_ms,
            DEFAULT_RUNTIME.window_ms,
            DEFAULT_RUNTIME.min_valid_frames,
            DEFAULT_RUNTIME.smoothing_alpha,
            DEFAULT_RUNTIME.min_hold_ms,
            DEFAULT_RUNTIME.min_switch_confidence,
        ]
    );
    return dbGet('SELECT * FROM oyon_settings WHERE tenant_id = ?', [String(currentTenantId)]);
}
