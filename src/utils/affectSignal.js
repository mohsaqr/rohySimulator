// Pure builder of the per-turn student-affect wire signal (Plan A,
// todo/plan-a-implementation-spec.md). No React, no I/O: snapshot + settings
// in, a small structured signal (or null) out. The signal is intentionally
// NOT prompt text — the server composes the actual note from enum-validated
// fields (server/shared/affectNote.js), so nothing free-form crosses the wire.
//
// This is a courtesy pre-filter: the server re-checks freshness, confidence,
// mode, and provider policy authoritatively. Building nothing when the signal
// is stale/weak just saves bytes and keeps the DiagnosticBar honest.

import { canonicalEmotionLabel, OYON_EMOTION_LABELS } from '../components/oyon/emotionVocabulary';
import { ANXIOUS_FLAG_THRESHOLD } from '../components/oyon/anxiousIndex';

/**
 * Build the wire signal for the current turn.
 *
 * @param {{sample: object|null}|null} snapshot from getAffectSnapshot()
 * @param {{enabled?: boolean, affect_mode?: string, min_confidence?: number,
 *   max_age_ms?: number}|null} settings normalized affect-routing settings
 *   (GET /platform-settings/affect)
 * @param {number} [now] injectable clock for tests
 * @returns {{mode: string, label?: string, anxious?: boolean,
 *   confidence: number, age_ms: number}|null} null when nothing should route
 */
export function buildAffectSignal(snapshot, settings, now = Date.now()) {
    const mode = settings?.affect_mode;
    if (!settings?.enabled || (mode !== 'dominant' && mode !== 'anxious')) return null;

    const sample = snapshot?.sample;
    if (!sample || !Number.isFinite(sample.ts)) return null;

    const ageMs = Math.max(0, now - sample.ts);
    const maxAge = Number.isFinite(settings.max_age_ms) ? settings.max_age_ms : 20000;
    if (ageMs > maxAge) return null;

    const confidence = Number.isFinite(sample.confidence)
        ? Math.min(1, Math.max(0, sample.confidence))
        : 0;
    const minConfidence = Number.isFinite(settings.min_confidence) ? settings.min_confidence : 0.4;
    if (confidence < minConfidence) return null;

    if (mode === 'dominant') {
        const label = canonicalEmotionLabel(sample.dominant);
        if (!label || !OYON_EMOTION_LABELS.includes(label)) return null;
        return { mode, label, confidence, age_ms: Math.round(ageMs) };
    }

    // anxious: the derived index is null when unknown — "unknown" routes
    // nothing (distinct from 0 = "known calm", anxiousIndex.js contract).
    const idx = sample.anxiousIndex;
    if (!Number.isFinite(idx)) return null;
    return { mode, anxious: idx >= ANXIOUS_FLAG_THRESHOLD, confidence, age_ms: Math.round(ageMs) };
}
