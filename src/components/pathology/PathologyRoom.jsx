import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, FileText, PenSquare } from 'lucide-react';
import { SlideCanvas } from './SlideCanvas.jsx';
import { SpecimenTray } from './SpecimenTray.jsx';
import { ReportPanel } from './ReportPanel.jsx';
import { AnnotationCanvas } from './AnnotationCanvas.jsx';
import { AnnotationPanel } from './AnnotationPanel.jsx';
import { KeyboardHelp } from './KeyboardHelp.jsx';
import { ViewerToolbar } from './ViewerToolbar.jsx';
import { NEUTRAL_ADJUSTMENTS, adjustmentFilter } from './imageAdjustments.js';
import { useReadRecorder } from './useReadRecorder.js';
import { useAnnotations } from './useAnnotations.js';
import { createPathologyLogger } from './pathologyEvents.js';
import { createViewerCommands, runViewerCommand } from './viewerCommands.js';
import { ANNOTATION_KINDS } from './annotationModel.js';
import { createReport, snapshotFindings, submitReport } from './report.js';
import { presetAvailability, formatObjective } from './magnification.js';
import { isTypingTarget, resolveCommand } from './keymap.js';
import { captureField, download } from './snapshot.js';
import { toLegacyViewerCase } from './caseCore/viewerAdapter.js';

/**
 * The Pathology room — a sixth peer alongside Patient, Examination,
 * Laboratory, Radiology and Consultant.
 *
 * Everything crossing the boundary is INJECTED via props: `eventLogger` and
 * the case data. The room imports nothing from Rohy, which is what makes the
 * folder droppable and what lets every module underneath it be tested outside
 * a browser.
 *
 * NOTE — `llmService` was removed along with the diagnosis box. It existed to
 * settle a free-text answer a deterministic grader could not decide, and there
 * is no longer a free-text answer to grade: the reader writes a report, and
 * grading prose against `requireTerms` / `rejectTerms` would misfire on any
 * legitimate differential ("no evidence of malignancy" contains "malignancy").
 * `grading.js` is intact and still tested, ready for a tutor-side use.
 *
 * THIS COMPONENT IS THE WIRING, NOT THE BEHAVIOUR. The viewport logic lives in
 * viewerCommands.js, the drawing in AnnotationCanvas.jsx, the document in
 * annotationStore.js, and the key bindings in keymap.js. Keeping the room thin
 * is what stops "go to 10x" from existing in three subtly different versions —
 * one for the button, one for the hotkey, one for the annotation jump.
 *
 * WHAT THIS PACKAGE DELIBERATELY DOES NOT DO: it does not persist anything, it
 * does not authenticate, and it owns no analytics. Annotations are handed to
 * the host through `onAnnotationsChange`, and every act is reported through the
 * injected event logger. Storage and interpretation are Rohy's.
 *
 * @param {object} props
 * @param {object} props.pathologyCase  {id, accession, slides[], specimens[], task}
 * @param {object} props.eventLogger    Rohy's eventLogger singleton
 * @param {boolean} [props.examMode]    proctored read: hints and revision off
 * @param {Function} [props.onAnnotationsChange]  (slideId, annotations) => void
 * @param {object} [props.initialAnnotations]     {[slideId]: annotation[]}
 * @param {Function} [props.onReportsChange]      (reports) => void
 * @param {Array<object>} [props.initialReports]  reports to restore
 */
