// Shared statistics for the Text and Voice analytics tabs.
//
// Pure functions over plain numbers and stored Oyon signal windows — no React,
// no fetching — so the numbers an educator reads are unit-tested directly.
//
// Two choices are deliberate and apply everywhere these are used:
//
//   1. Medians and IQRs, never means. Typing speed and pause counts are
//      right-skewed: one learner who pastes a paragraph, or a turn that runs
//      on for a minute, drags a mean somewhere no learner actually is.
//
//   2. Cohort figures are the median of PER-LEARNER medians. Windows are
//      nested in learners, and learners do not produce equal numbers of them.
//      Pooling every window would let the most prolific learner decide the
//      cohort's "typical" value; summarising each learner first gives every
//      learner one vote.

/** Okabe-Ito: colour-blind safe. Every use is paired with a text label. */
export const OKABE_ITO = Object.freeze([
    '#E69F00', '#56B4E9', '#009E73', '#F0E442',
    '#0072B2', '#D55E00', '#CC79A7', '#999999', '#000000',
]);

/** Finite numbers only — null, undefined, NaN and ±Infinity are dropped. */
export function finiteValues(values) {
    return (Array.isArray(values) ? values : []).filter((v) => typeof v === 'number' && Number.isFinite(v));
}

/**
 * Sample quantile, R type 7 (numpy's default linear interpolation).
 * Returns null for an empty sample rather than inventing a number.
 */
export function quantile(values, q) {
    if (!(q >= 0 && q <= 1)) throw new RangeError(`quantile: q must be in [0, 1], got ${q}`);
    const xs = finiteValues(values).slice().sort((a, b) => a - b);
    if (xs.length === 0) return null;
    const h = (xs.length - 1) * q;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return xs[lo] + (h - lo) * (xs[hi] - xs[lo]);
}

export const median = (values) => quantile(values, 0.5);

/** Median with its quartiles and the sample size it rests on. */
export function summarize(values) {
    const xs = finiteValues(values);
    return {
        n: xs.length,
        median: quantile(xs, 0.5),
        q1: quantile(xs, 0.25),
        q3: quantile(xs, 0.75),
    };
}

/** Share of `items` for which `predicate` holds; null when there are none. */
export function share(items, predicate) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return null;
    return list.filter(predicate).length / list.length;
}

/** Group into a Map preserving first-seen key order. Null keys are grouped under null. */
export function groupBy(items, keyOf) {
    const groups = new Map();
    for (const item of items) {
        const key = keyOf(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return groups;
}

/**
 * Cohort summary that gives every learner one vote: take each learner's median
 * of `metric`, then summarise those medians. `n` is the number of LEARNERS
 * with at least one finite value, not the number of windows.
 */
export function perLearnerSummary(windows, metric) {
    const learnerMedians = [];
    for (const group of groupBy(windows, learnerKey).values()) {
        const m = median(group.map(metric));
        if (m !== null) learnerMedians.push(m);
    }
    return summarize(learnerMedians);
}

// ── identity of a stored window ────────────────────────────────────────────

/** Stable key for the learner a window belongs to. */
export function learnerKey(w) {
    return w?.user_id != null ? `u:${w.user_id}` : `n:${learnerName(w)}`;
}

export function learnerName(w) {
    return w?.student_name_snapshot || w?.username || (w?.user_id != null ? `User ${w.user_id}` : 'Unknown learner');
}

export function caseKey(w) {
    return w?.case_id != null ? `c:${w.case_id}` : 'c:none';
}

export function caseLabel(w) {
    return w?.case_title_snapshot || (w?.case_id != null ? `Case ${w.case_id}` : 'No case');
}

/** The metrics block of a stored window — hydrated `payload`, or null. */
export function payloadOf(w) {
    const p = w?.payload;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
}

// ── pause histograms ───────────────────────────────────────────────────────

/**
 * Oyon's pause-histogram keys for the default buckets [500, 1000, 2000, 5000]
 * ms, shared by typing and voice. Order matters: it is the axis order.
 */
export const PAUSE_BUCKETS = Object.freeze([
    { key: 'lt_500_ms', label: '< 0.5 s' },
    { key: '500_to_1000_ms', label: '0.5–1 s' },
    { key: '1000_to_2000_ms', label: '1–2 s' },
    { key: '2000_to_5000_ms', label: '2–5 s' },
    { key: 'gte_5000_ms', label: '≥ 5 s' },
]);

/**
 * Sum pause histograms across windows, in axis order. A window whose histogram
 * uses keys outside the default buckets (a tenant with custom thresholds) is
 * counted in `skipped` rather than silently mis-binned.
 */
export function mergePauseHistograms(histograms) {
    const counts = Object.fromEntries(PAUSE_BUCKETS.map((b) => [b.key, 0]));
    const known = new Set(Object.keys(counts));
    let skipped = 0;
    for (const h of histograms) {
        if (!h || typeof h !== 'object') continue;
        const keys = Object.keys(h);
        if (keys.length === 0) continue;
        if (keys.some((k) => !known.has(k))) { skipped += 1; continue; }
        for (const k of keys) {
            const v = h[k];
            if (typeof v === 'number' && Number.isFinite(v) && v >= 0) counts[k] += v;
        }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
        total,
        skipped,
        buckets: PAUSE_BUCKETS.map((b) => ({
            key: b.key,
            label: b.label,
            count: counts[b.key],
            share: total > 0 ? counts[b.key] / total : 0,
        })),
    };
}
