import { useCallback, useEffect, useRef, useState } from 'react';

import { parseDicom } from './dicomParse.js';
import { readRealFrame, readRenderedFrame, isInverted, isRendered, toRealValues, rescaleOf } from './pixelData.js';
import { decodeCompressedFrame } from './compressed.js';
import { buildSeries, describeInstance, frameAddress, frameLayout } from './series.js';
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
const BYTE_BUDGET = 320 * 1024 * 1024;
const SWEEP_CONCURRENCY = 4;

export function useStudy({ ref, loadSeries, loadSeriesIndex, loadInstance, budgetBytes, prefetch = true }) {
    const [state, setState] = useState({ status: 'idle', instances: [], series: [], error: null });
    const cacheRef = useRef(null);
    const bytesRef = useRef(null);
    const pendingRef = useRef(new Set());
    const refRef = useRef(null);
    // Bumped when a lazily-fetched slice arrives, purely to re-render. Throttled:
    // a 500-slice sweep must not cost 500 renders, but a slice the reader is
    // waiting on must appear the moment it lands — so arrivals inside the
    // prefetch radius render immediately and the rest coalesce on a timer.
    const [, setArrivals] = useState(0);
    const [fetched, setFetched] = useState(0);
    const throttleRef = useRef(null);
    // Parsed headers, memoised per instance. Deciding whether an object is
    // compressed means parsing it, and doing that once per rendered frame
    // would re-walk a 400-frame loop's elements four hundred times.
    const dicomRef = useRef(new Map());
    // Frame keys with a decode already in flight, so a re-render during the
    // await does not start a second decode of the same frame.
    const decodingRef = useRef(new Set());

    if (cacheRef.current === null) cacheRef.current = createFrameCache({ budgetBytes });
    if (bytesRef.current === null) {
        // Raw instance bytes get their own LRU: the sweep below pulls the whole
        // stack in, and a budget is what keeps 'the whole stack' from meaning
        // 'the whole heap' on a series larger than expected.
        bytesRef.current = createFrameCache({ budgetBytes: BYTE_BUDGET, sizeOf: (b) => b?.byteLength ?? 0 });
    }

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
        bytesRef.current.clear();
        dicomRef.current = new Map();
        decodingRef.current = new Set();
        pendingRef.current = new Set();
        refRef.current = ref;
        setFetched(0);

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
    const request = useCallback((seriesRef, name, { urgent = true } = {}) => {
        if (bytesRef.current.has(name) || pendingRef.current.has(name)) return;
        pendingRef.current.add(name);
        loadInstance(seriesRef, name)
            .then((bytes) => {
                if (refRef.current !== seriesRef) return; // the reader moved on
                bytesRef.current.put(name, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
                setFetched((n) => n + 1);
                if (urgent) {
                    setArrivals((n) => n + 1);
                } else if (!throttleRef.current) {
                    throttleRef.current = setTimeout(() => {
                        throttleRef.current = null;
                        setArrivals((n) => n + 1);
                    }, 200);
                }
            })
            .catch(() => { /* a single missing slice must not fail the study */ })
            .finally(() => pendingRef.current.delete(name));
    }, [loadInstance]);

    /**
     * Background sweep: once the index is known, pull the WHOLE stack in,
     * ordered from the middle outward — the direction a reader actually moves.
     *
     * This is what makes scrolling feel like a workstation instead of a web
     * page: the prefetch radius around the cursor hides one slice of latency,
     * but a reader flicking the wheel outruns it instantly. The sweep runs a
     * few requests at a time so it never starves the urgent fetches, and it
     * checks `refRef` before every request so changing series stops it cold.
     *
     * `prefetch: false` turns it off. Right for a READER, wrong for an author
     * glancing at three candidate studies in the case editor: the sweep pulls
     * the whole stack — 263 MB on a 499-slice CT — for a look that touches four
     * slices. The slices under the cursor still arrive on demand either way.
     */
    useEffect(() => {
        if (!prefetch || !lazy || state.status !== 'ready') return undefined;
        const series = state.series[0];
        if (!series?.instances?.length) return undefined;

        const seriesRef = refRef.current;
        const middle = Math.floor(series.instances.length / 2);
        const order = [...series.instances.keys()]
            .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));

        let stopped = false;
        let cursor = 0;
        const pump = () => {
            if (stopped || refRef.current !== seriesRef) return;
            while (cursor < order.length && pendingRef.current.size < SWEEP_CONCURRENCY) {
                const name = series.instances[order[cursor]]?.name;
                cursor += 1;
                if (name && !bytesRef.current.has(name)) {
                    request(seriesRef, name, { urgent: false });
                }
            }
            if (cursor < order.length) timer = setTimeout(pump, 50);
        };
        let timer = setTimeout(pump, 0);
        return () => { stopped = true; clearTimeout(timer); };
    }, [lazy, state.status, state.series, request]);

    /**
     * The decoded frame at `index`, or null while its pixels are in flight.
     *
     * Neighbours are prefetched because a reader scrolls: by the time they reach
     * a slice its bytes are usually already here, and the stack feels continuous
     * rather than stuttering one request at a time.
     */
    const frameAt = useCallback((series, index) => {
        // `index` is a position in the STACK, which for a multi-frame series
        // is a frame inside some instance rather than an instance of its own.
        const address = frameAddress(series, index);
        if (!address) return null;
        const { instance, frameIndex } = address;

        if (lazy) {
            const around = 4;
            for (let i = Math.max(0, index - around); i <= Math.min(series.count - 1, index + around); i++) {
                // Neighbouring FRAMES frequently live in the instance already
                // being fetched; `request` de-duplicates by name, so an echo
                // loop asks for its one file once rather than nine times.
                const neighbour = frameAddress(series, i)?.instance;
                if (neighbour?.name) request(series.ref ?? refRef.current, neighbour.name);
            }
        }

        // Same guard in both branches: on a study switch the byte store is
        // cleared while a stale render can still hold the OLD series and ask
        // for its frames — decodeFrame(undefined) would throw
        // DicomError('bad_input') in the middle of render. A missing frame is
        // a loading state, never a crash.
        const store = lazy ? instance.name : instance.source;
        const bytes = bytesRef.current.read(store);
        if (!bytes) return null;

        const key = `${series.stackId ?? series.seriesInstanceUid}:${index}`;
        const cached = cacheRef.current.read(key);
        if (cached) return cached;

        // Parse once per instance, not once per frame.
        let dicom = dicomRef.current.get(store);
        if (!dicom) {
            dicom = parseDicom(bytes);
            dicomRef.current.set(store, dicom);
        }

        // COMPRESSED pixel data cannot be decoded synchronously: JPEG goes
        // through the browser's own image decoder, which is a promise. So the
        // frame is requested, null is returned, and the render that follows
        // its arrival picks it up from the cache — exactly the pattern the
        // lazy byte fetch above already uses, and the reason `put()` exists.
        if (dicom.isEncapsulated()) {
            if (!decodingRef.current.has(key)) {
                decodingRef.current.add(key);
                const forRef = refRef.current;
                decodeCompressedFrame(dicom, frameIndex)
                    .then((decoded) => {
                        if (refRef.current !== forRef) return; // the reader moved on
                        cacheRef.current.put(key, fromCompressed(dicom, decoded));
                        setArrivals((n) => n + 1);
                    })
                    .catch(() => { /* one undecodable frame must not fail the study */ })
                    .finally(() => decodingRef.current.delete(key));
            }
            return null;
        }

        return cacheRef.current.get(key, () => decodeFrame(bytes, frameIndex, dicom));
    }, [lazy, request]);

    const total = state.series[0]?.count ?? 0;
    return {
        ...state,
        frameAt,
        // How much of the active stack has arrived, for a progress indicator.
        progress: lazy ? { fetched: Math.min(fetched, total), total } : { fetched: total, total },
        cacheStats: () => cacheRef.current.stats(),
    };
}

