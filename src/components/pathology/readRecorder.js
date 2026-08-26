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
 * Both are held in a plain object rather than a React ref so the logic is
 * testable without a renderer.
 */

import { scoreRead } from './readAssessment.js';

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
    const objectiveEpsilon = options.objectiveEpsilon ?? 0.01;

    const state = { samples: [], emitted: new Set(), lastSampleAt: null, lastObjective: null };

    return {
        /**
         * Offer a viewport observation. Returns what the room should do about
         * it — never performs the logging itself, so the caller keeps control
         * of ordering and the recorder stays pure of side effects.
         *
         * @returns {{recorded:boolean, roiReached:Array, objectiveChanged:null|{from:number,to:number}}}
         */
        accept(sample) {
            const tooSoon = state.lastSampleAt !== null
                && sample.t - state.lastSampleAt < sampleIntervalMs;
            if (tooSoon) return { recorded: false, roiReached: [], objectiveChanged: null };

            const objectiveChanged = state.lastObjective !== null
                && Math.abs(sample.objective - state.lastObjective) > objectiveEpsilon
                ? { from: state.lastObjective, to: sample.objective }
                : null;

            state.samples.push(sample);
            state.lastSampleAt = sample.t;
            state.lastObjective = sample.objective;

            // Score with a tail so the sample just added can itself satisfy a
            // dwell requirement; otherwise the final sample always counts 0
            // and an ROI is only ever "reached" one sample late.
            const scored = scoreRead(state.samples, answerKey, { tailMs: sampleIntervalMs });
            const roiReached = scored.perRoi
                .filter((r) => r.reached && !state.emitted.has(r.id));
            roiReached.forEach((r) => state.emitted.add(r.id));

            return { recorded: true, roiReached, objectiveChanged };
        },

        /** Current score over everything accepted so far. */
        result() {
            return scoreRead(state.samples, answerKey, { tailMs: sampleIntervalMs });
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
