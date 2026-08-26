/**
 * Read assessment — scoring HOW a slide was read, not just what was answered.
 *
 * WHY this module is the reason the package exists. Rohy's survey engine can
 * already score "what is the diagnosis?". Nothing in Rohy can score the
 * search: whether the trainee ever put the diagnostic focus on screen, at a
 * magnification that could resolve it, for long enough to see it — or whether
 * they guessed correctly having never looked at the lesion. Those two
 * outcomes are indistinguishable in an answer-only assessment and are
 * completely different educationally.
 *
 * Everything here is a pure function of a sample array and an answer key, so
 * it can be run live in the room, re-run server-side on the persisted
 * learning_events, and unit-tested without a browser.
 *
 * A "sample" is one viewport observation:
 *   { t, x, y, w, h, objective }
 *   t          ms since read start (monotonic; NOT wall clock)
 *   x,y,w,h    viewport rect in SLIDE (level-0) coordinates
 *   objective  objective-equivalent magnification at that instant
 *
 * TWO DIFFERENT THRESHOLDS, easily and wrongly conflated:
 *   screeningObjective  the low/high power SPLIT, for reporting how the time
 *                       was divided. Default 5x.
 *   coverageObjective   the FLOOR at which a field counts toward spatial
 *                       coverage. Default 2x, and deliberately lower: a
 *                       pathologist screens a slide at 2-4x, so requiring 5x
 *                       would score a textbook low-power screen as 0%
 *                       covered. It must not be 0 either — at 1x a single
 *                       field spans most of the tissue, so anyone who opened
 *                       the slide would score 100% without panning at all.
 *
 * An ROI is one thing the learner was supposed to find:
 *   { id, label, x, y, w, h, minObjective, dwellMs, critical }
 *   minObjective  below this the feature is not resolvable — being "on" it at
 *                 2x does not count as having seen it
 *   dwellMs       cumulative on-target time required to count as seen
 */

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function validateSamples(samples) {
    if (!Array.isArray(samples)) {
        throw new TypeError(`scoreRead(): samples must be an array, received ${typeof samples}`);
    }
    const bad = samples.findIndex((s) =>
        !s || !['t', 'x', 'y', 'w', 'h', 'objective'].every((k) => isFiniteNumber(s[k])));
    if (bad !== -1) {
        throw new TypeError(
            `scoreRead(): sample at index ${bad} is missing a finite t/x/y/w/h/objective — `
            + `received ${JSON.stringify(samples[bad])}`,
        );
    }
    // Out-of-order samples would produce negative dwell. Surface it rather
    // than silently sorting, because it means the emitter is broken.
    const unordered = samples.findIndex((s, i) => i > 0 && s.t < samples[i - 1].t);
    if (unordered !== -1) {
        throw new RangeError(
            `scoreRead(): samples must be in non-decreasing time order; index ${unordered} `
            + `(t=${samples[unordered].t}) precedes index ${unordered - 1} (t=${samples[unordered - 1].t})`,
        );
    }
    return samples;
}

function validateRois(rois) {
    if (!Array.isArray(rois)) {
        throw new TypeError(`scoreRead(): answerKey.roi must be an array, received ${typeof rois}`);
    }
    const bad = rois.findIndex((r) => !r || !r.id || !['x', 'y', 'w', 'h', 'minObjective'].every((k) => isFiniteNumber(r[k])));
    if (bad !== -1) {
        throw new TypeError(
            `scoreRead(): ROI at index ${bad} needs an id and finite x/y/w/h/minObjective — `
            + `received ${JSON.stringify(rois[bad])}`,
        );
    }
    return rois;
}

// Per-sample time attribution: each sample owns the interval until the next
// one. The final sample owns `tailMs` (default 0) — a read that ends on a
// target should not be credited with unbounded dwell just because no further
// sample arrived.
function sampleDurations(samples, tailMs) {
    return samples.map((s, i) => (i < samples.length - 1 ? samples[i + 1].t - s.t : tailMs));
}

const centre = (r) => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2 });

// An ROI counts as ON SCREEN when its centre lies inside the viewport. Centre
// rather than overlap: a lesion clipped at the very edge of the field is not
// something a pathologist has actually examined.
function roiOnScreen(roi, sample) {
    const { cx, cy } = centre(roi);
    return cx >= sample.x && cx <= sample.x + sample.w
        && cy >= sample.y && cy <= sample.y + sample.h;
}

