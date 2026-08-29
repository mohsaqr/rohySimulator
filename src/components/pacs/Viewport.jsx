import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { applyWindow } from './windowLevel.js';
import { measureDistance, measureRegion } from './series.js';
import {
    panBy, scrollBy, toCanvasPoint, toImagePoint, viewTransform, windowBy, zoomAbout,
} from './viewportState.js';

/**
 * The image viewport: renders one slice, and owns the gestures that read a
 * study.
 *
 * The bindings are the ones every PACS uses, because a trainee who learns this
 * viewer should be learning the workstation they will sit at afterwards:
 *
 *   left drag        window / level   (horizontal = width, vertical = level)
 *   wheel            scroll the stack
 *   middle drag      pan
 *   right drag       zoom
 *   shift + left     pan               (for trackpads with no middle button)
 *
 * Rendering goes through an offscreen canvas at the image's native size, which
 * is then drawn scaled. Windowing therefore touches each pixel once per frame
 * regardless of zoom, and zooming costs nothing but a `drawImage`.
 */
export function Viewport({
    frame,
    viewport,
    onViewportChange,
    pixelSpacing,
    inverted = false,
    tool = 'window',
    measurements = [],
    onMeasure,
    onProbe,
    t = (key, fallback) => fallback ?? key,
}) {
    const canvasRef = useRef(null);
    const offscreenRef = useRef(null);
    const dragRef = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [pending, setPending] = useState(null);
    const [probe, setProbe] = useState(null);

    const geometry = useMemo(
        () => ({ rows: frame?.rows ?? 0, columns: frame?.columns ?? 0 }),
        [frame?.rows, frame?.columns],
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
        const grey = applyWindow(frame.values, { ...viewport.window, invert: inverted !== viewport.invert });
        const image = offscreen.getContext('2d').createImageData(columns, rows);
        for (let i = 0, j = 0; i < grey.length; i++, j += 4) {
            image.data[j] = grey[i];
            image.data[j + 1] = grey[i];
            image.data[j + 2] = grey[i];
            image.data[j + 3] = 255;
        }
        offscreen.getContext('2d').putImageData(image, 0, 0);
    }, [frame, viewport.window, viewport.invert, inverted]);

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
        ctx.imageSmoothingEnabled = transform.scale < 1;
        ctx.drawImage(
            offscreen, transform.offsetX, transform.offsetY,
            geometry.columns * transform.scale, geometry.rows * transform.scale,
        );

        [...measurements, pending].filter(Boolean).forEach((m) => drawMeasurement(ctx, m, transform, pixelSpacing, frame));
    }, [size, transform, geometry, measurements, pending, pixelSpacing, frame, viewport.window]);

    const pointAt = useCallback((event) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }, []);

    const onPointerDown = useCallback((event) => {
        canvasRef.current.setPointerCapture(event.pointerId);
        const point = pointAt(event);
        const image = toImagePoint(point, transform);

        const gesture = event.button === 1 || event.shiftKey ? 'pan'
            : event.button === 2 ? 'zoom'
                : tool === 'window' ? 'window' : tool;

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

        if (drag.gesture === 'window') onViewportChange(windowBy(viewport, dx, dy));
        else if (drag.gesture === 'pan') onViewportChange(panBy(viewport, dx, dy));
        else if (drag.gesture === 'zoom') onViewportChange(zoomAbout(viewport, Math.exp(-dy / 200), drag.start, geometry, size));
        else if (drag.gesture === 'distance' || drag.gesture === 'region') {
            setPending({ kind: drag.gesture, from: drag.startImage, to: image });
        }
    }, [pointAt, transform, viewport, onViewportChange, geometry, size, frame, onProbe]);

    const onPointerUp = useCallback((event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        canvasRef.current?.releasePointerCapture?.(event.pointerId);
        if (!drag || !pending) { setPending(null); return; }

        // A click with no drag is not a measurement; committing one would leave
        // a zero-length artefact on the image every time a reader clicked.
        const dragged = Math.hypot(pending.to.x - pending.from.x, pending.to.y - pending.from.y);
        if (dragged >= 1) onMeasure?.(summarise(pending, pixelSpacing, frame));
        setPending(null);
    }, [pending, onMeasure, pixelSpacing, frame]);

    const onWheel = useCallback((event) => {
        event.preventDefault();
        onViewportChange(scrollBy(viewport, event.deltaY > 0 ? 1 : -1));
    }, [viewport, onViewportChange]);

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
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); onViewportChange(scrollBy(viewport, step)); }
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); onViewportChange(scrollBy(viewport, -step)); }
    }, [viewport, onViewportChange]);

    return (
        <div className="relative w-full h-full bg-black select-none">
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
                onContextMenu={(e) => e.preventDefault()}
            />
            <Corners frame={frame} viewport={viewport} probe={probe} t={t} />
        </div>
    );
}

/**
 * The corner annotations every workstation shows. They are not decoration: the
 * slice index, the window and the units are what let a reader say where they
 * are and what they are looking at, and their absence is the first thing a
 * radiologist notices about a toy viewer.
 */
function Corners({ frame, viewport, probe, t }) {
    if (!frame) return null;
    const cell = 'absolute text-[11px] font-mono text-cyan-300/90 pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]';
    return (
        <>
            <div className={`${cell} top-2 left-2 space-y-0.5`}>
                <div>{t('radoyon_slice', 'Slice')} {viewport.slice + 1}/{viewport.sliceCount}</div>
                <div>{frame.columns}&times;{frame.rows}</div>
            </div>
            <div className={`${cell} top-2 right-2 text-right space-y-0.5`}>
                <div>W {Math.round(viewport.window.width)} / L {Math.round(viewport.window.center)}</div>
                <div>{t('radoyon_zoom', 'Zoom')} {viewport.zoom.toFixed(2)}&times;</div>
            </div>
            {probe && (
                <div className={`${cell} bottom-2 left-2`}>
                    ({probe.x}, {probe.y}) {Number.isFinite(probe.value) ? probe.value.toFixed(0) : '—'} {frame.units}
                </div>
            )}
        </>
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
            ?? measureRegion(frame.values, frame, { centerX: measurement.from.x, centerY: measurement.from.y, radius: radius / transform.scale });
        if (result.count > 0) {
            label(ctx, `${result.mean.toFixed(0)} ± ${result.sd.toFixed(0)} ${frame.units}`, from.x + radius + 6, from.y);
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
