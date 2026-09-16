// Text analytics — how learners compose their messages to the patient, from
// stored Oyon typing episodes (one row of oyon_signal_windows per message
// composed, or abandoned).
//
// What an episode measures is keystroke TIMING and edit structure: typing
// speed, pauses, bursts, revisions, pasting. Never the words — the capture
// contract forbids it, and nothing here reads text.
//
// Framing: these are behavioural estimates of composition, not measures of a
// learner's knowledge or state. The view says so.

import {
    caseKey, caseLabel, finiteValues, groupBy, learnerKey, learnerName,
    mergePauseHistograms, payloadOf, perLearnerSummary, share, summarize,
} from './signalStats.js';

/** Typing episodes that carry a metrics block. */
export function typingEpisodes(windows) {
    return (Array.isArray(windows) ? windows : [])
        .filter((w) => w?.modality === 'typing' && payloadOf(w));
}

// ── per-episode metrics ────────────────────────────────────────────────────
// Each returns a finite number, or null when the episode does not measure it.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Characters per minute of ACTIVE input (pauses above the burst threshold are
 * excluded), falling back to wall-clock speed when active time is unavailable.
 * Active speed is the one that means "how fast they type" rather than "how long
 * the box was open".
 */
export const cpmOf = (w) => num(payloadOf(w)?.chars_per_min_active) ?? num(payloadOf(w)?.chars_per_min);
export const revisionRatioOf = (w) => num(payloadOf(w)?.revision_ratio);
export const burstCountOf = (w) => num(payloadOf(w)?.burst_count);
export const firstInputLatencyOf = (w) => num(payloadOf(w)?.first_input_latency_ms);
export const correctionCountOf = (w) => num(payloadOf(w)?.correction_count);
export const isSubmitted = (w) => payloadOf(w)?.submitted === true;
export const isAbandoned = (w) => payloadOf(w)?.abandoned === true;
/** Any pasted text at all — a pasted message is not typed composition. */
export const hasPaste = (w) => (num(payloadOf(w)?.pasted_graphemes) ?? 0) > 0;

function groupRow(episodes) {
    return {
        episodes: episodes.length,
        sessions: new Set(episodes.map((w) => w.session_id)).size,
        cpm: summarize(episodes.map(cpmOf)),
        revisionRatio: summarize(episodes.map(revisionRatioOf)),
        burstCount: summarize(episodes.map(burstCountOf)),
        firstInputLatencyMs: summarize(episodes.map(firstInputLatencyOf)),
        submittedShare: share(episodes, isSubmitted),
        abandonedShare: share(episodes, isAbandoned),
        pasteShare: share(episodes, hasPaste),
    };
}

/**
 * Everything the Text tab renders, from stored signal windows of any modality.
 *
 * @returns {{
 *   summary: object,        cohort figures — speed/revision/latency are medians of per-learner medians
 *   byLearner: object[],    one row per learner, sorted by name
 *   byCase: object[],       one row per case, sorted by label
 *   bySession: object[],    one row per session, newest first
 *   pauses: object,         pooled pause histogram across all episodes
 * }}
 */
export function textAnalytics(windows) {
    const episodes = typingEpisodes(windows);

    const byLearner = [...groupBy(episodes, learnerKey).values()]
        .map((group) => ({ key: learnerKey(group[0]), learner: learnerName(group[0]), ...groupRow(group) }))
        .sort((a, b) => a.learner.localeCompare(b.learner) || a.key.localeCompare(b.key));

    const byCase = [...groupBy(episodes, caseKey).values()]
        .map((group) => ({
            key: caseKey(group[0]),
            case: caseLabel(group[0]),
            learners: new Set(group.map(learnerKey)).size,
            ...groupRow(group),
        }))
        .sort((a, b) => a.case.localeCompare(b.case) || a.key.localeCompare(b.key));

    const bySession = [...groupBy(episodes, (w) => String(w.session_id)).values()]
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
        // Newest first; ties broken by session id so the order is deterministic.
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || String(a.key).localeCompare(String(b.key)));

    return {
        summary: {
            episodes: episodes.length,
            learners: byLearner.length,
            sessions: bySession.length,
            cases: byCase.length,
            cpm: perLearnerSummary(episodes, cpmOf),
            revisionRatio: perLearnerSummary(episodes, revisionRatioOf),
            firstInputLatencyMs: perLearnerSummary(episodes, firstInputLatencyOf),
            submittedShare: share(episodes, isSubmitted),
            abandonedShare: share(episodes, isAbandoned),
            pasteShare: share(episodes, hasPaste),
            correctionsPerEpisode: summarize(finiteValues(episodes.map(correctionCountOf))),
        },
        byLearner,
        byCase,
        bySession,
        pauses: mergePauseHistograms(episodes.map((w) => payloadOf(w)?.pause_histogram)),
    };
}