/**
 * Score one slide read.
 *
 * @param {Array} samples    viewport samples, time-ordered
 * @param {object} answerKey {roi: Array, screeningObjective?: number, coverageObjective?: number, tissueBounds?: {x,y,w,h}, coverageGrid?: number}
 * @param {object} [options] {tailMs?: number}
 * @returns {object} flat, one-level result:
 *   roiTotal, roiReached, roiCoverage, criticalTotal, criticalReached,
 *   totalTimeMs, screeningTimeMs, highPowerTimeMs, objectiveChanges,
 *   maxObjective, meanObjective, slideCoverage, timeToFirstCriticalMs,
 *   readScore, perRoi[]
 *   `perRoi` is one row per ROI — id, label, critical, reached, dwellMs,
 *   requiredDwellMs, firstOnScreenMs, firstResolvedMs, maxObjectiveOnRoi,
 *   missReason.
 */
export function scoreRead(samples, answerKey, options = {}) {
    validateSamples(samples);
    if (!answerKey || typeof answerKey !== 'object') {
        throw new TypeError(`scoreRead(): answerKey must be an object, received ${typeof answerKey}`);
    }
    const rois = validateRois(answerKey.roi ?? []);
    const tailMs = options.tailMs ?? 0;
    if (!isFiniteNumber(tailMs) || tailMs < 0) {
        throw new TypeError(`scoreRead(): options.tailMs must be a finite non-negative number, received ${tailMs}`);
    }

    const durations = sampleDurations(samples, tailMs);
    const totalTimeMs = durations.reduce((a, b) => a + b, 0);
    const screeningObjective = answerKey.screeningObjective ?? 5;
    const coverageObjective = answerKey.coverageObjective ?? 2;

    // --- per-ROI --------------------------------------------------------
    const perRoi = rois.map((roi) => {
        const requiredDwellMs = roi.dwellMs ?? 1000;

        // Walk the samples once, accumulating dwell and remembering the
        // instant the required dwell was first satisfied.
        const walk = samples.reduce((acc, s, i) => {
            if (!roiOnScreen(roi, s)) return acc;
            const resolved = s.objective >= roi.minObjective;
            const firstOnScreenMs = acc.firstOnScreenMs ?? s.t;
            const maxObjectiveOnRoi = Math.max(acc.maxObjectiveOnRoi, s.objective);
            if (!resolved) return { ...acc, firstOnScreenMs, maxObjectiveOnRoi };
            const dwellMs = acc.dwellMs + durations[i];
            const firstResolvedMs = acc.firstResolvedMs ?? s.t;
            const reachedAtMs = acc.reachedAtMs
                ?? (dwellMs >= requiredDwellMs ? s.t + durations[i] : null);
            return { dwellMs, firstOnScreenMs, firstResolvedMs, reachedAtMs, maxObjectiveOnRoi };
        }, {
            dwellMs: 0,
            firstOnScreenMs: null,
            firstResolvedMs: null,
            reachedAtMs: null,
            maxObjectiveOnRoi: 0,
        });

        const reached = walk.dwellMs >= requiredDwellMs;

        // The miss reason is the teachable part: "never went there" and
        // "went there but stayed at 2x" call for different feedback.
        const missReason = reached ? null
            : walk.firstOnScreenMs === null ? 'never_on_screen'
                : walk.firstResolvedMs === null ? 'insufficient_magnification'
                    : 'insufficient_dwell';

        return {
            id: roi.id,
            label: roi.label ?? roi.id,
            critical: !!roi.critical,
            reached,
            dwellMs: walk.dwellMs,
            requiredDwellMs,
            firstOnScreenMs: walk.firstOnScreenMs,
            firstResolvedMs: walk.firstResolvedMs,
            reachedAtMs: walk.reachedAtMs,
            maxObjectiveOnRoi: walk.maxObjectiveOnRoi,
            minObjective: roi.minObjective,
            missReason,
        };
    });

    const reachedRois = perRoi.filter((r) => r.reached);
    const criticalRois = perRoi.filter((r) => r.critical);
    const criticalReached = criticalRois.filter((r) => r.reached);
    const criticalReachTimes = criticalReached
        .map((r) => r.reachedAtMs)
        .filter((t) => t !== null);

    // --- magnification behaviour ----------------------------------------
    const objectives = samples.map((s) => s.objective);
    const screeningTimeMs = samples.reduce(
        (a, s, i) => a + (s.objective < screeningObjective ? durations[i] : 0), 0);
    const objectiveChanges = samples.reduce(
        (a, s, i) => a + (i > 0 && s.objective !== samples[i - 1].objective ? 1 : 0), 0);
    const weightedObjective = samples.reduce((a, s, i) => a + s.objective * durations[i], 0);

    // --- spatial coverage -------------------------------------------------
    // Grid over the declared tissue bounds; a cell counts as covered when a
    // sample at or above coverageObjective overlapped it. Bounds must be
    // declared — inferring them from the samples would let a trainee who only
    // looked at one corner score 100% coverage of that corner.
    const slideCoverage = answerKey.tissueBounds
        ? gridCoverage(samples, answerKey.tissueBounds, answerKey.coverageGrid ?? 12, coverageObjective)
        : null;

    const roiCoverage = perRoi.length > 0 ? reachedRois.length / perRoi.length : null;

    return {
        roiTotal: perRoi.length,
        roiReached: reachedRois.length,
        roiCoverage,
        criticalTotal: criticalRois.length,
        criticalReached: criticalReached.length,
        totalTimeMs,
        screeningTimeMs,
        highPowerTimeMs: totalTimeMs - screeningTimeMs,
        objectiveChanges,
        maxObjective: objectives.length > 0 ? Math.max(...objectives) : null,
        meanObjective: totalTimeMs > 0 ? weightedObjective / totalTimeMs : null,
        slideCoverage,
        coverageObjective,
        timeToFirstCriticalMs: criticalReachTimes.length > 0 ? Math.min(...criticalReachTimes) : null,
        readScore: readScore(perRoi, slideCoverage),
        perRoi,
    };
}

