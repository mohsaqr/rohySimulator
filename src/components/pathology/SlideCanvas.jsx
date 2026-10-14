import { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { hasOpticalProfile, viewportSample, scaleBar } from './slideGeometry.js';
import { fieldOfViewAreaMm2, formatObjective } from './magnification.js';
import { formatArea } from './annotationModel.js';
import { plural } from './i18n.js';
import { slideNetworkOptions, tileSourceForSlide } from './slideSource.js';

/**
 * How many times a learner may ask to reload a slide that failed to open.
 * Bounded so a slide that is genuinely gone ends in a clear message rather
 * than a button that can be pressed forever.
 */
export const MAX_SLIDE_RETRIES = 2;

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
 * keep, so the sampling policy lives in exactly one place. It also identifies
 * settled frames: dwell/coverage still see the zoom spring, while analytics
 * can describe one deliberate objective change rather than every step of it.
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
    t = (key, fallback) => fallback ?? key,
}) {
    const hostRef = useRef(null);
    const viewerRef = useRef(null);
    const [hud, setHud] = useState(null);
    // Retries are counted PER SLIDE: switching slide starts the count again.
    const [retry, setRetry] = useState({ slideId: null, count: 0 });
    const attempt = retry.slideId === (slide?.id ?? null) ? retry.count : 0;
    // Load status for THIS slide and attempt. Keyed rather than reset in an
    // effect: a status left over from another slide or attempt reads as
    // 'loading', which is what it is.
    const loadKey = `${slide?.id ?? ''}#${attempt}`;
    const [status, setStatus] = useState({ key: null, state: 'loading', tileErrors: 0 });
    const slideRef = useRef(slide);
    useEffect(() => { slideRef.current = slide; }, [slide]);
    const tileSource = tileSourceForSlide(slide);
    // A slide with no source at all can never load: that is a failure, not
    // an endless "loading".
    const load = !tileSource
        ? { key: loadKey, state: 'failed', tileErrors: 0 }
        : (status.key === loadKey ? status : { key: loadKey, state: 'loading', tileErrors: 0 });
    const osdPrefixUrl = slide?.osdPrefixUrl ?? '/openseadragon/images/';

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
        if (!hostRef.current || !tileSource) return undefined;

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
                tileSources: tileSource,
                prefixUrl: osdPrefixUrl,
                ...slideNetworkOptions(slideRef.current),
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

            const sample = (settled = false) => {
                const item = viewer.world.getItemAt(0);
                // Fires before the tile source resolves on first paint.
                if (!item) return;
                // A slide can legitimately be half-described — the case editor
                // shows the tissue while the author is still typing its
                // calibration. Report that state rather than asking
                // opticalProfile() for a number it would rightly refuse to
                // invent. Without this the sampler threw on every frame.
                const currentSlide = slideRef.current;
                if (!hasOpticalProfile(currentSlide)) { setHud({ uncalibrated: true }); return; }
                const next = viewportSample({
                    bounds: viewer.viewport.getBounds(true),
                    // Rotation-invariant scale — see viewportSample's ROTATION note.
                    boundsNoRotate: viewer.viewport.getBoundsNoRotate(true),
                    imageWidthPx: item.getContentSize().x,
                    containerWidthPx: viewer.container.clientWidth,
                    slide: currentSlide,
                    t: Date.now() - startedAtRef.current,
                });
                next.slideId = currentSlide.id ?? null;
                setHud({ ...next, rotation: viewer.viewport.getRotation(), flipped: viewer.viewport.getFlip() });
                onSampleRef.current?.(next, { settled });
            };

            viewer.addHandler('open', () => {
                viewerRef.current = viewer;
                onViewerRef.current?.(viewer);
                setStatus({ key: loadKey, state: 'ready', tileErrors: 0 });
                sample(true);
            });
            // The descriptor itself could not be fetched or parsed: nothing
            // will ever draw. OSD's own response is an English message inside
            // the canvas; the learner gets a named, translated one instead.
            viewer.addHandler('open-failed', () => {
                setStatus({ key: loadKey, state: 'failed', tileErrors: 0 });
            });
            // Individual tiles failing leave holes in the tissue that look
            // like tissue. Counted, so the learner is told the view is
            // incomplete rather than left to read a hole as a finding.
            viewer.addHandler('tile-load-failed', () => {
                setStatus((current) => (current.key === loadKey
                    ? { ...current, tileErrors: current.tileErrors + 1 }
                    : { key: loadKey, state: 'ready', tileErrors: 1 }));
            });
            viewer.addHandler('animation', () => sample(false));
            viewer.addHandler('animation-finish', () => sample(true));
            // Rotation and flip do not animate, so they need their own trigger
            // or the HUD would go on claiming the slide is upright.
            viewer.addHandler('rotate', () => sample(true));
            viewer.addHandler('flip', () => sample(true));
            viewer.addHandler('resize', () => sample(true));
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
    }, [slide?.id, tileSource, osdPrefixUrl, loadKey]);

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

            <SlideLoadStatus
                load={load}
                label={slide?.label || slide?.id || ''}
                canRetry={Boolean(tileSource) && attempt < MAX_SLIDE_RETRIES}
                onRetry={() => setRetry({ slideId: slide?.id ?? null, count: attempt + 1 })}
                t={t}
            />

            <div
                className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2"
                role="status"
                aria-live="polite"
            >
                <span className={hud?.uncalibrated ? `${chip} text-amber-300` : chip}>
                    {hud?.uncalibrated ? t('no_calibration', 'no calibration') : (hud ? formatObjective(hud.objective) : '—')}
                    {/* Never let an interpolated view pass as optical resolution. */}
                    {hud?.interpolating && (
                        <em className="not-italic font-normal text-amber-300" title={t('interpolated_hint', 'Digitally enlarged beyond the scanned resolution')}>
                            {t('interpolated', 'interpolated')}
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
                    <span className={`${chip} max-lg:hidden`} title={t('field_area_hint', 'Area of tissue currently on screen')}>
                        {t('field_area', `${formatArea(fov * 1e6)} field`, { area: formatArea(fov * 1e6) })}
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
                        {hud.flipped && ` ${t('flipped', 'flipped')}`}
                    </span>
                )}
            </div>
        </div>
    );
}

