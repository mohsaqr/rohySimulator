import { useState } from 'react';
import {
    ArrowUpRight,
    Circle,
    Grid2x2,
    Hand,
    Keyboard,
    MapPin,
    MousePointer2,
    PenLine,
    RotateCcw,
    RotateCw,
    Ruler,
    Save,
    Shapes,
    Spline,
    Square,
    Sliders,
    Tag,
    Undo2,
    Redo2,
    Maximize,
    FlipHorizontal2,
    Camera,
    Download,
    Upload,
    Trash2,
} from 'lucide-react';
import { ANNOTATION_CLASSES, ANNOTATION_CLASS_KEYS, ANNOTATION_KINDS } from './annotationModel.js';
import { COUNTING_FRAME_AREAS_MM2, formatObjective } from './magnification.js';
import { ADJUSTMENT_CONTROLS, ADJUSTMENT_LABEL_KEYS, NEUTRAL_ADJUSTMENTS, isAdjusted } from './imageAdjustments.js';

/**
 * The instrument panel.
 *
 * WHY EVERY CONTROL IS A BUTTON WITH A VISIBLE KEY HINT: the input-device
 * study behind this work found that most pathologists want an alternative to
 * mouse click-and-drag and specifically asked for hotkeys. A hotkey nobody can
 * discover is not a hotkey, so each button carries its binding in the tooltip
 * and the full sheet is one press of "?" away.
 *
 * WHY THE UNREACHABLE MAGNIFICATIONS ARE DISABLED RATHER THAN CLAMPED: a 10x
 * archive cannot show 40x. Every commercial viewer will happily interpolate up
 * and present the blur as tissue; a teaching viewer must not, because a
 * trainee who believes they are at 40x will report mitotic figures the pixels
 * cannot support. The button is greyed and says why.
 */

const TOOLS = [
    { id: 'navigate', icon: Hand, labelKey: 'tool_navigate', label: 'Navigate', hint: 'V' },
    { id: 'select', icon: MousePointer2, labelKey: 'tool_select', label: 'Select & edit', hint: 'S' },
    { id: ANNOTATION_KINDS.LINE, icon: Ruler, labelKey: 'tool_measure', label: 'Measure a distance', hint: 'M' },
    { id: ANNOTATION_KINDS.ARROW, icon: ArrowUpRight, labelKey: 'tool_arrow', label: 'Arrow', hint: 'A' },
    { id: ANNOTATION_KINDS.RECTANGLE, icon: Square, labelKey: 'tool_rectangle', label: 'Rectangle', hint: 'R' },
    { id: ANNOTATION_KINDS.ELLIPSE, icon: Circle, labelKey: 'tool_ellipse', label: 'Ellipse', hint: 'E' },
    { id: ANNOTATION_KINDS.POLYGON, icon: Shapes, labelKey: 'tool_polygon', label: 'Polygon — click vertices, Enter to close', hint: 'P' },
    { id: ANNOTATION_KINDS.FREEHAND, icon: PenLine, labelKey: 'tool_freehand', label: 'Freehand outline (closed region)', hint: 'D' },
    { id: ANNOTATION_KINDS.POLYLINE, icon: Spline, labelKey: 'tool_polyline', label: 'Free-form path — measures along the curve', hint: 'F' },
    { id: ANNOTATION_KINDS.POINT, icon: MapPin, labelKey: 'tool_point', label: 'Drop a marker', hint: 'T' },
    { id: ANNOTATION_KINDS.COUNTING_FRAME, icon: Grid2x2, labelKey: 'tool_counting_frame', label: 'Counting frame', hint: 'C' },
];


const btn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 '
    + 'transition-colors hover:bg-slate-700/60 hover:text-slate-100 '
    + 'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent';
const btnOn = 'bg-fuchsia-500/20 text-fuchsia-200 ring-1 ring-fuchsia-500/40';
const group = 'flex items-center gap-0.5 rounded-xl bg-slate-900/70 p-1 ring-1 ring-slate-700/50';

