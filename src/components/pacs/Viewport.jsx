import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { sharpen } from './enhance.js';
import { applyWindow } from './windowLevel.js';
import { measureDistance, measureRegion, orientationLabels } from './series.js';
import {
    displayedOrientation, panBy, resetView, scrollBy, scrollTo, toCanvasPoint,
    toImagePoint, viewTransform, windowBy, zoomAbout,
} from './viewportState.js';

/**
 * The image viewport: renders one slice, and owns the gestures that read a
 * study.
 *
 * The bindings are the ones every PACS uses, because a trainee who learns this
 * viewer should be learning the workstation they will sit at afterwards:
 *
 *   left drag        the active tool (window, zoom, pan, or a measurement)
 *   wheel            scroll the stack
 *   ctrl + wheel     zoom about the cursor (a trackpad pinch arrives this way)
 *   middle drag      pan
 *   right drag       zoom
 *   shift + left     pan               (for trackpads with no middle button)
 *   double click     reset the presentation
 *
 * Rendering goes through an offscreen canvas at the image's native size, which
 * is then drawn scaled. Windowing therefore touches each pixel once per frame
 * regardless of zoom, and zooming costs nothing but a `drawImage`. Rotation and
 * flips are applied as canvas transforms in the SAME order `toDisplay` defines
 * (flip in image space, then rotate), so the pixels and the measurement
 * overlays can never disagree about where anatomy is.
 */
