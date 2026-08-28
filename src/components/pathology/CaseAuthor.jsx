import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, CircleAlert, Download, Plus, Trash2, Upload,
} from 'lucide-react';
import { SlideCanvas } from './SlideCanvas.jsx';
import { createViewerCommands, runViewerCommand } from './viewerCommands.js';
import { presetAvailability, formatObjective } from './magnification.js';
import { isTypingTarget, resolveCommand } from './keymap.js';
import { download } from './snapshot.js';
import {
    blankCase,
    blankSlide,
    caseToJSON,
    hasOptics,
    parseDecimal,
    validateCase,
} from './caseAuthoring.js';

/**
 * The case editor: put slides in a case and look at them.
 *
 * A case is a SET OF SLIDES. That is the whole model. Tasks, hints and answer
 * keys are optional assessment scaffolding that can be layered on later; most
 * cases will never carry them, and this editor does not ask for them.
 *
 * WHAT IT DOES INSIST ON is the scanner metadata — `nativeObjective`,
 * `nativeMpp` and `downsample`. Those three are not bookkeeping: every
 * magnification readout, scale bar and measurement in the viewer is derived
 * from them, and a slide without them can be looked at but not measured. The
 * checks panel says so rather than letting a case ship half-calibrated.
 *
 * The optical fields start EMPTY rather than pre-filled with plausible values.
 * A guessed 0.25 µm/px would pass every check and produce silently wrong
 * measurements, which is far worse than a blank the panel tells you to fill in.
 *
 * @param {object} props
 * @param {object} [props.initialCase]  a case to edit; a blank one otherwise
 * @param {Function} [props.onChange]   (pathologyCase) => void, after each edit
 * @param {import('react').ReactNode} [props.topBarControls]  host chrome for
 *   the header's leading edge — a back link, a save button, whatever the
 *   embedding app needs. The same slot `PathologyScreen` offers, and for the
 *   same reason: the editor should not have to know it is inside anything.
 */
