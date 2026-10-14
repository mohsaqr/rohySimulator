/**
 * Read feedback — scoring a read WITHOUT the rubric being in the browser.
 *
 * WHY THIS EXISTS. The read recorder scores live, which means it needs the
 * rubric — every ROI, every dwell threshold — in the same process as the
 * learner. That is fine for a standalone workstation where the reader is also
 * the author, and wrong for a host that assesses learners with the case: the
 * rubric IS the answer key, and a host that strips it from the learner's
 * projection (as it must) is left with a room that records nothing and a
 * "How this slide was read" panel that can never appear.
 *
 * So the read is split in two:
 *
 *   recording  — in the browser, rubric-free: `createSampleRecorder()` keeps
 *                the viewport track and nothing else. `packReadSamples()`
 *                turns it into a compact, versioned wire shape.
 *   scoring    — wherever the rubric lives (a host's server): `assessPackedRead()`
 *                unpacks, scores with the SAME `scoreCaseRead()` the live
 *                recorder uses, and returns the full score for the host to
 *                keep plus `readFeedbackSummary()` — the part a learner may see.
 *
 * WHAT THE SUMMARY OMITS. Geometry (ROI x/y/w/h, tissue bounds), thresholds
 * (minObjective, dwellMs) and the overall read score. What remains is what the
 * feedback panel promises: per-slide coverage, key and critical findings
 * reached, magnification, time, and which findings were missed and why. It is
 * meant to be released AFTER a report is submitted — the missed findings name
 * what was there to find.
 *
 * Pure and browser-free: runs under `node --test` and on a server.
 */

import { scoreCaseRead } from './caseCore/caseAssessment.js';
import { DEFAULT_SAMPLE_INTERVAL_MS } from './readRecorder.js';

/** Version of the packed read wire shape. */
export const PACKED_READ_VERSION = 1;

/** Version of the learner-facing summary shape. */
export const READ_FEEDBACK_VERSION = 1;

/**
 * The most samples one packed read may carry. At the recorder's 400 ms
 * throttle this is over two hours of continuous movement — far beyond any
 * read — and it bounds what a host has to accept and score.
 */
export const MAX_READ_SAMPLES = 20000;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, places) => {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
};

/**
 * Pack recorder samples for transport.
 *
 * Tuples instead of objects (a sample is ~50 bytes instead of ~120) and slide
 * ids interned once. Coordinates are rounded to 0.1 level-0 pixel and the
 * objective to 0.001 — far below anything the scorer can distinguish.
 *
 * @param {Array<object>} samples  {t, x, y, w, h, objective, settled?, slideId}
 * @returns {{v: number, slides: string[], samples: number[][]}}
 */
export function packReadSamples(samples) {
    if (!Array.isArray(samples)) throw new TypeError('packReadSamples(): samples must be an array');
    const slides = [];
    const index = new Map();
    const packed = samples.map((sample, at) => {
        if (!sample || typeof sample.slideId !== 'string' || sample.slideId === '') {
            throw new TypeError(`packReadSamples(): sample at index ${at} needs a non-empty slideId`);
        }
        if (!index.has(sample.slideId)) {
            index.set(sample.slideId, slides.length);
            slides.push(sample.slideId);
        }
        return [
            index.get(sample.slideId),
            Math.round(sample.t),
            round(sample.x, 1),
            round(sample.y, 1),
            round(sample.w, 1),
            round(sample.h, 1),
            round(sample.objective, 3),
            sample.settled === false ? 0 : 1,
        ];
    });
    return { v: PACKED_READ_VERSION, slides, samples: packed };
}

/**
 * The inverse of packReadSamples, validating everything: this runs on a
 * request body. Throws TypeError / RangeError naming what is wrong.
 *
 * @param {*} packed
 * @param {{maxSamples?: number}} [options]
 * @returns {Array<object>} samples in the shape scoreCaseRead() takes
 */
export function unpackReadSamples(packed, { maxSamples = MAX_READ_SAMPLES } = {}) {
    if (!packed || typeof packed !== 'object' || Array.isArray(packed)) {
        throw new TypeError('unpackReadSamples(): a packed read must be an object');
    }
    if (packed.v !== PACKED_READ_VERSION) {
        throw new RangeError(`unpackReadSamples(): unsupported packed read version ${JSON.stringify(packed.v)}`);
    }
    const { slides, samples } = packed;
    if (!Array.isArray(slides) || !slides.every((id) => typeof id === 'string' && id !== '' && id.length <= 200)) {
        throw new TypeError('unpackReadSamples(): slides must be an array of non-empty slide ids');
    }
    if (!Array.isArray(samples)) throw new TypeError('unpackReadSamples(): samples must be an array');
    if (samples.length > maxSamples) {
        throw new RangeError(`unpackReadSamples(): ${samples.length} samples is over the ${maxSamples} a read may carry`);
    }
    return samples.map((tuple, at) => {
        if (!Array.isArray(tuple) || tuple.length !== 8 || !tuple.every(finite)) {
            throw new TypeError(`unpackReadSamples(): sample at index ${at} must be 8 finite numbers`);
        }
        const [slide, t, x, y, w, h, objective, settled] = tuple;
        if (!Number.isInteger(slide) || slide < 0 || slide >= slides.length) {
            throw new RangeError(`unpackReadSamples(): sample at index ${at} names no listed slide`);
        }
        if (w < 0 || h < 0 || objective < 0 || t < 0) {
            throw new RangeError(`unpackReadSamples(): sample at index ${at} has a negative extent, objective or time`);
        }
        if (settled !== 0 && settled !== 1) {
            throw new TypeError(`unpackReadSamples(): sample at index ${at} has a settled flag that is not 0 or 1`);
        }
        return { slideId: slides[slide], t, x, y, w, h, objective, settled: settled === 1 };
    });
}

