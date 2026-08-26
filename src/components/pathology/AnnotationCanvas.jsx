import { useCallback, useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';
import {
    ANNOTATION_KINDS,
    annotationColor,
    annotationLabel,
    annotationVertices,
    countingFrameCorners,
    measureAnnotation,
    pickAt,
    formatArea,
    formatLength,
} from './annotationModel.js';
import { simplifyPath } from './annotationGeometry.js';

/**
 * The drawing surface: one canvas over the slide, and every pointer gesture
 * that turns into an annotation.
 *
 * TWO DECISIONS HERE ARE LOAD-BEARING.
 *
 * 1. The canvas has `pointer-events: none` and NEVER receives a pointer event.
 *    All input arrives through OpenSeadragon's own MouseTracker, via its
 *    `canvas-press` / `canvas-drag` / `canvas-release` handlers, and a tool
 *    that wants a gesture sets `event.preventDefaultAction = true` to stop OSD
 *    panning with it. The obvious alternative — putting the canvas on top and
 *    toggling pointer-events per tool — means re-implementing pan, pinch,
 *    inertia and touch for the select tool, and fighting OSD for every gesture
 *    that starts on empty background. Letting OSD own the gestures and opting
 *    out of specific defaults is both less code and better behaved.
 *
 * 2. Drawing state lives in REFS, not in React state. A freehand stroke emits
 *    a point every animation frame; routing that through setState would
 *    re-render the tree sixty times a second and rebuild the viewer. The
 *    component renders once, and `draw()` is called imperatively.
 *
 * COORDINATES. Annotations are stored in SLIDE (level-0) pixels. Conversion to
 * and from screen goes through the TiledImage plus the viewport rather than
 * arithmetic on getBounds(), because those two calls are what correctly
 * account for rotation and flip — a hand-rolled affine would silently draw
 * annotations in the wrong place the moment the reader rotated the slide.
 */
export function AnnotationCanvas({
    viewer,
    slide,
    tool = 'navigate',
    activeClass = null,
    frameAreaMm2 = 2,
    annotations = [],
    selectedId = null,
    showLabels = true,
    onSelect,
    onAdd,
    onUpdate,
    onDelete,
    controlsRef,
}) {
    const canvasRef = useRef(null);
    // The floating action bar for the selected mark. Positioned IMPERATIVELY
    // from draw(), never through state: it has to track the annotation on
    // every animation frame of a pan, and routing that through React would
    // re-render the tree sixty times a second for a two-button strip.
    const badgeRef = useRef(null);

    // Everything the handlers and the renderer read. Kept in one ref so the
    // OSD handlers can be registered ONCE per viewer and never go stale.
    //
    // Synced in an EFFECT, not during render: a ref written during render is
    // invisible to React and was the root of a viewer-rebuild bug elsewhere in
    // this package. Every reader of this ref is an OSD pointer handler, and
    // those only fire in response to user input — which is always after the
    // commit that ran this effect. This effect is declared BEFORE the draw
    // effect below so the renderer never paints from a stale snapshot.
    const stateRef = useRef({});
    const callbacksRef = useRef({});
    useEffect(() => {
        stateRef.current = {
            ...stateRef.current,
            slide, tool, activeClass, frameAreaMm2, annotations, selectedId, showLabels,
        };
        callbacksRef.current = { onSelect, onAdd, onUpdate, onDelete };
    });

    // The gesture in flight: a rubber-band shape, a polygon being clicked out,
    // or an existing annotation being moved.
    const draftRef = useRef(null);

    // ---- coordinate conversion ------------------------------------------

    const converters = useCallback(() => {
        const item = viewer?.world?.getItemAt?.(0);
        if (!item || !slide?.downsample) return null;
        const { downsample } = slide;
        // OSD's converters call Point methods (`minus`, `times`, `rotate`) on
        // whatever they are handed, so a plain {x, y} throws
        // "pixel.minus is not a function" from inside OSD. Every point crossing
        // this boundary is constructed as a real OpenSeadragon.Point.
        const P = (x, y) => new OpenSeadragon.Point(x, y);
        return {
            toSlide: (elementPoint) => {
                const image = item.viewportToImageCoordinates(
                    viewer.viewport.viewerElementToViewportCoordinates(P(elementPoint.x, elementPoint.y)),
                );
                return { x: image.x * downsample, y: image.y * downsample };
            },
            toElement: (slidePoint) => {
                const viewport = item.imageToViewportCoordinates(
                    P(slidePoint.x / downsample, slidePoint.y / downsample),
                );
                return viewer.viewport.viewportToViewerElementCoordinates(viewport);
            },
        };
    }, [viewer, slide]);

    /**
     * How many slide pixels one screen pixel spans right now.
     *
     * Measured by converting two points ten screen pixels apart rather than
     * derived from the zoom, so it stays correct under rotation and flip.
     */
    const slidePerScreen = useCallback((c) => {
        const a = c.toSlide({ x: 0, y: 0 });
        const b = c.toSlide({ x: 10, y: 0 });
        return Math.hypot(b.x - a.x, b.y - a.y) / 10;
    }, []);

    // ---- rendering -------------------------------------------------------

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const c = converters();
        if (!canvas || !c || !viewer) return;

        const ctx = canvas.getContext('2d');
        const { clientWidth: w, clientHeight: h } = viewer.container;
        // Match the backing store to the device so a 1 px outline is a real
        // hairline on a Retina display rather than a soft two-pixel smear.
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const s = stateRef.current;
        s.annotations.forEach((a) => paint(ctx, a, {
            toElement: c.toElement,
            selected: a.id === s.selectedId,
            showLabels: s.showLabels,
            slide: s.slide,
        }));

        const draft = draftRef.current;
        if (draft?.preview) {
            paint(ctx, draft.preview, {
                toElement: c.toElement,
                selected: false,
                showLabels: s.showLabels,
                slide: s.slide,
                pending: true,
            });
        }

        positionBadge(badgeRef.current, {
            annotation: draft?.preview ? null : s.annotations.find((a) => a.id === s.selectedId),
            toElement: c.toElement,
            width: w,
            height: h,
        });
    }, [viewer, converters]);

    // Repaint whenever the data changes. The viewport-driven repaints are
    // wired separately, below.
    useEffect(() => { draw(); }, [draw, annotations, selectedId, showLabels, tool]);

    // ---- OSD event wiring -------------------------------------------------

    useEffect(() => {
        if (!viewer) return undefined;

        const c = () => converters();

        // A gesture that produced no movement is a click. 3 screen px of slop
        // covers the shake in a normal click without swallowing a deliberate
        // short drag.
        const CLICK_SLOP_PX = 3;

        const beginDraft = (kind, start) => {
            draftRef.current = {
                mode: 'create',
                kind,
                points: [start],
                start,
                moved: false,
            };
        };

        // A draft is a plain record, NOT a createAnnotation() result: it is
        // deliberately not validated or normalised, because a shape mid-drag
        // is legitimately degenerate (a rectangle is zero-width for the first
        // frame of every drag). Validation happens once, on commit.
        const previewFor = (kind, points) => ({
            id: '__draft__',
            kind,
            points,
            classification: stateRef.current.activeClass,
            text: '',
            tally: kind === ANNOTATION_KINDS.COUNTING_FRAME ? 0 : null,
            targetAreaMm2: kind === ANNOTATION_KINDS.COUNTING_FRAME ? stateRef.current.frameAreaMm2 : null,
        });

        const commit = (kind, points, extra = {}) => {
            const s = stateRef.current;
            callbacksRef.current.onAdd?.({
                kind,
                points,
                classification: s.activeClass,
                ...extra,
            });
        };

        const onPress = (event) => {
            const conv = c();
            const s = stateRef.current;
            if (!conv || s.tool === 'navigate') return;
            const point = conv.toSlide(event.position);

            if (s.tool === 'select') {
                const tol = slidePerScreen(conv) * 8;
                const selected = s.annotations.find((a) => a.id === s.selectedId);

                // A handle on the CURRENT selection wins over anything beneath
                // it, so a vertex sitting on top of another shape can still be
                // grabbed.
                const handleIndex = selected
                    ? selected.points.findIndex((p) => Math.hypot(p.x - point.x, p.y - point.y) <= tol)
                    : -1;
                if (handleIndex !== -1) {
                    draftRef.current = { mode: 'vertex', id: selected.id, index: handleIndex, points: [...selected.points] };
                    event.preventDefaultAction = true;
                    return;
                }

                // Smallest-first, not topmost — see pickAt() for why.
                const hit = pickAt(s.annotations, point, tol);
                if (hit) {
                    callbacksRef.current.onSelect?.(hit.id);
                    draftRef.current = { mode: 'move', id: hit.id, origin: point, points: [...hit.points] };
                    event.preventDefaultAction = true;
                    return;
                }
                // Nothing under the pointer: deselect, and deliberately do NOT
                // preventDefaultAction — this drag becomes an ordinary pan.
                callbacksRef.current.onSelect?.(null);
                return;
            }

            // --- drawing tools -------------------------------------------
            if (s.tool === ANNOTATION_KINDS.POLYGON) {
                const draft = draftRef.current;
                if (draft?.mode === 'polygon') draft.points.push(point);
                else draftRef.current = { mode: 'polygon', kind: ANNOTATION_KINDS.POLYGON, points: [point] };
                event.preventDefaultAction = true;
                draw();
                return;
            }

            beginDraft(s.tool, point);
            event.preventDefaultAction = true;
        };

        const onDrag = (event) => {
            const conv = c();
            const draft = draftRef.current;
            const s = stateRef.current;
            if (!conv || !draft) return;
            const point = conv.toSlide(event.position);
            event.preventDefaultAction = true;

            if (draft.mode === 'move') {
                const dx = point.x - draft.origin.x;
                const dy = point.y - draft.origin.y;
                draft.preview = {
                    ...s.annotations.find((a) => a.id === draft.id),
                    points: draft.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                };
                draft.moved = true;
                draw();
                return;
            }

            if (draft.mode === 'vertex') {
                const points = [...draft.points];
                points[draft.index] = point;
                draft.preview = { ...s.annotations.find((a) => a.id === draft.id), points };
                draft.moved = true;
                draw();
                return;
            }

            if (draft.mode !== 'create') return;
            draft.moved = true;

            if (draft.kind === ANNOTATION_KINDS.FREEHAND
                || draft.kind === ANNOTATION_KINDS.POLYLINE) {
                draft.points.push(point);
                // A closed region needs three vertices; an open path is a path
                // as soon as it has two.
                const minimum = draft.kind === ANNOTATION_KINDS.FREEHAND ? 3 : 2;
                draft.preview = draft.points.length >= minimum
                    ? previewFor(draft.kind, draft.points)
                    : null;
            } else {
                draft.preview = previewFor(draft.kind, [draft.start, point]);
            }
            draw();
        };

        const onRelease = (event) => {
            const conv = c();
            const draft = draftRef.current;
            const s = stateRef.current;
            if (!conv || !draft) return;
            const point = conv.toSlide(event.position);

            if (draft.mode === 'move' || draft.mode === 'vertex') {
                if (draft.moved && draft.preview) {
                    callbacksRef.current.onUpdate?.(draft.id, { points: draft.preview.points });
                }
                draftRef.current = null;
                draw();
                return;
            }

            if (draft.mode === 'polygon') return; // finished by Enter or double-click

            if (draft.mode !== 'create') return;

            const dragged = Math.hypot(point.x - draft.start.x, point.y - draft.start.y)
                > slidePerScreen(conv) * CLICK_SLOP_PX;

            if (draft.kind === ANNOTATION_KINDS.POINT) {
                commit(ANNOTATION_KINDS.POINT, [draft.start]);
            } else if (draft.kind === ANNOTATION_KINDS.COUNTING_FRAME) {
                // A frame is PLACED, not dragged: its whole purpose is to
                // enclose a known area, so it is built from the nominal mm²
                // and the scanner's mpp rather than from however far the
                // pointer happened to travel.
                commit(
                    ANNOTATION_KINDS.COUNTING_FRAME,
                    countingFrameCorners(draft.start, {
                        areaMm2: s.frameAreaMm2,
                        nativeMpp: s.slide.nativeMpp,
                    }),
                    { targetAreaMm2: s.frameAreaMm2, tally: 0 },
                );
            } else if (draft.kind === ANNOTATION_KINDS.FREEHAND
                || draft.kind === ANNOTATION_KINDS.POLYLINE) {
                const minimum = draft.kind === ANNOTATION_KINDS.FREEHAND ? 3 : 2;
                if (draft.points.length >= minimum) {
                    // Simplify at 2 screen pixels, so the tolerance follows the
                    // magnification the stroke was drawn at.
                    commit(draft.kind, simplifyPath(draft.points, slidePerScreen(conv) * 2));
                }
            } else if (dragged) {
                commit(draft.kind, [draft.start, point]);
            }
            // A click that never became a drag on a two-point tool is simply
            // discarded — silently creating a zero-length ruler would litter
            // the slide with unmeasurable artefacts.

            draftRef.current = null;
            draw();
        };

        const onDoubleClick = (event) => {
            const draft = draftRef.current;
            if (draft?.mode !== 'polygon') return;
            event.preventDefaultAction = true;
            finishPolygon();
        };

        const finishPolygon = () => {
            const draft = draftRef.current;
            if (draft?.mode !== 'polygon') return;
            if (draft.points.length >= 3) commit(ANNOTATION_KINDS.POLYGON, draft.points);
            draftRef.current = null;
            draw();
        };
        // Published upward so the room's Enter/Escape keys can finish or
        // abandon a polygon. A polygon is the one shape whose gesture spans
        // many clicks, so it is the one shape the keyboard has to be able to
        // end — without this, a polygon could only ever be closed by a
        // double-click.
        if (controlsRef) {
            controlsRef.current = {
                finish: finishPolygon,
                cancel: () => { draftRef.current = null; draw(); },
                drawing: () => draftRef.current !== null,
                // The snapshot compositor needs the overlay's pixels. Handed
                // out as a getter rather than the element itself so a caller
                // holding this object across a slide switch cannot end up
                // compositing a canvas that no longer exists.
                canvas: () => canvasRef.current,
            };
        }

        viewer.addHandler('canvas-press', onPress);
        viewer.addHandler('canvas-drag', onDrag);
        viewer.addHandler('canvas-release', onRelease);
        viewer.addHandler('canvas-double-click', onDoubleClick);
        viewer.addHandler('update-viewport', draw);
        viewer.addHandler('resize', draw);
        viewer.addHandler('open', draw);

        return () => {
            viewer.removeHandler('canvas-press', onPress);
            viewer.removeHandler('canvas-drag', onDrag);
            viewer.removeHandler('canvas-release', onRelease);
            viewer.removeHandler('canvas-double-click', onDoubleClick);
            viewer.removeHandler('update-viewport', draw);
            viewer.removeHandler('resize', draw);
            viewer.removeHandler('open', draw);
        };
    }, [viewer, converters, draw, slidePerScreen, controlsRef]);

    // Abandoning a half-drawn polygon when the tool changes: leaving it live
    // would make the next click with a different tool extend it.
    useEffect(() => {
        draftRef.current = null;
        draw();
    }, [tool, draw]);

    return (
        <>
            <canvas
                ref={canvasRef}
                // Never receives a pointer event: OSD owns every gesture. See
                // the note at the top of the file.
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden="true"
            />
            {/*
              The selected mark's own controls, on the slide rather than only in
              the side panel. Moving and deleting were both possible before this
              existed and neither was discoverable: you had to know to press S
              first, and nothing on screen said so.
            */}
            <div
                ref={badgeRef}
                className="pointer-events-none absolute left-0 top-0 z-10 hidden items-center gap-1
                           rounded-lg bg-slate-950/90 px-1.5 py-1 text-[10px] font-semibold text-slate-300
                           shadow-lg shadow-black/40 ring-1 ring-slate-700/70 backdrop-blur"
            >
                <span className="pointer-events-none px-1 text-slate-400">drag to move</span>
                <button
                    type="button"
                    className="pointer-events-auto rounded p-1 text-slate-300 transition-colors hover:bg-rose-500/25 hover:text-rose-200"
                    title="Delete this mark  (Del)"
                    onClick={() => {
                        const { selectedId } = stateRef.current;
                        if (selectedId) callbacksRef.current.onDelete?.(selectedId);
                    }}
                >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="sr-only">Delete the selected mark</span>
                </button>
            </div>
        </>
    );
}

