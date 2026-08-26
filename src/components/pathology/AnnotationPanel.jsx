import { useMemo } from 'react';
import { Minus, Plus, Target, Trash2 } from 'lucide-react';
import {
    ANNOTATION_CLASSES,
    ANNOTATION_KINDS,
    annotationBounds,
    annotationColor,
    annotationLabel,
    formatArea,
    formatLength,
    isAreal,
    measureAnnotation,
    pointsWithin,
} from './annotationModel.js';

/**
 * The annotation list — the half of the editor that is not the canvas.
 *
 * WHY THIS EXISTS RATHER THAN JUST THE OVERLAY: an annotation drawn at 20x is
 * invisible when the reader steps back to 1x, and a slide with fourteen marks
 * on it cannot be audited by squinting at the tissue. The list is what makes
 * annotations addressable — nameable, classifiable, jumpable-to, countable —
 * and it is the surface a marker or a tutor actually reads.
 *
 * The per-class summary at the bottom is the one genuinely derived number
 * here: total annotated area per class. It is computed from the geometry every
 * render rather than cached, because a cached total that disagrees with the
 * shapes on screen is worse than no total.
 */
export function AnnotationPanel({
    annotations,
    slide,
    selectedId,
    onSelect,
    onUpdate,
    onDelete,
    onAdjustTally,
    onGoTo,
}) {
    const summary = useMemo(() => summarise(annotations, slide), [annotations, slide]);

    if (!slide) return null;

    return (
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Annotations">
            <header className="flex shrink-0 items-baseline justify-between px-3 py-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Annotations
                </h3>
                <span className="text-[11px] tabular-nums text-slate-500">{annotations.length}</span>
            </header>

            {annotations.length === 0 ? (
                <p className="px-3 pb-3 text-[11px] leading-relaxed text-slate-500">
                    Nothing marked yet. Pick a tool above — <strong className="text-slate-400">M</strong> measures a
                    distance, <strong className="text-slate-400">C</strong> places a counting frame of known area.
                </p>
            ) : (
                <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
                    {annotations.map((a) => (
                        <AnnotationRow
                            key={a.id}
                            annotation={a}
                            slide={slide}
                            annotations={annotations}
                            selected={a.id === selectedId}
                            onSelect={onSelect}
                            onUpdate={onUpdate}
                            onDelete={onDelete}
                            onAdjustTally={onAdjustTally}
                            onGoTo={onGoTo}
                        />
                    ))}
                </ul>
            )}

            {summary.length > 0 && (
                <footer className="shrink-0 border-t border-slate-800/80 px-3 py-2">
                    <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Area by class
                    </h4>
                    <ul className="space-y-0.5">
                        {summary.map((row) => (
                            <li key={row.name} className="flex items-center gap-2 text-[11px] text-slate-300">
                                <span
                                    className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-slate-950/50"
                                    style={{ backgroundColor: row.color }}
                                />
                                <span className="truncate">{row.name}</span>
                                <span className="ml-auto shrink-0 tabular-nums text-slate-400">
                                    {formatArea(row.areaUm2)}
                                </span>
                                <span className="w-6 shrink-0 text-right tabular-nums text-slate-500">
                                    {row.count}
                                </span>
                            </li>
                        ))}
                    </ul>
                </footer>
            )}
        </section>
    );
}

