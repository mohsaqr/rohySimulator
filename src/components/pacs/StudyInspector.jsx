import { useCallback, useEffect, useMemo, useState } from 'react';

import { ReadingPane } from './ReadingPane.jsx';
import { SeriesRail } from './SeriesRail.jsx';
import { ImageControls } from './ImageControls.jsx';
import { useThumbnails } from './useThumbnails.js';
import { resetView, setAdjustment, setWindow } from './viewportState.js';

/**
 * Look at a study, properly, inside the editor.
 *
 * It reuses the READING side rather than drawing its own preview, and that is
 * the whole design. A second, simpler viewer would decode and window the pixels
 * differently from the room, so an author would be judging imaging by a picture
 * the learner is never shown — which defeats the point of looking. `ReadingPane`
 * already owns the lazy stack, the slice slider, cine and the load progress;
 * `SeriesRail` already handles thumbnails and irregular-spacing warnings.
 *
 * Two differences from the reading room, both deliberate:
 *
 *   `prefetch={false}`  the room pulls the whole stack in the background, which
 *                       is right for someone reading it and wrong for someone
 *                       glancing at three candidates. 263 MB for four slices.
 *   one pane            hanging layouts, cine buses and report actions belong to
 *                       the room. This is a look, not a reading session.
 *
 * It is deliberately usable with NO loaders: a host that passes none gets a
 * stated reason rather than an empty black rectangle. That is the honest
 * degradation, and it is the state rohy is in until its adapter is updated.
 */
export function StudyInspector({
    series = [],
    loadSeriesIndex,
    loadInstance,
    badgeFor = null,
    eventLogger,
    t = (key, fallback) => fallback ?? key,
}) {
    const [selected, setSelected] = useState(null);
    const [viewport, setViewport] = useState(null);
    const [tool, setTool] = useState('window');

    const canLoad = typeof loadSeriesIndex === 'function' && typeof loadInstance === 'function';

    // SeriesRail keys on `stackId`; the archive keys on the series' own `key`.
    const rail = useMemo(() => series.map((s) => ({
        ...s,
        stackId: s.key,
        // Already resolved by `previewSeries`. The rail fetches by this, so a
        // `remote:` scheme here would silently produce no thumbnails.
        ref: s.url ?? s.ref,
        count: s.instances,
        badge: badgeFor?.(s) ?? null,
    })), [series, badgeFor]);

    const active = rail.find((s) => s.stackId === selected) ?? rail[0] ?? null;

    // Changing study must not leave the previous study's window on the new one:
    // a chest CT's W400/L40 shows a radiograph as a white rectangle, and an
    // author would read that as broken imaging rather than as a stale viewport.
    useEffect(() => { setViewport(null); }, [active?.stackId]);

    const thumbnails = useThumbnails({ series: rail, loadSeriesIndex, loadInstance });

    const assignment = active ? {
        key: active.stackId,
        ref: active.ref,
        stackId: null,
        meta: {
            description: active.description || active.stackId,
            plane: active.plane,
            count: active.instances,
            spacing: active.geometry?.spacing,
        },
    } : null;

    /**
     * `ReadingPane` passes either a value or an updater, exactly as the room's
     * own `updateViewport` accepts. Handling only one of the two leaves the pane
     * silently ignoring half its own changes.
     */
    const changeViewport = useCallback((_pane, next) => {
        setViewport((current) => (typeof next === 'function' ? next(current) : next));
    }, []);

    if (series.length === 0) {
        return (
            <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950 p-8 text-center">
                <p className="text-sm text-amber-400/90">
                    {t('radoyon_inspect_nothing',
                        'There is no imaging for this study yet — a learner who orders it gets the catalogue’s written normal and no pictures.')}
                </p>
            </div>
        );
    }

    if (!canLoad) {
        return (
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-8 text-center">
                <p className="text-sm text-slate-400">
                    {t('radoyon_inspect_no_loader',
                        'This host has not supplied an image loader, so the study cannot be opened here.')}
                </p>
                <p className="text-xs text-slate-600 mt-1 font-mono">
                    loadSeriesIndex + loadInstance
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col lg:flex-row gap-2 min-h-[36rem]">
            {rail.length > 1 && (
                <aside className="lg:w-40 flex-shrink-0 bg-slate-950 rounded border border-slate-800 lg:max-h-[36rem] overflow-y-auto">
                    <SeriesRail
                        series={rail}
                        activeStackId={active?.stackId}
                        onSelect={(s) => setSelected(s.stackId)}
                        thumbnailFor={thumbnails.thumbnailFor}
                        columns={1}
                        t={t}
                    />
                </aside>
            )}

            {/*
              * `grid`, not `flex`. ReadingPane's own root carries no `flex-1`
              * — in the reading room it is a grid item and stretches for free —
              * so a flex parent leaves it at its content width, which on a
              * single-series study is a narrow column beside empty space.
              */}
            <div className="flex-1 min-w-0 min-h-[28rem] grid">
                <ReadingPane
                    pane={0}
                    assignment={assignment}
                    viewport={viewport}
                    onViewportInit={changeViewport}
                    onViewportChange={changeViewport}
                    tool={tool}
                    active
                    loadSeriesIndex={loadSeriesIndex}
                    loadInstance={loadInstance}
                    prefetch={false}
                    eventLogger={eventLogger}
                    t={t}
                />
            </div>

            <aside className="lg:w-60 flex-shrink-0 flex flex-col gap-2">
                <div className="flex gap-1" role="group" aria-label={t('radoyon_tools', 'Tools')}>
                    {[
                        ['window', t('radoyon_tool_window', 'Window')],
                        ['zoom', t('radoyon_tool_zoom', 'Zoom')],
                        ['pan', t('radoyon_tool_pan', 'Pan')],
                    ].map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTool(id)}
                            aria-pressed={tool === id}
                            className={`flex-1 text-[11px] rounded px-2 py-1 border ${
                                tool === id
                                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                                    : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {viewport && (
                    <div className="bg-slate-950 rounded border border-slate-800">
                        <ImageControls
                            viewport={viewport}
                            // The study's ACQUIRED window, so reset and the
                            // relative presets return to what the scanner sent
                            // rather than to a hardcoded number that means
                            // something different on every modality.
                            baseWindow={viewport.baseWindow}
                            onWindow={(w) => setViewport((v) => setWindow(v, w))}
                            onAdjust={(key, value) => setViewport((v) => setAdjustment(v, key, value))}
                            onReset={() => setViewport((v) => resetView(v))}
                            t={t}
                        />
                    </div>
                )}
            </aside>
        </div>
    );
}

export default StudyInspector;
