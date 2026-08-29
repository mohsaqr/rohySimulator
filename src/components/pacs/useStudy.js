import { useCallback, useEffect, useRef, useState } from 'react';

import { parseDicom } from './dicomParse.js';
import { readRealFrame, isInverted } from './pixelData.js';
import { buildSeries, describeInstance } from './series.js';
import { defaultWindow } from './windowLevel.js';
import { createFrameCache } from './frameCache.js';

/**
 * Load a series and expose the current frame.
 *
 * Two loading strategies, and which one runs depends entirely on what the host
 * offers. Both are legitimate; the second exists because the first does not
 * scale.
 *
 * BULK — `loadSeries(ref)` returns every instance's bytes. Simple, and correct
 *   for a small series. For a 499-slice CT it means 263 MB downloaded and 545 MB
 *   of heap before ONE pixel is drawn: measured at 1.4 s on localhost, and tens
 *   of seconds over a real network. The reader stares at an empty pane
 *   throughout.
 *
 * LAZY — `loadSeriesIndex(ref)` returns the series' metadata (an ordered list of
 *   instances with their positions) and `loadInstance(ref, name)` fetches one.
 *   Everything needed to build an ordered, measurable stack is metadata, so the
 *   stack appears immediately and pixels arrive one slice at a time, as the
 *   reader actually looks at them. This is the same split DICOMweb draws
 *   between /metadata and /frames, for the same reason.
 *
 * The host decides. A host that provides only `loadSeries` keeps working
 * exactly as before.
 */
export function useStudy({ ref, loadSeries, loadSeriesIndex, loadInstance, budgetBytes }) {
    const [state, setState] = useState({ status: 'idle', instances: [], series: [], error: null });
    const cacheRef = useRef(null);
    const bytesRef = useRef(new Map());
    const pendingRef = useRef(new Set());
    const refRef = useRef(null);
    // Bumped when a lazily-fetched slice arrives, purely to re-render.
    const [, setArrivals] = useState(0);

    if (cacheRef.current === null) cacheRef.current = createFrameCache({ budgetBytes });

    const lazy = typeof loadSeriesIndex === 'function' && typeof loadInstance === 'function';

    useEffect(() => {
        if (!ref || (!lazy && typeof loadSeries !== 'function')) {
            setState({ status: 'idle', instances: [], series: [], error: null });
            return undefined;
        }
        const controller = new AbortController();
        let cancelled = false;

        setState({ status: 'loading', instances: [], series: [], error: null });
        cacheRef.current.clear();
        bytesRef.current = new Map();
        pendingRef.current = new Set();
        refRef.current = ref;

        const run = lazy
            ? loadSeriesIndex(ref, { signal: controller.signal }).then((index) => fromIndex(index, ref))
            : loadSeries(ref, { signal: controller.signal }).then((files) => fromBytes(files, bytesRef));

        run.then(({ instances, series }) => {
            if (cancelled) return;
            setState({ status: 'ready', instances, series, error: null });
        }).catch((error) => {
            if (cancelled || controller.signal.aborted) return;
            // Surfaced, never swallowed: a study that failed to load is
            // indistinguishable to a learner from a normal one, and grading them
            // on a finding they were never shown would be unjust.
            setState({ status: 'error', instances: [], series: [], error });
        });

        return () => { cancelled = true; controller.abort(); };
    }, [ref, loadSeries, loadSeriesIndex, loadInstance, lazy]);

    /** Fetch one instance's bytes, once, then re-render. */
    const request = useCallback((seriesRef, name) => {
        if (bytesRef.current.has(name) || pendingRef.current.has(name)) return;
        pendingRef.current.add(name);
        loadInstance(seriesRef, name)
            .then((bytes) => {
                if (refRef.current !== seriesRef) return; // the reader moved on
                bytesRef.current.set(name, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
                setArrivals((n) => n + 1);
            })
            .catch(() => { /* a single missing slice must not fail the study */ })
            .finally(() => pendingRef.current.delete(name));
    }, [loadInstance]);

    /**
     * The decoded frame at `index`, or null while its pixels are in flight.
     *
     * Neighbours are prefetched because a reader scrolls: by the time they reach
     * a slice its bytes are usually already here, and the stack feels continuous
     * rather than stuttering one request at a time.
     */
    const frameAt = useCallback((series, index) => {
        const instance = series?.instances?.[index];
        if (!instance) return null;

        if (lazy) {
            const around = 4;
            for (let i = Math.max(0, index - around); i <= Math.min(series.count - 1, index + around); i++) {
                const neighbour = series.instances[i];
                if (neighbour?.name) request(series.ref ?? refRef.current, neighbour.name);
            }
            const bytes = bytesRef.current.get(instance.name);
            if (!bytes) return null;
            return cacheRef.current.get(`${series.stackId}:${index}`, () => decodeFrame(bytes));
        }

        return cacheRef.current.get(`${series.stackId ?? series.seriesInstanceUid}:${index}`, () => (
            decodeFrame(bytesRef.current.get(instance.source))
        ));
    }, [lazy, request]);

    return { ...state, frameAt, cacheStats: () => cacheRef.current.stats() };
}

function decodeFrame(bytes) {
    const dicom = parseDicom(bytes);
    const frame = readRealFrame(dicom);
    return { ...frame, inverted: isInverted(dicom), window: defaultWindow(dicom, frame) };
}

/** BULK: parse metadata for every instance, then group and order. */
function fromBytes(files, bytesRef) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('no instances were returned');
    const store = new Map();
    files.forEach((f, i) => store.set(i, f instanceof Uint8Array ? f : new Uint8Array(f)));
    bytesRef.current = store;

    const instances = Array.from(store.entries()).map(([i, bytes]) => (
        describeInstance(parseDicom(bytes, { stopBeforePixelData: true }), { source: i })
    ));
    return { instances, series: buildSeries(instances) };
}