export function Viewport({
    frame,
    viewport,
    onViewportChange,
    pixelSpacing,
    orientation = null,
    inverted = false,
    tool = 'window',
    measurements = [],
    onMeasure,
    onProbe,
    info = null,
    t = (key, fallback) => fallback ?? key,
}) {
    const canvasRef = useRef(null);
    const offscreenRef = useRef(null);
    const dragRef = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [pending, setPending] = useState(null);
    const [probe, setProbe] = useState(null);

    // The last rendered frame's dimensions; kept while the next slice is in
    // flight so a fast scroll shows the previous image with a loading chip
    // instead of a black flash on every unfetched slice.
    const shownRef = useRef({ rows: 0, columns: 0 });
    if (frame) shownRef.current = { rows: frame.rows, columns: frame.columns };

    const geometry = useMemo(
        () => ({ rows: frame?.rows ?? shownRef.current.rows, columns: frame?.columns ?? shownRef.current.columns }),
        [frame?.rows, frame?.columns], // eslint-disable-line react-hooks/exhaustive-deps
    );
    const transform = useMemo(
        () => viewTransform(viewport, geometry, size),
        [viewport, geometry, size],
    );

    // Track the element's real size rather than assuming one: the room is a
    // flex child and its height is whatever is left over.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setSize({ width: Math.round(width), height: Math.round(height) });
        });
        observer.observe(canvas.parentElement ?? canvas);
        return () => observer.disconnect();
    }, []);

    // Window the pixels once per (frame, window) into an offscreen canvas.
    useEffect(() => {
        if (!frame?.values) return;
        const { rows, columns } = frame;
        let offscreen = offscreenRef.current;
        if (!offscreen || offscreen.width !== columns || offscreen.height !== rows) {
            offscreen = document.createElement('canvas');
            offscreen.width = columns;
            offscreen.height = rows;
            offscreenRef.current = offscreen;
        }
        const windowed = applyWindow(frame.values, {
            ...viewport.window,
            invert: inverted !== viewport.invert,
            fn: viewport.voiFunction ?? 'LINEAR',
            gamma: viewport.gamma ?? 1,
        });
        // Enhancement acts on the displayed image, never on `frame.values` —
        // so a probe and a measurement still read what the scanner recorded.
        const grey = sharpen(windowed, { rows, columns, amount: viewport.sharpen ?? 0 });
        const image = offscreen.getContext('2d').createImageData(columns, rows);
        for (let i = 0, j = 0; i < grey.length; i++, j += 4) {
            image.data[j] = grey[i];
            image.data[j + 1] = grey[i];
            image.data[j + 2] = grey[i];
            image.data[j + 3] = 255;
        }
        offscreen.getContext('2d').putImageData(image, 0, 0);
    }, [frame, viewport.window, viewport.invert, inverted, viewport.voiFunction, viewport.gamma, viewport.sharpen]);

    // Composite: the windowed image, then the overlays, at device resolution.
    useEffect(() => {
        const canvas = canvasRef.current;
        const offscreen = offscreenRef.current;
        if (!canvas || !size.width || !size.height) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = size.width * dpr;
        canvas.height = size.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, size.width, size.height);
        if (!offscreen) return;

        // Nearest-neighbour past 1:1. Interpolating a magnified CT invents
        // intermediate densities that are not in the data — a smoothed edge can
        // read as a real gradient, so the honest rendering is the blocky one.
        // Below 1:1 the reader may turn interpolation off to see raw pixels.
        ctx.imageSmoothingEnabled = transform.scale < 1 && (viewport.smooth !== false);

        const { rows, columns } = geometry;
        ctx.save();
        ctx.translate(transform.offsetX, transform.offsetY);
        ctx.scale(transform.scale, transform.scale);
        // Rotation first in call order, flip second: canvas transforms compose
        // so the LAST one applies to the drawing first — flips act in image
        // space before the rotation, exactly as `toDisplay` does.
        if (transform.rotation === 1) { ctx.translate(rows, 0); ctx.rotate(Math.PI / 2); }
        else if (transform.rotation === 2) { ctx.translate(columns, rows); ctx.rotate(Math.PI); }
        else if (transform.rotation === 3) { ctx.translate(0, columns); ctx.rotate(-Math.PI / 2); }
        if (transform.flipH) { ctx.translate(columns, 0); ctx.scale(-1, 1); }
        if (transform.flipV) { ctx.translate(0, rows); ctx.scale(1, -1); }
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();

        [...measurements, pending].filter(Boolean).forEach((m) => drawMeasurement(ctx, m, transform, pixelSpacing, frame));
    }, [size, transform, geometry, measurements, pending, pixelSpacing, frame, viewport.window, viewport.smooth]);

    const pointAt = useCallback((event) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }, []);

    const onPointerDown = useCallback((event) => {
        // Capture keeps a drag alive when it leaves the canvas — an enhancement,
        // not a precondition. It throws if the pointer is already gone by the
        // time React dispatches (fast taps, synthetic events); the gesture must
        // start regardless.
        try { canvasRef.current.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
        canvasRef.current.focus();
        const point = pointAt(event);
        const image = toImagePoint(point, transform);

        const gesture = event.button === 1 || event.shiftKey ? 'pan'
            : event.button === 2 ? 'zoom'
                : tool;

        dragRef.current = { gesture, last: point, start: point, startImage: image };
        if (gesture === 'distance' || gesture === 'region') {
            setPending({ kind: gesture, from: image, to: image });
        }
    }, [pointAt, transform, tool]);

    const onPointerMove = useCallback((event) => {
        const point = pointAt(event);
        const image = toImagePoint(point, transform);

        // The HU readout follows the cursor whether or not a drag is running:
        // it is how a reader interrogates a density without committing an ROI.
        if (frame?.values && image.x >= 0 && image.y >= 0 && image.x < geometry.columns && image.y < geometry.rows) {
            const value = frame.values[Math.floor(image.y) * geometry.columns + Math.floor(image.x)];
            const next = { x: Math.floor(image.x), y: Math.floor(image.y), value };
            setProbe(next);
            onProbe?.(next);
        } else {
            setProbe(null);
        }

        const drag = dragRef.current;
        if (!drag) return;
        const dx = point.x - drag.last.x;
        const dy = point.y - drag.last.y;
        drag.last = point;

        // Functional updates, not `windowBy(viewport, ...)`: several pointer or
        // wheel events can land inside one React batch, and building each new
        // state from the render-scope value silently drops all but the last —
        // a fast wheel-fling would move one slice. The updater form composes.
        if (drag.gesture === 'window') onViewportChange((v) => windowBy(v, dx, dy));
        else if (drag.gesture === 'pan') onViewportChange((v) => panBy(v, dx, dy));
        else if (drag.gesture === 'zoom') onViewportChange((v) => zoomAbout(v, Math.exp(-dy / 200), drag.start, geometry, size));
        else if (drag.gesture === 'distance' || drag.gesture === 'region') {
            setPending({ kind: drag.gesture, from: drag.startImage, to: image });
        }
    }, [pointAt, transform, onViewportChange, geometry, size, frame, onProbe]);

    const onPointerUp = useCallback((event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        try { canvasRef.current?.releasePointerCapture?.(event.pointerId); } catch { /* never captured */ }
        if (!drag || !pending) { setPending(null); return; }

        // A click with no drag is not a measurement; committing one would leave
        // a zero-length artefact on the image every time a reader clicked.
        const dragged = Math.hypot(pending.to.x - pending.from.x, pending.to.y - pending.from.y);
        if (dragged >= 1) onMeasure?.(summarise(pending, pixelSpacing, frame));
        setPending(null);
    }, [pending, onMeasure, pixelSpacing, frame]);

    const onWheel = useCallback((event) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
            const rect = canvasRef.current.getBoundingClientRect();
            const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            onViewportChange((v) => zoomAbout(v, Math.exp(-event.deltaY / 200), point, geometry, size));
            return;
        }
        onViewportChange((v) => scrollBy(v, event.deltaY > 0 ? 1 : -1));
    }, [onViewportChange, geometry, size]);

    // A non-passive listener, because React's synthetic wheel handler is passive
    // and cannot preventDefault — without this the page scrolls behind the study.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', onWheel);
    }, [onWheel]);

    const onKeyDown = useCallback((event) => {
        const step = event.shiftKey ? 10 : 1;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); onViewportChange((v) => scrollBy(v, step)); }
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); onViewportChange((v) => scrollBy(v, -step)); }
        else if (event.key === 'Home') { event.preventDefault(); onViewportChange((v) => scrollTo(v, 0)); }
        else if (event.key === 'End') { event.preventDefault(); onViewportChange((v) => scrollTo(v, v.sliceCount - 1)); }
        else if (event.key === 'PageDown') { event.preventDefault(); onViewportChange((v) => scrollBy(v, 10)); }
        else if (event.key === 'PageUp') { event.preventDefault(); onViewportChange((v) => scrollBy(v, -10)); }
    }, [onViewportChange]);

    const markers = useMemo(
        () => displayedOrientation(orientationLabels(orientation), viewport),
        [orientation, viewport.rotation, viewport.flipH, viewport.flipV], // eslint-disable-line react-hooks/exhaustive-deps
    );

    return (
        <div className="relative w-full h-full bg-black select-none overflow-hidden">
            <canvas
                ref={canvasRef}
                tabIndex={0}
                role="img"
                aria-label={t('radoyon_viewport_label', 'Image viewport')}
                className="w-full h-full outline-none cursor-crosshair touch-none"
                style={{ display: 'block' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
                onDoubleClick={() => onViewportChange((v) => resetView(v))}
                onContextMenu={(e) => e.preventDefault()}
            />
            {!frame && (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 border border-white/10 text-xs text-slate-300">
                        <LoaderCircle className="w-3.5 h-3.5 animate-spin text-cyan-400" aria-hidden="true" />
                        {t('radoyon_loading_slice', 'Loading slice…')}
                    </div>
                </div>
            )}
            <Corners frame={frame} viewport={viewport} probe={probe} info={info} pixelSpacing={pixelSpacing} t={t} />
            {markers && <OrientationMarkers markers={markers} />}
            <ScaleBar pixelSpacing={pixelSpacing} scale={transform.scale} t={t} />
            <SliceScrollbar viewport={viewport} onViewportChange={onViewportChange} />
        </div>
    );
}

/**
 * The corner annotations every workstation shows. They are not decoration: the
 * slice index, the window and the units are what let a reader say where they
 * are and what they are looking at, and their absence is the first thing a
 * radiologist notices about a toy viewer.
 */
function Corners({ frame, viewport, probe, info, pixelSpacing, t }) {
    const cell = 'absolute text-[11px] leading-4 font-mono text-cyan-300/90 pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]';
    const shown = frame ?? null;
    return (
        <>
            <div className={`${cell} top-1.5 left-2 space-y-px max-w-[55%]`}>
                {info?.studyDescription && <div className="truncate text-slate-200">{info.studyDescription}</div>}
                {info?.seriesDescription && <div className="truncate text-slate-400">{info.seriesDescription}</div>}
                <div>{t('radoyon_slice', 'Im')} {viewport.slice + 1}/{viewport.sliceCount}</div>
            </div>
            <div className={`${cell} top-1.5 right-2 text-right space-y-px`}>
                {info?.modality && <div className="text-slate-300">{info.modality}{info?.plane && info.plane !== 'unknown' ? ` · ${info.plane}` : ''}</div>}
                <div>W {Math.round(viewport.window.width)} / L {Math.round(viewport.window.center)}</div>
                <div>{t('radoyon_zoom', 'Zoom')} {viewport.zoom.toFixed(2)}&times;</div>
            </div>
            <div className={`${cell} bottom-1.5 left-2 space-y-px`}>
                {probe && (
                    <div>({probe.x}, {probe.y}) {Number.isFinite(probe.value) ? probe.value.toFixed(0) : '—'} {shown?.units}</div>
                )}
                {shown && (
                    <div className="text-slate-500">
                        {shown.columns}&times;{shown.rows}
                        {Array.isArray(pixelSpacing) && Number.isFinite(pixelSpacing[0])
                            // Three decimals, because the stored value is not a
                            // measurement to that precision: a CR reporting
                            // 0.1438572207084 mm has a detector pitch divided out to
                            // fourteen digits, and printing all of them tells the
                            // reader nothing while filling the corner.
                            && ` · ${Number(pixelSpacing[1] ?? pixelSpacing[0]).toFixed(3)} mm/px`}
                    </div>
                )}
            </div>
        </>
    );
}

/** L/R/A/P/H/F at the viewport's mid-edges, permuted with the presentation. */
function OrientationMarkers({ markers }) {
    const mark = 'absolute text-[12px] font-mono font-semibold text-amber-300/90 pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]';
    return (
        <>
            <div className={`${mark} top-1.5 left-1/2 -translate-x-1/2`}>{markers.up}</div>
            <div className={`${mark} bottom-1.5 left-1/2 -translate-x-1/2`}>{markers.down}</div>
            <div className={`${mark} left-2 top-1/2 -translate-y-1/2`}>{markers.left}</div>
            <div className={`${mark} right-5 top-1/2 -translate-y-1/2`}>{markers.right}</div>
        </>
    );
}

/**
 * A physical scale bar. Its length is chosen from round numbers so it reads
 * "5 cm", never "3.7 cm" — the point is to calibrate the reader's eye.
 */
function ScaleBar({ pixelSpacing, scale, t }) {
    const mmPerPixel = Array.isArray(pixelSpacing) ? Number(pixelSpacing[1] ?? pixelSpacing[0]) : NaN;
    if (!Number.isFinite(mmPerPixel) || !(mmPerPixel > 0) || !(scale > 0)) return null;
    const candidates = [10, 20, 50, 100, 200];
    const px = (mm) => (mm / mmPerPixel) * scale;
    const mm = [...candidates].reverse().find((c) => px(c) <= 160) ?? 10;
    const width = px(mm);
    if (width < 24) return null;
    return (
        <div className="absolute bottom-2 right-8 pointer-events-none flex flex-col items-end gap-0.5">
            <div className="text-[10px] font-mono text-slate-400">{mm >= 10 ? `${mm / 10} cm` : `${mm} mm`}</div>
            <div className="h-1.5 border-x border-b border-slate-400/80" style={{ width: `${width}px` }} aria-hidden="true" />
        </div>
    );
}

/**
 * The stack position, as a draggable track on the right edge — the fastest way
 * to jump 200 slices, and a constant reminder of where in the body you are.
 */
function SliceScrollbar({ viewport, onViewportChange }) {
    const trackRef = useRef(null);
    if (!(viewport.sliceCount > 1)) return null;
    const fraction = viewport.slice / (viewport.sliceCount - 1);

    const jumpTo = (event) => {
        const rect = trackRef.current.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
        onViewportChange((v) => scrollTo(v, Math.round(f * (v.sliceCount - 1))));
    };

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
            ref={trackRef}
            className="absolute right-1 top-10 bottom-10 w-2.5 rounded-full bg-white/5 hover:bg-white/10 cursor-pointer touch-none"
            onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); jumpTo(e); }}
            onPointerMove={(e) => { if (e.buttons & 1) { e.stopPropagation(); jumpTo(e); } }}
        >
            <div
                className="absolute left-1/2 -translate-x-1/2 w-2.5 h-5 rounded-full bg-cyan-400/70"
                style={{ top: `calc(${(fraction * 100).toFixed(2)}% - 10px)` }}
                aria-hidden="true"
            />
        </div>
    );
}