/**
 * Loading, failed, and incomplete — said in words, naming the slide.
 *
 * Without this a slide that never opened was a black rectangle (or OSD's own
 * untranslated error), indistinguishable from a slow network, and a slide with
 * missing tiles looked like tissue with holes in it.
 */
function SlideLoadStatus({ load, label, canRetry, onRetry, t }) {
    if (load.state === 'loading') {
        return (
            <p role="status" className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-md bg-slate-950/80 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-slate-700/60">
                {plural(t, 'slide_loading', 'Loading slide “{label}”…', { label })}
            </p>
        );
    }
    if (load.state === 'failed') {
        return (
            <div role="alert" className="absolute inset-0 z-10 flex items-center justify-center p-6">
                <div className="max-w-sm space-y-2 rounded-lg bg-slate-900/95 p-4 text-center ring-1 ring-rose-500/30">
                    <p className="text-sm font-semibold text-rose-200">
                        {plural(t, 'slide_load_failed', 'The slide “{label}” could not be loaded.', { label })}
                    </p>
                    {canRetry ? (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100 ring-1 ring-slate-600 hover:bg-slate-800"
                        >
                            {t('retry', 'Try again')}
                        </button>
                    ) : (
                        <p className="text-xs text-slate-400">
                            {t('slide_load_gave_up', 'It still could not be loaded. Tell your instructor which slide it was.')}
                        </p>
                    )}
                </div>
            </div>
        );
    }
    if (load.tileErrors > 0) {
        return (
            <div role="alert" className="absolute inset-x-0 bottom-3 z-10 mx-auto flex w-fit items-center gap-2 rounded-md bg-amber-500/15 px-2.5 py-1 text-[11px] text-amber-200 ring-1 ring-amber-500/30">
                <span>{plural(t, 'slide_tiles_failed', 'Parts of “{label}” did not load — what you see may be incomplete.', { label })}</span>
                {canRetry && (
                    <button type="button" onClick={onRetry} className="rounded px-1.5 font-semibold ring-1 ring-amber-500/40 hover:bg-amber-500/15">
                        {t('retry', 'Try again')}
                    </button>
                )}
            </div>
        );
    }
    return null;
}
