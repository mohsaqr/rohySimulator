import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { parseDicom } from './dicomParse.js';
import { readRealFrame, isInverted } from './pixelData.js';
import { buildSeries, describeInstance } from './series.js';
import { defaultWindow } from './windowLevel.js';
import { createFrameCache } from './frameCache.js';

/**
 * Load a series and expose the current frame.
 *
 * `loadSeries` is a PROP, not an import. The package must never know how its
 * host addresses content — rohy resolves `remote:` references through an
 * operator-configured proxy, a standalone build reads from disk, a test hands
 * over bytes it built in memory. All three satisfy the same one-line contract:
 *
 *     loadSeries(ref, { signal }) -> Promise<Array<ArrayBuffer|Uint8Array>>
 *
 * Metadata is parsed for every instance up front, because ordering a stack
 * requires every slice's position before the first can be shown. Pixels are
 * decoded lazily, one slice at a time, through a byte-bounded LRU — see
 * frameCache.js for why eager decoding is not an option.
 */
export function useStudy({ ref, loadSeries, budgetBytes }) {
    const [state, setState] = useState({ status: 'idle', instances: [], series: [], error: null });
    const cacheRef = useRef(null);
    const bytesRef = useRef([]);

    if (cacheRef.current === null) cacheRef.current = createFrameCache({ budgetBytes });

    useEffect(() => {
        if (!ref || typeof loadSeries !== 'function') {
            setState({ status: 'idle', instances: [], series: [], error: null });
            return undefined;
        }
        const controller = new AbortController();
        let cancelled = false;

        setState({ status: 'loading', instances: [], series: [], error: null });
        cacheRef.current.clear();

        loadSeries(ref, { signal: controller.signal })
            .then((files) => {
                if (cancelled) return;
                if (!Array.isArray(files) || files.length === 0) {
                    throw new Error(`no instances were returned for ${ref}`);
                }
                bytesRef.current = files.map((f) => (f instanceof Uint8Array ? f : new Uint8Array(f)));

                // Parse metadata only. `stopBeforePixelData` means a 300-slice
                // study is indexed without touching 150 MB of pixels.
                const instances = bytesRef.current.map((bytes, index) => {
                    const dicom = parseDicom(bytes, { stopBeforePixelData: true });
                    return describeInstance(dicom, { source: index });
                });
                setState({ status: 'ready', instances, series: buildSeries(instances), error: null });
            })
            .catch((error) => {
                if (cancelled || controller.signal.aborted) return;
                // Surfaced, never swallowed: a study that failed to load is
                // indistinguishable to a learner from a normal one, and grading
                // them on a finding they were never shown would be unjust.
                setState({ status: 'error', instances: [], series: [], error });
            });

        return () => { cancelled = true; controller.abort(); };
    }, [ref, loadSeries]);

    /** Decode (or fetch from cache) the frame at `index` within `series`. */
    const frameAt = useCallback((series, index) => {
        const instance = series?.instances?.[index];
        if (!instance) return null;
        const key = `${series.seriesInstanceUid}:${index}`;
        return cacheRef.current.get(key, () => {
            const dicom = parseDicom(bytesRef.current[instance.source]);
            const frame = readRealFrame(dicom);
            return { ...frame, inverted: isInverted(dicom), window: defaultWindow(dicom, frame) };
        });
    }, []);

    return { ...state, frameAt, cacheStats: () => cacheRef.current.stats() };
}

/**
 * The window a series should open with — taken from its middle slice, not its
 * first. On a chest CT the first slice is usually through the shoulders or the
 * table, and auto-windowing on it gives a presentation that has to be corrected
 * by hand before the study is readable.
 */
export function openingWindow(series, frameAt) {
    if (!series?.count) return { center: 40, width: 400 };
    return frameAt(series, Math.floor(series.count / 2))?.window ?? { center: 40, width: 400 };
}