export function ViewerToolbar({
    tool,
    onTool,
    activeClass,
    onClass,
    frameAreaMm2,
    onFrameArea,
    objective,
    presets = [],
    onObjective,
    onFit,
    onRotate,
    onFlip,
    onBookmark,
    adjustments,
    onAdjust,
    onSnapshot,
    onExport,
    onImport,
    onClear,
    onHelp,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    annotationCount = 0,
    t = (key, fallback) => fallback ?? key,
}) {
    const [openPanel, setOpenPanel] = useState(null);
    const toggle = (name) => setOpenPanel((current) => (current === name ? null : name));

    return (
        <div className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800/80 bg-slate-950/70 px-3 py-2">
            {/* --- tools ---------------------------------------------------- */}
            <div role="toolbar" aria-label={t('annotation_tools', 'Annotation tools')} className={group}>
                {TOOLS.map(({ id, icon: Icon, labelKey, label, hint }) => {
                    const name = t(labelKey, label);
                    return (
                    <button
                        key={id}
                        type="button"
                        aria-pressed={tool === id}
                        title={`${name}  (${hint})`}
                        onClick={() => onTool(id)}
                        className={`${btn} ${tool === id ? btnOn : ''}`}
                    >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">{name}</span>
                    </button>
                    );
                })}
            </div>

            {/* --- classification ------------------------------------------- */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => toggle('class')}
                    aria-expanded={openPanel === 'class'}
                    title={t('classification_title', 'What the next annotation is called')}
                    className="flex h-9 items-center gap-2 rounded-xl bg-slate-900/70 px-2.5 text-xs font-semibold text-slate-200 ring-1 ring-slate-700/50 hover:bg-slate-800/70"
                >
                    <Tag className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <span
                        className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-slate-950/50"
                        style={{ backgroundColor: activeClass?.color ?? '#F1F5F9' }}
                    />
                    {activeClass ? t(ANNOTATION_CLASS_KEYS[activeClass.name] ?? activeClass.name, activeClass.name) : t('unclassified', 'Unclassified')}
                </button>
                {openPanel === 'class' && (
                    <ul className="absolute left-0 top-10 w-52 rounded-xl border border-slate-700/60 bg-slate-900 p-1 shadow-xl shadow-black/40">
                        {[null, ...ANNOTATION_CLASSES].map((c) => (
                            <li key={c?.name ?? 'none'}>
                                <button
                                    type="button"
                                    onClick={() => { onClass(c); setOpenPanel(null); }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800"
                                >
                                    <span
                                        className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-slate-950/50"
                                        style={{ backgroundColor: c?.color ?? '#F1F5F9' }}
                                    />
                                    {c ? t(ANNOTATION_CLASS_KEYS[c.name] ?? c.name, c.name) : t('unclassified', 'Unclassified')}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* --- counting-frame size, only while that tool is chosen ------- */}
            {tool === ANNOTATION_KINDS.COUNTING_FRAME && (
                <div className={group} role="group" aria-label={t('counting_frame_area', 'Counting frame area')}>
                    {COUNTING_FRAME_AREAS_MM2.map((mm2) => (
                        <button
                            key={mm2}
                            type="button"
                            aria-pressed={frameAreaMm2 === mm2}
                            onClick={() => onFrameArea(mm2)}
                            title={t('counting_frame_place', `Place a ${mm2} mm² frame — WHO reports counts per mm², not per 10 HPF`, { area: mm2 })}
                            className={`h-7 rounded-lg px-2 text-[11px] font-semibold tabular-nums ${
                                frameAreaMm2 === mm2 ? btnOn : 'text-slate-300 hover:bg-slate-700/60'}`}
                        >
                            {mm2} mm²
                        </button>
                    ))}
                </div>
            )}

            {/* --- magnification -------------------------------------------- */}
            <div className={group} role="group" aria-label={t('magnification', 'Magnification')}>
                {presets.map(({ objective: power, reachable }) => (
                    <button
                        key={power}
                        type="button"
                        disabled={!reachable}
                        onClick={() => onObjective(power)}
                        title={reachable
                            ? t('objective_go_to', `Go to ${power}x`, { power })
                            : t('objective_unreachable', `${power}x is beyond this archive — it would be interpolated, not resolved`, { power })}
                        className={`h-7 rounded-lg px-2 text-[11px] font-semibold tabular-nums transition-colors ${
                            reachable ? 'text-slate-300 hover:bg-slate-700/60' : 'cursor-not-allowed text-slate-600'
                        } ${Math.abs((objective ?? 0) - power) < 0.05 ? btnOn : ''}`}
                    >
                        {power}x
                    </button>
                ))}
                <span className="ml-1 min-w-12 px-1 text-right text-[11px] font-semibold tabular-nums text-slate-400">
                    {formatObjective(objective)}
                </span>
            </div>

            {/* --- view ------------------------------------------------------ */}
            <div className={group} role="group" aria-label={t('view', 'View')}>
                <button type="button" className={btn} onClick={onFit} title={t('fit_slide_hint', 'Fit the whole slide  (0)')}>
                    <Maximize className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('fit', 'Fit')}</span>
                </button>
                <button type="button" className={btn} onClick={() => onRotate(-90)} title={t('rotate_left_hint', 'Rotate left  ([)')}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('rotate_left', 'Rotate left')}</span>
                </button>
                <button type="button" className={btn} onClick={() => onRotate(90)} title={t('rotate_right_hint', 'Rotate right  (])')}>
                    <RotateCw className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('rotate_right', 'Rotate right')}</span>
                </button>
                <button type="button" className={btn} onClick={onFlip} title={t('flip_hint', 'Flip horizontally  (H)')}>
                    <FlipHorizontal2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('flip', 'Flip')}</span>
                </button>
                <button type="button" className={btn} onClick={onBookmark} title={t('bookmark_hint', 'Bookmark this field  (B)')}>
                    <Save className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('bookmark', 'Bookmark')}</span>
                </button>
            </div>

            {/* --- image adjustments ----------------------------------------- */}
            <div className="relative">
                <button
                    type="button"
                    onClick={() => toggle('adjust')}
                    aria-expanded={openPanel === 'adjust'}
                    title={t('adjustments_title', 'Brightness, contrast, gamma')}
                    className={`${btn} h-9 w-9 rounded-xl bg-slate-900/70 ring-1 ring-slate-700/50 ${
                        isAdjusted(adjustments) ? btnOn : ''}`}
                >
                    <Sliders className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">{t('image_adjustments', 'Image adjustments')}</span>
                </button>
                {openPanel === 'adjust' && (
                    <div className="absolute left-0 top-11 w-64 space-y-3 rounded-xl border border-slate-700/60 bg-slate-900 p-3 shadow-xl shadow-black/40">
                        <p className="text-[11px] leading-snug text-slate-400">
                            {t('adjustments_note', 'Display only. These change what you see, never the measurements — those come from scanner metadata.')}
                        </p>
                        {ADJUSTMENT_CONTROLS.map(({ key, label, min, max, step }) => (
                            <label key={key} className="block text-[11px] font-semibold text-slate-300">
                                <span className="flex justify-between">
                                    {t(ADJUSTMENT_LABEL_KEYS[key] ?? key, label)}
                                    <span className="tabular-nums text-slate-500">{adjustments[key].toFixed(2)}</span>
                                </span>
                                <input
                                    type="range"
                                    min={min}
                                    max={max}
                                    step={step}
                                    value={adjustments[key]}
                                    onChange={(e) => onAdjust({ ...adjustments, [key]: Number(e.target.value) })}
                                    className="mt-1 w-full accent-fuchsia-400"
                                />
                            </label>
                        ))}
                        <button
                            type="button"
                            onClick={() => onAdjust(NEUTRAL_ADJUSTMENTS)}
                            className="w-full rounded-lg bg-slate-800 px-2 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
                        >
                            {t('adjustments_reset', 'Reset to the scanned image')}
                        </button>
                    </div>
                )}
            </div>

            {/* --- history and files ----------------------------------------- */}
            <div className={`${group} ml-auto`} role="group" aria-label={t('history_and_files', 'History and files')}>
                <button type="button" className={btn} disabled={!canUndo} onClick={onUndo} title={t('undo_hint', 'Undo  (Cmd/Ctrl+Z)')}>
                    <Undo2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('undo', 'Undo')}</span>
                </button>
                <button type="button" className={btn} disabled={!canRedo} onClick={onRedo} title={t('redo_hint', 'Redo  (Cmd/Ctrl+Shift+Z)')}>
                    <Redo2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('redo', 'Redo')}</span>
                </button>
                <span className="mx-1 h-5 w-px bg-slate-700/60" aria-hidden="true" />
                <button type="button" className={btn} onClick={onSnapshot} title={t('snapshot_hint', 'Save this field as a PNG, scale bar included')}>
                    <Camera className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('snapshot', 'Snapshot')}</span>
                </button>
                <button
                    type="button"
                    className={btn}
                    disabled={annotationCount === 0}
                    onClick={onExport}
                    title={t('export_hint', 'Export annotations as QuPath-readable GeoJSON')}
                >
                    <Download className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('export', 'Export')}</span>
                </button>
                <button type="button" className={btn} onClick={onImport} title={t('import_hint', 'Import a GeoJSON annotation file')}>
                    <Upload className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('import', 'Import')}</span>
                </button>
                <button
                    type="button"
                    className={btn}
                    disabled={annotationCount === 0}
                    onClick={onClear}
                    title={t('clear_hint', 'Delete every annotation on this slide (undoable)')}
                >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('clear', 'Clear')}</span>
                </button>
                <span className="mx-1 h-5 w-px bg-slate-700/60" aria-hidden="true" />
                <button type="button" className={btn} onClick={onHelp} title={t('shortcuts_hint', 'Keyboard shortcuts  (?)')}>
                    <Keyboard className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{t('shortcuts', 'Shortcuts')}</span>
                </button>
            </div>
        </div>
    );
}
