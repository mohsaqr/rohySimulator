import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { ReadingPane } from './ReadingPane.jsx';
import { SeriesRail } from './SeriesRail.jsx';
import { Worklist } from './Worklist.jsx';
import { Toolbar, LAYOUTS } from './Toolbar.jsx';
import { useThumbnails } from './useThumbnails.js';
import { ImageControls } from './ImageControls.jsx';
import { ReportPane } from './ReportPane.jsx';
import { activePreset, presetsFor } from './windowLevel.js';
import {
    applyPreset, cineStep, flipHorizontal, flipVertical, resetView, setAdjustment, setWindow,
    rotateQuarter, scrollBy, toggleInvert, zoomAbout,
} from './viewportState.js';
import { RADOYON_COMPONENTS, RADOYON_OBJECT_TYPES } from './radoyonEvents.js';

const CINE_FPS = 12;

/**
 * The reading room.
 *
 * Every service arrives as a prop — `loadSeries`, `eventLogger`, `t`. The
 * package imports nothing from any host, which is what lets the same folder run
 * inside rohy, inside the standalone app, and inside a test.
 *
 * Architecture of the room: the WORKLIST picks a study, the RAIL assigns its
 * series to panes of the hanging LAYOUT, and each `ReadingPane` streams its own
 * series while the room holds every pane's viewport state — which is what lets
 * the toolbar, the presets and the keyboard act on "the active pane" directly.
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
    // Reporting. Both delivery routes are the HOST's, and both optional — see
    // ReportPane. Radoyon composes the report and hands it over; it does not
    // know where it goes, which is what lets the same package serve a host that
    // stores reports and one that would rather open its own form.
    onSubmitReport,
    reportLinkFor,
    reportedBy = null,
}) {
    const [activeEntry, setActiveEntry] = useState(() => worklist.find((e) => e.available) ?? null);

    // Whether the reader has actually picked a study, as opposed to the room
    // having auto-selected one for them.
    const chosenByReader = useRef(false);

    // Re-select when the worklist arrives or changes.
    //
    // The initialiser above runs ONCE, at mount. A host that loads its worklist
    // asynchronously — the normal case — mounts this room with an empty or
    // partial list. Tracking WHO chose matters: testing only "is the selection
    // still in the list" preserves an auto-pick that is merely still present,
    // which is how the first attempt at this failed.
    useEffect(() => {
        setActiveEntry((current) => {
            // ALWAYS adopt the current worklist's object for the selected id,
            // not just when the id changes. A host resolves its worklist
            // asynchronously (a case entry may first resolve against an empty
            // archive and only later against the real one), and keeping the
            // stale first-render object froze that half-resolved study on
            // screen for the whole session.
            const fresh = current ? worklist.find((e) => e.id === current.id) : null;
            if (chosenByReader.current && fresh) return fresh;
            return worklist.find((e) => e.available) ?? fresh ?? null;
        });
    }, [worklist]); // eslint-disable-line react-hooks/exhaustive-deps

    const [layoutId, setLayoutId] = useState('1x1');
    const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0];
    const [activePane, setActivePane] = useState(0);
    const [assignments, setAssignments] = useState([]);
    const [viewports, setViewports] = useState({});
    const [tool, setTool] = useState('window');
    const [measurements, setMeasurements] = useState(initialMeasurements);
    const [cine, setCine] = useState({ pane: 0, playing: false });
    // Open by default. The window/level, gamma and edge controls live in here,
    // and a contrast control a reader has to discover behind an unlabelled icon
    // is a contrast control they do not have.
    const [panelOpen, setPanelOpen] = useState(true);
    // What each pane actually loaded, reported up by the pane: modality for the
    // preset list, stackId for the measurement store, series list for the rail
    // when the host supplies no catalogue.
    const [paneInfo, setPaneInfo] = useState({});

    // A study's series are known from the worklist METADATA — key, description,
    // plane, instance count — without fetching a pixel. That is what lets the
    // rail list all series of an examination while only the ones on screen are
    // streamed.
    const catalogueSeries = activeEntry?.series ?? [];
    const hasCatalogue = catalogueSeries.length > 0;
    const seriesSignature = catalogueSeries.map((s) => `${s.key ?? ''}:${s.ref ?? ''}`).join('|');

    const thumbnails = useThumbnails({ series: catalogueSeries, loadSeriesIndex, loadInstance });

    const assignmentFor = useCallback((s) => (s ? {
        key: s.key ?? s.ref,
        ref: s.ref,
        stackId: null,
        meta: {
            description: s.description || s.key,
            studyDescription: activeEntry?.description,
            modality: activeEntry?.modality,
            plane: s.plane,
            count: s.instances,
            spacing: s.geometry?.spacing,
        },
    } : null), [activeEntry]);

    // Changing study hangs its series across the current layout, so a reader
    // never lands on a pane belonging to the study they just navigated away
    // from — and a two-pane layout opens with the first TWO series up, which is
    // what "hanging protocol" means at its simplest.
    useEffect(() => {
        setCine((c) => ({ ...c, playing: false }));
        setViewports({});
        setPaneInfo({});
        setActivePane(0);
        if (hasCatalogue) {
            setAssignments(Array.from({ length: layout.panes }, (_, i) => assignmentFor(catalogueSeries[i])));
        } else if (activeEntry?.ref) {
            setAssignments([{ key: activeEntry.ref, ref: activeEntry.ref, stackId: null, meta: { studyDescription: activeEntry.description } }]);
        } else {
            setAssignments([]);
        }
        if (activeEntry) {
            log('OPENED_STUDY', RADOYON_OBJECT_TYPES.STUDY, {
                study: activeEntry.id,
                study_id: activeEntry.studyId,
                series: catalogueSeries.length,
            });
        }
    }, [activeEntry?.id, seriesSignature]); // eslint-disable-line react-hooks/exhaustive-deps

    // Growing the layout fills the new panes with the next unassigned series;
    // shrinking it just hides the extra panes (their assignments are kept, so
    // growing back restores them).
    useEffect(() => {
        if (!hasCatalogue) return;
        setAssignments((current) => {
            const next = [...current];
            for (let i = 0; i < layout.panes; i++) {
                if (!next[i]) {
                    // Fill only with series not already on screen; when the
                    // study runs out, the pane stays EMPTY. Hanging the same
                    // series twice unasked is a workstation lying about how
                    // much of the study exists.
                    const used = new Set(next.filter(Boolean).map((a) => a.key));
                    next[i] = assignmentFor(catalogueSeries.find((s) => !used.has(s.key ?? s.ref)) ?? null);
                }
            }
            return next;
        });
        setActivePane((p) => Math.min(p, layout.panes - 1));
    }, [layout.panes]); // eslint-disable-line react-hooks/exhaustive-deps

    const log = useCallback((verb, objectType, detail) => {
        eventLogger?.log?.({ verb, objectType, component: RADOYON_COMPONENTS.VIEWPORT, detail });
    }, [eventLogger]);

    const updateViewport = useCallback((pane, next) => {
        setViewports((vs) => {
            const value = typeof next === 'function' ? (vs[pane] ? next(vs[pane]) : vs[pane]) : next;
            if (value === vs[pane]) return vs;
            return { ...vs, [pane]: value };
        });
    }, []);

    const onSeriesReady = useCallback((pane, series, seriesList) => {
        setPaneInfo((info) => ({
            ...info,
            [pane]: {
                stackId: series.stackId ?? series.seriesInstanceUid,
                modality: series.modality,
                description: series.description,
                count: series.count,
                plane: series.plane,
                spacing: series.spacing,
                frameRate: series.frameRate ?? null,
                seriesList,
            },
        }));
    }, []);

    // The rail: the catalogue when there is one, otherwise whatever pane 0
    // loaded — a host that points the room at one directory of DICOM still gets
    // a rail of its stacks.
    const railSeries = hasCatalogue
        ? catalogueSeries.map((s) => ({
            stackId: s.key ?? s.ref,
            ref: s.ref,
            description: s.description || s.key,
            plane: s.plane,
            count: s.instances,
            spacing: s.geometry?.spacing,
        }))
        : (paneInfo[0]?.seriesList ?? []);

    const railAssignments = useMemo(() => {
        const map = {};
        assignments.slice(0, layout.panes).forEach((a, i) => {
            if (!a) return;
            const id = hasCatalogue ? a.key : (a.stackId ?? paneInfo[i]?.stackId);
            if (id !== undefined && map[id] === undefined) map[id] = i;
        });
        return map;
    }, [assignments, layout.panes, hasCatalogue, paneInfo]);

    const onRailSelect = useCallback((s) => {
        if (hasCatalogue) {
            const catalogueEntry = catalogueSeries.find((c) => (c.key ?? c.ref) === s.stackId);
            setAssignments((current) => {
                const next = [...current];
                next[activePane] = assignmentFor(catalogueEntry);
                return next;
            });
        } else {
            setAssignments((current) => {
                const next = [...current];
                next[activePane] = { ...(next[activePane] ?? { ref: activeEntry?.ref }), stackId: s.stackId ?? s.seriesInstanceUid };
                return next;
            });
        }
    }, [hasCatalogue, catalogueSeries, activePane, assignmentFor, activeEntry?.ref]);

    const onMeasure = useCallback((stackId, measurement) => {
        setMeasurements((current) => {
            const next = { ...current, [stackId]: [...(current[stackId] ?? []), measurement] };
            onMeasurementsChange?.(next);
            return next;
        });
        log(
            measurement.kind === 'distance' ? 'MEASURED_DISTANCE' : 'MEASURED_REGION',
            RADOYON_OBJECT_TYPES.MEASUREMENT,
            measurement.kind === 'distance'
                ? { mm: measurement.result?.mm, unit: measurement.result?.unit, slice: measurement.slice }
                : { mean: measurement.result?.mean, sd: measurement.result?.sd, slice: measurement.slice },
        );
    }, [log, onMeasurementsChange]);

    const onDeleteMeasurement = useCallback((stackId, id) => {
        setMeasurements((current) => {
            const kept = (current[stackId] ?? []).filter((m) => m.id !== id);
            const next = { ...current, [stackId]: kept };
            if (kept.length === 0) delete next[stackId];
            onMeasurementsChange?.(next);
            return next;
        });
    }, [onMeasurementsChange]);

    const activeModality = paneInfo[activePane]?.modality ?? activeEntry?.modality;
    // A radiograph's presets are relative to the window it was stored with, so
    // they cannot be listed until that window is known — see presetsFor().
    const presets = presetsFor(activeModality, viewports[activePane]?.baseWindow);
    const activePresetId = activePreset(presets, viewports[activePane]?.window)?.id ?? null;

    const onPreset = useCallback((preset) => {
        updateViewport(activePane, (v) => applyPreset(v, preset));
        log('APPLIED_PRESET', RADOYON_OBJECT_TYPES.SERIES, {
            preset: preset.id, center: preset.center, width: preset.width,
        });
    }, [activePane, updateViewport, log]);

    const onAction = useCallback((id) => {
        const action = {
            invert: toggleInvert,
            rotate: rotateQuarter,
            flipH: flipHorizontal,
            flipV: flipVertical,
            reset: resetView,
        }[id];
        if (action) updateViewport(activePane, action);
    }, [activePane, updateViewport]);

    const onCineToggle = useCallback((pane) => {
        setCine((c) => ({ pane, playing: c.pane === pane ? !c.playing : true }));
        setActivePane(pane);
    }, []);

    // The cine loop. One pane plays at a time — matching how cine is used
    // (watching one stack move), and keeping "space bar" unambiguous.
    //
    // A loop that states its own rate is played at THAT rate. CINE_FPS is a
    // reasonable speed for scrolling a CT stack, where there is no true rate to
    // honour, and a badly wrong one for an echo: replayed at 12 fps a ventricle
    // acquired at 50 looks like it is failing, and no amount of care elsewhere
    // undoes a viewer that misrepresents wall motion.
    const cineFps = paneInfo[cine.pane]?.frameRate;
    useEffect(() => {
        if (!cine.playing) return undefined;
        const fps = Number.isFinite(cineFps) && cineFps > 0 ? cineFps : CINE_FPS;
        const timer = setInterval(() => updateViewport(cine.pane, (v) => cineStep(v)), 1000 / fps);
        return () => clearInterval(timer);
    }, [cine, cineFps, updateViewport]);

    // Room-level shortcuts. Guarded so typing in any form control is never
    // hijacked, and skipped when the focused viewport already handled the key.
    useEffect(() => {
        const toolKeys = { w: 'window', z: 'zoom', p: 'pan', d: 'distance', e: 'region' };
        const handler = (event) => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
            const tag = event.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return;
            const key = event.key.toLowerCase();

            if (toolKeys[key]) { setTool(toolKeys[key]); return; }
            if (key === 'i') { onAction('invert'); return; }
            if (key === 'r') { onAction('rotate'); return; }
            if (key === 'h') { onAction('flipH'); return; }
            if (key === 'v') { onAction('flipV'); return; }
            if (key === '0') { onAction('reset'); return; }
            if (key === ' ') { event.preventDefault(); onCineToggle(activePane); return; }
            if (key === '+' || key === '=') { updateViewport(activePane, (v) => zoomAbout(v, 1.25)); return; }
            if (key === '-') { updateViewport(activePane, (v) => zoomAbout(v, 0.8)); return; }
            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); updateViewport(activePane, (v) => scrollBy(v, event.shiftKey ? 10 : 1)); return; }
            if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); updateViewport(activePane, (v) => scrollBy(v, event.shiftKey ? -10 : -1)); return; }
            const digit = Number.parseInt(event.key, 10);
            if (digit >= 1 && digit <= 9 && presets[digit - 1]) onPreset(presets[digit - 1]);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [activePane, presets, onAction, onPreset, onCineToggle, updateViewport]);

    const measurementRows = useMemo(() => (
        Object.entries(measurements).flatMap(([stackId, list]) => list.map((m) => ({ ...m, stackId })))
    ), [measurements]);

    const gridClass = layout.panes === 1 ? 'grid-cols-1'
        : layout.panes === 2 ? 'grid-cols-2'
            : 'grid-cols-2 grid-rows-2';

    return (
        <div className="flex flex-col h-full bg-slate-950 text-slate-100">
            <Toolbar
                tool={tool}
                onTool={setTool}
                onAction={onAction}
                layout={layoutId}
                onLayout={setLayoutId}
                presets={presets}
                activePresetId={activePresetId}
                onPreset={onPreset}
                panelOpen={panelOpen}
                onTogglePanel={() => setPanelOpen((open) => !open)}
                t={t}
            />

            <div className="flex flex-1 min-h-0">
                <aside className="w-72 flex-shrink-0 border-r border-slate-800 min-h-0 bg-slate-950">
                    <Worklist
                        entries={worklist}
                        activeId={activeEntry?.id}
                        onSelect={(entry) => { chosenByReader.current = true; setActiveEntry(entry); }}
                        t={t}
                    />
                </aside>

                <main className={`flex-1 min-w-0 min-h-0 grid gap-px bg-slate-900 p-px ${gridClass}`}>
                    {Array.from({ length: layout.panes }, (_, pane) => (
                        <ReadingPane
                            key={pane}
                            pane={pane}
                            assignment={assignments[pane] ?? null}
                            viewport={viewports[pane]}
                            onViewportInit={updateViewport}
                            onViewportChange={updateViewport}
                            tool={tool}
                            active={layout.panes > 1 && pane === activePane}
                            onActivate={setActivePane}
                            measurementsByStack={measurements}
                            onMeasure={onMeasure}
                            cine={cine}
                            onCineToggle={onCineToggle}
                            loadSeries={loadSeries}
                            loadSeriesIndex={loadSeriesIndex}
                            loadInstance={loadInstance}
                            onSeriesReady={onSeriesReady}
                            eventLogger={eventLogger}
                            t={t}
                        />
                    ))}
                </main>

                {railSeries.length > 0 && (
                    <aside className="w-32 flex-shrink-0 border-l border-slate-800 bg-slate-950 flex flex-col min-h-0">
                        <div className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-widest text-slate-500">
                            {t('radoyon_series_label', 'Series')}
                        </div>
                        <SeriesRail
                            series={railSeries}
                            columns={1}
                            activeStackId={hasCatalogue
                                ? assignments[activePane]?.key
                                : (assignments[activePane]?.stackId ?? paneInfo[activePane]?.stackId)}
                            assignments={railAssignments}
                            onSelect={onRailSelect}
                            thumbnailFor={thumbnails.thumbnailFor}
                            t={t}
                        />
                    </aside>
                )}

                {panelOpen && (
                    <aside className="w-64 flex-shrink-0 border-l border-slate-800 bg-slate-950 overflow-y-auto text-sm">
                        <section className="border-b border-slate-800">
                            <h2 className="px-3 pt-3 text-[10px] uppercase tracking-widest text-slate-500">
                                {t('radoyon_image_controls', 'Image')}
                            </h2>
                            <ImageControls
                                viewport={viewports[activePane]}
                                baseWindow={viewports[activePane]?.baseWindow}
                                onWindow={(w) => updateViewport(activePane, (v) => setWindow(v, w))}
                                onAdjust={(key, value) => updateViewport(activePane, (v) => setAdjustment(v, key, value))}
                                onReset={() => onAction('reset')}
                                t={t}
                            />
                        </section>
                        <section className="border-b border-slate-800">
                            <h2 className="px-3 pt-3 text-[10px] uppercase tracking-widest text-slate-500">
                                {t('radoyon_report', 'Report')}
                            </h2>
                            <ReportPane
                                entry={activeEntry}
                                series={railSeries}
                                viewports={viewports}
                                paneInfo={paneInfo}
                                measurements={Object.values(measurements).flat()}
                                referenceNormal={activeEntry?.referenceNormal ?? null}
                                reportedBy={reportedBy}
                                onSubmitReport={onSubmitReport}
                                reportLinkFor={reportLinkFor}
                                t={t}
                            />
                        </section>
                        <section className="p-3 border-b border-slate-800">
                            <h2 className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">{t('radoyon_study', 'Study')}</h2>
                            {activeEntry ? (
                                <dl className="space-y-1 text-[12px]">
                                    <Row k={t('radoyon_description', 'Description')} v={activeEntry.description} />
                                    <Row k={t('radoyon_accession', 'Accession')} v={activeEntry.accession} mono />
                                    <Row k={t('radoyon_modality', 'Modality')} v={activeEntry.modality} mono />
                                    <Row k={t('radoyon_series_label', 'Series')} v={String(railSeries.length)} mono />
                                </dl>
                            ) : (
                                <p className="text-slate-500 text-xs">{t('radoyon_select_study', 'Select a study to read.')}</p>
                            )}
                        </section>
                        <section className="p-3">
                            <h2 className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">
                                {t('radoyon_measurements', 'Measurements')}
                            </h2>
                            {measurementRows.length === 0 ? (
                                <p className="text-slate-500 text-xs">{t('radoyon_no_measurements', 'None yet — use the distance or region tool.')}</p>
                            ) : (
                                <ul className="space-y-1">
                                    {measurementRows.map((m) => (
                                        <li key={`${m.stackId}:${m.id}`} className="flex items-center gap-2 text-[12px] bg-slate-900 rounded px-2 py-1">
                                            <span className="flex-1 min-w-0 truncate font-mono text-slate-300">
                                                {m.kind === 'distance'
                                                    ? (m.result?.unit === 'mm' ? `${m.result.mm.toFixed(1)} mm` : `${m.result?.px?.toFixed(0)} px`)
                                                    : `${m.result?.mean?.toFixed(0)} ± ${m.result?.sd?.toFixed(0)}`}
                                                <span className="text-slate-500"> · {t('radoyon_slice', 'im')} {Number.isFinite(m.slice) ? m.slice + 1 : '—'}</span>
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => onDeleteMeasurement(m.stackId, m.id)}
                                                aria-label={t('radoyon_delete_measurement', 'Delete measurement')}
                                                className="p-0.5 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </aside>
                )}
            </div>
        </div>
    );
}

function Row({ k, v, mono = false }) {
    return (
        <div className="flex gap-2">
            <dt className="text-slate-500 w-20 flex-shrink-0">{k}</dt>
            <dd className={`min-w-0 truncate text-slate-300 ${mono ? 'font-mono text-[11px]' : ''}`}>{v ?? '—'}</dd>
        </div>
    );
}

export default PacsScreen;