export function CaseAuthor({ initialCase, onChange, topBarControls = null }) {
    const [draft, setDraft] = useState(() => initialCase ?? blankCase());
    const [activeSlideId, setActiveSlideId] = useState(initialCase?.slides?.[0]?.id ?? null);
    const [objective, setObjective] = useState(null);
    const [importError, setImportError] = useState(null);
    const viewerRef = useRef(null);
    const fileInputRef = useRef(null);

    const slide = draft.slides.find((s) => s.id === activeSlideId) ?? draft.slides[0] ?? null;
    const slideRef = useRef(slide);
    slideRef.current = slide;

    const issues = useMemo(() => validateCase(draft), [draft]);
    const optics = hasOptics(slide);
    const presets = optics ? presetAvailability(slide, 1.1) : [];

    const update = useCallback((next) => {
        setDraft(next);
        onChange?.(next);
    }, [onChange]);

    const commands = useMemo(() => createViewerCommands({
        getViewer: () => viewerRef.current,
        getSlide: () => slideRef.current,
    }), []);

    const attachViewer = useCallback((next) => {
        viewerRef.current = next;
        if (!next) return;
        const sync = () => setObjective(commands.currentObjective());
        next.addHandler('animation-finish', sync);
        next.addHandler('open', sync);
        sync();
    }, [commands]);

    // Bound to the WINDOW. A container listener only sees keys pressed while
    // focus is already inside it, and on a freshly loaded page nothing is
    // focused — the event targets <body> and bubbles UP, past the app.
    useEffect(() => {
        const onKeyDown = (event) => {
            if (isTypingTarget(event.target)) return;
            const command = resolveCommand(event);
            if (command && runViewerCommand(command, commands)) event.preventDefault();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [commands]);

    const addSlide = useCallback(() => {
        // Numbered past everything present, so removing slide 2 and adding
        // another cannot mint a duplicate id.
        let n = draft.slides.length + 1;
        while (draft.slides.some((s) => s.id === `slide-${n}`)) n += 1;
        const added = blankSlide(n);
        update({ ...draft, slides: [...draft.slides, added] });
        setActiveSlideId(added.id);
    }, [draft, update]);

    const patchSlide = useCallback((id, patch) => {
        update({ ...draft, slides: draft.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
    }, [draft, update]);

    const removeSlide = useCallback((id) => {
        const remaining = draft.slides.filter((s) => s.id !== id);
        update({ ...draft, slides: remaining });
        if (activeSlideId === id) setActiveSlideId(remaining[0]?.id ?? null);
    }, [draft, update, activeSlideId]);

    const exportCase = useCallback(() => {
        download(`${draft.id || 'pathology-case'}.json`, caseToJSON(draft), 'application/json');
    }, [draft]);

    const importCase = useCallback(async (file) => {
        if (!file) return;
        const parsed = JSON.parse(await file.text());
        update(parsed);
        setActiveSlideId(parsed.slides?.[0]?.id ?? null);
    }, [update]);

    return (
        <div
            className="flex h-screen w-screen flex-col overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 text-slate-100"
            role="application"
            aria-label="Pathology case editor"
        >
            <header className="flex shrink-0 items-center gap-3 border-b border-slate-800/80 bg-slate-950/80 px-4 py-2.5">
                {topBarControls}
                <span className="shrink-0 text-sm font-semibold">Case</span>
                <input
                    type="text"
                    value={draft.accession ?? ''}
                    placeholder="Accession"
                    onChange={(e) => update({ ...draft, accession: e.target.value })}
                    className={`${FIELD} max-w-40`}
                />
                <input
                    type="text"
                    value={draft.specimen ?? ''}
                    placeholder="Specimen description"
                    onChange={(e) => update({ ...draft, specimen: e.target.value })}
                    className={`${FIELD} max-w-[32rem]`}
                />
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <ShipStatus issues={issues} slideCount={draft.slides.length} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className={BTN}>
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Import
                    </button>
                    <button
                        type="button"
                        onClick={exportCase}
                        className={`${BTN} bg-fuchsia-500/20 text-fuchsia-100 ring-fuchsia-500/40 hover:bg-fuchsia-500/30`}
                    >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export case JSON
                    </button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1 overflow-hidden">
                <nav aria-label="Slides" className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-slate-800/80 bg-slate-950/40 p-3">
                    <header className="mb-2 flex items-center justify-between">
                        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Slides ({draft.slides.length})
                        </h2>
                        <button
                            type="button"
                            onClick={addSlide}
                            className="flex items-center gap-1 rounded-lg bg-fuchsia-500/15 px-2 py-1 text-[10px] font-semibold text-fuchsia-200 ring-1 ring-fuchsia-500/30 hover:bg-fuchsia-500/25"
                        >
                            <Plus className="h-3 w-3" aria-hidden="true" /> Add slide
                        </button>
                    </header>

                    {draft.slides.length === 0 && (
                        <p className="text-[11px] leading-relaxed text-slate-500">
                            No slides yet. <strong className="text-slate-400">Add slide</strong> creates one —
                            give it a tile source and the scanner metadata, and it opens in the viewer.
                        </p>
                    )}

                    <ul className="space-y-1">
                        {draft.slides.map((s) => (
                            <li key={s.id}>
                                <div className={`rounded-lg px-2.5 py-1.5 ring-1 transition-colors ${
                                    s.id === slide?.id ? 'bg-fuchsia-500/15 ring-fuchsia-500/30' : 'ring-slate-800'}`}
                                >
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setActiveSlideId(s.id)}
                                            aria-current={s.id === slide?.id}
                                            className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-slate-100"
                                        >
                                            {s.label || s.id}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeSlide(s.id)}
                                            title="Remove this slide"
                                            className="rounded p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                            <span className="sr-only">Remove {s.label || s.id}</span>
                                        </button>
                                    </div>
                                    <span className="block text-[10px] text-slate-500">
                                        {hasOptics(s)
                                            ? `${s.nativeObjective}x scan · ÷${s.downsample} · ${s.nativeMpp} µm/px`
                                            : 'calibration incomplete'}
                                    </span>
                                </div>
                            </li>
                        ))}
                    </ul>

                    {slide && <SlideFields slide={slide} onPatch={(p) => patchSlide(slide.id, p)} />}
                </nav>

                <main className="flex min-w-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-2 border-b border-slate-800/80 bg-slate-950/70 px-3 py-2">
                        <div className="flex items-center gap-0.5 rounded-xl bg-slate-900/70 p-1 ring-1 ring-slate-700/50" role="group" aria-label="Magnification">
                            {presets.map(({ objective: power, reachable }) => (
                                <button
                                    key={power}
                                    type="button"
                                    disabled={!reachable}
                                    onClick={() => commands.goToObjective(power)}
                                    title={reachable ? `Go to ${power}x` : `${power}x is beyond this archive`}
                                    className={`h-7 rounded-lg px-2 text-[11px] font-semibold tabular-nums ${
                                        reachable ? 'text-slate-300 hover:bg-slate-700/60' : 'cursor-not-allowed text-slate-600'}`}
                                >
                                    {power}x
                                </button>
                            ))}
                            {presets.length === 0 ? (
                                <span className="px-2 text-[11px] text-slate-500">
                                    Fill in the scanner metadata to get magnification
                                </span>
                            ) : (
                                <span className="ml-1 min-w-12 px-1 text-right text-[11px] font-semibold tabular-nums text-slate-400">
                                    {formatObjective(objective)}
                                </span>
                            )}
                        </div>
                        <p className="ml-auto text-[11px] text-slate-500">
                            Checking the slide opens and is calibrated. Reading and marking happen in the room.
                        </p>
                    </div>

                    {slide?.dzi
                        ? <SlideCanvas slide={slide} onViewer={attachViewer} startedAt={0} />
                        : (
                            <p className="m-auto max-w-sm p-6 text-center text-sm text-slate-500">
                                {draft.slides.length === 0
                                    ? 'Add a slide to get started.'
                                    : 'Give this slide a tile source and it will open here.'}
                            </p>
                        )}
                </main>

                <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-800/80 bg-slate-950/40">
                    {importError && (
                        <p role="alert" className="m-2 rounded-lg bg-rose-500/10 p-2 text-[11px] text-rose-300 ring-1 ring-rose-500/30">
                            That file could not be read: {importError}
                        </p>
                    )}
                    <IssueList issues={issues} />
                </aside>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                    importCase(e.target.files?.[0])
                        .then(() => setImportError(null))
                        .catch((err) => setImportError(err.message));
                    e.target.value = '';
                }}
            />
        </div>
    );
}

