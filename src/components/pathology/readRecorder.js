/**
 * Read recorder — the live half of read assessment.
 *
 * scoreRead() is a batch function over a finished read. The room needs the
 * same information *during* the read, to fire REACHED_ROI the moment a
 * trainee resolves a focus. The naive version re-scores on every sample and
 * emits whatever is currently reached — which re-emits the same ROI forever.
 *
 * This module owns the two pieces of state that prevents:
 *   - `emitted`, so each ROI fires exactly once per read
 *   - `lastSampleAt`, so a 60 fps pan does not write 60 rows a second
 *   - `lastSettledObjective`, so a zoom spring produces one objective change
 *     from its starting power to its settled power, rather than one change
 *     for every retained animation frame
 * Both are held in a plain object rather than a React ref so the logic is
 * testable without a renderer.
 */

import { DEFAULT_OBJECTIVE_EPSILON, scoreRead } from './readAssessment.js';
import { scoreCaseRead } from './caseCore/caseAssessment.js';

/** Minimum gap between retained viewport samples. */
export const DEFAULT_SAMPLE_INTERVAL_MS = 400;

/**
 * @param {object} answerKey  as accepted by scoreRead
 * @param {object} [options]  {sampleIntervalMs, objectiveEpsilon}
 * @returns {{accept:Function, result:Function, samples:Function, finish:Function}}
 */
export function createReadRecorder(answerKey, options = {}) {
    if (!answerKey || !Array.isArray(answerKey.roi)) {
        throw new TypeError('createReadRecorder(answerKey): answerKey.roi must be an array');
    }
    const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
    // Objectives are floats off a zoom spring; two readings within this are
    // the same magnification for logging purposes.
    const objectiveEpsilon = options.objectiveEpsilon ?? DEFAULT_OBJECTIVE_EPSILON;
    if (typeof objectiveEpsilon !== 'number' || !Number.isFinite(objectiveEpsilon) || objectiveEpsilon < 0) {
        throw new TypeError(
            'createReadRecorder(): objectiveEpsilon must be a finite non-negative number, '
            + `received ${objectiveEpsilon}`,
        );
    }

    const state = {
        samples: [],
        emitted: new Set(),
        lastSampleAt: null,
        lastSettledObjective: null,
    };

    return {
        /**
         * Offer a viewport observation. Returns what the room should do about
         * it — never performs the logging itself, so the caller keeps control
         * of ordering and the recorder stays pure of side effects.
         *
         * @param {object} sample  viewportSample() output
         * @param {object} [observation]  {settled}; false for zoom-animation frames
         * @returns {{recorded:boolean, roiReached:Array, objectiveChanged:null|{from:number,to:number}}}
         */
        accept(sample, observation = {}) {
            if (observation.settled !== undefined && typeof observation.settled !== 'boolean') {
                throw new TypeError(
                    'createReadRecorder().accept(): observation.settled must be boolean when supplied, '
                    + `received ${JSON.stringify(observation.settled)}`,
                );
            }
            // Direct callers predate the observation metadata, so an omitted
            // flag remains a settled observation. SlideCanvas explicitly
            // marks animation frames false and animation endpoints true.
            const settled = observation.settled ?? true;
            const objectiveChanged = settled
                && state.lastSettledObjective !== null
                && Math.abs(sample.objective - state.lastSettledObjective) > objectiveEpsilon
                ? { from: state.lastSettledObjective, to: sample.objective }
                : null;
            if (settled) state.lastSettledObjective = sample.objective;

            const tooSoon = state.lastSampleAt !== null
                && sample.t - state.lastSampleAt < sampleIntervalMs;
            // A settled zoom endpoint is the authoritative power. Retain it
            // even when the last animation frame was sampled less than one
            // interval ago; otherwise the event and the finished read would
            // both be left at an intermediate spring value.
            if (tooSoon && !objectiveChanged) {
                return { recorded: false, roiReached: [], objectiveChanged: null };
            }

            // Preserve the phase on the retained sample so scoreRead() can
            // count objective changes from the same settled endpoints used
            // by the event logger, without discarding animation exposure.
            state.samples.push({ ...sample, settled });
            state.lastSampleAt = sample.t;

            // Score with a tail so the sample just added can itself satisfy a
            // dwell requirement; otherwise the final sample always counts 0
            // and an ROI is only ever "reached" one sample late.
            const scored = scoreRead(state.samples, answerKey, {
                tailMs: sampleIntervalMs,
                objectiveEpsilon,
            });
            const roiReached = scored.perRoi
                .filter((r) => r.reached && !state.emitted.has(r.id));
            roiReached.forEach((r) => state.emitted.add(r.id));

            return { recorded: true, roiReached, objectiveChanged };
        },

        /** Current score over everything accepted so far. */
        result() {
            return scoreRead(state.samples, answerKey, {
                tailMs: sampleIntervalMs,
                objectiveEpsilon,
            });
        },

        /** Retained samples — persist these to reconstruct the read path. */
        samples() {
            return [...state.samples];
        },

        /**
         * Close the read. Returns the final score plus the ROIs that were
         * never reached, so the room can emit MISSED_ROI once each and the
         * feedback panel can explain why.
         */
        finish() {
            const scored = this.result();
            return { ...scored, missed: scored.perRoi.filter((r) => !r.reached) };
        },
    };
}

