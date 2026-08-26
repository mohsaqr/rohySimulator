import { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { hasOpticalProfile, viewportSample, scaleBar } from './slideGeometry.js';
import { fieldOfViewAreaMm2, formatObjective } from './magnification.js';
import { formatArea } from './annotationModel.js';

/**
 * The slide viewport. Owns the OpenSeadragon instance and nothing else.
 *
 * Two settings here are corrections, not preferences, and should not be
 * "tidied" back to the OSD defaults:
 *
 *   maxZoomPixelRatio: 1.1   Above 1:1 the viewer interpolates. An earlier
 *                            build ran 2.5, which presented a magnified blur
 *                            as if it were tissue at 612%. 1.1 allows a
 *                            slight overshoot for comfort while the HUD
 *                            flags it as interpolated.
 *   dblClickToZoom: false    Double-click zoom swallows paced clicks and
 *                            makes both automated testing and deliberate
 *                            ROI clicking unreliable. It is now also the
 *                            gesture that closes a polygon.
 *
 * Sampling is throttled by the recorder, not here: this component reports
 * every animation frame it is asked about and lets the caller decide what to
 * keep, so the sampling policy lives in exactly one place.
 *
 * The viewer instance is published upward through `onViewer` so the toolbar,
 * the keyboard map and the annotation layer all drive ONE viewer. It is passed
 * as a value rather than exposed through an imperative handle because the
 * annotation layer needs to re-register its handlers when the viewer is
 * rebuilt, and a ref mutation would not trigger that.
 */
export function SlideCanvas({
    slide,
    onSample,
    onViewer,
    startedAt,
    filter = 'none',
    showNavigator = true,
    children,
}) {
    const hostRef = useRef(null);
    const viewerRef = useRef(null);
    const [hud, setHud] = useState(null);

    // Held in refs so a fresh callback identity at the call site cannot make
    // this effect tear down and rebuild the viewer. That exact mistake once
    // made an idle page rebuild OpenSeadragon continuously.
    const onSampleRef = useRef(onSample);
    useEffect(() => { onSampleRef.current = onSample; }, [onSample]);
    const onViewerRef = useRef(onViewer);
    useEffect(() => { onViewerRef.current = onViewer; }, [onViewer]);
    // Belt and braces with the fix in useReadRecorder: even a genuinely new
    // read clock must not cost a viewer rebuild. Rebuilding OSD throws away
    // the reader's position and re-downloads tiles; a changed epoch only
    // affects the `t` stamped on future samples.
    const startedAtRef = useRef(startedAt);
    useEffect(() => { startedAtRef.current = startedAt; }, [startedAt]);

    useEffect(() => {
        if (!hostRef.current || !slide?.dzi) return undefined;

        // Rohy runs React StrictMode (src/main.jsx), which in development
        // mounts every effect, tears it down, and mounts it again. Building
        // the viewer synchronously means the throwaway first instance starts
        // an async Deep Zoom fetch that lands AFTER its own destroy(), and OSD
        // asserts "[TiledImage] options.drawer is required" — the assert lives
        // inside OSD, so guarding our own handlers does not stop it, and
        // close() does not cancel a request already in flight.
        //
        // Deferring construction by one macrotask means the discarded mount
        // never constructs a viewer at all: its cleanup runs first and simply
        // cancels the pending timer. One tick of delay, no race to lose.
        let disposed = false;
        let viewer = null;

        const timer = setTimeout(() => {
            if (disposed) return;

            viewer = OpenSeadragon({
                element: hostRef.current,
                tileSources: slide.dzi,
                prefixUrl: slide.osdPrefixUrl ?? '/openseadragon/images/',
                showNavigator: true,
                navigatorPosition: 'BOTTOM_RIGHT',
                navigatorSizeRatio: 0.14,
                navigatorBackground: '#020617',
                navigatorBorderColor: '#334155',
                navigatorDisplayRegionColor: '#E879F9',
                // OSD fades the navigator out when the pointer leaves the
                // viewer. The usability work on WSI navigation found readers
                // specifically want a thumbnail showing where they are on the
                // slide — a thumbnail that disappears whenever you look away
                // from the canvas cannot serve that purpose, and at 20x the
                // navigator is often the only thing telling you which end of
                // the core you are on.
                navigatorAutoFade: false,
                // The default OSD button cluster is redundant now that the
                // toolbar carries zoom, home, rotate and flip with visible key
                // hints. Two sets of controls for the same actions is how a
                // viewer ends up with a fit button that disagrees with its
                // fit hotkey.
                showNavigationControl: false,
                maxZoomPixelRatio: 1.1,
                visibilityRatio: 1,
                constrainDuringPan: true,
                animationTime: 0.5,
                springStiffness: 6.5,
                gestureSettingsMouse: { dblClickToZoom: false, clickToZoom: false },
                // Keyboard is handled by this package's own keymap, on the room
                // container. OSD's built-in arrow handling would fight it and
                // pan by a different, unconfigurable amount — and its 'r'
                // rotates the slide, which would collide with the rectangle
                // tool. The option is keyboardNavEnabled, not the plausible
                // keyboardShortCuts; the wrong name is silently ignored.
                keyboardNavEnabled: false,
            });

            const sample = () => {
                const item = viewer.world.getItemAt(0);
                // Fires before the tile source resolves on first paint.
                if (!item) return;
                // A slide can legitimately be half-described — the case editor
                // shows the tissue while the author is still typing its
                // calibration. Report that state rather than asking
                // opticalProfile() for a number it would rightly refuse to
                // invent. Without this the sampler threw on every frame.
                if (!hasOpticalProfile(slide)) { setHud({ uncalibrated: true }); return; }
                const next = viewportSample({
                    bounds: viewer.viewport.getBounds(true),
                    // Rotation-invariant scale — see viewportSample's ROTATION note.
                    boundsNoRotate: viewer.viewport.getBoundsNoRotate(true),
                    imageWidthPx: item.getContentSize().x,
                    containerWidthPx: viewer.container.clientWidth,
                    slide,
                    t: Date.now() - startedAtRef.current,
                });
                setHud({ ...next, rotation: viewer.viewport.getRotation(), flipped: viewer.viewport.getFlip() });
                onSampleRef.current?.(next);
            };

            viewer.addHandler('open', () => {
                viewerRef.current = viewer;
                onViewerRef.current?.(viewer);
                sample();
            });
            viewer.addHandler('animation', sample);
            viewer.addHandler('animation-finish', sample);
            // Rotation and flip do not animate, so they need their own trigger
            // or the HUD would go on claiming the slide is upright.
            viewer.addHandler('rotate', sample);
            viewer.addHandler('flip', sample);
            viewer.addHandler('resize', sample);
        }, 0);

        return () => {
            disposed = true;
            clearTimeout(timer);
            viewerRef.current = null;
            onViewerRef.current?.(null);
            // destroy() removes handlers and the canvas; without it every
            // slide switch leaks a WebGL context.
            if (viewer) viewer.destroy();
        };
    }, [slide]);

    // The navigator is a DOM element OSD owns. Toggling its display avoids
    // rebuilding the whole viewer — and losing the reader's position — just to
    // hide a thumbnail. `hud` is in the dependency list because the navigator
    // does not exist until the first frame, so the effect has to run again
    // once there is something to hide.
    useEffect(() => {
        const element = viewerRef.current?.navigator?.element;
        if (element) element.style.display = showNavigator ? '' : 'none';
    }, [showNavigator, hud]);

    const calibrated = hud && !hud.uncalibrated;
    const bar = calibrated ? scaleBar(hud.mppOnScreen, 160) : null;
    const fov = calibrated && slide?.nativeMpp && hud.w > 0 && hud.h > 0
        ? fieldOfViewAreaMm2({ widthPx: hud.w, heightPx: hud.h, nativeMpp: slide.nativeMpp })
        : null;
    const chip = 'flex items-center gap-2 rounded-md bg-slate-950/80 px-2.5 py-1 '
        + 'text-[11px] font-semibold tabular-nums text-slate-200 ring-1 ring-slate-700/60 backdrop-blur';

    return (
        <div className="relative flex-1 min-h-0 bg-slate-950">
            {/*
              The adjustment filter is applied to the OSD host, not to the
              annotation canvas, so brightness and contrast change the TISSUE
              and never the annotations drawn over it. An annotation that
              faded out when the reader dimmed the image would be a bug that
              looked like a feature.
            */}
            <div ref={hostRef} className="absolute inset-0" style={{ filter }} />

            {children}

            <div
                className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2"
                role="status"
                aria-live="polite"
            >
                <span className={hud?.uncalibrated ? `${chip} text-amber-300` : chip}>
                    {hud?.uncalibrated ? 'no calibration' : (hud ? formatObjective(hud.objective) : '—')}
                    {/* Never let an interpolated view pass as optical resolution. */}
                    {hud?.interpolating && (
                        <em className="not-italic font-normal text-amber-300" title="Digitally enlarged beyond the scanned resolution">
                            interpolated
                        </em>
                    )}
                </span>
                {bar && (
                    <span className={chip}>
                        <span className="inline-block h-[3px] shrink-0 rounded-sm bg-slate-200" style={{ width: `${Math.round(bar.px)}px` }} />
                        {bar.label}
                    </span>
                )}
                {/* The field-of-view area is what makes a count reportable:
                    "14 in 2.03 mm²" is a finding, "14 per 10 HPF" is not. */}
                {fov !== null && (
                    <span className={`${chip} max-lg:hidden`} title="Area of tissue currently on screen">
                        {formatArea(fov * 1e6)} field
                    </span>
                )}
                {calibrated && (
                    <span className={`${chip} max-lg:hidden`}>
                        x {Math.round(hud.x + hud.w / 2).toLocaleString()} · y {Math.round(hud.y + hud.h / 2).toLocaleString()}
                    </span>
                )}
                {/* Shown only when the view is NOT in its default orientation,
                    so it reads as a warning rather than as furniture. */}
                {calibrated && (hud.rotation !== 0 || hud.flipped) && (
                    <span className={`${chip} text-amber-300`}>
                        {hud.rotation !== 0 && `${Math.round(hud.rotation)}°`}
                        {hud.flipped && ' flipped'}
                    </span>
                )}
            </div>
        </div>
    );
}