/**
 * LAZY: build the stack from the index alone.
 *
 * The instances are already in stack order — ingest writes them that way — so
 * no re-sorting is needed and, critically, no pixels. A v1 index that lists
 * bare filenames still works: the stack is then ordered by file name, which is
 * the order it was written in.
 */
function fromIndex(index, ref) {
    const raw = Array.isArray(index?.instances) ? index.instances : [];
    if (raw.length === 0) throw new Error(`the series index for ${ref} lists no instances`);

    const instances = raw.map((entry, i) => (typeof entry === 'string'
        ? { name: entry, source: i, instanceNumber: i + 1, position: null, orientation: null }
        : {
            name: entry.name,
            source: i,
            instanceNumber: entry.instanceNumber ?? i + 1,
            position: entry.position ?? null,
            orientation: entry.orientation ?? null,
        }));

    const series = [{
        seriesInstanceUid: index.seriesInstanceUid ?? ref,
        stackId: index.seriesInstanceUid ?? ref,
        ref,
        modality: index.modality,
        description: index.description,
        plane: index.plane ?? 'unknown',
        orderedBy: index.orderedBy ?? 'position',
        instances,
        count: instances.length,
        spacing: Number.isFinite(index.spacing) ? index.spacing : null,
        spacingIsUniform: typeof index.spacingIsUniform === 'boolean' ? index.spacingIsUniform : null,
        spacingRange: null,
        geometry: index.geometry ?? {},
    }];

    return { instances, series };
}

/**
 * The window a series should open with — taken from its middle slice, not its
 * first. On a chest CT the first slice is usually through the shoulders or the
 * table, and auto-windowing on it gives a presentation that has to be corrected
 * by hand before the study is readable.
 *
 * Returns undefined when that slice has not arrived yet, so a caller can wait
 * rather than commit to a window computed from nothing.
 */
export function openingWindow(series, frameAt) {
    if (!series?.count) return undefined;
    return frameAt(series, Math.floor(series.count / 2))?.window;
}
