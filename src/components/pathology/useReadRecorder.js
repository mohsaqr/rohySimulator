import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCaseReadRecorder, createReadRecorder } from './readRecorder.js';

/**
 * React binding for createReadRecorder.
 *
 * The recorder is held in a ref, not state: accepting a sample must not
 * re-render, or a 60 fps pan would re-render 60 times a second. Only
 * deliberate acts (an ROI reached, the read finishing) surface to the caller.
 *
 * @param {object} answerKey
 * @param {object} logger      a createPathologyLogger() instance
 * @param {object} [opts]      {enabled, sampleIntervalMs}
 */
export function useReadRecorder(answerKey, logger, opts = {}) {
    const enabled = opts.enabled ?? true;
    const caseRubric = answerKey && Array.isArray(answerKey.activities) && typeof answerKey.caseId === 'string';
    const recorder = useMemo(
        () => (answerKey
            ? (caseRubric ? createCaseReadRecorder(answerKey, opts) : createReadRecorder(answerKey, opts))
            : null),
        // A new answer key is a new read; anything else must not reset it.
        [answerKey, caseRubric], // eslint-disable-line react-hooks/exhaustive-deps
    );
    // The read clock, held as STATE rather than as a ref — and that is a
    // correctness fix, not a style preference.
    //
    // It used to be a ref that an effect rewrote after mount. Writing a ref
    // does not re-render, so the stale value went on being returned until
    // something else caused a render; at that moment `startedAt` silently
    // changed and every consumer keyed on it re-ran. That is exactly what
    // happened once SlideCanvas began publishing its viewer upward: the first
    // post-mount render read a new timestamp, SlideCanvas's effect dependency
    // changed, and OpenSeadragon was destroyed and rebuilt mid-load — two
    // tile-source fetches and an "[TiledImage] options.drawer is required"
    // assert, from nothing but a timestamp.
    //
    // As state it is stable across renders and changes visibly, once, when the
    // read genuinely restarts. The first-mount guard matters: without it the
    // effect would reset the clock immediately after mount and reintroduce the
    // very change of identity this is meant to remove.
    const [startedAt, setStartedAt] = useState(() => Date.now());
    const mountedRef = useRef(false);
    useEffect(() => {
        if (!mountedRef.current) { mountedRef.current = true; return; }
        setStartedAt(Date.now());
    }, [answerKey]);

    // These are pulled out of `opts` deliberately. `opts` is an object
    // literal at every call site, so a fresh identity on every render — using
    // it directly as a dependency made `accept` a new function each render,
    // which made SlideCanvas tear down and rebuild the OpenSeadragon viewer
    // on every render. Depend on the stable pieces, and keep the mutable
    // callback in a ref so it never participates in identity at all.
    const { slide, onRoiReached } = opts;
    const onRoiReachedRef = useRef(onRoiReached);
    useEffect(() => { onRoiReachedRef.current = onRoiReached; }, [onRoiReached]);

    const accept = useCallback((sample, observation) => {
        if (!recorder || !enabled) return;
        const { recorded, roiReached, objectiveChanged } = recorder.accept(sample, observation);
        if (!recorded) return;

        if (objectiveChanged) {
            logger.objectiveChanged(slide ?? {}, objectiveChanged.from, objectiveChanged.to);
        }
        // One row per ROI, the first time it is genuinely resolved.
        roiReached.forEach((roi) => logger.roiReached(roi, {
            dwellMs: roi.dwellMs,
            objective: sample.objective,
            timeToReachMs: roi.reachedAtMs,
        }));
        if (roiReached.length > 0) onRoiReachedRef.current?.(roiReached);
    }, [recorder, enabled, logger, slide]);

    const finish = useCallback(() => {
        if (!recorder) return null;
        const done = recorder.finish();
        // MISSED_ROI is emitted once per unreached ROI at close, carrying the
        // reason — that is the row a teacher's dashboard is actually built on.
        done.missed.forEach((roi) => logger.roiMissed(roi, roi.missReason));
        return done;
    }, [recorder, logger]);

    return { accept, finish, startedAt, samples: () => recorder?.samples() ?? [] };
}