/** Turn a pending gesture into a measurement with its computed value. */
function summarise(pending, pixelSpacing, frame) {
    if (pending.kind === 'distance') {
        return { ...pending, id: `m${Date.now()}`, result: measureDistance(pending.from, pending.to, pixelSpacing) };
    }
    const radius = Math.hypot(pending.to.x - pending.from.x, pending.to.y - pending.from.y);
    return {
        ...pending,
        id: `m${Date.now()}`,
        radius,
        result: measureRegion(frame.values, frame, { centerX: pending.from.x, centerY: pending.from.y, radius }),
    };
}

function drawMeasurement(ctx, measurement, transform, pixelSpacing, frame) {
    const from = toCanvasPoint(measurement.from, transform);
    const to = toCanvasPoint(measurement.to, transform);
    ctx.save();
    ctx.strokeStyle = '#56B4E9';
    ctx.fillStyle = '#56B4E9';
    ctx.lineWidth = 1.5;
    ctx.font = '12px ui-monospace, monospace';

    if (measurement.kind === 'distance') {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        const result = measurement.result ?? measureDistance(measurement.from, measurement.to, pixelSpacing);
        const text = result.unit === 'mm' ? `${result.mm.toFixed(1)} mm` : `${result.px.toFixed(0)} px`;
        label(ctx, text, (from.x + to.x) / 2 + 6, (from.y + to.y) / 2 - 6);
    } else {
        const radius = Math.hypot(to.x - from.x, to.y - from.y);
        ctx.beginPath();
        ctx.arc(from.x, from.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        const result = measurement.result
            ?? (frame?.values ? measureRegion(frame.values, frame, { centerX: measurement.from.x, centerY: measurement.from.y, radius: radius / transform.scale }) : null);
        if (result && result.count > 0) {
            label(ctx, `${result.mean.toFixed(0)} ± ${result.sd.toFixed(0)} ${frame?.units ?? ''}`, from.x + radius + 6, from.y);
        }
    }
    ctx.restore();
}

function label(ctx, text, x, y) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    const width = ctx.measureText(text).width;
    ctx.fillRect(x - 3, y - 12, width + 6, 16);
    ctx.fillStyle = '#56B4E9';
    ctx.fillText(text, x, y);
    ctx.restore();
}

export default Viewport;