/**
 * Decode one frame, by the kind of image it is.
 *
 * `readRenderedFrame`'s own documentation says the viewer must honour the
 * distinction between a MEASURED image and an ALREADY-RENDERED one — and until
 * cardiac imaging arrived, nothing called it. Every decode went through
 * `readRealFrame`, which throws `unsupported_pixels` on three samples per
 * pixel. So any colour object — a Doppler echo, an angiographic run, a
 * secondary capture — failed to display, with the code to display it sitting
 * unused two functions away.
 *
 * A rendered frame carries `rgba` and NO `values`: there is no modality LUT
 * behind it, so there is nothing to window and nothing to probe, and callers
 * key on the absence rather than being told a window that means nothing.
 */
function decodeFrame(bytes, frameIndex = 0, parsed = null) {
    const dicom = parsed ?? parseDicom(bytes);
    if (isRendered(dicom)) {
        return { ...readRenderedFrame(dicom, frameIndex), inverted: false, window: null };
    }
    const frame = readRealFrame(dicom, frameIndex);
    return { ...frame, inverted: isInverted(dicom), window: defaultWindow(dicom, frame) };
}

/**
 * A decoded COMPRESSED frame, in the shape the viewer's uncompressed frames
 * have — so nothing downstream has to know how the pixels arrived.
 *
 * JPEG comes back as RGBA whatever the object's samples-per-pixel, because the
 * browser's decoder renders it; that is a rendered frame and is presented as
 * one. RLE comes back as stored integers, which still owe the modality LUT.
 */
