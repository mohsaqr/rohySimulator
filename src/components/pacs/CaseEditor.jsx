import { useCallback, useMemo, useRef, useState } from 'react';
import {
    ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Link2, Pencil, Plus,
    Repeat, RotateCcw, SlidersHorizontal, Trash2, TriangleAlert, Undo2, Unlink,
} from 'lucide-react';

import {
    SOURCE_KIND, SUBSTITUTION_SCOPE, caseCatalogue, documentIssues, emptyDocument,
    readDocument,
} from './caseDocument.js';
import {
    ACTION, addFinding, changeStudy, patchFinding, patchStudy, removeFinding,
    revertStudy, undoLabelFor, unwireBaseline, wireBaseline,
} from './caseActions.js';
import { defaultResolveRef, pictureOf, previewSeries, studyActions } from './caseView.js';
import { StudyInspector } from './StudyInspector.jsx';
import {
    LIBRARY, entriesForStudy, entryStats, libraryOf, pathologySources, readArchive,
} from './archive.js';
import { StudyLibrary, contentText } from './StudyLibrary.jsx';

/**
 * The case editor: the catalogue, minus what you changed.
 *
 * A case is NOT a worklist an author assembles. Every study in the catalogue is
 * orderable in the host, and unless the author says otherwise the learner who
 * orders one gets a real, complete, normal examination. So the editor opens on
 * the whole catalogue with everything already normal, and the author's entire
 * job is to say which studies are different for this patient — one, a few, or
 * all of them.
 *
 * That shape is the teaching claim. An editor that started empty and asked you
 * to add studies would quietly teach the opposite: that a case is the handful
 * of images someone chose to put in it, and that ordering anything else is
 * meaningless. It is exactly the assumption that lets a learner find the
 * abnormality by noticing which study exists.
 *
 * The stored document still holds ONLY what changed. A document that
 * enumerated 74 studies to say "normal" 73 times would grow every time the
 * catalogue did, and would freeze the case to the catalogue as it stood the day
 * it was written. `caseCatalogue()` does the join; `studyForOrder()` is the
 * matching rule a host must use so its server resolves an order the same way.
 *
 * Uncontrolled-with-seed: it seeds once from `initialCase` and owns the
 * document thereafter, reporting every change through `onChange`.
 */
