import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ruler, Circle, Contrast, RotateCcw } from 'lucide-react';

import { Viewport } from './Viewport.jsx';
import { SeriesRail } from './SeriesRail.jsx';
import { Worklist } from './Worklist.jsx';
import { useStudy, openingWindow } from './useStudy.js';
import { presetsFor } from './windowLevel.js';
import {
    applyPreset, changeSeries, coverage, initialViewport, resetView,
} from './viewportState.js';
import { RADOYON_COMPONENTS, RADOYON_OBJECT_TYPES } from './radoyonEvents.js';

/**
 * The reading room.
 *
 * Every service arrives as a prop — `loadSeries`, `eventLogger`, `t`. The
 * package imports nothing from any host, which is what lets the same folder run
 * inside rohy, inside the standalone app, and inside a test.
 */
export function PacsScreen({
    worklist = [],
    loadSeries,
    eventLogger,
    t = (key, fallback) => fallback ?? key,
    initialMeasurements = {},
    onMeasurementsChange,
}) {
    const [activeEntry, setActiveEntry] = useState(() => worklist.find((e) => e.available) ?? null);
    const [activeSeriesUid, setActiveSeriesUid] = useState(null);
    const [viewport, setViewport] = useState(() => initialViewport({ sliceCount: 1 }));
    const [tool, setTool] = useState('window');
    const [measurements, setMeasurements] = useState(initialMeasurements);

    const study = useStudy({ ref: activeEntry?.ref, loadSeries });
    const activeSeries = useMemo(
        () => study.series.find((s) => s.seriesInstanceUid === activeSeriesUid) ?? study.series[0] ?? null,
        [study.series, activeSeriesUid],
    );

    const log = useCallback((verb, objectType, detail) => {
        eventLogger?.log?.({
            verb,
            objectType,
            component: RADOYON_COMPONENTS.VIEWPORT,
            detail,
        });
    }, [eventLogger]);

    // When a series becomes current, open it the way a workstation would: the
    // whole stack available, positioned mid-study, windowed from the middle
    // slice rather than the first (see openingWindow).
    useEffect(() => {
        if (!activeSeries) return;
        setActiveSeriesUid(activeSeries.seriesInstanceUid);
        setViewport(initialViewport({
            sliceCount: activeSeries.count,
            window: openingWindow(activeSeries, study.frameAt),
        }));
        log('SELECTED_SERIES', RADOYON_OBJECT_TYPES.SERIES, {
            series_uid: activeSeries.seriesInstanceUid,
            description: activeSeries.description,
            images: activeSeries.count,
            plane: activeSeries.plane,
        });
    }, [activeSeries?.seriesInstanceUid]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (study.status === 'error') {
            log('FAILED_TO_LOAD', RADOYON_OBJECT_TYPES.STUDY, {
                study: activeEntry?.id,
                reason: study.error?.message,
            });
        }
        if (study.status === 'ready' && activeEntry) {
            log('OPENED_STUDY', RADOYON_OBJECT_TYPES.STUDY, {
                study: activeEntry.id,
                study_id: activeEntry.studyId,
                series: study.series.length,
            });
        }
    }, [study.status]); // eslint-disable-line react-hooks/exhaustive-deps

    // Report the sweep on leaving a series, not on every slice: a per-slice
    // event on a 300-slice CT would put thousands of rows in the event log for
    // one study and drown every other signal in the case.
    useEffect(() => () => {
        if (!activeSeries || viewport.seen.size <= 1) return;
        log('SCROLLED_SERIES', RADOYON_OBJECT_TYPES.SERIES, {
            series_uid: activeSeries.seriesInstanceUid,
            images_seen: viewport.seen.size,
            images_total: activeSeries.count,
            coverage: Number(coverage(viewport).toFixed(3)),
        });
    }, [activeSeries?.seriesInstanceUid]); // eslint-disable-line react-hooks/exhaustive-deps

    const frame = activeSeries ? study.frameAt(activeSeries, viewport.slice) : null;
    const presets = presetsFor(activeSeries?.modality);

    const onPreset = useCallback((preset) => {
        setViewport((v) => applyPreset(v, preset));
        log('APPLIED_PRESET', RADOYON_OBJECT_TYPES.SERIES, {
            preset: preset.id, center: preset.center, width: preset.width,
        });
    }, [log]);

    const onMeasure = useCallback((measurement) => {
        const key = activeSeries?.seriesInstanceUid ?? 'unknown';
        setMeasurements((current) => {
            const next = { ...current, [key]: [...(current[key] ?? []), { ...measurement, slice: viewport.slice }] };
            onMeasurementsChange?.(next);
            return next;
        });
        log(
            measurement.kind === 'distance' ? 'MEASURED_DISTANCE' : 'MEASURED_REGION',
            RADOYON_OBJECT_TYPES.MEASUREMENT,
            measurement.kind === 'distance'
                ? { mm: measurement.result.mm, unit: measurement.result.unit, slice: viewport.slice }
                : { mean: measurement.result.mean, sd: measurement.result.sd, units: frame?.units, slice: viewport.slice },
        );
    }, [activeSeries, viewport.slice, frame, log, onMeasurementsChange]);

    const tools = [
        { id: 'window', icon: Contrast, label: t('radoyon_tool_window', 'Window') },
        { id: 'distance', icon: Ruler, label: t('radoyon_tool_distance', 'Distance') },
        { id: 'region', icon: Circle, label: t('radoyon_tool_region', 'Region') },
    ];

    return (
        <div className="flex flex-col h-full bg-slate-900 text-slate-100">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 bg-slate-800/60">
                <div role="group" aria-label={t('radoyon_tools_label', 'Tools')} className="flex gap-1">
                    {tools.map(({ id, icon: Icon, label }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTool(id)}
                            aria-pressed={tool === id}
                            title={label}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs border ${
                                tool === id
                                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-100'
                                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                            {label}
                        </button>
                    ))}
                </div>

                {presets.length > 0 && (
                    <div role="group" aria-label={t('radoyon_presets_label', 'Window presets')} className="flex gap-1 ml-2 flex-wrap">
                        {presets.map((preset) => (
                            <button
                                key={preset.id}
                                type="button"
                                onClick={() => onPreset(preset)}
                                title={`${preset.note} — W ${preset.width} / L ${preset.center}`}
                                className="px-2 py-1.5 rounded text-xs bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => setViewport(resetView)}
                    title={t('radoyon_reset', 'Reset view')}
                    className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
                >
                    <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('radoyon_reset', 'Reset')}
                </button>
            </div>

            <div className="flex flex-1 min-h-0">
                <aside className="w-60 flex-shrink-0 border-r border-slate-700 flex flex-col min-h-0">
                    <div className="border-b border-slate-700 max-h-56 overflow-y-auto">
                        <Worklist
                            entries={worklist}
                            activeId={activeEntry?.id}
                            onSelect={setActiveEntry}
                            t={t}
                        />
                    </div>
                    <SeriesRail
                        series={study.series}
                        activeUid={activeSeries?.seriesInstanceUid}
                        onSelect={(s) => {
                            setActiveSeriesUid(s.seriesInstanceUid);
                            setViewport((v) => changeSeries(v, s.count));
                        }}
                        t={t}
                    />
                </aside>

                <main className="flex-1 min-w-0 relative">
                    {study.status === 'loading' && <Centered>{t('radoyon_loading', 'Loading study…')}</Centered>}
                    {study.status === 'error' && (
                        <Centered tone="warning">
                            {t('radoyon_load_failed', 'This study could not be loaded.')}
                            <div className="mt-1 text-xs font-mono opacity-70">{study.error?.message}</div>
                        </Centered>
                    )}
                    {study.status === 'idle' && <Centered>{t('radoyon_select_study', 'Select a study to read.')}</Centered>}
                    {study.status === 'ready' && frame && (
                        <Viewport
                            frame={frame}
                            viewport={viewport}
                            onViewportChange={setViewport}
                            pixelSpacing={activeSeries?.geometry?.pixelSpacing}
                            inverted={frame.inverted}
                            tool={tool}
                            measurements={measurements[activeSeries?.seriesInstanceUid] ?? []}
                            onMeasure={onMeasure}
                            t={t}
                        />
                    )}
                </main>
            </div>
        </div>
    );
}

function Centered({ children, tone }) {
    return (
        <div className={`absolute inset-0 flex flex-col items-center justify-center text-center p-6 ${
            tone === 'warning' ? 'text-amber-400' : 'text-slate-400'
        }`}>
            {children}
        </div>
    );
}

export default PacsScreen;
