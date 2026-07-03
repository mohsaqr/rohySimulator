// Emotion-sequence builder — Stage 3 of the Oyon v2 embed. Turns hydrated
// /addons/oyon/emotion-records rows (one row per sensing window, arriving
// NEWEST-FIRST from the API) into TNA-ready state sequences so the same
// network/cluster/pattern pipeline that analyses xAPI activity can analyse
// how student emotions transition during a simulated case.
//
// Two dimensions:
//   raw        — the 8 dominant-emotion classes as canonical Oyon labels
//                (anger/contempt/disgust/fear/happy/neutral/sad/surprise)
//   affective  — the 8 classes grouped into 4 clinical-training affect
//                states via EMOTION_STATE_MAP (below). This is the
//                simulator-domain analogue of chatoyon's pedagogical
//                states: fewer, denser nodes so transition structure is
//                readable on small cohorts.
//
// The mapping follows the activation × valence framing of academic
// emotions (positive vs negative, activating vs deactivating), renamed
// for a clinical-encounter context:
//   engaged     — positive affect (happy, surprise). Surprise in a sim is
//                 almost always a reaction to an unexpected finding or
//                 alarm — an engagement signal, not distress.
//   stressed    — negative-ACTIVATING (angry, fear, disgust): acuity
//                 pressure, alarm anxiety, aversion.
//   discouraged — negative-DEACTIVATING (sad, contempt). Contempt is
//                 negative-valence withdrawal/disdain; folding it into
//                 neutral would wash a negative signal out of the network,
//                 so it groups with sad rather than with neutral.
//   composed    — calm task-focused baseline (neutral).
//
// Unknown raw labels pass through literally in BOTH dimensions (same
// visibility contract as clinicalStates' literal fallback) so new model
// vocabularies surface in the UI instead of vanishing.

import { canonicalEmotionLabel } from '../../oyon/emotionVocabulary';

export const EMOTION_STATE_MAP = {
    anger: 'stressed',
    // Legacy Rohy rows/tests before the Oyon v2 vocabulary settled on
    // `anger`. Keep the alias visible so old data does not fall through.
    angry: 'stressed',
    happy: 'engaged',
    surprise: 'engaged',
    fear: 'stressed',
    disgust: 'stressed',
    sad: 'discouraged',
    contempt: 'discouraged',
    neutral: 'composed',
};

export const EMOTION_DIMENSIONS = ['raw', 'affective'];

// SQLite timestamps come back as 'YYYY-MM-DD HH:MM:SS' (no zone) or ISO
// strings; treat zoneless values as UTC — same convention as the Oyon
// session timeline. Returns NaN when unparseable.
function windowStartMs(value) {
    if (typeof value !== 'string' || !value) return NaN;
    const iso = value.includes('T') ? value : value.replace(' ', 'T');
    const hasZone = /Z$|[+-]\d\d:?\d\d$/.test(iso);
    return Date.parse(hasZone ? iso : `${iso}Z`);
}

// Human-readable per-sequence label from the snapshot fields of the
// session's earliest record, e.g. "Session 42 · alice · Chest pain".
function sequenceLabel(sessionId, rec) {
    const parts = [`Session ${sessionId}`];
    const who = rec.username || rec.student_name_snapshot
        || (rec.user_id != null ? `#${rec.user_id}` : null);
    if (who) parts.push(String(who));
    const caseLabel = rec.case_title_snapshot
        || (rec.case_id != null ? `case ${rec.case_id}` : null);
    if (caseLabel) parts.push(String(caseLabel));
    return parts.join(' · ');
}

/**
 * Build per-session emotion-state sequences from emotion-record rows.
 *
 * @param {Array<object>} records  hydrated /addons/oyon/emotion-records rows,
 *                                 newest-first (the API's order); malformed
 *                                 entries and rows without a session_id are
 *                                 skipped.
 * @param {{ dimension?: 'raw' | 'affective' }} [options]
 * @returns {{ sequences: string[][], labels: string[] }} one sequence per
 *          session (chronological window order, null/empty dominants
 *          skipped, sequences shorter than 2 dropped), plus an aligned
 *          human-readable label per sequence. Sessions are ordered by
 *          their earliest window.
 */
export function recordsToEmotionSequences(records, { dimension = 'raw' } = {}) {
    if (!EMOTION_DIMENSIONS.includes(dimension)) {
        throw new Error(`Unknown emotion dimension: ${dimension}`);
    }
    const rows = Array.isArray(records) ? records : [];

    // Group by session_id, remembering input order so ties/unparseable
    // timestamps still resolve to chronological order (input is newest-first,
    // so higher input index = earlier).
    const groups = new Map();
    rows.forEach((rec, idx) => {
        if (!rec || typeof rec !== 'object' || rec.session_id == null) return;
        const key = String(rec.session_id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ rec, idx, ms: windowStartMs(rec.window_start) });
    });

    const built = [];
    for (const [sessionId, entries] of groups) {
        entries.sort((a, b) => {
            const byTime = (Number.isFinite(a.ms) && Number.isFinite(b.ms)) ? a.ms - b.ms : 0;
            return byTime !== 0 ? byTime : b.idx - a.idx;
        });
        const states = entries
            .map(({ rec }) => {
                const dominant = rec.dominant_emotion;
                if (typeof dominant !== 'string' || !dominant) return null;
                const canonical = canonicalEmotionLabel(dominant);
                if (dimension === 'raw') return canonical;
                return EMOTION_STATE_MAP[canonical] ?? canonical;
            })
            .filter((s) => s !== null);
        if (states.length < 2) continue;
        built.push({
            sequence: states,
            label: sequenceLabel(sessionId, entries[0].rec),
            startMs: entries[0].ms,
        });
    }

    built.sort((a, b) => {
        if (Number.isFinite(a.startMs) && Number.isFinite(b.startMs)) return a.startMs - b.startMs;
        return 0;
    });

    return {
        sequences: built.map((b) => b.sequence),
        labels: built.map((b) => b.label),
    };
}