const missedRow = (roi, slideId) => ({
    id: roi.id,
    slideId,
    label: roi.label ?? roi.id,
    critical: Boolean(roi.critical),
    missReason: roi.missReason,
});

/**
 * The learner-facing summary of a scored read.
 *
 * Accepts either a case score (`scoreCaseRead()` output: `{perSlide,
 * aggregate}`) or a single-slide score (`scoreRead()` output, with the slide
 * id supplied), so the live recorder and a server produce the same shape and
 * the feedback panel renders one thing.
 *
 * @param {object} scored
 * @param {{slideId?: string}} [options]  slide id for a single-slide score
 * @returns {object} see READ_FEEDBACK_VERSION; no geometry, no thresholds, no read score
 */
export function readFeedbackSummary(scored, { slideId = null } = {}) {
    if (!scored || typeof scored !== 'object') throw new TypeError('readFeedbackSummary(): a scored read is required');
    const perSlideScores = Array.isArray(scored.perSlide)
        ? scored.perSlide
        : [{ ...scored, slideId, weight: 1 }];
    const perSlide = perSlideScores.map((entry) => ({
        slideId: entry.slideId ?? null,
        slideCoverage: finite(entry.slideCoverage) ? entry.slideCoverage : null,
        maxObjective: finite(entry.maxObjective) ? entry.maxObjective : null,
        totalTimeMs: finite(entry.totalTimeMs) ? entry.totalTimeMs : 0,
        roiTotal: entry.roiTotal ?? 0,
        roiReached: entry.roiReached ?? 0,
        criticalTotal: entry.criticalTotal ?? 0,
        criticalReached: entry.criticalReached ?? 0,
    }));
    const sum = (key) => perSlide.reduce((total, entry) => total + entry[key], 0);
    // Coverage is weighted the way the case scorer weights slides, over the
    // slides that have a coverage figure at all (a slide with no tissue
    // bounds has none, and must not pull the mean towards zero).
    const weighted = perSlideScores
        .map((entry, at) => ({ coverage: perSlide[at].slideCoverage, weight: finite(entry.weight) ? entry.weight : 1 }))
        .filter((entry) => entry.coverage !== null);
    const weightTotal = weighted.reduce((total, entry) => total + entry.weight, 0);
    const objectives = perSlide.map((entry) => entry.maxObjective).filter((value) => value !== null);
    return {
        version: READ_FEEDBACK_VERSION,
        activityId: scored.activityId ?? null,
        totalTimeMs: sum('totalTimeMs'),
        roiTotal: sum('roiTotal'),
        roiReached: sum('roiReached'),
        criticalTotal: sum('criticalTotal'),
        criticalReached: sum('criticalReached'),
        slideCoverage: weightTotal > 0
            ? weighted.reduce((total, entry) => total + entry.coverage * entry.weight, 0) / weightTotal
            : null,
        maxObjective: objectives.length > 0 ? Math.max(...objectives) : null,
        perSlide,
        missed: perSlideScores.flatMap((entry) => (entry.perRoi ?? [])
            .filter((roi) => !roi.reached)
            .map((roi) => missedRow(roi, entry.slideId ?? slideId))),
    };
}

/**
 * Score a packed read against a protected rubric, as a host server does on
 * report submission.
 *
 * Scored exactly as the live case recorder scores (`scoreCaseRead`, with the
 * recorder's sampling interval as the tail), so a read assessed on a server
 * and one assessed in a standalone workstation agree.
 *
 * @param {object} packed     packReadSamples() output
 * @param {object} rubric     the protected v1 rubric
 * @param {{activityId?: string, maxSamples?: number}} [options]
 * @returns {{scored: object, feedback: object, sampleCount: number}}
 *   `scored` is the full result (keep it server-side); `feedback` is what the
 *   learner may receive.
 */
export function assessPackedRead(packed, rubric, { activityId, maxSamples } = {}) {
    const samples = unpackReadSamples(packed, maxSamples === undefined ? {} : { maxSamples });
    const scored = scoreCaseRead(samples, rubric, {
        ...(activityId === undefined ? {} : { activityId }),
        tailMs: DEFAULT_SAMPLE_INTERVAL_MS,
    });
    return { scored, feedback: readFeedbackSummary(scored), sampleCount: samples.length };
}
