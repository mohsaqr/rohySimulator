// Pure mapper: hydrated /addons/oyon/emotion-records rows → the EmotionWindow
// shape the <oyon-app> element's Analyze dashboards consume via
// el.setWindows(...). Rohy's DB stores each window as a fixed-column
// projection (plus parsed JSON blobs), so this is mostly a rename-free
// projection; the JSON blobs (probabilities, quality, dynamics, gaze,
// engagement) are already parsed by the server's hydrateRecord.

function finite(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function intOr(value, fallback) {
    const n = Number(value);
    return Number.isInteger(n) ? n : fallback;
}

/** One DB record → one EmotionWindow (extra host keys like user_id/username
 *  ride along — EmotionWindow has an open index signature). */
export function recordToWindow(r) {
    const rec = r && typeof r === 'object' ? r : {};
    return {
        session_id: rec.session_id != null ? String(rec.session_id) : undefined,
        user_id: rec.user_id != null ? String(rec.user_id) : undefined,
        username: rec.username || rec.student_name_snapshot || undefined,
        case_id: rec.case_id != null ? String(rec.case_id) : undefined,
        record_id: rec.record_id != null ? String(rec.record_id) : undefined,
        window_start: rec.window_start,
        window_end: rec.window_end,
        duration_ms: finite(rec.duration_ms) ?? undefined,
        expected_samples: finite(rec.expected_samples) ?? undefined,
        dominant_emotion: rec.dominant_emotion ?? null,
        probabilities: rec.probabilities ?? null,
        valence: finite(rec.valence),
        valence_std: finite(rec.valence_std),
        valence_min: finite(rec.valence_min),
        valence_max: finite(rec.valence_max),
        arousal: finite(rec.arousal),
        arousal_std: finite(rec.arousal_std),
        arousal_min: finite(rec.arousal_min),
        arousal_max: finite(rec.arousal_max),
        confidence: finite(rec.confidence) ?? 0,
        confidence_std: finite(rec.confidence_std),
        entropy: finite(rec.entropy),
        entropy_std: finite(rec.entropy_std),
        stability_score: finite(rec.stability_score),
        label_switch_count: intOr(rec.label_switch_count, undefined),
        valid_frames: intOr(rec.valid_frames, 0),
        missing_face_ratio: finite(rec.missing_face_ratio) ?? undefined,
        quality: rec.quality ?? null,
        model_name: rec.model_name ?? null,
        model_version: rec.model_version ?? null,
        model_profile: rec.model_profile ?? undefined,
        settings_snapshot: rec.settings_snapshot ?? undefined,
        dynamics: rec.dynamics ?? undefined,
        // v2 blocks (migration 0028) — null on rows captured before it ran.
        gaze: rec.gaze ?? null,
        engagement: rec.engagement ?? null,
        // Simulator-room stamp (migration 0029) — drives the per-room gaze view.
        room: rec.room ?? null,
    };
}

/** Records arrive newest-first from the API; the dashboards expect a
 *  chronological pool, so reverse into ascending window_start order. */
export function recordsToWindows(records) {
    const rows = Array.isArray(records) ? records : [];
    return rows.map(recordToWindow).reverse();
}