export function fromCompressed(dicom, decoded) {
    if (decoded.rgba) {
        return {
            rows: decoded.rows,
            columns: decoded.columns,
            frames: decoded.frames,
            rgba: decoded.rgba,
            rendered: true,
            inverted: false,
            window: null,
        };
    }

    const rescale = rescaleOf(dicom);
    const values = toRealValues(decoded, rescale);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
        if (values[i] < min) min = values[i];
        if (values[i] > max) max = values[i];
    }
    const frame = {
        rows: decoded.rows,
        columns: decoded.columns,
        frames: decoded.frames,
        values,
        units: rescale.units,
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 0,
    };
    return { ...frame, inverted: isInverted(dicom), window: defaultWindow(dicom, frame) };
}

/** BULK: parse metadata for every instance, then group and order. */
function fromBytes(files, bytesRef) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('no instances were returned');
    const all = files.map((f) => (f instanceof Uint8Array ? f : new Uint8Array(f)));
    all.forEach((bytes, i) => bytesRef.current.put(i, bytes));

    const instances = all.map((bytes, i) => (
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
export function fromIndex(index, ref) {
    const raw = Array.isArray(index?.instances) ? index.instances : [];
    if (raw.length === 0) throw new Error(`the series index for ${ref} lists no instances`);

    const instances = raw.map((entry, i) => (typeof entry === 'string'
        ? { name: entry, source: i, instanceNumber: i + 1, position: null, orientation: null, frames: 1 }
        : {
            name: entry.name,
            source: i,
            instanceNumber: entry.instanceNumber ?? i + 1,
            position: entry.position ?? null,
            orientation: entry.orientation ?? null,
            // The index exists so the viewer knows the shape of the stack
            // before fetching a byte. For a multi-frame series that shape is
            // its FRAME count, so ingest writes `frames` per instance. An
            // older index that omits it reads as 1 — which is what every
            // pre-cardiac series in the archive actually is.
            frames: Number.isFinite(entry.frames) && entry.frames > 0 ? Math.trunc(entry.frames) : 1,
        }));
    const layout = frameLayout(instances);

    const series = [{
        seriesInstanceUid: index.seriesInstanceUid ?? ref,
        stackId: index.seriesInstanceUid ?? ref,
        ref,
        modality: index.modality,
        description: index.description,
        plane: index.plane ?? 'unknown',
        orderedBy: index.orderedBy ?? 'position',
        instances,
        count: layout.frameCount,
        instanceCount: instances.length,
        multiframe: layout.multiframe,
        frameStarts: layout.frameStarts,
        frameRate: Number.isFinite(index.frameRate) && index.frameRate > 0 ? index.frameRate : null,
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
