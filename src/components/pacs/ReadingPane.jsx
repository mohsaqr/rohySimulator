import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pause, Play } from 'lucide-react';

import { Viewport } from './Viewport.jsx';
import { useStudy, openingWindow } from './useStudy.js';
import { adoptWindow, coverage, initialViewport, scrollTo } from './viewportState.js';
import { createRadoyonLogger, REVIEWED_COVERAGE } from './radoyonEvents.js';

/**
 * One pane of the hanging layout.
 *
 * The split of responsibilities is deliberate: the pane OWNS its data (its own
 * `useStudy`, so two panes stream two series independently) but its viewport
 * state lives in the parent. That is what lets the toolbar, the presets and
 * the keyboard shortcuts act on "the active pane" without a command bus — the
 * parent simply updates the state it already holds.
 */
export function ReadingPane({
    pane,
    assignment = null,
    viewport,
    onViewportInit,
    onViewportChange,
    tool,
    active = false,
    onActivate,
    measurementsByStack = {},
    onMeasure,
    cine = null,
    onCineToggle,
    loadSeries,
    loadSeriesIndex,
    loadInstance,
    // The background sweep is right for a reader and wasteful for an author
    // glancing at a study in the editor. Defaults to the reader's behaviour.
    prefetch = true,
    onSeriesReady,
    eventLogger,
    t = (key, fallback) => fallback ?? key,
}) {
    const study = useStudy({ ref: assignment?.ref, loadSeries, loadSeriesIndex, loadInstance, prefetch });

    const activeSeries = useMemo(() => {
        if (assignment?.stackId) {
            return study.series.find((s) => (s.stackId ?? s.seriesInstanceUid) === assignment.stackId) ?? study.series[0] ?? null;
        }
        return study.series[0] ?? null;
    }, [study.series, assignment?.stackId]);

    // Which series has already had its declared window applied.
    const windowedSeries = useRef(null);
    // The live viewport, readable from cleanup closures without re-binding them.
    const viewportRef = useRef(viewport);
    viewportRef.current = viewport;

    const logger = useMemo(() => createRadoyonLogger(eventLogger), [eventLogger]);

    // When a series becomes current, open it the way a workstation would: the
    // whole stack available, positioned mid-study, windowed from the middle
    // slice rather than the first (see openingWindow).
    useEffect(() => {
        if (!activeSeries) return;
        windowedSeries.current = null;
        onViewportInit(pane, initialViewport({
            sliceCount: activeSeries.count,
            window: openingWindow(activeSeries, study.frameAt),
        }));
        onSeriesReady?.(pane, activeSeries, study.series);
        logger.seriesSelected(activeSeries);
    }, [activeSeries?.stackId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Self-heal. The room clears every pane's viewport when the study changes,
    // and that clear can land AFTER this pane has already initialised its own —
    // whereupon the effect above will not re-fire, because the series it keys on
    // has not changed. The pane is then left showing a series with no viewport:
    // no canvas, no window, and an empty image-controls panel.
    //
    // Rather than couple two effects in different components by ordering, the
    // pane simply re-asserts the invariant it owns — a series on screen always
    // has a viewport — whenever it finds it missing.
    useEffect(() => {
        if (!activeSeries || viewport) return;
        onViewportInit(pane, initialViewport({
            sliceCount: activeSeries.count,
            window: openingWindow(activeSeries, study.frameAt),
        }));
    }, [activeSeries, viewport, pane, onViewportInit, study.frameAt]);

    useEffect(() => {
        if (study.status === 'error') {
            logger.loadFailed(assignment?.ref, study.error);
        }
    }, [study.status]); // eslint-disable-line react-hooks/exhaustive-deps

    // Report the sweep on leaving a series, not on every slice: a per-slice
    // event on a 300-slice CT would put thousands of rows in the event log for
    // one study and drown every other signal in the case.
    useEffect(() => () => {
        const v = viewportRef.current;
        if (!activeSeries || !v || v.seen?.size <= 1) return;
        const sweep = { imagesSeen: v.seen.size, coverage: Number(coverage(v).toFixed(3)) };
        logger.seriesScrolled(activeSeries, sweep);
        // A sweep that covered the stack is the fact a rubric asks about —
        // "did they look at every image?" — so it gets its own row beside the
        // sweep itself, rather than a threshold every consumer must re-apply.
        if (sweep.coverage >= REVIEWED_COVERAGE) logger.seriesReviewed(activeSeries, sweep);
    }, [activeSeries?.stackId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Self-heal. The room clears every pane's viewport when the study changes,
    // and that clear can land AFTER this pane has already initialised its own —
    // whereupon the effect above will not re-fire, because the series it keys on
    // has not changed. The pane is then left showing a series with no viewport:
    // no canvas, no window, and an empty image-controls panel.
    //
    // Rather than couple two effects in different components by ordering, the
    // pane simply re-asserts the invariant it owns — a series on screen always
    // has a viewport — whenever it finds it missing.
    useEffect(() => {
        if (!activeSeries || viewport) return;
        onViewportInit(pane, initialViewport({
            sliceCount: activeSeries.count,
            window: openingWindow(activeSeries, study.frameAt),
        }));
    }, [activeSeries, viewport, pane, onViewportInit, study.frameAt]);

    // Apply the study's own window once the slice that declares it has arrived.
    // Applied ONCE per series, so a reader who has since dialled their own
    // window keeps it.
    const frame = activeSeries && viewport ? study.frameAt(activeSeries, viewport.slice) : null;
    useEffect(() => {
        if (!activeSeries || !viewport || windowedSeries.current === activeSeries.stackId) return;
        const opening = openingWindow(activeSeries, study.frameAt);
        if (!opening) return;
        windowedSeries.current = activeSeries.stackId;
        // adoptWindow, not a plain assignment: this IS the series' acquired
        // window, so it becomes what reset and the "As acquired" preset return
        // to. The slice that declares it often arrives after the viewport was
        // created, which is why the target cannot simply be set at init.
        onViewportChange(pane, adoptWindow(viewport, opening));
    }, [activeSeries, frame, study.frameAt]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleViewport = useCallback((next) => onViewportChange(pane, next), [onViewportChange, pane]);
    const handleMeasure = useCallback((measurement) => {
        onMeasure?.(activeSeries?.stackId ?? 'unknown', { ...measurement, slice: viewportRef.current?.slice ?? 0 });
    }, [onMeasure, activeSeries?.stackId]);

    const playing = cine?.pane === pane && cine?.playing;
    const seriesInfo = assignment?.meta ?? {};
    const measurements = measurementsByStack[activeSeries?.stackId] ?? [];

    return (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div
            className={`relative flex flex-col min-w-0 min-h-0 rounded-sm overflow-hidden border ${
                active ? 'border-cyan-500/70' : 'border-slate-800'
            }`}
            onPointerDownCapture={() => onActivate?.(pane)}
            data-pane={pane}
            data-active={active ? 'true' : 'false'}
        >
            <div className="relative flex-1 min-h-0 bg-black">
                {!assignment && (
                    <Centered t={t}>{t('radoyon_select_series', 'Select a series from the rail.')}</Centered>
                )}
                {assignment && study.status === 'loading' && (
                    <Centered t={t}>{t('radoyon_loading', 'Loading study…')}</Centered>
                )}
                {assignment && study.status === 'error' && (
                    <Centered tone="warning" t={t}>
                        {t('radoyon_load_failed', 'This study could not be loaded.')}
                        <div className="mt-1 text-xs font-mono opacity-70">{study.error?.message}</div>
                    </Centered>
                )}
                {assignment && study.status === 'ready' && viewport && activeSeries && (
                    <Viewport
                        frame={frame}
                        viewport={viewport}
                        onViewportChange={handleViewport}
                        pixelSpacing={activeSeries.geometry?.pixelSpacing}
                        orientation={activeSeries.instances?.[viewport.slice]?.orientation
                            ?? activeSeries.instances?.[0]?.orientation ?? null}
                        inverted={frame?.inverted ?? false}
                        tool={tool}
                        measurements={measurements}
                        onMeasure={handleMeasure}
                        info={{
                            studyDescription: seriesInfo.studyDescription,
                            seriesDescription: activeSeries.description ?? seriesInfo.description,
                            modality: activeSeries.modality ?? seriesInfo.modality,
                            plane: activeSeries.plane,
                        }}
                        t={t}
                    />
                )}
            </div>

            {assignment && study.status === 'ready' && viewport && activeSeries && (
                <PaneFooter
                    viewport={viewport}
                    onViewportChange={handleViewport}
                    playing={playing}
                    onCineToggle={() => onCineToggle?.(pane)}
                    progress={study.progress}
                    t={t}
                />
            )}
        </div>
    );
}

/** Cine, the slice slider, and how much of the stack has arrived. */
function PaneFooter({ viewport, onViewportChange, playing, onCineToggle, progress, t }) {
    const loaded = progress?.total > 0 ? progress.fetched / progress.total : 1;
    return (
        <div className="relative flex items-center gap-2 px-2 py-1 bg-slate-950 border-t border-slate-800">
            {/* The prefetch sweep's progress: full width means every slice is local. */}
            <div className="absolute top-0 left-0 h-px bg-cyan-500/60" style={{ width: `${(loaded * 100).toFixed(1)}%` }} aria-hidden="true" />
            <button
                type="button"
                onClick={onCineToggle}
                title={playing ? t('radoyon_cine_pause', 'Pause cine') : t('radoyon_cine_play', 'Play cine')}
                aria-pressed={playing}
                className="p-1 rounded text-slate-300 hover:bg-slate-800 hover:text-cyan-200"
            >
                {playing
                    ? <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                    : <Play className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
            <input
                type="range"
                min={0}
                max={Math.max(0, viewport.sliceCount - 1)}
                value={viewport.slice}
                onChange={(e) => { const target = Number(e.target.value); onViewportChange((v) => scrollTo(v, target)); }}
                aria-label={t('radoyon_slice_slider', 'Slice')}
                className="flex-1 min-w-0 h-1 accent-cyan-500 cursor-pointer"
            />
            <span className="text-[10px] font-mono text-slate-400 tabular-nums whitespace-nowrap">
                {viewport.slice + 1}/{viewport.sliceCount}
            </span>
            <span
                className="text-[10px] font-mono text-slate-500 tabular-nums whitespace-nowrap"
                title={t('radoyon_coverage_hint', 'Distinct slices you have reviewed')}
            >
                {Math.round(coverage(viewport) * 100)}%
            </span>
        </div>
    );
}

function Centered({ children, tone, t: _t }) {
    return (
        <div className={`absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-sm ${
            tone === 'warning' ? 'text-amber-400' : 'text-slate-500'
        }`}>
            {children}
        </div>
    );
}

export default ReadingPane;
