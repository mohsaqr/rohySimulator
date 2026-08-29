import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    loadSeriesIndex,
    loadInstance,
    eventLogger,
    t = (key, fallback) => fallback ?? key,
    initialMeasurements = {},
    onMeasurementsChange,
}) {
    const [activeEntry, setActiveEntry] = useState(() => worklist.find((e) => e.available) ?? null);

    // Whether the reader has actually picked a study, as opposed to the room
    // having auto-selected one for them.
    const chosenByReader = useRef(false);
    // Which series has already had its declared window applied.
    const windowedSeries = useRef(null);

    // Re-select when the worklist arrives or changes.
    //
    // The initialiser above runs ONCE, at mount. A host that loads its worklist
    // asynchronously — the normal case, since studies come from a case document
    // and an archive catalogue over the network — mounts this room with an
    // empty or partial list. The reader was then left looking at whichever
    // study happened to exist at the first render for the rest of the session.
    //
    // Tracking WHO chose matters: testing only "is the selection still in the
    // list" preserves an auto-pick that is merely still present, which is how
    // the first attempt at this failed — the room kept showing a placeholder
    // study while the real ones sat unopened above it.
    useEffect(() => {
        if (chosenByReader.current && activeEntry && worklist.some((e) => e.id === activeEntry.id)) return;
        const next = worklist.find((e) => e.available) ?? null;
        setActiveEntry((current) => (current?.id === next?.id ? current : next));
    }, [worklist]); // eslint-disable-line react-hooks/exhaustive-deps
    const [activeStackId, setActiveStackId] = useState(null);
    const [viewport, setViewport] = useState(() => initialViewport({ sliceCount: 1 }));
    const [tool, setTool] = useState('window');
    const [measurements, setMeasurements] = useState(initialMeasurements);

    // A study's series are known from the worklist METADATA — key, description,
    // plane, instance count — without fetching a pixel. That is what lets the
    // rail list all 27 series of a whole-body examination while only the series
    // the reader is looking at is loaded. Fetching a study to discover what is
    // in it would mean a gigabyte to render one slice.
    const catalogueSeries = activeEntry?.series ?? [];
    const [selectedKey, setSelectedKey] = useState(null);
    const hasCatalogue = catalogueSeries.length > 1;

    const selected = useMemo(
        () => catalogueSeries.find((s) => (s.key ?? s.ref) === selectedKey) ?? catalogueSeries[0] ?? null,
        [catalogueSeries, selectedKey],
    );

    // Falls back to the entry's own ref when the host supplies no series list —
    // a study that is one directory of DICOM works exactly as before.
    const study = useStudy({ ref: selected?.ref ?? activeEntry?.ref, loadSeries, loadSeriesIndex, loadInstance });

    const activeSeries = useMemo(
        () => study.series.find((s) => (s.stackId ?? s.seriesInstanceUid) === activeStackId) ?? study.series[0] ?? null,
        [study.series, activeStackId],
    );

    // The rail is driven by the catalogue when there is one, and by whatever was
    // loaded otherwise. Both shapes carry description, plane and count.
    const railSeries = hasCatalogue
        ? catalogueSeries.map((s) => ({
            stackId: s.key ?? s.ref,
            description: s.description || s.key,
            plane: s.plane,
            count: s.instances,
            spacing: s.geometry?.spacing,
        }))
        : study.series;

    const railActiveId = hasCatalogue
        ? (selected?.key ?? selected?.ref)
        : (activeSeries?.stackId ?? activeSeries?.seriesInstanceUid);

    // Changing study resets to its first series, so a reader never lands on a
    // series belonging to the study they just navigated away from.
    useEffect(() => { setSelectedKey(null); }, [activeEntry?.id]);

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
        setActiveStackId(activeSeries.stackId ?? activeSeries.seriesInstanceUid);
        windowedSeries.current = null;
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
    }, [activeSeries?.stackId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    }, [activeSeries?.stackId]); // eslint-disable-line react-hooks/exhaustive-deps

    const frame = activeSeries ? study.frameAt(activeSeries, viewport.slice) : null;
    const presets = presetsFor(activeSeries?.modality);

    // Apply the study's own window once the slice that declares it has arrived.
    //
    // Under lazy loading no pixels exist when a series is selected, so the
    // window cannot be known yet and the viewport opens on a neutral default.
    // Applying it later is not cosmetic: a CT opened at the wrong window can
    // look like a normal study when it is not. Applied ONCE per series, so a
    // reader who has since dialled their own window keeps it.
    useEffect(() => {
        if (!activeSeries || windowedSeries.current === activeSeries.stackId) return;
        const opening = openingWindow(activeSeries, study.frameAt);
        if (!opening) return;
        windowedSeries.current = activeSeries.stackId;
        setViewport((v) => ({ ...v, window: { center: opening.center, width: opening.width } }));
    }, [activeSeries, frame, study.frameAt]);

    const onPreset = useCallback((preset) => {
        setViewport((v) => applyPreset(v, preset));
        log('APPLIED_PRESET', RADOYON_OBJECT_TYPES.SERIES, {
            preset: preset.id, center: preset.center, width: preset.width,
        });
    }, [log]);

    const onMeasure = useCallback((measurement) => {
        const key = activeSeries?.stackId ?? 'unknown';
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
                <aside className="w-80 flex-shrink-0 border-r border-slate-700 flex flex-col min-h-0">
                    <div className="border-b border-slate-700 max-h-56 overflow-y-auto">
                        <Worklist
                            entries={worklist}
                            activeId={activeEntry?.id}
                            onSelect={(entry) => { chosenByReader.current = true; setActiveEntry(entry); }}
                            t={t}
                        />
                    </div>
                    <SeriesRail
                        series={railSeries}
                        activeStackId={railActiveId}
                        onSelect={(s) => {
                            // A different series means a different fetch;
                            // useStudy re-runs on the new ref.
                            if (hasCatalogue) { setSelectedKey(s.stackId); return; }
                            setActiveStackId(s.stackId ?? s.seriesInstanceUid);
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
                    {study.status === 'ready' && !frame && (
                        <Centered>{t('radoyon_loading_slice', 'Loading slice…')}</Centered>
                    )}
                    {study.status === 'ready' && frame && (
                        <Viewport
                            frame={frame}
                            viewport={viewport}
                            onViewportChange={setViewport}
                            pixelSpacing={activeSeries?.geometry?.pixelSpacing}
                            inverted={frame.inverted}
                            tool={tool}
                            measurements={measurements[activeSeries?.stackId] ?? []}
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
