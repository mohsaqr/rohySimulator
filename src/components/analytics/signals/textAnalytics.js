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
/** Share of everything typed that survived into the final message (typing-v3). */
export const productRatioOf = (w) => num(payloadOf(w)?.product_ratio);
/** Share of revisions made at or near the point of writing (typing-v3). */
export const leadingEdgeRevisionOf = (w) => num(payloadOf(w)?.leading_edge_revision_ratio);

/**
 * Share of an episode's bursts that ended in a revision rather than a pause
 * (Chenoweth & Hayes' R- vs P-bursts). Null when the episode had no bursts or
 * predates typing-v3.
 */
export function revisionBurstShareOf(w) {
    const p = num(payloadOf(w)?.p_burst_count);
    const r = num(payloadOf(w)?.r_burst_count);
    if (p === null || r === null || p + r === 0) return null;
    return r / (p + r);
}

/**
 * Whether an episode kept its per-edit series (positioned edits or keystroke
 * intervals) — what the writing-process charts draw. A summary-only episode
 * still counts in every cohort figure; it just has no process to draw.
 */
export function hasEditSeries(w) {
    const t = payloadOf(w);
    return (Array.isArray(t?.revision_locations) && t.revision_locations.length > 0)
        || (Array.isArray(t?.inter_event_intervals_ms) && t.inter_event_intervals_ms.length > 0);
}

/** Where the caret sat when a pause began — keys from Oyon's typing-v3 aggregator. */
export const PAUSE_LOCATIONS = Object.freeze([
    { key: 'mid_word', label: 'Mid-word' },
    { key: 'word_boundary', label: 'Between words' },
    { key: 'sentence_boundary', label: 'Between sentences' },
    { key: 'paragraph_boundary', label: 'Between paragraphs' },
]);

/**
 * Pooled pause-location counts. Episodes without the field (the adapter
 * supplied no boundary context) are counted as `unmeasured`, never as zeros.
 */
export function mergePauseLocations(episodes) {
    const counts = Object.fromEntries(PAUSE_LOCATIONS.map(({ key }) => [key, 0]));
    let measured = 0;
    for (const w of episodes) {
        const loc = payloadOf(w)?.pause_location_counts;
        if (!loc || typeof loc !== 'object') continue;
        measured += 1;
        for (const { key } of PAUSE_LOCATIONS) counts[key] += num(loc[key]) ?? 0;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
        total,
        measured,
        unmeasured: episodes.length - measured,
        buckets: PAUSE_LOCATIONS.map(({ key, label }) => ({
            key, label, count: counts[key], share: total > 0 ? counts[key] / total : 0,
        })),
    };
}

function groupRow(episodes) {
    return {
        episodes: episodes.length,
        sessions: new Set(episodes.map((w) => w.session_id)).size,
        cpm: summarize(episodes.map(cpmOf)),
        revisionRatio: summarize(episodes.map(revisionRatioOf)),
        burstCount: summarize(episodes.map(burstCountOf)),
        firstInputLatencyMs: summarize(episodes.map(firstInputLatencyOf)),
        productRatio: summarize(episodes.map(productRatioOf)),
        revisionBurstShare: summarize(episodes.map(revisionBurstShareOf)),
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
 *   pauseLocations: object, pooled pause counts by caret context, with unmeasured episodes counted
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
            productRatio: perLearnerSummary(episodes, productRatioOf),
            revisionBurstShare: perLearnerSummary(episodes, revisionBurstShareOf),
            leadingEdgeRevision: perLearnerSummary(episodes, leadingEdgeRevisionOf),
            submittedShare: share(episodes, isSubmitted),
            abandonedShare: share(episodes, isAbandoned),
            pasteShare: share(episodes, hasPaste),
            correctionsPerEpisode: summarize(finiteValues(episodes.map(correctionCountOf))),
        },
        byLearner,
        byCase,
        bySession,
        pauses: mergePauseHistograms(episodes.map((w) => payloadOf(w)?.pause_histogram)),
        pauseLocations: mergePauseLocations(episodes),
    };
}
