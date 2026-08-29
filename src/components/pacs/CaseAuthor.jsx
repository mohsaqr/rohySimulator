import { useCallback, useMemo, useState } from 'react';
import { CircleAlert, Plus, Trash2, TriangleAlert } from 'lucide-react';

import {
    SOURCE_KIND, SUBSTITUTION_SCOPE, documentIssues, emptyDocument, readDocument,
} from './caseDocument.js';
import { entriesForStudy, readArchive } from './archive.js';

/**
 * The case editor: "a normal study, except…".
 *
 * The shape of this screen is the teaching claim of the whole package. An
 * author does not assemble a study; they pick a **normal** examination from the
 * archive and then say what is different about this patient. Everything they do
 * not touch stays normal, which is what forces a learner to exclude a real
 * study rather than spot the one thing that was put there.
 *
 * Validation runs on every keystroke and is shown inline, but it never blocks
 * saving. A half-written case is the normal state of an unfinished one, and an
 * editor that refuses to save is an editor that loses work. The host decides
 * what to do with errors — RPS-1's contract is that they block RELEASING a case
 * to learners, not writing it.
 *
 * Uncontrolled-with-seed, like the pathology package's CaseAuthor: it seeds
 * once from `initialCase` and owns the document, because the host's
 * PluginAuthor re-renders and recomputes props on every change and a controlled
 * mount needs a document that is stable across renders.
 */