export function CaseEditor({
    initialCase,
    onChange,
    archive: rawArchive,
    studyCatalogue = [],
    thumbnailFor = () => null,
    resolveRef = defaultResolveRef,
    // The same lazy loaders the reading room takes. With them the editor shows
    // the study; without them it says so plainly rather than showing a black
    // rectangle. Optional, so an existing host keeps working.
    loadSeriesIndex,
    loadInstance,
    eventLogger,
    t = (key, fallback) => fallback ?? key,
}) {
    /**
     * Loader identity, held steady.
     *
     * `useStudy` and `useThumbnails` take these as effect dependencies, and a
     * host that builds them inline — rohy's `authorProps(ctx, draft)` is
     * recomputed every render — would hand a fresh function identity on each
     * pass and refetch forever. Rather than rely on every host remembering, the
     * package holds them in refs and exposes stable callbacks.
     */
    const loaderRefs = useRef({ loadSeriesIndex, loadInstance });
    loaderRefs.current = { loadSeriesIndex, loadInstance };
    const stableIndex = useCallback(
        (...args) => loaderRefs.current.loadSeriesIndex?.(...args),
        [],
    );
    const stableInstance = useCallback(
        (...args) => loaderRefs.current.loadInstance?.(...args),
        [],
    );
    const canLoad = typeof loadSeriesIndex === 'function' && typeof loadInstance === 'function';
    const [doc, setDoc] = useState(() => (initialCase ? readDocument(initialCase) : emptyDocument()));
    /**
     * One level of undo, for the destructive actions only.
     *
     * It holds the document as it was BEFORE the change, and any subsequent
     * edit withdraws the offer. That is deliberate: restoring a snapshot taken
     * before three further edits would silently discard those edits, which is a
     * worse outcome than not offering undo at all. The offer is transient and
     * says so by disappearing.
     */
    const [undo, setUndo] = useState(null);
    const [open, setOpen] = useState(null);        // the opened studyId
    const [editing, setEditing] = useState(null);  // studyId whose order details are expanded
    const [picker, setPicker] = useState(null);    // { studyId, mode } while the library is choosing
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');   // all | changed | backed | unbacked

    const archive = useMemo(() => readArchive(rawArchive ?? { entries: [] }), [rawArchive]);
    const issues = useMemo(() => documentIssues(doc, { archive }), [doc, archive]);
    const rows = useMemo(
        () => caseCatalogue(doc, { archive, catalogue: studyCatalogue }),
        [doc, archive, studyCatalogue],
    );

    /**
     * Worklist entries the catalogue does not account for.
     *
     * A document written against an older catalogue, or by hand, can name a
     * study that is no longer listed. Rendering only `rows` would hide those
     * entries while still saving them — the author would see a case that looks
     * normal throughout and ship one that is not. They are shown separately and
     * named as such.
     */
    const unlisted = useMemo(() => {
        const known = new Set(studyCatalogue.map((s) => s.id));
        return readDocument(doc).worklist.filter((e) => !e.studyId || !known.has(e.studyId));
    }, [doc, studyCatalogue]);

    /**
     * @param next the new document
     * @param label a `{key, fallback}` from `undoLabelFor`, or null when the
     *   change lost nothing and undo would be noise
     */
    const update = useCallback((next, label = null) => {
        setUndo(label ? { label, doc } : null);
        setDoc(next);
        onChange?.(next);
    }, [doc, onChange]);

    /**
     * Every verb, in one place, driven by the same action ids `studyActions()`
     * returns — so a control on a card and the same control in an opened study
     * cannot drift apart.
     */
    const run = useCallback((action, row) => {
        const seed = { studyId: row.studyId, name: row.name, normalEntry: row.normalEntry };
        switch (action) {
            case ACTION.OPEN:
                setOpen(row.studyId);
                break;
            case ACTION.CHANGE:
                update(changeStudy(doc, seed));
                setOpen(row.studyId);
                break;
            case ACTION.REPLACE:
            case ACTION.WIRE:
                // The library decides; nothing is written until it does.
                setPicker({ studyId: row.studyId, mode: action });
                break;
            case ACTION.ADD_FINDING:
                update(addFinding(changeStudy(doc, seed), row.studyId, {
                    baselineEntry: row.wiredEntry ?? row.normalEntry,
                }));
                setOpen(row.studyId);
                break;
            case ACTION.EDIT:
                setOpen(row.studyId);
                setEditing(row.studyId);
                break;
            case ACTION.REMOVE_IMAGING:
                update(unwireBaseline(doc, row.studyId), undoLabelFor(ACTION.REMOVE_IMAGING));
                break;
            case ACTION.REVERT:
                update(revertStudy(doc, row.studyId), undoLabelFor(ACTION.REVERT, { name: row.name }));
                if (open === row.studyId) setOpen(null);
                break;
            default:
                break;
        }
    }, [doc, update, open]);

    /** The library chose. Materialises the entry when the case was silent. */
    const chooseImaging = useCallback((row, chosen) => {
        // Undo is offered either way. Wiring imaging onto an untouched study
        // is not a smaller change than replacing it — it is the moment the case
        // starts saying something about that study at all.
        update(
            wireBaseline(doc, row.studyId, chosen.id, { name: row.name, normalEntry: row.normalEntry }),
            row.wiredEntryId
                ? undoLabelFor(ACTION.REPLACE)
                : undoLabelFor(ACTION.REVERT, { name: row.name }),
        );
        setPicker(null);
        setOpen(row.studyId);
    }, [doc, update]);

    const counts = {
        all: rows.length,
        changed: rows.filter((r) => r.state === 'changed').length,
        backed: rows.filter((r) => r.backed).length,
        unbacked: rows.filter((r) => !r.backed).length,
    };

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return rows.filter((row) => {
            if (filter === 'changed' && row.state !== 'changed') return false;
            if (filter === 'backed' && !row.backed) return false;
            if (filter === 'unbacked' && row.backed) return false;
            if (!q) return true;
            return `${row.name} ${row.studyId} ${row.modality ?? ''} ${row.bodyRegion ?? ''}`
                .toLowerCase().includes(q);
        });
    }, [rows, filter, query]);

    const openRow = open ? rows.find((r) => r.studyId === open) : null;

    return (
        <div className={`flex flex-col gap-3 p-4 mx-auto text-slate-100 ${
            // An open study is a workstation and wants the room; the grid reads
            // better at a fixed measure.
            openRow ? 'max-w-none w-full' : 'max-w-5xl'}`}>
            <header className="flex items-start gap-3">
                {openRow ? (
                    <>
                        <button
                            type="button"
                            onClick={() => setOpen(null)}
                            className="mt-0.5 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 flex-shrink-0"
                        >
                            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                            {t('radoyon_author_all_studies', 'All studies')}
                        </button>
                        <div className="min-w-0">
                            <h2 className="text-lg font-semibold truncate">{openRow.name}</h2>
                            <p className="text-sm text-slate-400 font-mono">
                                {openRow.modality ?? '—'}{openRow.bodyRegion ? ` · ${openRow.bodyRegion}` : ''}
                            </p>
                        </div>
                        {/*
                          * The same verbs as the card. An action available in
                          * only one of the two places is an action that will be
                          * reported as missing from the other.
                          */}
                        <div className="ml-auto flex-shrink-0 flex flex-wrap gap-1 justify-end">
                            {studyActions(openRow)
                                .filter((a) => a !== ACTION.OPEN)
                                .map((a) => (
                                    <TextButton
                                        key={a}
                                        danger={a === ACTION.REVERT || a === ACTION.REMOVE_IMAGING}
                                        onClick={() => run(a, openRow)}
                                        title={ACTION_LABEL[a]?.hint}
                                    >
                                        {t(ACTION_LABEL[a]?.key, ACTION_LABEL[a]?.fallback ?? a)}
                                    </TextButton>
                                ))}
                        </div>
                    </>
                ) : (
                    <div>
                        <h2 className="text-lg font-semibold">{t('radoyon_author_title', 'Imaging')}</h2>
                        <p className="text-sm text-slate-400">
                            {t('radoyon_author_intro',
                                'Every study in the catalogue is normal for this patient unless you change it. A learner can order any of them.')}
                        </p>
                    </div>
                )}
            </header>

            {undo && (
                <div className="flex items-center gap-3 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
                    <Undo2 className="w-4 h-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
                    <span className="text-slate-300 mr-auto">{t(undo.label.key, undo.label.fallback)}</span>
                    <button
                        type="button"
                        onClick={() => { setDoc(undo.doc); onChange?.(undo.doc); setUndo(null); }}
                        className="text-xs rounded px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-100"
                    >
                        {t('radoyon_author_undo', 'Undo')}
                    </button>
                    <button type="button" onClick={() => setUndo(null)} className="text-xs text-slate-500 hover:text-slate-300">
                        {t('radoyon_dismiss', 'Dismiss')}
                    </button>
                </div>
            )}

            <IssueList issues={issues.filter((i) => !i.entryId)} t={t} />

            {openRow ? (
                <>
                {/*
                  * The imaging first, at size, in the SAME viewer the learner
                  * reads it with. A thumbnail is not inspection: an author
                  * deciding whether this is the right study has to be able to
                  * scroll it, window it and see its geometry.
                  */}
                <StudyInspector
                    series={previewSeries(openRow, { archive, resolveRef })}
                    loadSeriesIndex={canLoad ? stableIndex : undefined}
                    loadInstance={canLoad ? stableInstance : undefined}
                    badgeFor={(sx) => (sx.origin === 'baseline' ? null : sx.origin)}
                    eventLogger={eventLogger}
                    t={t}
                />
                {openRow.state === 'changed' ? (
                    <ChangedStudy
                        row={openRow}
                        archive={archive}
                        onPatch={(patch, label) => update(patchStudy(doc, openRow.studyId, patch), label)}
                        onFindingPatch={(subId, patch) => update(patchFinding(doc, openRow.studyId, subId, patch))}
                        onFindingRemove={(subId) => update(
                            removeFinding(doc, openRow.studyId, subId),
                            undoLabelFor('removeFinding'),
                        )}
                        onAction={(a) => run(a, openRow)}
                        onChooseImaging={(chosen) => chooseImaging(openRow, chosen)}
                        editing={editing === openRow.studyId}
                        resolveRef={resolveRef}
                        issues={issues.filter((i) => i.entryId === openRow.entry.id)}
                        thumbnailFor={thumbnailFor}
                        catalogue={studyCatalogue}
                        t={t}
                    />
                ) : (
                    <NormalStudy row={openRow} t={t} />
                )}
                </>
            ) : (
            <>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Chip active={filter === 'all'} onClick={() => setFilter('all')}
                    label={t('radoyon_author_filter_all', 'All')} count={counts.all} />
                <Chip active={filter === 'changed'} onClick={() => setFilter('changed')}
                    label={t('radoyon_author_filter_changed', 'Changed')} count={counts.changed} tone="cyan" />
                <Chip active={filter === 'backed'} onClick={() => setFilter('backed')}
                    label={t('radoyon_author_filter_backed', 'With imaging')} count={counts.backed} />
                <Chip active={filter === 'unbacked'} onClick={() => setFilter('unbacked')}
                    label={t('radoyon_author_filter_unbacked', 'No imaging yet')} count={counts.unbacked} />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('radoyon_author_search', 'Search the catalogue…')}
                    aria-label={t('radoyon_author_search', 'Search the catalogue')}
                    className="ml-auto w-56 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:border-cyan-500 outline-none"
                />
            </div>

            {/*
              * A grid of cards, not a list of rows. 74 studies is a lot to
              * read as text, and the one thing that tells an author what a
              * study IS at a glance is the picture — so the picture is the
              * card, and the state rides on it.
              */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {visible.length === 0 && (
                    <p className="col-span-full text-sm text-slate-500 border border-dashed border-slate-700 rounded p-6 text-center">
                        {t('radoyon_author_none_match', 'No study in the catalogue matches.')}
                    </p>
                )}
                {visible.map((row) => (
                    <StudyCard
                        key={row.studyId}
                        row={row}
                        thumbnailFor={thumbnailFor}
                        resolveRef={resolveRef}
                        errors={issues.filter((i) => row.entry && i.entryId === row.entry.id && i.level === 'error').length}
                        onAction={(action) => run(action, row)}
                        t={t}
                    />
                ))}
            </div>
            </>
            )}

            {picker && (
                <ImagingPicker
                    row={rows.find((r) => r.studyId === picker.studyId)}
                    mode={picker.mode}
                    archive={archive}
                    catalogue={studyCatalogue}
                    thumbnailFor={thumbnailFor}
                    resolveRef={resolveRef}
                    onChoose={(chosen) => chooseImaging(rows.find((r) => r.studyId === picker.studyId), chosen)}
                    onCancel={() => setPicker(null)}
                    t={t}
                />
            )}

            {unlisted.length > 0 && (
                <section className="border border-amber-900/60 rounded-lg bg-amber-950/20 p-3">
                    <h3 className="text-sm font-medium text-amber-300 flex items-center gap-1.5">
                        <TriangleAlert className="w-4 h-4" aria-hidden="true" />
                        {t('radoyon_author_unlisted', 'Not in the catalogue')}
                    </h3>
                    <p className="text-xs text-amber-400/80 mt-1">
                        {t('radoyon_author_unlisted_hint',
                            'This case changes studies the catalogue no longer lists. They are still saved and still served — link each to an order, or remove it.')}
                    </p>
                    <ul className="mt-2 flex flex-col gap-1">
                        {unlisted.map((entry) => (
                            <li key={entry.id} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-slate-400">{entry.studyId ?? '—'}</span>
                                <span className="text-slate-300 mr-auto">{entry.description || entry.id}</span>
                                <button
                                    type="button"
                                    onClick={() => update(
                                        { ...doc, worklist: doc.worklist.filter((e) => e.id !== entry.id) },
                                        t('radoyon_author_undo_removed_study', 'Study removed, with its findings and report.'),
                                    )}
                                    className="text-slate-500 hover:text-red-400"
                                >
                                    {t('radoyon_author_remove', 'Remove')}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}

function Chip({ active, onClick, label, count, tone = 'slate' }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`rounded-md px-2.5 py-1 border ${
                active
                    ? (tone === 'cyan'
                        ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                        : 'border-slate-500 bg-slate-800 text-slate-100')
                    : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
        >
            {label} <span className="opacity-60 font-mono">{count}</span>
        </button>
    );
}

/**
 * Every verb, with its icon and its words, in one table.
 *
 * The card and the opened study read the same table, so a control cannot appear
 * in one place and be missing from the other — which is exactly how the last
 * three rounds of this editor went wrong.
 */
const ACTION_LABEL = {
    [ACTION.CHANGE]: {
        icon: Pencil, key: 'radoyon_action_change', fallback: 'Change',
        hint: 'Start saying something different about this study for this patient.',
    },
    [ACTION.REPLACE]: {
        icon: Repeat, key: 'radoyon_action_replace', fallback: 'Replace imaging',
        hint: 'Point this study at different imaging, keeping the findings and the report.',
    },
    [ACTION.WIRE]: {
        icon: Link2, key: 'radoyon_action_wire', fallback: 'Wire imaging',
        hint: 'Choose the imaging a learner opens for this study.',
    },
    [ACTION.ADD_FINDING]: {
        icon: Plus, key: 'radoyon_action_add_finding', fallback: 'Add finding',
        hint: 'Splice pathology into this study.',
    },
    [ACTION.EDIT]: {
        icon: SlidersHorizontal, key: 'radoyon_action_edit', fallback: 'Details',
        hint: 'Accession, availability and the worklist description.',
    },
    [ACTION.REMOVE_IMAGING]: {
        icon: Unlink, key: 'radoyon_action_remove_imaging', fallback: 'Remove imaging',
        hint: 'Unwire the images. The findings and the report are kept.',
    },
    [ACTION.REVERT]: {
        icon: RotateCcw, key: 'radoyon_action_revert', fallback: 'Back to normal',
        hint: 'Discard the changes. The learner gets the archive’s normal study again.',
    },
};

/**
 * One catalogue study, as a card.
 *
 * The picture is the card. Reading 74 study names as text tells an author very
 * little; the thumbnail of the actual imaging tells them what it is at a
 * glance, and the state rides on top of it rather than in a column beside it.
 *
 * Every action is VISIBLE, not revealed on hover. An affordance that only
 * appears under the pointer is indistinguishable from one that is not there,
 * and "the buttons I asked for are missing" is the report that follows.
 *
 * A study with no imaging still gets a card. It is orderable in the host — a
 * learner CAN ask for it and get nothing — and hiding it would put the gap in
 * the one place nobody could act on it.
 */
function StudyCard({ row, thumbnailFor, resolveRef, errors, onAction, t }) {
    // A changed study is pictured by the imaging it is WIRED to, not by the
    // normal example it started from.
    const source = pictureOf(row);
    const first = source?.series?.[0];
    const thumb = first?.ref ? thumbnailFor(resolveRef(first.ref)) : null;
    const changed = row.state === 'changed';
    const actions = studyActions(row).filter((a) => a !== ACTION.OPEN);

    return (
        <div
            className={`flex flex-col rounded-lg border overflow-hidden transition-colors ${
                errors > 0 ? 'border-red-800'
                    : changed ? 'border-cyan-700'
                        : row.backed ? 'border-slate-800' : 'border-dashed border-slate-800'}`}
        >
            <button
                type="button"
                onClick={() => onAction(ACTION.OPEN)}
                title={t('radoyon_author_open', 'Open this study')}
                className="text-left"
            >
                <div className="aspect-4/3 bg-black flex items-center justify-center relative">
                    {thumb
                        ? <img src={thumb} alt="" className="w-full h-full object-contain" draggable={false} />
                        : (
                            <span className="text-[10px] font-mono text-slate-700 px-2 text-center">
                                {row.backed
                                    ? (row.modality ?? 'DICOM')
                                    : t('radoyon_author_no_imaging', 'no imaging yet')}
                            </span>
                        )}
                    {changed && (
                        <span className="absolute top-1 right-1 text-[9px] bg-cyan-600 text-white rounded px-1.5 py-0.5 font-medium">
                            {t('radoyon_author_changed', 'Changed')}
                        </span>
                    )}
                    {errors > 0 && (
                        <span className="absolute top-1 left-1 flex items-center gap-0.5 text-[9px] bg-red-700 text-white rounded px-1 py-0.5">
                            <CircleAlert className="w-2.5 h-2.5" aria-hidden="true" />
                            {errors}
                        </span>
                    )}
                </div>
                <div className="px-2 pt-2 bg-slate-950">
                    <div className="text-xs text-slate-200 leading-tight line-clamp-2 min-h-8" title={row.name}>
                        {row.name}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                        {row.modality ?? '—'}{row.bodyRegion ? ` · ${row.bodyRegion}` : ''}
                    </div>
                    <div className={`text-[10px] font-mono mt-0.5 ${
                        changed ? 'text-cyan-400' : row.backed ? 'text-slate-600' : 'text-slate-700'}`}>
                        {changed
                            ? (row.findingCount > 0
                                ? `${row.findingCount} ${row.findingCount === 1
                                    ? t('radoyon_finding_one', 'finding')
                                    : t('radoyon_finding_many', 'findings')}`
                                : t('radoyon_author_changed_imaging', 'imaging changed'))
                            : row.backed
                                ? t('radoyon_author_normal', 'normal')
                                : t('radoyon_author_not_backed', 'not backed')}
                    </div>
                </div>
            </button>

            <div className="mt-auto flex items-center gap-0.5 px-1.5 py-1.5 bg-slate-950 border-t border-slate-900">
                {actions.map((a) => {
                    const label = ACTION_LABEL[a];
                    const Icon = label.icon;
                    const danger = a === ACTION.REVERT || a === ACTION.REMOVE_IMAGING;
                    return (
                        <button
                            key={a}
                            type="button"
                            onClick={() => onAction(a)}
                            aria-label={`${t(label.key, label.fallback)} — ${row.name}`}
                            title={`${t(label.key, label.fallback)}. ${label.hint}`}
                            className={`p-1.5 rounded ${
                                danger
                                    ? 'text-slate-500 hover:text-red-400 hover:bg-slate-800'
                                    : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-800'}`}
                        >
                            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * The library, over the editor, choosing imaging for one named study.
 *
 * A sheet rather than a popover: it is a grid of up to eighty cards and needs
 * the room. It opens on the ABNORMAL tab when replacing — an author changing a
 * study is usually reaching for pathology — but the normal library is one click
 * away, because "change this CT for a different normal CT" is a real move.
 */
function ImagingPicker({ row, mode, archive, catalogue, thumbnailFor, resolveRef, onChoose, onCancel, t }) {
    if (!row) return null;
    return (
        <div className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
            <div className="w-full max-w-5xl">
                <div className="flex items-baseline gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-slate-100">
                        {mode === ACTION.REPLACE
                            ? t('radoyon_picker_replace', 'Replace the imaging for')
                            : t('radoyon_picker_wire', 'Wire imaging into')}
                    </h3>
                    <span className="text-sm text-cyan-300">{row.name}</span>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="ml-auto text-xs text-slate-400 hover:text-slate-200"
                    >
                        {t('radoyon_cancel', 'Cancel')}
                    </button>
                </div>
                <StudyLibrary
                    archive={archive}
                    catalogue={catalogue}
                    selected={row.wiredEntryId}
                    library={LIBRARY.ABNORMAL}
                    preferStudyId={row.studyId}
                    thumbnailFor={thumbnailFor}
                    resolveRef={resolveRef}
                    onChoose={onChoose}
                    onCancel={onCancel}
                    title={t('radoyon_picker_title', 'Choose the imaging')}
                    t={t}
                />
            </div>
        </div>
    );
}

/**
 * The line under the viewer for an untouched study.
 *
 * It used to BE the whole view — one sentence and a 96 px tile, with no way to
 * look at the study it was describing. The pixels are above it now; this only
 * has to say what the case is claiming.
 */
function NormalStudy({ row, t }) {
    return (
        <p className={`text-sm px-1 ${row.normalEntry ? 'text-slate-400' : 'text-amber-400/90'}`}>
            {row.normalEntry
                ? t('radoyon_author_is_normal_short',
                    `Normal for this patient. A learner who orders it gets this study, complete — ${row.normalEntry.label}.`)
                : t('radoyon_author_no_normal',
                    'Orderable, but the archive has no example of this study yet — a learner who orders it gets the catalogue’s written normal and no images.')}
        </p>
    );
}

function IconButton({ label, onClick, children, disabled = false, danger = false, active = false }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            aria-pressed={active || undefined}
            className={`p-1.5 rounded flex-shrink-0 disabled:opacity-25 disabled:cursor-default ${
                active ? 'text-cyan-300 bg-slate-700'
                    : danger ? 'text-slate-400 hover:text-red-400 hover:bg-slate-700'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700'}`}
        >
            {children}
        </button>
    );
}

function TextButton({ onClick, children, danger = false, title }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={`text-xs rounded-md border px-2 py-1 ${
                danger
                    ? 'border-slate-800 text-slate-500 hover:text-red-400 hover:border-red-900'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
        >
            {children}
        </button>
    );
}

/** One numbered step of the flow. */
function Step({ n, title, hint, action, last = false, children }) {
    return (
        <div className={`px-3 py-3 ${last ? '' : 'border-b border-slate-800/70'}`}>
            <div className="flex items-start gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-px">
                    {n}
                </span>
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-slate-200">{title}</h3>
                    {hint && <p className="text-[11px] text-slate-500 leading-snug">{hint}</p>}
                </div>
                {action}
            </div>
            <div className="pl-7">{children}</div>
        </div>
    );
}

/**
 * The study currently wired into a case entry — shown instead of the library
 * once one is chosen, so the editor states what IS rather than asking again.
 */
function CurrentStudy({ entry, thumbnailFor, resolveRef = (r) => r, t }) {
    const first = entry.series?.[0];
    const thumb = first?.ref ? thumbnailFor(resolveRef(first.ref)) : null;
    const abnormal = libraryOf(entry) === LIBRARY.ABNORMAL;
    const confirmed = entry.review?.state === 'confirmed';
    const { series, instances } = entryStats(entry);
    return (
        <div className="flex gap-3 items-start">
            <div className="w-24 aspect-4/3 bg-black rounded shrink-0 flex items-center justify-center overflow-hidden">
                {thumb
                    ? <img src={thumb} alt="" className="w-full h-full object-contain" />
                    : <span className="text-[10px] text-slate-700">{entry.modality ?? '…'}</span>}
            </div>
            <div className="min-w-0 text-xs">
                <div className="text-slate-200">{entry.label}</div>
                <div className="text-[11px] text-slate-500 font-mono truncate">{entry.id}</div>
                <div className="text-[11px] text-slate-500 font-mono">
                    {entry.modality ?? '—'}{entry.bodyRegion ? ` · ${entry.bodyRegion}` : ''}
                    {' · '}{contentText(series, instances, t)}
                </div>
                {abnormal && (
                    // A case built on an abnormal baseline is legitimate, but the
                    // author should never discover it by opening the study.
                    <div className={`text-[11px] mt-1 ${confirmed ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {confirmed
                            ? `${t('radoyon_review_confirmed', 'Confirmed')} — ${entry.review.finding ?? ''}`
                            : t('radoyon_baseline_abnormal', 'From the abnormal library — findings not read')}
                    </div>
                )}
            </div>
        </div>
    );
}


/**
 * The authoring panel for a study the case says something about.
 *
 * It sits UNDER the inspector, so it never has to picture the imaging — the
 * pixels are already on screen at size. What it owns is the writing: the order
 * details, the findings spliced in, and the report.
 */
function ChangedStudy({
    row, archive, onPatch, onFindingPatch, onFindingRemove, onChooseImaging, onAction,
    editing, issues, thumbnailFor, resolveRef, catalogue, t,
}) {
    // Narrows the library to other examples of this same catalogue order —
    // which is all "update" ever meant. A filter, not a second verb.
    const [sameOrderOnly, setSameOrderOnly] = useState(false);
    const entry = row.entry;
    const sources = pathologySources(archive);
    const baselineEntry = archive.entries.find((e) => e.id === entry.baseline.ref);
    const alternatives = entry.studyId
        ? entriesForStudy(archive, entry.studyId).filter((e) => e.id !== entry.baseline.ref)
        : [];

    return (
        <div className="border border-slate-800 rounded-lg bg-slate-900/40 overflow-hidden">
            {editing && (
                <div className="grid gap-3 md:grid-cols-3 px-3 py-3 border-b border-slate-800/70 bg-slate-950/40">
                    <Field label={t('radoyon_author_description', 'Worklist description')}>
                        <input
                            value={entry.description}
                            onChange={(e) => onPatch({ description: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm focus:border-cyan-500 outline-none"
                        />
                    </Field>
                    <Field
                        label={t('radoyon_author_accession', 'Accession number')}
                        hint={t('radoyon_author_accession_hint', 'The host generates one when this is blank.')}
                    >
                        <input
                            value={entry.accession ?? ''}
                            onChange={(e) => onPatch({ accession: e.target.value || null })}
                            placeholder={t('radoyon_author_generated', 'generated')}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono focus:border-cyan-500 outline-none"
                        />
                    </Field>
                    <Field
                        label={t('radoyon_author_available_at', 'Available after (minutes)')}
                        hint={t('radoyon_author_available_at_hint', 'Blank uses the order’s own turnaround.')}
                    >
                        <input
                            type="number"
                            min="0"
                            value={entry.availableAtMinutes ?? ''}
                            onChange={(e) => onPatch({
                                // '' must stay null. Number('') is 0, which would
                                // silently turn "use the order's turnaround" into
                                // "available immediately".
                                availableAtMinutes: e.target.value === '' ? null : e.target.valueAsNumber,
                            })}
                            placeholder={t('radoyon_author_order_default', 'order default')}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono focus:border-cyan-500 outline-none"
                        />
                    </Field>
                </div>
            )}

            <Step
                n={1}
                title={t('radoyon_author_baseline', 'The imaging')}
                hint={t('radoyon_author_baseline_hint', 'What the learner opens. Everything you do not change stays as this study is.')}
                action={alternatives.length > 0 ? (
                    <TextButton
                        onClick={() => setSameOrderOnly((v) => !v)}
                        title={t('radoyon_author_same_order_hint', 'Show only the archive’s other examples of this same order.')}
                    >
                        <Repeat className="w-3 h-3 inline-block mr-1 -mt-px" aria-hidden="true" />
                        {sameOrderOnly
                            ? t('radoyon_author_show_all', 'Show the whole library')
                            : `${t('radoyon_author_same_order', 'Same order')} (${alternatives.length})`}
                    </TextButton>
                ) : null}
            >
                {baselineEntry && (
                    <div className="mb-3">
                        <CurrentStudy entry={baselineEntry} thumbnailFor={thumbnailFor} resolveRef={resolveRef} t={t} />
                    </div>
                )}

                {/*
                  * The library is on screen, not behind a button. An author
                  * changing a study is choosing imaging by definition, and a
                  * picker that has to be opened first makes the point of the
                  * screen the hidden part of it.
                  */}
                <StudyLibrary
                    archive={archive}
                    catalogue={catalogue}
                    selected={entry.baseline.kind === SOURCE_KIND.ARCHIVE ? entry.baseline.ref : null}
                    library={sameOrderOnly && baselineEntry ? libraryOf(baselineEntry) : LIBRARY.ABNORMAL}
                    preferStudyId={entry.studyId}
                    onlyStudyId={sameOrderOnly ? entry.studyId : null}
                    onClearScope={sameOrderOnly ? () => setSameOrderOnly(false) : null}
                    thumbnailFor={thumbnailFor}
                    resolveRef={resolveRef}
                    onChoose={onChooseImaging}
                    title={t('radoyon_author_change_to', 'Change the imaging to…')}
                    t={t}
                />
            </Step>

            <Step
                n={2}
                title={t('radoyon_author_substitutions', 'What is different about this patient')}
                hint={t('radoyon_author_all_normal', 'Nothing here means the learner reads the study above as it is — which is also a case.')}
                action={(
                    <button
                        type="button"
                        disabled={!baselineEntry}
                        onClick={() => onAction(ACTION.ADD_FINDING)}
                        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-default"
                        title={baselineEntry ? undefined : t('radoyon_author_need_baseline', 'Wire imaging first.')}
                    >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('radoyon_author_add_finding', 'Add finding')}
                    </button>
                )}
            >
                <div className="flex flex-col gap-2">
                    {entry.substitutions.map((sub) => (
                        <SubstitutionEditor
                            key={sub.id}
                            sub={sub}
                            baselineEntry={baselineEntry}
                            sources={sources}
                            onPatch={(patch) => onFindingPatch(sub.id, patch)}
                            onRemove={() => onFindingRemove(sub.id)}
                            t={t}
                        />
                    ))}
                </div>
            </Step>

            <Step n={3} title={t('radoyon_author_report', 'The report')} last>
                <div className="grid gap-3 md:grid-cols-2">
                    <Field label={t('radoyon_author_findings', 'Findings')}>
                        <textarea
                            rows={3}
                            value={entry.report.findings}
                            onChange={(e) => onPatch({ report: { ...entry.report, findings: e.target.value } })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono focus:border-cyan-500 outline-none"
                        />
                    </Field>
                    <Field label={t('radoyon_author_impression', 'Impression')}>
                        <textarea
                            rows={3}
                            value={entry.report.impression}
                            onChange={(e) => onPatch({ report: { ...entry.report, impression: e.target.value } })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono focus:border-cyan-500 outline-none"
                        />
                    </Field>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300 mt-2">
                    <input
                        type="checkbox"
                        checked={entry.report.released}
                        onChange={(e) => onPatch({ report: { ...entry.report, released: e.target.checked } })}
                        className="accent-cyan-500"
                    />
                    {t('radoyon_author_release_report', 'Release the report to the learner')}
                    <span className="text-xs text-slate-500">
                        {t('radoyon_author_release_hint', 'Withhold it to make them read the images first.')}
                    </span>
                </label>
            </Step>

            <IssueList issues={issues} t={t} className="px-3 pb-3" />
        </div>
    );
}

/**
 * One finding. Its source is PICKED from the archive's pathology material —
 * the pick fills the reference and the declared geometry in one gesture, so
 * the splice-compatibility validation has real numbers to check. A custom
 * remote reference stays available behind "advanced", for material that lives
 * outside the archive.
 */
function SubstitutionEditor({ sub, baselineEntry, sources, onPatch, onRemove, t }) {
    const isRange = sub.scope === SUBSTITUTION_SCOPE.RANGE;
    const sourceOptions = sources.flatMap((entry) => entry.series.map((series) => ({
        id: `${entry.id}:${series.key}`,
        label: `${entry.label || entry.id}`,
        // The series description matters only when an entry offers several
        // series to choose between; repeating it after a single-series entry's
        // label just says the same thing twice.
        detail: entry.series.length > 1 ? series.description : null,
        ref: series.ref,
        // What is actually KNOWN about this source's findings, so an author
        // choosing pathology is never guessing whether "abnormal" means someone
        // read it or merely that it came from a cohort with that disease.
        review: entry.review,
        geometry: series.geometry
            ? { ...series.geometry, instances: series.instances, plane: series.plane ?? series.geometry.plane }
            : null,
    })));
    const picked = sourceOptions.find((o) => o.ref === sub.source.ref);
    const isCustom = Boolean(sub.source.ref) && !picked;
    const review = picked?.review;
    const [advanced, setAdvanced] = useState(isCustom);

    // Orphaned by a baseline replacement: this finding names a series the new
    // imaging does not have, so it would never be spliced in. The picker is
    // shown even on a single-series baseline, where it is normally redundant,
    // because otherwise the error documentIssues reports has nowhere to be
    // fixed — a dead end is worse than a redundant control.
    const orphaned = Boolean(baselineEntry) && sub.targetSeriesKey !== null
        && !baselineEntry.series.some((s) => s.key === sub.targetSeriesKey);

    return (
        <div className={`border rounded bg-slate-950/60 p-2.5 ${
            orphaned ? 'border-red-800' : 'border-slate-800'}`}>
            <div className="grid gap-2 md:grid-cols-[1fr_1.4fr_auto] items-start">
                <Field label={t('radoyon_author_finding_label', 'Finding')}>
                    <input
                        value={sub.label}
                        onChange={(e) => onPatch({ label: e.target.value })}
                        placeholder={t('radoyon_author_finding_ph', 'e.g. Right upper lobe nodule')}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm focus:border-cyan-500 outline-none"
                    />
                </Field>

                <Field label={t('radoyon_author_source', 'Pathology material')}>
                    <select
                        value={picked?.id ?? ''}
                        onChange={(e) => {
                            const option = sourceOptions.find((o) => o.id === e.target.value);
                            if (!option) { onPatch({ source: { kind: SOURCE_KIND.NONE, ref: null }, geometry: null }); return; }
                            // One pick fills reference, geometry AND a default
                            // label — the author corrects, never assembles.
                            onPatch({
                                source: { kind: SOURCE_KIND.REMOTE, ref: option.ref },
                                geometry: option.geometry,
                                ...(sub.label ? {} : { label: option.label }),
                            });
                        }}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm focus:border-cyan-500 outline-none"
                    >
                        <option value="">{t('radoyon_author_choose_source', 'Choose from the archive…')}</option>
                        {sourceOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.detail ? `${o.label} — ${o.detail}` : o.label}</option>
                        ))}
                    </select>
                    {sourceOptions.length === 0 && !advanced && (
                        <span className="block text-[11px] text-slate-500 mt-1">
                            {t('radoyon_author_no_sources', 'No pathology material in the archive yet — derive some (scripts/make-lesion.mjs) or use an advanced reference.')}
                        </span>
                    )}
                </Field>

                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={t('radoyon_author_remove_finding', 'Remove finding')}
                    className="p-1.5 mt-5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700 justify-self-end"
                >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                {((baselineEntry?.series?.length ?? 0) > 1 || orphaned) && (
                    <label className={`flex items-center gap-1.5 ${orphaned ? 'text-red-400' : 'text-slate-400'}`}>
                        {t('radoyon_author_target', 'Replaces series')}
                        <select
                            value={orphaned ? '' : (sub.targetSeriesKey ?? '')}
                            onChange={(e) => onPatch({ targetSeriesKey: e.target.value || null })}
                            className={`bg-slate-950 border rounded px-1.5 py-1 ${
                                orphaned ? 'border-red-700 text-red-300' : 'border-slate-700'}`}
                        >
                            {orphaned && (
                                <option value="">
                                    {t('radoyon_author_orphaned', `“${sub.targetSeriesKey}” — not in this study`)}
                                </option>
                            )}
                            {(baselineEntry?.series ?? []).map((s) => (
                                <option key={s.key} value={s.key}>{s.description || s.key}</option>
                            ))}
                        </select>
                    </label>
                )}

                <label className="flex items-center gap-1.5 text-slate-400">
                    <input
                        type="checkbox"
                        checked={isRange}
                        onChange={(e) => onPatch({
                            scope: e.target.checked ? SUBSTITUTION_SCOPE.RANGE : SUBSTITUTION_SCOPE.SERIES,
                            range: e.target.checked ? (sub.range ?? { from: 0, to: 0 }) : null,
                        })}
                        className="accent-cyan-500"
                    />
                    {t('radoyon_author_scope_range', 'Only a range of slices')}
                </label>

                {isRange && (
                    <span className="flex items-center gap-1.5 text-slate-400">
                        <input
                            type="number"
                            value={sub.range?.from ?? 0}
                            onChange={(e) => onPatch({ range: { ...(sub.range ?? { to: 0 }), from: Number(e.target.value) } })}
                            aria-label={t('radoyon_author_slice_from', 'From slice')}
                            className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-1"
                        />
                        –
                        <input
                            type="number"
                            value={sub.range?.to ?? 0}
                            onChange={(e) => onPatch({ range: { ...(sub.range ?? { from: 0 }), to: Number(e.target.value) } })}
                            aria-label={t('radoyon_author_slice_to', 'To slice')}
                            className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-1"
                        />
                    </span>
                )}

                {review && (
                    <span className={`text-[11px] flex items-center gap-1.5 ${
                        review.state === 'confirmed' ? 'text-emerald-400' : 'text-amber-400'}`}>
                        <span className="uppercase tracking-wide font-semibold">
                            {review.state === 'confirmed'
                                ? t('radoyon_review_confirmed', 'Confirmed')
                                : t('radoyon_review_primary', 'Primary')}
                        </span>
                        <span className="text-slate-500 truncate max-w-72">
                            {review.state === 'confirmed'
                                ? (review.finding ?? t('radoyon_review_read', 'Findings have been read.'))
                                : t('radoyon_review_unread', 'in place, findings not read')}
                        </span>
                    </span>
                )}

                <button
                    type="button"
                    onClick={() => setAdvanced((a) => !a)}
                    aria-expanded={advanced}
                    className="flex items-center gap-0.5 text-slate-500 hover:text-slate-300 ml-auto"
                >
                    {advanced
                        ? <ChevronDown className="w-3 h-3" aria-hidden="true" />
                        : <ChevronRight className="w-3 h-3" aria-hidden="true" />}
                    {t('radoyon_author_advanced', 'Advanced')}
                </button>
            </div>

            {advanced && (
                <div className="mt-2">
                    <Field
                        label={t('radoyon_author_custom_ref', 'Custom reference')}
                        hint={t('radoyon_author_custom_ref_hint', 'A remote: path served by the host. Material referenced this way declares no geometry, so splice compatibility cannot be checked.')}
                    >
                        <input
                            value={picked ? '' : (sub.source.ref ?? '')}
                            onChange={(e) => onPatch({
                                source: e.target.value
                                    ? { kind: SOURCE_KIND.REMOTE, ref: e.target.value }
                                    : { kind: SOURCE_KIND.NONE, ref: null },
                                geometry: null,
                            })}
                            placeholder="remote:dicom/…"
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono focus:border-cyan-500 outline-none"
                        />
                    </Field>
                </div>
            )}
        </div>
    );
}

function Field({ label, hint, children, className = '' }) {
    return (
        <label className={`block text-xs ${className}`}>
            <span className="block text-slate-400 mb-1">{label}</span>
            {children}
            {hint && <span className="block text-slate-500 mt-1">{hint}</span>}
        </label>
    );
}

function IssueList({ issues, t, className = '' }) {
    if (!issues || issues.length === 0) return null;
    return (
        <ul className={`flex flex-col gap-1 ${className}`}>
            {issues.map((issue, i) => (
                <li
                    // Issues are derived, positionally stable, and carry no id;
                    // the index is the only honest key here.
                    key={`${issue.level}:${i}`}
                    className={`flex items-start gap-1.5 text-xs ${
                        issue.level === 'error' ? 'text-red-400' : 'text-amber-400'
                    }`}
                >
                    {issue.level === 'error'
                        ? <CircleAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                        : <TriangleAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />}
                    <span>{issue.message}</span>
                </li>
            ))}
        </ul>
    );
}

/** The editor's previous name, kept so a host that mounts it does not break. */
export const CaseAuthor = CaseEditor;

export default CaseEditor;