export function PathologyRoom({
    pathologyCase,
    rubric = null,
    eventLogger,
    examMode = false,
    onAnnotationsChange,
    initialAnnotations,
    onReportsChange,
    initialReports,
    // How this host turns a `remote:` reference into a loadable address. Some
    // hosts resolve references before the case ever reaches this component; a
    // host that does not passes the rule in here instead.
    resolveRef = null,
}) {
    const logger = useMemo(() => createPathologyLogger(eventLogger), [eventLogger]);
    const viewerCase = useMemo(() => {
        if (!pathologyCase?.schemaVersion) return pathologyCase;
        return toLegacyViewerCase(pathologyCase, typeof resolveRef === 'function'
            // Slides and gross plates both resolve through the same rule; the
            // adapter asks per rendition and does not care which it is.
            ? { resolveRendition: ({ rendition }) => (rendition ? resolveRef(rendition.uri) : undefined) }
            : undefined);
    }, [pathologyCase, resolveRef]);
    const [activeSlideId, setActiveSlideId] = useState(viewerCase?.slides?.[0]?.id ?? null);
    const [readResult, setReadResult] = useState(null);
    // Microscopy and gross are peer modules within the room, mirroring the
    // standalone workstation. A case may carry either, both, or neither — so the
    // room opens on whichever it has. A gross-only case used to open on
    // Microscopy, which then rendered "No slides in this case" with no tab to
    // reach the photographs by.
    const [module, setModule] = useState(() => (
        (viewerCase?.slides?.length ?? 0) === 0
        && (viewerCase?.specimens ?? []).some((entry) => (entry.images?.length ?? 0) > 0)
            ? 'gross'
            : 'microscopy'
    ));

    // --- viewer state ------------------------------------------------------
    const [viewer, setViewer] = useState(null);
    const viewerRef = useRef(null);
    const [tool, setTool] = useState('navigate');
    const [activeClass, setActiveClass] = useState(null);
    const [frameAreaMm2, setFrameAreaMm2] = useState(2);
    const [adjustments, setAdjustments] = useState(NEUTRAL_ADJUSTMENTS);
    const [showNavigator, setShowNavigator] = useState(true);
    const [helpOpen, setHelpOpen] = useState(false);
    const [bookmarks, setBookmarks] = useState([]);
    const [objective, setObjective] = useState(null);
    const [sidePanel, setSidePanel] = useState('annotations');
    // Seeded ONCE, deliberately. Re-reading `initialReports` on later renders
    // would discard a draft in progress every time the parent re-rendered —
    // the same rule `initialAnnotations` follows.
    const [reports, setReports] = useState(() => initialReports ?? []);
    const [activeReportId, setActiveReportId] = useState(null);
    // Report ids come from a counter, not from reports.length: deleting a
    // report would otherwise let the next one reuse a retired id. Seeded past
    // anything restored, so a report added after a reload cannot collide with
    // one saved last session.
    const reportSeqRef = useRef(
        (initialReports ?? []).reduce((max, r) => {
            const m = typeof r?.id === 'string' ? r.id.match(/-(\d+)$/) : null;
            return m ? Math.max(max, Number(m[1])) : max;
        }, 0),
    );
    const drawControlsRef = useRef(null);
    const fileInputRef = useRef(null);

    const slides = viewerCase?.slides ?? [];
    const specimens = viewerCase?.specimens ?? [];
    const slide = slides.find((s) => s.id === activeSlideId) ?? null;
    const task = viewerCase?.task ?? null;
    const answerKey = task?.answerKey ?? null;
    // Latest-value refs, synced in an effect rather than during render. Their
    // only readers are the command set and the key handler, both of which run
    // from user events — always after the commit that ran this effect.
    const slideRef = useRef(slide);
    const annotationsRef = useRef(null);

    const assessment = rubric ?? answerKey;
    const { accept, finish, startedAt } = useReadRecorder(assessment, logger, {
        slide,
        activityId: task?.id,
        enabled: !!assessment,
    });

    const annotations = useAnnotations({
        slide,
        initial: initialAnnotations?.[activeSlideId],
        logger,
        onChange: onAnnotationsChange,
    });
    // `annotations` is a fresh object every render; reaching it through a ref
    // is what keeps the key-handler effect from re-registering on every one.
    useEffect(() => {
        slideRef.current = slide;
        annotationsRef.current = annotations;
    });

    // Commands read the viewer through a ref rather than closing over it: the
    // viewer is rebuilt on every slide switch, and a captured instance would
    // go on driving a destroyed one.
    const commands = useMemo(() => createViewerCommands({
        getViewer: () => viewerRef.current,
        getSlide: () => slideRef.current,
        onBookmark: (state) => setBookmarks((current) => [
            ...current,
            { id: `bm-${current.length + 1}`, label: formatObjective(state.objective), state },
        ]),
    }), []);

    // After a region is drawn the reader almost always wants to nudge it, so
    // the tool hands back to Select — which is what every vector editor does,
    // and what makes "move it after drawing" need no tool change at all.
    // Markers and counting frames are excluded: placing a run of them is the
    // whole workflow, and switching tools after each one would break it.
    const addAnnotation = useCallback((spec) => {
        const annotation = annotationsRef.current.add(spec);
        if (annotation && !REPEAT_TOOLS.has(spec.kind)) setTool('select');
        return annotation;
    }, []);

    const attachViewer = useCallback((next) => {
        viewerRef.current = next;
        setViewer(next);
    }, []);

    // Keep the toolbar's magnification readout in step with the viewport,
    // however the viewport was moved — wheel, drag, hotkey or button.
    useEffect(() => {
        if (!viewer) { setObjective(null); return undefined; }
        const update = () => setObjective(commands.currentObjective());
        update();
        viewer.addHandler('animation-finish', update);
        viewer.addHandler('open', update);
        return () => {
            viewer.removeHandler('animation-finish', update);
            viewer.removeHandler('open', update);
        };
    }, [viewer, commands]);

    // Log the open from an effect keyed on the ACTIVE slide, not from the
    // click handler. The first slide is selected by initial state and never
    // clicked, so a click-handler-only version silently lost the opening
    // OPENED_SLIDE of every read — the one event the whole read hangs off.
    const loggedSlideRef = useRef(null);
    useEffect(() => {
        if (!slide || loggedSlideRef.current === slide.id) return;
        loggedSlideRef.current = slide.id;
        logger.slideOpened(slide);
    }, [slide, logger]);

    // --- keyboard ----------------------------------------------------------
    //
    // Bound to the window rather than to a container, because focus legitimately
    // sits on the OSD canvas, on a toolbar button, or nowhere at all, and a
    // container listener would miss two of those three. `isTypingTarget` is what
    // keeps this safe: without it, typing a diagnosis would fire half the tools.
    useEffect(() => {
        if (module !== 'microscopy') return undefined;
        const onKeyDown = (event) => {
            if (isTypingTarget(event.target)) return;
            const command = resolveCommand(event);
            if (!command) return;

            // Viewport commands first: they are the ones that must feel
            // instant, and they never depend on the annotation document.
            if (runViewerCommand(command, commands)) {
                event.preventDefault();
                return;
            }

            const tools = {
                'tool.navigate': 'navigate',
                'tool.select': 'select',
                'tool.line': ANNOTATION_KINDS.LINE,
                'tool.arrow': ANNOTATION_KINDS.ARROW,
                'tool.rectangle': ANNOTATION_KINDS.RECTANGLE,
                'tool.ellipse': ANNOTATION_KINDS.ELLIPSE,
                'tool.polygon': ANNOTATION_KINDS.POLYGON,
                'tool.freehand': ANNOTATION_KINDS.FREEHAND,
                'tool.polyline': ANNOTATION_KINDS.POLYLINE,
                'tool.point': ANNOTATION_KINDS.POINT,
                'tool.countingFrame': ANNOTATION_KINDS.COUNTING_FRAME,
            };
            // A counting frame IS an area in mm² — that is the whole point of
            // it, since WHO's classification asks for mitoses per mm² rather
            // than per high-power field. On a slide with no micron scale there
            // is no such area to place, so the tool is withheld rather than
            // placed and left meaningless.
            if (command === 'tool.countingFrame' && slide?.measurable === false) {
                event.preventDefault();
                return;
            }
            if (tools[command]) { setTool(tools[command]); event.preventDefault(); return; }

            const doc = annotationsRef.current;
            switch (command) {
                case 'view.toggleNavigator': setShowNavigator((v) => !v); break;
                case 'edit.undo': doc.undo(); break;
                case 'edit.redo': doc.redo(); break;
                case 'edit.delete':
                    if (doc.selectedId) doc.remove(doc.selectedId);
                    break;
                case 'edit.cancel':
                    // Escape unwinds one layer at a time: an in-flight polygon
                    // first, then the selection, then the help sheet. Clearing
                    // everything at once would make Escape unusable for backing
                    // out of a mis-started shape.
                    if (drawControlsRef.current?.drawing()) drawControlsRef.current.cancel();
                    else if (doc.selectedId) doc.select(null);
                    else setHelpOpen(false);
                    break;
                case 'edit.finish': drawControlsRef.current?.finish(); break;
                case 'count.increment':
                    if (doc.selectedId) doc.adjustTally(doc.selectedId, 1);
                    break;
                case 'count.decrement':
                    if (doc.selectedId) doc.adjustTally(doc.selectedId, -1);
                    break;
                case 'help.toggle': setHelpOpen((v) => !v); break;
                default: return;
            }
            event.preventDefault();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [commands, module, slide?.measurable]);

    // --- files -------------------------------------------------------------

    const exportAnnotations = useCallback(() => {
        const collection = annotations.exportGeoJSON();
        if (!collection) return;
        download(
            `${slideRef.current.id}-annotations.geojson`,
            JSON.stringify(collection, null, 2),
            'application/geo+json',
        );
    }, [annotations]);

    const [importError, setImportError] = useState(null);
    const importAnnotations = useCallback(async (file) => {
        if (!file) return;
        // Errors are surfaced, never swallowed. Importing four of a reader's
        // eleven regions and saying nothing would be far worse than refusing
        // the file and saying which feature was wrong.
        try {
            const count = annotations.importGeoJSON(JSON.parse(await file.text()));
            setImportError(null);
            logger.emit('ANNOTATED_SLIDE', 'slide_annotation', {
                objectId: slideRef.current?.id ?? null,
                objectName: file.name,
                result: `imported_${count}`,
                context: { source: 'geojson_import', count },
            });
        } catch (err) {
            setImportError(err.message);
        }
    }, [annotations, logger]);

    const takeSnapshot = useCallback(() => {
        if (!viewerRef.current || !slideRef.current) return;
        const { dataUrl, filename } = captureField({
            viewer: viewerRef.current,
            annotationCanvas: drawControlsRef.current?.canvas() ?? null,
            slide: slideRef.current,
            filter: adjustmentFilter(adjustments),
        });
        download(filename, dataUrl);
    }, [adjustments]);

    // --- reporting ---------------------------------------------------------

    const openSlide = useCallback((next) => setActiveSlideId(next.id), []);

    // --- reports ----------------------------------------------------------

    const emitReports = useCallback((next) => {
        setReports(next);
        onReportsChange?.(next);
    }, [onReportsChange]);

    const addReport = useCallback(() => {
        reportSeqRef.current += 1;
        const report = createReport({
            id: `${viewerCase?.id ?? 'case'}-report-${reportSeqRef.current}`,
            now: Date.now(),
        });
        setReports((current) => {
            const next = [...current, report];
            onReportsChange?.(next);
            return next;
        });
        setActiveReportId(report.id);
        setSidePanel('report');
    }, [viewerCase, onReportsChange]);

    // Typing does NOT log. A keystroke is not a learning event, and one row per
    // character would bury the activity feed for every other room in Rohy.
    // Saving and submitting are the acts worth recording.
    const changeReport = useCallback((id, patch) => {
        setReports((current) => {
            const next = current.map((r) => (r.id === id
                ? { ...r, ...patch, updatedAtMs: Date.now() }
                : r));
            onReportsChange?.(next);
            return next;
        });
    }, [onReportsChange]);

    const saveReport = useCallback((id) => {
        const report = reports.find((r) => r.id === id);
        if (report) logger.reportSaved(report);
    }, [reports, logger]);

    const submitActiveReport = useCallback((id) => {
        const report = reports.find((r) => r.id === id);
        if (!report) return;
        // Close the read FIRST, so the score that is shown and the score that
        // is logged are the same object rather than two separate calculations.
        const scored = finish();
        setReadResult(scored);

        const submitted = submitReport(report, Date.now());
        emitReports(reports.map((r) => (r.id === id ? submitted : r)));
        logger.reportSubmitted(submitted, {
            elapsedMs: scored?.totalTimeMs ?? null,
            readScore: scored?.readScore ?? null,
            roiCoverage: scored?.roiCoverage ?? null,
            slideCoverage: scored?.slideCoverage ?? null,
        });
    }, [reports, finish, logger, emitReports]);

    if (!viewerCase) {
        return (
            <p className="m-auto max-w-sm p-6 text-center text-sm text-slate-500">
                No pathology material is attached to this case.
            </p>
        );
    }

    const showGross = module === 'gross';
    const presets = slide ? presetAvailability(slide, 1.1) : [];
    // Recomputed each render rather than cached: a stale findings list offered
    // to a report would attach measurements the slide no longer carries.
    const findings = slide?.nativeMpp ? snapshotFindings(annotations.annotations, slide) : [];

    return (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Module switcher. Rendered only when the case actually carries
                both, so a slides-only case is not given a dead tab. */}
            {/* Shown whenever the case carries both kinds of evidence — counted by
                photographs, not by parts, so a part with no pictures does not
                conjure a tab that leads nowhere. */}
            {slides.length > 0 && specimens.some((entry) => (entry.images?.length ?? 0) > 0) && (
                <div role="tablist" aria-label="Pathology modules" className="flex shrink-0 gap-1 border-b border-slate-800/80 bg-slate-950/60 px-3 py-1.5">
                    {/* Both tabs count the same kind of thing: the evidence
                        behind them. Counting specimen PARTS here read as
                        "Gross 2" for two parts holding no photograph at all. */}
                    {[
                        ['microscopy', 'Microscopy', slides.length],
                        ['gross', 'Gross', specimens.reduce((total, entry) => total + (entry.images?.length ?? 0), 0)],
                    ].map(([key, label, count]) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={module === key}
                            onClick={() => setModule(key)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                                module === key ? 'bg-fuchsia-500/15 text-fuchsia-200 ring-1 ring-fuchsia-500/30'
                                    : 'text-slate-400 hover:bg-slate-800/50'
                            }`}
                        >
                            {label} <span className="ml-1 tabular-nums text-slate-500">{count}</span>
                        </button>
                    ))}
                </div>
            )}

            {showGross ? (
                <SpecimenTray specimens={specimens} logger={logger} />
            ) : (
                <>
                    <ViewerToolbar
                        tool={tool}
                        onTool={setTool}
                        activeClass={activeClass}
                        onClass={setActiveClass}
                        frameAreaMm2={frameAreaMm2}
                        onFrameArea={setFrameAreaMm2}
                        objective={objective}
                        presets={presets}
                        onObjective={(power) => commands.goToObjective(power)}
                        onFit={() => commands.fit()}
                        onRotate={(deg) => commands.rotate(deg)}
                        onFlip={() => commands.flip()}
                        onBookmark={() => commands.bookmark()}
                        adjustments={adjustments}
                        onAdjust={setAdjustments}
                        onSnapshot={takeSnapshot}
                        onExport={exportAnnotations}
                        onImport={() => fileInputRef.current?.click()}
                        onClear={annotations.clear}
                        onHelp={() => setHelpOpen(true)}
                        canUndo={annotations.canUndo}
                        canRedo={annotations.canRedo}
                        onUndo={annotations.undo}
                        onRedo={annotations.redo}
                        annotationCount={annotations.annotations.length}
                    />

                    <div className="flex min-h-0 flex-1 overflow-hidden">
                        <nav aria-label="Slides" className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-slate-800/80 bg-slate-950/40 p-3">
                            <div className="flex flex-col gap-1.5">
                                {slides.map((s) => {
                                    const active = s.id === activeSlideId;
                                    return (
                                        <button
                                            key={s.id}
                                            type="button"
                                            aria-current={active}
                                            onClick={() => openSlide(s)}
                                            className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left ring-1 transition-colors ${
                                                active ? 'bg-fuchsia-500/15 text-fuchsia-100 ring-fuchsia-500/30'
                                                    : 'text-slate-300 ring-slate-800 hover:bg-slate-800/50'
                                            }`}
                                        >
                                            <span className="text-[13px] font-semibold">{s.label}</span>
                                            <span className="text-[11px] text-slate-500">{s.stain}</span>
                                        </button>
                                    );
                                })}
                                {slides.length === 0 && <p className="p-2 text-xs text-slate-500">No slides in this case.</p>}
                            </div>

                            {/* Bookmarked fields. A reader who finds something at
                                20x and then screens on needs to get back to it
                                without re-hunting — the digital equivalent of
                                leaving the stage where it was. */}
                            {bookmarks.length > 0 && (
                                <div className="mt-4 border-t border-slate-800/80 pt-3">
                                    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                        Bookmarked fields
                                    </h3>
                                    <ul className="space-y-1">
                                        {bookmarks.map((b) => (
                                            <li key={b.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => commands.restore(b.state)}
                                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-slate-300 ring-1 ring-slate-800 hover:bg-slate-800/50"
                                                >
                                                    <Bookmark className="h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />
                                                    <span className="tabular-nums">{b.label}</span>
                                                    <span className="ml-auto tabular-nums text-slate-600">
                                                        {Math.round(b.state.center.x * 1000) / 1000}
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </nav>

                        <main className="flex min-w-0 flex-1 flex-col">
                            {slide ? (
                                <SlideCanvas
                                    slide={slide}
                                    onSample={accept}
                                    onViewer={attachViewer}
                                    startedAt={startedAt}
                                    filter={adjustmentFilter(adjustments)}
                                    showNavigator={showNavigator}
                                >
                                    <AnnotationCanvas
                                        viewer={viewer}
                                        slide={slide}
                                        tool={tool}
                                        activeClass={activeClass}
                                        frameAreaMm2={frameAreaMm2}
                                        annotations={annotations.annotations}
                                        selectedId={annotations.selectedId}
                                        onSelect={annotations.select}
                                        onAdd={addAnnotation}
                                        onUpdate={annotations.update}
                                        onDelete={annotations.remove}
                                        controlsRef={drawControlsRef}
                                    />
                                </SlideCanvas>
                            ) : (
                                <p className="m-auto text-sm text-slate-500">Select a slide.</p>
                            )}
                        </main>

                        <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-slate-800/80 bg-slate-950/40 max-xl:w-72">
                            <div role="tablist" aria-label="Side panel" className="flex shrink-0 gap-1 border-b border-slate-800/80 px-2 py-1.5">
                                {[['annotations', 'Marks', PenSquare], ['report', 'Report', FileText]].map(([key, label, Icon]) => (
                                        <button
                                            key={key}
                                            type="button"
                                            role="tab"
                                            aria-selected={sidePanel === key}
                                            onClick={() => setSidePanel(key)}
                                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                                sidePanel === key ? 'bg-fuchsia-500/15 text-fuchsia-200 ring-1 ring-fuchsia-500/30'
                                                    : 'text-slate-400 hover:bg-slate-800/50'
                                            }`}
                                        >
                                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {importError && (
                                <p role="alert" className="m-2 rounded-lg bg-rose-500/10 p-2 text-[11px] text-rose-300 ring-1 ring-rose-500/30">
                                    That file could not be imported: {importError}
                                </p>
                            )}

                            {sidePanel === 'annotations' ? (
                                <AnnotationPanel
                                    annotations={annotations.annotations}
                                    slide={slide}
                                    selectedId={annotations.selectedId}
                                    onSelect={annotations.select}
                                    onUpdate={annotations.update}
                                    onDelete={annotations.remove}
                                    onAdjustTally={annotations.adjustTally}
                                    onGoTo={(rect) => commands.goToSlideRect(rect)}
                                />
                            ) : (
                                <ReportPanel
                                    reports={reports}
                                    activeId={activeReportId}
                                    onSelect={setActiveReportId}
                                    onAdd={addReport}
                                    onChange={changeReport}
                                    onSave={saveReport}
                                    onSubmit={submitActiveReport}
                                    findings={findings}
                                    task={examMode && task ? { ...task, hints: [] } : task}
                                    logger={logger}
                                    readResult={readResult}
                                    examMode={examMode}
                                />
                            )}
                        </aside>
                    </div>
                </>
            )}

            <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

            <input
                ref={fileInputRef}
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                className="hidden"
                onChange={(e) => {
                    importAnnotations(e.target.files?.[0]);
                    // Reset so re-picking the SAME file fires change again.
                    e.target.value = '';
                }}
            />
        </div>
    );
}
// Tools where placing a run of them IS the workflow, so the tool must stay
// selected rather than handing back to Select after each one.
const REPEAT_TOOLS = new Set([ANNOTATION_KINDS.POINT, ANNOTATION_KINDS.COUNTING_FRAME]);