/**
 * Park the action bar just above the selected mark.
 *
 * Clamped into the viewport rather than allowed to follow the annotation off
 * screen: a reader who pans away from a selected mark should still be able to
 * delete it, and a control that has drifted 40,000 pixels off the canvas is
 * the same as no control at all.
 */
function positionBadge(element, { annotation, toElement, width, height }) {
    if (!element) return;
    if (!annotation) {
        element.style.display = 'none';
        return;
    }
    const screen = annotation.points.map(toElement);
    const left = Math.min(...screen.map((p) => p.x));
    const top = Math.min(...screen.map((p) => p.y));
    element.style.display = 'flex';
    element.style.transform = `translate(${
        Math.max(4, Math.min(width - 120, left))
    }px, ${
        Math.max(4, Math.min(height - 34, top - 34))
    }px)`;
}

// ---- painting ------------------------------------------------------------

const HANDLE_PX = 4;
const POINT_RADIUS_PX = 6;
const ARROW_HEAD_PX = 14;

function paint(ctx, annotation, { toElement, selected, showLabels, slide, pending = false }) {
    const color = annotationColor(annotation);
    const screen = annotationVertices(annotation).map(toElement);
    if (screen.length === 0) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = selected ? 3 : 2;
    // A dashed outline is the ONLY cue that says "not committed yet" without
    // relying on colour, which matters for a reader with a colour deficiency.
    ctx.setLineDash(pending ? [6, 4] : []);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    switch (annotation.kind) {
        case ANNOTATION_KINDS.POINT:
            paintPoint(ctx, screen[0], color);
            break;
        case ANNOTATION_KINDS.ARROW:
            paintArrow(ctx, screen[0], screen[1]);
            break;
        case ANNOTATION_KINDS.LINE:
            paintLine(ctx, screen[0], screen[1]);
            break;
        case ANNOTATION_KINDS.POLYLINE:
            paintOpenPath(ctx, screen);
            break;
        default:
            paintClosed(ctx, screen, color);
            break;
    }

    if (selected) paintHandles(ctx, annotation.points.map(toElement));
    if (showLabels) paintLabel(ctx, annotation, screen, slide, color);
    ctx.restore();
}

