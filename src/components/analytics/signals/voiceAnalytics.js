// Voice analytics — how learners speak to the patient in voice mode, from
// stored Oyon voice turns (one row of oyon_signal_windows per spoken turn).
//
// A turn is a per-turn SUMMARY: speech/silence ratio, pauses, pitch, loudness,
// spectral shape. No audio, no waveform, no transcript — verified against a
// real stored window (~2 KB, no per-frame arrays).
//
// Analysable vs insufficient: Oyon flags a turn `insufficient_data` when it
// holds too little speech to measure (a click-and-release, a noisy room, a
// detector that never initialised). Averaging those in would drag every voice
// metric toward zero, so metrics are computed over ANALYSABLE turns only, and
// the insufficient ones are counted and reported with their reasons — never
// silently dropped.

import {
    caseKey, caseLabel, groupBy, learnerKey, learnerName,
    mergePauseHistograms, payloadOf, perLearnerSummary, share, summarize,
} from './signalStats.js';

/** Voice turns that carry a metrics block. */
export function voiceTurns(windows) {
    return (Array.isArray(windows) ? windows : [])
        .filter((w) => w?.modality === 'voice' && payloadOf(w));
}

export const isAnalysable = (w) => payloadOf(w)?.insufficient_data !== true;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Metrics are read only from analysable turns — see the header.
const analysable = (fn) => (w) => (isAnalysable(w) ? fn(w) : null);

export const speechRatioOf = analysable((w) => num(payloadOf(w)?.speech_ratio));
export const turnDurationOf = analysable((w) => num(payloadOf(w)?.turn_duration_ms));
export const speechDurationOf = analysable((w) => num(payloadOf(w)?.speech_duration_ms));
export const pitchMedianOf = analysable((w) => num(payloadOf(w)?.pitch_median_hz));
export const pitchIqrOf = analysable((w) => num(payloadOf(w)?.pitch_iqr_hz));
export const loudnessOf = analysable((w) => num(payloadOf(w)?.rms_mean));
export const internalPausesOf = analysable((w) => num(payloadOf(w)?.internal_pause_count));

function groupRow(turns) {
    const ok = turns.filter(isAnalysable);
    return {
        turns: turns.length,
        analysableTurns: ok.length,
        insufficientShare: share(turns, (w) => !isAnalysable(w)),
        sessions: new Set(turns.map((w) => w.session_id)).size,
        speechRatio: summarize(turns.map(speechRatioOf)),
        turnDurationMs: summarize(turns.map(turnDurationOf)),
        pitchMedianHz: summarize(turns.map(pitchMedianOf)),
        internalPauses: summarize(turns.map(internalPausesOf)),
    };
}

/** Why turns were not analysable, most common first. Ties broken by reason name. */
export function insufficientReasons(turns) {
    const counts = new Map();
    for (const w of turns) {
        if (isAnalysable(w)) continue;
        const reasons = payloadOf(w)?.insufficient_reasons;
        const list = Array.isArray(reasons) && reasons.length ? reasons : ['unspecified'];
        for (const r of list) counts.set(String(r), (counts.get(String(r)) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/**
 * Everything the Voice tab renders, from stored signal windows of any modality.
 * Cohort figures are medians of per-learner medians over analysable turns.
 */
export function voiceAnalytics(windows) {
    const turns = voiceTurns(windows);
    const ok = turns.filter(isAnalysable);

    const byLearner = [...groupBy(turns, learnerKey).values()]
        .map((group) => ({ key: learnerKey(group[0]), learner: learnerName(group[0]), ...groupRow(group) }))
        .sort((a, b) => a.learner.localeCompare(b.learner) || a.key.localeCompare(b.key));

    const byCase = [...groupBy(turns, caseKey).values()]
        .map((group) => ({
            key: caseKey(group[0]),
            case: caseLabel(group[0]),
            learners: new Set(group.map(learnerKey)).size,
            ...groupRow(group),
        }))
        .sort((a, b) => a.case.localeCompare(b.case) || a.key.localeCompare(b.key));

    const bySession = [...groupBy(turns, (w) => String(w.session_id)).values()]
        .map((group) => {
            const starts = group.map((w) => w.window_start).filter(Boolean).sort();
            return {
                key: String(group[0].session_id),
                sessionId: group[0].session_id,
                learner: learnerName(group[0]),
                case: caseLabel(group[0]),
                startedAt: starts[0] ?? null,
                ...groupRow(group),
            };
        })
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || String(a.key).localeCompare(String(b.key)));

    return {
        summary: {
            turns: turns.length,
            analysableTurns: ok.length,
            insufficientShare: share(turns, (w) => !isAnalysable(w)),
            learners: byLearner.length,
            sessions: bySession.length,
            cases: byCase.length,
            speechRatio: perLearnerSummary(ok, speechRatioOf),
            turnDurationMs: perLearnerSummary(ok, turnDurationOf),
            pitchMedianHz: perLearnerSummary(ok, pitchMedianOf),
            internalPauses: perLearnerSummary(ok, internalPausesOf),
        },
        insufficientReasons: insufficientReasons(turns),
        byLearner,
        byCase,
        bySession,
        pauses: mergePauseHistograms(ok.map((w) => payloadOf(w)?.pause_histogram)),
    };
}