function AnnotationRow({
    annotation, slide, annotations, selected, onSelect, onUpdate, onDelete, onAdjustTally, onGoTo,
}) {
    const m = measureAnnotation(annotation, slide);
    const color = annotationColor(annotation);
    const isFrame = annotation.kind === ANNOTATION_KINDS.COUNTING_FRAME;
    // The cross-check: how many markers the reader actually placed inside the
    // frame, against the number they clicked onto the counter.
    const marks = isFrame ? pointsWithin(annotation, annotations).length : 0;

    return (
        <li>
            <div
                className={`rounded-lg p-2 ring-1 transition-colors ${
                    selected ? 'bg-slate-800/70 ring-fuchsia-500/40' : 'ring-slate-800 hover:bg-slate-800/40'
                }`}
            >
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => onSelect(annotation.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                        <span
                            className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-slate-950/50"
                            style={{ backgroundColor: color }}
                        />
                        <span className="truncate text-[12px] font-medium text-slate-100">
                            {annotationLabel(annotation)}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onGoTo(annotationBounds(annotation))}
                        title="Show me this"
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-700/60 hover:text-slate-100"
                    >
                        <Target className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">Go to {annotationLabel(annotation)}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onDelete(annotation.id)}
                        title="Delete"
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                    >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">Delete {annotationLabel(annotation)}</span>
                    </button>
                </div>

                <p className="mt-0.5 pl-4 text-[11px] tabular-nums text-slate-400">
                    {annotation.kind.replace(/_/g, ' ')}
                    {m.lengthUm !== null && ` · ${formatLength(m.lengthUm)}`}
                    {m.areaUm2 !== null && ` · ${formatArea(m.areaUm2)}`}
                </p>

                {selected && (
                    <div className="mt-2 space-y-2 pl-4">
                        <label className="block">
                            <span className="sr-only">Label</span>
                            <input
                                type="text"
                                value={annotation.text}
                                placeholder="Add a note…"
                                onChange={(e) => onUpdate(annotation.id, { text: e.target.value })}
                                className="w-full rounded-md bg-slate-950/60 px-2 py-1 text-[11px] text-slate-100 ring-1 ring-slate-700 placeholder:text-slate-600 focus:outline-none focus:ring-fuchsia-500/50"
                            />
                        </label>

                        <label className="block">
                            <span className="sr-only">Classification</span>
                            <select
                                value={annotation.classification?.name ?? ''}
                                onChange={(e) => onUpdate(annotation.id, {
                                    classification: ANNOTATION_CLASSES.find((c) => c.name === e.target.value) ?? null,
                                })}
                                className="w-full rounded-md bg-slate-950/60 px-2 py-1 text-[11px] text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-fuchsia-500/50"
                            >
                                <option value="">Unclassified</option>
                                {ANNOTATION_CLASSES.map((c) => (
                                    <option key={c.name} value={c.name}>{c.name}</option>
                                ))}
                            </select>
                        </label>

                        {isFrame && (
                            <div className="rounded-md bg-slate-950/60 p-2 ring-1 ring-slate-700/60">
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onAdjustTally(annotation.id, -1)}
                                        className="rounded p-1 text-slate-300 hover:bg-slate-700"
                                        title="One fewer  (Shift+Space)"
                                    >
                                        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span className="sr-only">Decrease count</span>
                                    </button>
                                    <span className="min-w-8 text-center text-lg font-semibold tabular-nums text-slate-100">
                                        {annotation.tally}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => onAdjustTally(annotation.id, 1)}
                                        className="rounded p-1 text-slate-300 hover:bg-slate-700"
                                        title="One more  (Space)"
                                    >
                                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span className="sr-only">Increase count</span>
                                    </button>
                                    <span className="ml-auto text-right text-[11px] tabular-nums text-slate-300">
                                        {m.perMm2 !== null ? `${m.perMm2.toFixed(1)} /mm²` : '—'}
                                    </span>
                                </div>
                                <p className="mt-1 text-[10px] leading-snug text-slate-500">
                                    {annotation.tally} in {formatArea(m.areaUm2)}
                                    {annotation.targetAreaMm2 && ` · placed as ${annotation.targetAreaMm2} mm²`}
                                </p>
                                {/* The cross-check is shown ONLY when it disagrees. A
                                    permanent "0 markers placed" line would train the
                                    reader to ignore the row that matters. */}
                                {marks !== annotation.tally && (
                                    <p className="mt-1 text-[10px] leading-snug text-amber-300">
                                        {marks} marker{marks === 1 ? '' : 's'} placed inside this frame —
                                        the counter says {annotation.tally}.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </li>
    );
}

/**
 * Total annotated area per class, largest first.
 *
 * Linear annotations are excluded rather than counted as zero: a ruler has no
 * area, and letting it contribute a zero row would make "Tumour: 0 µm² (3)"
 * appear for a class the reader only ever measured across.
 *
 * @param {Array<object>} annotations
 * @param {object} slide
 * @returns {Array<{name:string, color:string, areaUm2:number, count:number}>}
 */
function summarise(annotations, slide) {
    if (!slide?.nativeMpp) return [];
    const totals = new Map();
    annotations
        .filter((a) => isAreal(a.kind))
        .forEach((a) => {
            const name = a.classification?.name ?? 'Unclassified';
            const row = totals.get(name) ?? { name, color: annotationColor(a), areaUm2: 0, count: 0 };
            row.areaUm2 += measureAnnotation(a, slide).areaUm2;
            row.count += 1;
            totals.set(name, row);
        });
    return [...totals.values()].sort((a, b) => b.areaUm2 - a.areaUm2);
}