function paintPoint(ctx, p, color) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, POINT_RADIUS_PX, 0, 2 * Math.PI);
    // Hollow with an opaque ring: a filled disc hides the very cell the reader
    // is marking, which is the one thing a marker must not do.
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
}

function paintLine(ctx, a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // End ticks perpendicular to the line, so a ruler reads as a ruler and its
    // exact endpoints are visible against busy tissue.
    const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    [a, b].forEach((p) => {
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(angle) * 6, p.y - Math.sin(angle) * 6);
        ctx.lineTo(p.x + Math.cos(angle) * 6, p.y + Math.sin(angle) * 6);
        ctx.stroke();
    });
}

function paintArrow(ctx, a, b) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // The head is sized in SCREEN pixels so it stays legible at every zoom.
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
        b.x - ARROW_HEAD_PX * Math.cos(angle - Math.PI / 7),
        b.y - ARROW_HEAD_PX * Math.sin(angle - Math.PI / 7),
    );
    ctx.lineTo(
        b.x - ARROW_HEAD_PX * Math.cos(angle + Math.PI / 7),
        b.y - ARROW_HEAD_PX * Math.sin(angle + Math.PI / 7),
    );
    ctx.closePath();
    ctx.fill();
}

// An OPEN path: stroked but never closed and never filled, so it cannot be
// mistaken on screen for a region. The end ticks mark where the measurement
// actually starts and stops.
function paintOpenPath(ctx, screen) {
    ctx.beginPath();
    ctx.moveTo(screen[0].x, screen[0].y);
    screen.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    [screen[0], screen[screen.length - 1]].forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
        ctx.stroke();
    });
}