export function CaseAuthor({
    initialCase,
    onChange,
    archive: rawArchive,
    studyCatalogue = [],
    t = (key, fallback) => fallback ?? key,
}) {
    const [doc, setDoc] = useState(() => (initialCase ? readDocument(initialCase) : emptyDocument()));
    const archive = useMemo(() => readArchive(rawArchive ?? { entries: [] }), [rawArchive]);
    const issues = useMemo(() => documentIssues(doc, { archive }), [doc, archive]);

    const update = useCallback((next) => {
        setDoc(next);
        onChange?.(next);
    }, [onChange]);

    const patchEntry = useCallback((entryId, patch) => {
        update({
            ...doc,
            worklist: doc.worklist.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
        });
    }, [doc, update]);

    const addEntry = useCallback(() => {
        update({
            ...doc,
            // Time-based ids would collide across a fast double-click and are
            // not reproducible in a fixture; a counted id is both.
            worklist: [...doc.worklist, {
                id: `study_${doc.worklist.length + 1}`,
                studyId: null,
                description: '',
                accession: null,
                availableAtMinutes: null,
                baseline: { kind: SOURCE_KIND.NONE, ref: null },
                substitutions: [],
                report: { findings: '', impression: '', reportedBy: null, released: true },
            }],
        });
    }, [doc, update]);

    const issuesFor = (entryId) => issues.filter((i) => i.entryId === entryId);

    return (
        <div className="flex flex-col gap-4 p-4 text-slate-100">
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{t('radoyon_author_title', 'Imaging')}</h2>
                    <p className="text-sm text-slate-400">
                        {t('radoyon_author_intro', 'Start from a normal study, then say what is different about this patient.')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={addEntry}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-sm"
                >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    {t('radoyon_author_add_study', 'Add study')}
                </button>
            </header>

            <IssueList issues={issues.filter((i) => !i.entryId)} t={t} />

            {doc.worklist.length === 0 && (
                <p className="text-sm text-slate-500 border border-dashed border-slate-700 rounded p-6 text-center">
                    {t('radoyon_author_empty', 'No imaging yet. Add a study to begin.')}
                </p>
            )}

            {doc.worklist.map((entry) => (
                <EntryEditor
                    key={entry.id}
                    entry={entry}
                    archive={archive}
                    studyCatalogue={studyCatalogue}
                    issues={issuesFor(entry.id)}
                    onPatch={(patch) => patchEntry(entry.id, patch)}
                    onRemove={() => update({ ...doc, worklist: doc.worklist.filter((e) => e.id !== entry.id) })}
                    t={t}
                />
            ))}
        </div>
    );
}

function EntryEditor({ entry, archive, studyCatalogue, issues, onPatch, onRemove, t }) {
    const normals = entry.studyId ? entriesForStudy(archive, entry.studyId) : archive.entries;
    const baselineEntry = archive.entries.find((e) => e.id === entry.baseline.ref);

    const patchSub = (subId, patch) => onPatch({
        substitutions: entry.substitutions.map((s) => (s.id === subId ? { ...s, ...patch } : s)),
    });

    return (
        <section className="border border-slate-700 rounded-lg bg-slate-800/40">
            <div className="flex items-center gap-3 p-3 border-b border-slate-700">
                <input
                    value={entry.description}
                    onChange={(e) => onPatch({ description: e.target.value })}
                    placeholder={t('radoyon_author_description', 'Study description')}
                    aria-label={t('radoyon_author_description', 'Study description')}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
                />
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={t('radoyon_author_remove', 'Remove study')}
                    className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700"
                >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
            </div>

            <div className="p-3 grid gap-3 md:grid-cols-2">
                <Field label={t('radoyon_author_catalogue_study', 'Catalogue study')}>
                    <select
                        value={entry.studyId ?? ''}
                        onChange={(e) => onPatch({ studyId: e.target.value || null })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
                    >
                        <option value="">{t('radoyon_author_unlinked', 'Not linked')}</option>
                        {studyCatalogue.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                </Field>

                <Field
                    label={t('radoyon_author_baseline', 'Normal baseline')}
                    hint={t('radoyon_author_baseline_hint', 'The complete normal examination this case starts from.')}
                >
                    <select
                        value={entry.baseline.kind === SOURCE_KIND.ARCHIVE ? (entry.baseline.ref ?? '') : ''}
                        onChange={(e) => onPatch({
                            baseline: e.target.value
                                ? { kind: SOURCE_KIND.ARCHIVE, ref: e.target.value }
                                : { kind: SOURCE_KIND.NONE, ref: null },
                        })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
                    >
                        <option value="">{t('radoyon_author_choose', 'Choose a normal study…')}</option>
                        {normals.map((n) => (
                            <option key={n.id} value={n.id}>{n.label || n.id}</option>
                        ))}
                    </select>
                </Field>
            </div>

            <div className="px-3 pb-3">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-slate-300">
                        {t('radoyon_author_substitutions', 'What is different about this patient')}
                    </h3>
                    <button
                        type="button"
                        onClick={() => onPatch({
                            substitutions: [...entry.substitutions, {
                                id: `sub_${entry.substitutions.length + 1}`,
                                label: '',
                                scope: SUBSTITUTION_SCOPE.SERIES,
                                targetSeriesKey: baselineEntry?.series?.[0]?.key ?? null,
                                source: { kind: SOURCE_KIND.REMOTE, ref: '' },
                                range: null,
                                geometry: null,
                            }],
                        })}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600"
                    >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('radoyon_author_add_finding', 'Add finding')}
                    </button>
                </div>

                {entry.substitutions.length === 0 && (
                    <p className="text-xs text-slate-500">
                        {t('radoyon_author_all_normal', 'Nothing substituted — the learner will read a normal study.')}
                    </p>
                )}

                <div className="flex flex-col gap-2">
                    {entry.substitutions.map((sub) => (
                        <SubstitutionEditor
                            key={sub.id}
                            sub={sub}
                            baselineEntry={baselineEntry}
                            onPatch={(patch) => patchSub(sub.id, patch)}
                            onRemove={() => onPatch({ substitutions: entry.substitutions.filter((s) => s.id !== sub.id) })}
                            t={t}
                        />
                    ))}
                </div>
            </div>

            <div className="px-3 pb-3 grid gap-3 md:grid-cols-2">
                <Field label={t('radoyon_author_findings', 'Findings')}>
                    <textarea
                        rows={3}
                        value={entry.report.findings}
                        onChange={(e) => onPatch({ report: { ...entry.report, findings: e.target.value } })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono"
                    />
                </Field>
                <Field label={t('radoyon_author_impression', 'Impression')}>
                    <textarea
                        rows={3}
                        value={entry.report.impression}
                        onChange={(e) => onPatch({ report: { ...entry.report, impression: e.target.value } })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm font-mono"
                    />
                </Field>
                <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
                    <input
                        type="checkbox"
                        checked={entry.report.released}
                        onChange={(e) => onPatch({ report: { ...entry.report, released: e.target.checked } })}
                    />
                    {t('radoyon_author_release_report', 'Release the report to the learner')}
                    <span className="text-xs text-slate-500">
                        {t('radoyon_author_release_hint', 'Withhold it to make them read the images first.')}
                    </span>
                </label>
            </div>

            <IssueList issues={issues} t={t} className="px-3 pb-3" />
        </section>
    );
}

function SubstitutionEditor({ sub, baselineEntry, onPatch, onRemove, t }) {
    const isRange = sub.scope === SUBSTITUTION_SCOPE.RANGE;
    return (
        <div className="border border-slate-700 rounded bg-slate-900/60 p-2 grid gap-2 md:grid-cols-4 items-end">
            <Field label={t('radoyon_author_finding_label', 'Finding')}>
                <input
                    value={sub.label}
                    onChange={(e) => onPatch({ label: e.target.value })}
                    placeholder={t('radoyon_author_finding_ph', 'e.g. Saddle embolus')}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                />
            </Field>

            <Field label={t('radoyon_author_scope', 'Replaces')}>
                <select
                    value={sub.scope}
                    onChange={(e) => onPatch({
                        scope: e.target.value,
                        range: e.target.value === SUBSTITUTION_SCOPE.RANGE ? (sub.range ?? { from: 0, to: 0 }) : null,
                    })}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                >
                    <option value={SUBSTITUTION_SCOPE.SERIES}>{t('radoyon_author_scope_series', 'The whole series')}</option>
                    <option value={SUBSTITUTION_SCOPE.RANGE}>{t('radoyon_author_scope_range', 'A range of slices')}</option>
                </select>
            </Field>

            <Field label={t('radoyon_author_target', 'In series')}>
                <select
                    value={sub.targetSeriesKey ?? ''}
                    onChange={(e) => onPatch({ targetSeriesKey: e.target.value || null })}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                >
                    <option value="">{t('radoyon_author_target_auto', 'The only series')}</option>
                    {(baselineEntry?.series ?? []).map((s) => (
                        <option key={s.key} value={s.key}>{s.description || s.key}</option>
                    ))}
                </select>
            </Field>

            <div className="flex items-end gap-2">
                <Field label={t('radoyon_author_source', 'Source')} className="flex-1">
                    <input
                        value={sub.source.ref ?? ''}
                        onChange={(e) => onPatch({ source: { kind: SOURCE_KIND.REMOTE, ref: e.target.value } })}
                        placeholder="remote:dicom/…"
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm font-mono"
                    />
                </Field>
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={t('radoyon_author_remove_finding', 'Remove finding')}
                    className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700"
                >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
            </div>

            {isRange && (
                <div className="md:col-span-4 flex items-center gap-2 text-xs text-slate-400">
                    <span>{t('radoyon_author_slices', 'Slices')}</span>
                    <input
                        type="number"
                        value={sub.range?.from ?? 0}
                        onChange={(e) => onPatch({ range: { ...(sub.range ?? { to: 0 }), from: Number(e.target.value) } })}
                        className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                    />
                    <span>–</span>
                    <input
                        type="number"
                        value={sub.range?.to ?? 0}
                        onChange={(e) => onPatch({ range: { ...(sub.range ?? { from: 0 }), to: Number(e.target.value) } })}
                        className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1"
                    />
                    <span className="text-amber-400/80">
                        {t('radoyon_author_splice_warning', 'Spliced slices must match the baseline geometry, or measurements across the seam will be wrong.')}
                    </span>
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

export default CaseAuthor;
