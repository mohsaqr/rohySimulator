import { useEffect, useRef, useState } from 'react';

import { parseDicom } from './dicomParse.js';
import { readPreviewFrame } from './pixelData.js';
import { applyWindow, defaultWindow } from './windowLevel.js';

/**
 * Real thumbnails for the series rail.
 *
 * A reader picks a series by what it looks like — "the thin axial bone recon"
 * is recognised in a tenth of a second from a picture and not at all from a
 * row of text. Each thumbnail is the series' MIDDLE slice (the same slice the
 * opening window is taken from, for the same reason: the first slice is
 * shoulders or table), auto-windowed, downscaled and cached as a data URL.
 *
 * Cost control, because this fires for every series in the rail at once:
 * fetches run through a small queue (2 at a time), each series costs exactly
 * one index and one instance fetch, and results are cached by ref for the
 * life of the room — switching studies back and forth re-fetches nothing.
 */
const THUMB_SIZE = 128;
const CONCURRENCY = 2;

export function useThumbnails({ series = [], loadSeriesIndex, loadInstance }) {
    const cacheRef = useRef(new Map());   // ref -> data URL (or 'failed')
    const queueRef = useRef([]);
    const runningRef = useRef(0);
    const [, setVersion] = useState(0);

    const enabled = typeof loadSeriesIndex === 'function' && typeof loadInstance === 'function';

    // Tied to the component's LIFETIME, not to each run of the effect below.
    //
    // This used to be a `let alive` inside the effect, cleared by its cleanup.
    // The effect re-runs whenever `series` changes — which is every time the
    // reader opens a different study — so the previous run's flag went false
    // while its thumbnails were still in flight. Those then finished with
    // `alive === false`, which skipped BOTH the re-render that would have shown
    // them and the `pump()` that drains the rest of the queue. The rail stalled
    // until some unrelated render happened to restart it: thumbnails that had
    // been fetched and decoded sat there unshown for seconds.
    //
    // A finished thumbnail is always worth keeping — the cache is keyed by ref,
    // refs are stable, and the reader may well come back to that series — so
    // the only thing that should stop this work is the component going away.
    // Set on mount as well as cleared on unmount, not merely cleared: React
    // StrictMode mounts, unmounts and remounts in development, so a flag that
    // is only ever cleared stays cleared and the queue never runs again.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const pumpRef = useRef(null);
    pumpRef.current = () => {
        while (mountedRef.current && runningRef.current < CONCURRENCY && queueRef.current.length > 0) {
            const ref = queueRef.current.shift();
            runningRef.current += 1;
            renderThumbnail(ref, loadSeriesIndex, loadInstance)
                .then((url) => { cacheRef.current.set(ref, url); })
                .catch(() => { cacheRef.current.set(ref, 'failed'); })
                .finally(() => {
                    runningRef.current -= 1;
                    if (!mountedRef.current) return;
                    setVersion((v) => v + 1);
                    pumpRef.current();
                });
        }
    };

    useEffect(() => {
        if (!enabled) return;
        series.forEach((s) => {
            const ref = s?.ref;
            if (ref && !cacheRef.current.has(ref) && !queueRef.current.includes(ref)) {
                queueRef.current.push(ref);
            }
        });
        pumpRef.current();
    }, [enabled, series, loadSeriesIndex, loadInstance]);

    return {
        /** The thumbnail data URL for a series ref, or null while it renders. */
        thumbnailFor: (ref) => {
            const hit = cacheRef.current.get(ref);
            return hit && hit !== 'failed' ? hit : null;
        },
    };
}

async function renderThumbnail(ref, loadSeriesIndex, loadInstance) {
    const index = await loadSeriesIndex(ref);
    const raw = Array.isArray(index?.instances) ? index.instances : [];
    if (raw.length === 0) throw new Error('empty series');
    const middle = raw[Math.floor(raw.length / 2)];
    const name = typeof middle === 'string' ? middle : middle.name;

    const bytes = await loadInstance(ref, name);
    const dicom = parseDicom(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

    // Sampled, not decoded whole. This used to read every pixel, fill a
    // full-size ImageData one pixel at a time, and resample nine megapixels
    // down to a 128-pixel tile — around five seconds per radiograph study, all
    // of it for a picture the size of a postage stamp. readPreviewFrame strides
    // the stored pixels instead and comes back already at thumbnail size.
    const frame = readPreviewFrame(dicom, { maxSize: THUMB_SIZE });
    const grey = applyWindow(frame.values, defaultWindow(dicom, frame));

    const thumb = document.createElement('canvas');
    thumb.width = frame.columns;
    thumb.height = frame.rows;
    const ctx = thumb.getContext('2d');
    const image = ctx.createImageData(frame.columns, frame.rows);
    for (let i = 0, j = 0; i < grey.length; i++, j += 4) {
        image.data[j] = grey[i];
        image.data[j + 1] = grey[i];
        image.data[j + 2] = grey[i];
        image.data[j + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    // JPEG because a windowed greyscale tile compresses to a few KB and the
    // rail may hold dozens of them.
    return thumb.toDataURL('image/jpeg', 0.8);
}

export default useThumbnails;