// Composite 0..1 read quality. Critical ROIs are weighted 3x — missing the
// diagnostic focus is not the same kind of error as missing a supporting
// feature. Coverage contributes a fifth so a lucky direct hit on the lesion
// without screening the rest of the slide does not score as a perfect read.
function readScore(perRoi, slideCoverage) {
    if (perRoi.length === 0) return null;
    const weight = (r) => (r.critical ? 3 : 1);
    const earned = perRoi.reduce((a, r) => a + (r.reached ? weight(r) : 0), 0);
    const possible = perRoi.reduce((a, r) => a + weight(r), 0);
    const roiPart = earned / possible;
    return slideCoverage === null ? roiPart : 0.8 * roiPart + 0.2 * slideCoverage;
}

/**
 * Fraction of a bounding box brought on screen at or above `minObjective`.
 * Exported for the read-path overlay, which shades the same grid.
 *
 * @returns {number} 0..1
 */
export function gridCoverage(samples, bounds, grid, minObjective) {
    if (!isFiniteNumber(grid) || grid < 1) {
        throw new TypeError(`gridCoverage(): grid must be a number >= 1, received ${grid}`);
    }
    if (!bounds || !['x', 'y', 'w', 'h'].every((k) => isFiniteNumber(bounds[k])) || bounds.w <= 0 || bounds.h <= 0) {
        throw new TypeError(`gridCoverage(): bounds needs finite x/y and positive w/h, received ${JSON.stringify(bounds)}`);
    }
    const cellW = bounds.w / grid;
    const cellH = bounds.h / grid;
    const visible = samples.filter((s) => s.objective >= minObjective);

    const covered = new Set();
    // Index arithmetic per sample: mark the cell span the viewport overlaps,
    // clamped to the grid. Cheaper than testing every cell against every
    // sample (grid^2 x samples).
    visible.forEach((s) => {
        const i0 = Math.max(0, Math.floor((s.x - bounds.x) / cellW));
        const i1 = Math.min(grid - 1, Math.floor((s.x + s.w - bounds.x) / cellW));
        const j0 = Math.max(0, Math.floor((s.y - bounds.y) / cellH));
        const j1 = Math.min(grid - 1, Math.floor((s.y + s.h - bounds.y) / cellH));
        Array.from({ length: Math.max(0, i1 - i0 + 1) }, (_, di) => i0 + di).forEach((i) => {
            Array.from({ length: Math.max(0, j1 - j0 + 1) }, (_, dj) => j0 + dj).forEach((j) => {
                covered.add(`${i},${j}`);
            });
        });
    });
    return covered.size / (grid * grid);
}