/**
 * Record and score a multi-slide read against a protected v1 rubric.
 *
 * The ordinary recorder intentionally remains unchanged for legacy hosts.
 * This variant requires every sample to carry `slideId`, keeps objective
 * transitions separate per slide, and delegates finished scoring to the
 * slide-isolated case scorer.
 *
 * @param {object} rubric protected v1 rubric
 * @param {object} [options] {activityId, sampleIntervalMs, objectiveEpsilon}
 * @returns {{accept:Function,result:Function,samples:Function,finish:Function}}
 */
export function createCaseReadRecorder(rubric, options = {}) {
    const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
    const objectiveEpsilon = options.objectiveEpsilon ?? DEFAULT_OBJECTIVE_EPSILON;
    if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs < 0) {
        throw new TypeError('createCaseReadRecorder(): sampleIntervalMs must be finite and non-negative');
    }
    if (!Number.isFinite(objectiveEpsilon) || objectiveEpsilon < 0) {
        throw new TypeError('createCaseReadRecorder(): objectiveEpsilon must be finite and non-negative');
    }
    // Exercise the full rubric boundary before accepting live data.
    scoreCaseRead([], rubric, { activityId: options.activityId, tailMs: 0, objectiveEpsilon });

    const state = {
        samples: [],
        emitted: new Set(),
        lastSampleAt: null,
        lastSettledObjectiveBySlide: new Map(),
    };

    const score = () => scoreCaseRead(state.samples, rubric, {
        activityId: options.activityId,
        tailMs: sampleIntervalMs,
        objectiveEpsilon,
    });

    const compatibleResult = () => {
        const scored = score();
        const perRoi = scored.perSlide.flatMap((slideResult) => slideResult.perRoi.map((roi) => ({
            ...roi,
            slideId: slideResult.slideId,
        })));
        const coverageRows = scored.perSlide.filter((row) => row.slideCoverage !== null);
        const coverageWeight = coverageRows.reduce((sum, row) => sum + row.weight, 0);
        const slideCoverage = coverageWeight > 0
            ? coverageRows.reduce((sum, row) => sum + row.slideCoverage * row.weight, 0) / coverageWeight
            : null;
        return {
            ...scored.aggregate,
            slideCoverage,
            perRoi,
            perSlide: scored.perSlide,
            aggregate: scored.aggregate,
            activityId: scored.activityId,
            unscoredSlideIds: scored.unscoredSlideIds,
        };
    };

    return {
        accept(sample, observation = {}) {
            if (!sample || typeof sample.slideId !== 'string' || sample.slideId.length === 0) {
                throw new TypeError('createCaseReadRecorder().accept(): sample needs a non-empty slideId');
            }
            if (observation.settled !== undefined && typeof observation.settled !== 'boolean') {
                throw new TypeError('createCaseReadRecorder().accept(): observation.settled must be boolean');
            }
            const settled = observation.settled ?? true;
            const previous = state.lastSettledObjectiveBySlide.get(sample.slideId);
            const objectiveChanged = settled && previous !== undefined
                && Math.abs(sample.objective - previous) > objectiveEpsilon
                ? { from: previous, to: sample.objective, slideId: sample.slideId }
                : null;
            if (settled) state.lastSettledObjectiveBySlide.set(sample.slideId, sample.objective);

            const tooSoon = state.lastSampleAt !== null && sample.t - state.lastSampleAt < sampleIntervalMs;
            if (tooSoon && !objectiveChanged) {
                return { recorded: false, roiReached: [], objectiveChanged: null };
            }
            state.samples.push({ ...sample, settled });
            state.lastSampleAt = sample.t;
            const current = compatibleResult();
            const roiReached = current.perRoi.filter((roi) => {
                const key = `${roi.slideId}:${roi.id}`;
                if (!roi.reached || state.emitted.has(key)) return false;
                state.emitted.add(key);
                return true;
            });
            return { recorded: true, roiReached, objectiveChanged };
        },
        result: compatibleResult,
        samples() { return state.samples.map((sample) => ({ ...sample })); },
        finish() {
            const scored = compatibleResult();
            return { ...scored, missed: scored.perRoi.filter((roi) => !roi.reached) };
        },
    };
}