const FIELD = 'w-full rounded-md bg-slate-950/60 px-2 py-1 text-[12px] text-slate-100 ring-1 '
    + 'ring-slate-700 placeholder:text-slate-600 focus:outline-none focus:ring-fuchsia-500/50';
const BTN = 'flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold '
    + 'text-slate-200 ring-1 ring-slate-700 transition-colors hover:bg-slate-700';

/**
 * The three fields every measurement in the viewer depends on, plus the tile
 * source. Nothing else about a slide is required.
 */
function SlideFields({ slide, onPatch }) {
    return (
        <div className="mt-3 space-y-2 border-t border-slate-800/80 pt-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {slide.label || slide.id}
            </h3>
            {[['label', 'Label', 'A1 — H&E'], ['stain', 'Stain', 'H&E'],
                ['dzi', 'Tile source', '/slides/example.dzi']].map(([key, label, placeholder]) => (
                <label key={key} className="block text-[10px] font-semibold text-slate-400">
                    {label}
                    <input
                        type="text"
                        value={slide[key] ?? ''}
                        placeholder={placeholder}
                        onChange={(e) => onPatch({ [key]: e.target.value })}
                        className={`${FIELD} mt-0.5`}
                    />
                </label>
            ))}

            <p className="pt-1 text-[10px] leading-snug text-slate-500">
                Every magnification, scale bar and measurement comes from these three.
            </p>
            {[['nativeObjective', 'Scanned at (x)', '40'],
                ['nativeMpp', 'µm per pixel', '0.25'],
                ['downsample', 'Archive ÷', '4']].map(([key, label, placeholder]) => (
                <label key={key} className="block text-[10px] font-semibold text-slate-400">
                    {label}
                    {/* text + inputMode, NOT type="number": a number input
                        rejects the decimal separator that does not match the
                        browser locale and reports it as an empty string, so
                        "0,25" silently wiped the slide's calibration. */}
                    <input
                        type="text"
                        inputMode="decimal"
                        value={slide[key] ?? ''}
                        placeholder={placeholder}
                        onChange={(e) => onPatch({ [key]: parseDecimal(e.target.value) })}
                        className={`${FIELD} mt-0.5`}
                    />
                </label>
            ))}
        </div>
    );
}

function ShipStatus({ issues, slideCount }) {
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;
    if (errors > 0) {
        return (
            <span className="flex items-center gap-1.5 rounded-lg bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-500/30">
                <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                {errors} to fix
            </span>
        );
    }
    return (
        <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
            {slideCount} slide{slideCount === 1 ? '' : 's'} ready
            {warnings > 0 ? ` · ${warnings} to review` : ''}
        </span>
    );
}

/**
 * The problems list.
 *
 * Each message states the CONSEQUENCE rather than the field — "no scale bar or
 * measurement can be computed" tells an author why to care; "nativeMpp is
 * required" does not.
 */
function IssueList({ issues }) {
    if (issues.length === 0) {
        return (
            <p className="p-3 text-[11px] leading-relaxed text-slate-500">
                Nothing to fix. Every slide has a tile source and a complete calibration.
            </p>
        );
    }
    const icons = { error: CircleAlert, warning: AlertTriangle };
    const tones = { error: 'text-rose-300', warning: 'text-amber-300' };
    return (
        <section className="p-3" aria-label="Problems">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Checks ({issues.length})
            </h3>
            <ul className="space-y-1.5">
                {issues.map((issue) => {
                    const Icon = icons[issue.severity] ?? AlertTriangle;
                    return (
                        <li key={`${issue.severity}-${issue.path}-${issue.message}`} className="flex gap-1.5">
                            <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${tones[issue.severity] ?? 'text-slate-400'}`} aria-hidden="true" />
                            <span className="min-w-0 text-[11px] leading-snug text-slate-300">
                                {issue.message}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
