/**
 * Turn the viewport sample stream into the three reading-behaviour events —
 * PANNED_SLIDE, ZOOMED_SLIDE, DWELLED_REGION — at a rate a learning-event
 * table can carry.
 *
 * SlideCanvas samples the viewport on every animation frame and again when
 * the animation settles. Logging each frame would be a row every 16 ms; the
 * read recorder already retains the samples for the read-path reconstruction.
 * What analytics needs beside that path is the SHAPE of the read: each settled
 * move (a pan), each settled change of power that did not cross an objective
 * threshold (a zoom — the threshold crossings are CHANGED_OBJECTIVE), and each
 * pause long enough to count as looking (a dwell). Pure, so it is tested
 * without a viewer; the room owns one per slide.
 *
 * @param {object} [options]
 * @param {number} [options.panThrottleMs=2000]  at most one PANNED per this window
 * @param {number} [options.dwellMs=3000]        a pause this long is a dwell
 * @param {number} [options.moveEpsilon=0.15]    a settled move smaller than this
 *   fraction of the visible width is not a pan (a nudge, or the zoom spring)
 * @param {number} [options.zoomEpsilon=0.05]    objective change below this is noise
 * @returns {{accept: Function, flush: Function}}
 */
export function createViewportEventTracker({
    panThrottleMs = 2000, dwellMs = 3000, moveEpsilon = 0.15, zoomEpsilon = 0.05,
} = {}) {
    let last = null;          // the last SETTLED sample
    let lastPanAt = null;     // read-clock time of the last PANNED row
    let restingSince = null;  // read-clock time the viewport came to rest
    let resting = null;       // the sample it came to rest on

    const dwellOf = (t) => (resting && restingSince !== null && t - restingSince >= dwellMs
        ? { sample: resting, durationMs: t - restingSince }
        : null);

    return {
        /**
         * @param {object} sample  a viewportSample() row (+ slideId)
         * @param {{settled?: boolean}} [observation]
         * @returns {{panned: object|null, zoomed: {from:number,to:number}|null, dwelled: {sample:object,durationMs:number}|null}}
         */
        accept(sample, observation = {}) {
            const settled = observation.settled ?? true;
            const out = { panned: null, zoomed: null, dwelled: null };
            if (!sample || typeof sample.t !== 'number') return out;
            if (!settled) {
                // Motion: whatever the viewport was resting on is over. A
                // rest long enough to be a dwell is reported once, now.
                if (resting) { out.dwelled = dwellOf(sample.t); resting = null; restingSince = null; }
                return out;
            }
            if (last) {
                const dx = Math.abs(sample.x - last.x);
                const dy = Math.abs(sample.y - last.y);
                const moved = Math.max(dx, dy) >= Math.max(sample.w, 1) * moveEpsilon;
                const zoomed = Math.abs(sample.objective - last.objective) >= zoomEpsilon
                    && Math.round(sample.objective) === Math.round(last.objective);
                if (resting && (moved || zoomed)) {
                    out.dwelled = out.dwelled ?? dwellOf(sample.t);
                    resting = null; restingSince = null;
                }
                if (zoomed) out.zoomed = { from: last.objective, to: sample.objective };
                if (moved && !zoomed && (lastPanAt === null || sample.t - lastPanAt >= panThrottleMs)) {
                    out.panned = sample;
                    lastPanAt = sample.t;
                }
            }
            if (!resting) { resting = sample; restingSince = sample.t; }
            last = sample;
            return out;
        },
        /** Close the read: a dwell still in progress at `t` is reported. */
        flush(t) {
            const dwelled = typeof t === 'number' ? dwellOf(t) : null;
            last = null; resting = null; restingSince = null; lastPanAt = null;
            return { panned: null, zoomed: null, dwelled };
        },
    };
}