function paintClosed(ctx, screen, color) {
    ctx.beginPath();
    ctx.moveTo(screen[0].x, screen[0].y);
    screen.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    // 12% fill: enough to read the region as a region, faint enough that the
    // tissue underneath is still diagnosable. An opaque fill would make the
    // annotation useless for anything except finding itself again.
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
}

function paintHandles(ctx, points) {
    ctx.save();
    ctx.setLineDash([]);
    points.forEach((p) => {
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(p.x - HANDLE_PX, p.y - HANDLE_PX, HANDLE_PX * 2, HANDLE_PX * 2);
        ctx.strokeStyle = '#F8FAFC';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - HANDLE_PX, p.y - HANDLE_PX, HANDLE_PX * 2, HANDLE_PX * 2);
    });
    ctx.restore();
}

/**
 * The text drawn beside an annotation.
 *
 * Carries the measurement, not just the name: a 1.4 mm outline that does not
 * say "1.4 mm" forces the reader into the side panel to learn what they just
 * drew. Counting frames additionally carry the per-mm² rate, which is the
 * number the report actually needs.
 */
function paintLabel(ctx, annotation, screen, slide, color) {
    let text = annotationLabel(annotation);
    if (slide?.nativeMpp) {
        const m = measureAnnotation(annotation, slide);
        if (annotation.kind === ANNOTATION_KINDS.COUNTING_FRAME) {
            text = `${annotation.tally ?? 0} in ${formatArea(m.areaUm2)}`
                + (m.perMm2 !== null ? ` · ${m.perMm2.toFixed(1)}/mm²` : '');
        } else if (m.lengthUm !== null) {
            text = `${text} · ${formatLength(m.lengthUm)}`;
        } else if (m.areaUm2 !== null) {
            text = `${text} · ${formatArea(m.areaUm2)}`;
        }
    }

    const anchor = screen.reduce(
        (best, p) => (p.y < best.y ? p : best),
        screen[0],
    );
    ctx.save();
    ctx.setLineDash([]);
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    const width = ctx.measureText(text).width;
    // A dark plate behind the text: white-on-tissue is unreadable over a pale
    // section and black-on-tissue is unreadable over a dark one.
    ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
    ctx.fillRect(anchor.x - 3, anchor.y - 17, width + 8, 16);
    ctx.fillStyle = color;
    ctx.fillText(text, anchor.x + 1, anchor.y - 4);
    ctx.restore();
}
