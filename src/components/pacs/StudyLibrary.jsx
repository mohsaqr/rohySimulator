import { useMemo, useState } from 'react';
import { Check, Info, X } from 'lucide-react';

import { LIBRARY, abnormalEntries, entryStats, libraryOf, normalEntries } from './archive.js';
import { defaultResolveRef } from './caseView.js';

/**
 * The study library: browse both libraries, inspect one, then choose it.
 *
 * This is where an author decides what a learner will open, so it is a
 * BROWSER with a confirm step, not a grid of buttons that swap the imaging on
 * a stray click. Three things it refuses to leave implicit.
 *
 * **Which library.** `normal/` is the baseline library — one normal example
 * per catalogue study. `abnormal/` is real pathology. Choosing an abnormal
 * study as a baseline is allowed and warned about, never forbidden: a case may
 * legitimately be abnormal from the outset (a pneumonia film for a
 * septic-shock case) rather than a normal study with a finding spliced in.
 *
 * **Whether anyone has read it.** "Abnormal" covering both "a radiologist
 * recorded this finding" and "it came from a myeloma cohort" is the single
 * distinction an author most needs, and the one they would otherwise have to
 * guess. Every abnormal card states which it is.
 *
 * **What it actually is.** A card shows modality, region, series and image
 * counts; opening one shows the provenance, the licence and the per-series
 * geometry. An author picking imaging for a measurement case needs the pixel
 * spacing, and hunting for it in a JSON file is how it stops being checked.
 */
export function StudyLibrary({
    archive,
    // The full catalogue of orderable studies. With it, the Normal tab lists
    // every study a learner can order — including the ones with no imaging yet,
    // which is the only way the gap is visible where it matters.
    catalogue = [],
    selected = null,
    library = LIBRARY.NORMAL,
    thumbnailFor = () => null,
    // How a `remote:` reference becomes a URL this host can fetch. Hardcoding
    // the demo host's rule here made every card blank in any other host.
    resolveRef = defaultResolveRef,
    onChoose,
    onCancel,
    title,
    // When replacing a study that fulfils a catalogue order, the other examples
    // of THAT order are the likely choice, so they sort first and say why.
    preferStudyId = null,
    // Narrow the library to one catalogue order — what "Update" means. Always
    // escapable, so a narrowed library is never a trap.
    onlyStudyId = null,
    onClearScope = null,
    t = (key, fallback) => fallback ?? key,
}) {
    const [tab, setTab] = useState(library);
    const [query, setQuery] = useState('');
    const [modality, setModality] = useState('');
    const [reviewed, setReviewed] = useState('');   // '' | 'confirmed' | 'primary'
    const [backing, setBacking] = useState('');     // '' | 'backed' | 'unbacked'
    const [openId, setOpenId] = useState(null);

    /**
     * A row is a study, not an archive entry.
     *
     * On the normal tab that distinction is the whole point: the catalogue has
     * 74 orderable studies and the archive backs 26 of them, and a library that
     * silently listed only the 26 would make the other 48 look like they do not
     * exist rather than like work still to do.
     */
    const pool = useMemo(() => {
        if (tab === LIBRARY.ABNORMAL) {
            return abnormalEntries(archive).map((entry) => ({
                key: entry.id,
                label: entry.label || entry.id,
                modality: entry.modality,
                bodyRegion: entry.bodyRegion,
                studyId: entry.studyId,
                entry,
            }));
        }
        const normals = normalEntries(archive);
        if (catalogue.length === 0) {
            return normals.map((entry) => ({
                key: entry.id,
                label: entry.label || entry.id,
                modality: entry.modality,
                bodyRegion: entry.bodyRegion,
                studyId: entry.studyId,
                entry,
            }));
        }
        const byStudy = new Map();
        normals.forEach((e) => { if (e.studyId && !byStudy.has(e.studyId)) byStudy.set(e.studyId, e); });
        const claimed = new Set(byStudy.values());
        const rows = catalogue.map((study) => {
            const entry = byStudy.get(study.id) ?? null;
            return {
                key: study.id,
                label: study.name ?? study.id,
                modality: entry?.modality ?? study.modality ?? null,
                bodyRegion: entry?.bodyRegion ?? study.bodyRegion ?? study.body_region ?? null,
                studyId: study.id,
                entry,
            };
        });
        // A normal entry that matches no catalogue study would otherwise vanish
        // from the library entirely, which is worse than showing it unlinked.
        normals.filter((e) => !claimed.has(e)).forEach((entry) => rows.push({
            key: entry.id,
            label: entry.label || entry.id,
            modality: entry.modality,
            bodyRegion: entry.bodyRegion,
            studyId: entry.studyId,
            entry,
        }));
        return rows;
    }, [archive, catalogue, tab]);

    const modalities = useMemo(
        () => Array.from(new Set(pool.map((r) => r.modality).filter(Boolean))).sort(),
        [pool],
    );

    const entries = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matches = pool.filter((row) => {
            const e = row.entry;
            if (onlyStudyId && row.studyId !== onlyStudyId) return false;
            if (modality && row.modality !== modality) return false;
            if (backing === 'backed' && !e) return false;
            if (backing === 'unbacked' && e) return false;
            if (reviewed === 'confirmed' && e?.review.state !== 'confirmed') return false;
            if (reviewed === 'primary' && e?.review.state === 'confirmed') return false;
            if (!q) return true;
            return `${row.label} ${e?.description ?? ''} ${e?.id ?? ''} ${row.bodyRegion ?? ''} ${e?.review.finding ?? ''}`
                .toLowerCase().includes(q);
        });
        if (!preferStudyId) return matches;
        // A stable partition, not a sort: equal keys must not reshuffle the
        // grid between renders, and Array.prototype.sort is only stable within
        // one call, not across the comparator changing.
        return [
            ...matches.filter((r) => r.studyId === preferStudyId),
            ...matches.filter((r) => r.studyId !== preferStudyId),
        ];
    }, [pool, query, modality, reviewed, backing, preferStudyId, onlyStudyId]);

    const counts = {
        [LIBRARY.NORMAL]: catalogue.length || normalEntries(archive).length,
        [LIBRARY.ABNORMAL]: abnormalEntries(archive).length,
    };
    const backedCount = pool.filter((r) => r.entry).length;
    const open = openId ? archive.entries.find((e) => e.id === openId) : null;

    return (
        <div className="border border-slate-700 rounded-lg bg-slate-950 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 bg-slate-900/60">
                <h4 className="text-xs font-semibold text-slate-200 mr-auto">
                    {title ?? t('radoyon_library_title', 'Study library')}
                </h4>
                {onClearScope && (
                    <button
                        type="button"
                        onClick={onClearScope}
                        className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
                    >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('radoyon_library_show_all', 'Show the whole library')}
                    </button>
                )}
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
                    >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('radoyon_cancel', 'Cancel')}
                    </button>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
                {[
                    [LIBRARY.NORMAL, t('radoyon_library_normal', 'Normal')],
                    [LIBRARY.ABNORMAL, t('radoyon_library_abnormal', 'Abnormal')],
                ].map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => { setTab(id); setModality(''); setReviewed(''); setBacking(''); setOpenId(null); }}
                        aria-pressed={tab === id}
                        className={`text-xs rounded-md px-2.5 py-1 border ${
                            tab === id
                                ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
                                : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                    >
                        {label} <span className="opacity-60 font-mono">{counts[id]}</span>
                    </button>
                ))}
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('radoyon_library_search', 'Search…')}
                    aria-label={t('radoyon_library_search', 'Search the library')}
                    className="ml-auto w-40 text-xs bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:border-cyan-500 outline-none"
                />
            </div>

            <div className="flex flex-wrap items-center gap-1 px-3 pt-2 text-[11px]">
                <Filter active={!modality} onClick={() => setModality('')} label={t('radoyon_library_all_modalities', 'All')} />
                {modalities.map((m) => (
                    <Filter key={m} active={modality === m} onClick={() => setModality(modality === m ? '' : m)} label={m} />
                ))}
                {tab === LIBRARY.NORMAL && catalogue.length > 0 && (
                    <>
                        <span className="mx-1 text-slate-700" aria-hidden="true">|</span>
                        <Filter
                            active={backing === 'backed'}
                            onClick={() => setBacking(backing === 'backed' ? '' : 'backed')}
                            label={`${t('radoyon_library_backed', 'With imaging')} ${backedCount}`}
                        />
                        <Filter
                            active={backing === 'unbacked'}
                            onClick={() => setBacking(backing === 'unbacked' ? '' : 'unbacked')}
                            label={`${t('radoyon_library_unbacked', 'None yet')} ${pool.length - backedCount}`}
                        />
                    </>
                )}
                {tab === LIBRARY.ABNORMAL && (
                    <>
                        <span className="mx-1 text-slate-700" aria-hidden="true">|</span>
                        <Filter
                            active={reviewed === 'confirmed'}
                            onClick={() => setReviewed(reviewed === 'confirmed' ? '' : 'confirmed')}
                            label={t('radoyon_library_read', 'Read')}
                        />
                        <Filter
                            active={reviewed === 'primary'}
                            onClick={() => setReviewed(reviewed === 'primary' ? '' : 'primary')}
                            label={t('radoyon_library_unread', 'Not read')}
                        />
                    </>
                )}
            </div>

            {tab === LIBRARY.ABNORMAL && (
                <p className="mx-3 mt-2 text-[11px] text-amber-400/90 leading-snug">
                    {t('radoyon_library_abnormal_note',
                        'A case may be abnormal from the outset, so an abnormal study is a legitimate baseline — but the usual move is a normal one with the finding spliced in.')}
                </p>
            )}

            <div className="p-3 grid grid-cols-2 lg:grid-cols-3 gap-2 max-h-[22rem] overflow-y-auto">
                {entries.length === 0 && (
                    <p className="col-span-full text-xs text-slate-600 py-8 text-center">
                        {t('radoyon_library_empty', 'Nothing in this library matches.')}
                    </p>
                )}
                {entries.map((row) => (
                    <LibraryCard
                        key={row.key}
                        row={row}
                        thumbnailFor={thumbnailFor}
                        resolveRef={resolveRef}
                        inUse={Boolean(row.entry) && selected === row.entry.id}
                        open={Boolean(row.entry) && openId === row.entry.id}
                        sameOrder={Boolean(preferStudyId) && row.studyId === preferStudyId}
                        onChoose={row.entry ? () => onChoose(row.entry) : null}
                        onOpen={row.entry ? () => setOpenId(openId === row.entry.id ? null : row.entry.id) : null}
                        t={t}
                    />
                ))}
            </div>

            {open && (
                <StudyDetail
                    entry={open}
                    inUse={selected === open.id}
                    onChoose={() => { onChoose(open); setOpenId(null); }}
                    onClose={() => setOpenId(null)}
                    t={t}
                />
            )}
        </div>
    );
}

function Filter({ active, onClick, label }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`rounded px-1.5 py-0.5 border font-mono ${
                active ? 'border-slate-500 bg-slate-800 text-slate-200' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
        >
            {label}
        </button>
    );
}

function LibraryCard({ row, thumbnailFor, resolveRef, inUse, open, sameOrder, onChoose, onOpen, t }) {
    const entry = row.entry;

    // A catalogue study with no imaging behind it. Shown, not hidden: it is
    // orderable in the host, a learner CAN ask for it, and there is nothing to
    // give them. Hiding it would make the gap invisible in the one place an
    // author could act on it.
    if (!entry) {
        return (
            <div className="rounded-md border border-dashed border-slate-800 overflow-hidden opacity-70">
                <div className="aspect-4/3 bg-slate-950/60 flex items-center justify-center">
                    <span className="text-[10px] font-mono text-slate-700">
                        {t('radoyon_library_no_imaging', 'no imaging yet')}
                    </span>
                </div>
                <div className="p-1.5 bg-slate-950">
                    <div className="text-[11px] text-slate-400 leading-tight line-clamp-2" title={row.label}>
                        {row.label}
                    </div>
                    <div className="text-[10px] text-slate-600 font-mono truncate">
                        {row.modality ?? '—'}{row.bodyRegion ? ` · ${row.bodyRegion}` : ''}
                    </div>
                    <div className="text-[10px] text-slate-700 font-mono">
                        {t('radoyon_library_not_backed', 'not backed')}
                    </div>
                </div>
            </div>
        );
    }

    const first = entry.series?.[0];
    const thumb = first?.ref ? thumbnailFor(resolveRef(first.ref)) : null;
    const { series, instances } = entryStats(entry);
    const confirmed = entry.review.state === 'confirmed';
    const abnormal = libraryOf(entry) === LIBRARY.ABNORMAL;

    // The card itself chooses, in one click. Provenance and geometry live
    // behind the ⓘ, because an author who already knows which study they want
    // should not have to walk past a detail panel to say so.
    return (
        <div
            className={`relative rounded-md border overflow-hidden transition-colors ${
                open ? 'border-cyan-500 ring-1 ring-cyan-500/40'
                    : inUse ? 'border-emerald-600/70' : 'border-slate-800 hover:border-slate-600'}`}
        >
            <button type="button" onClick={onChoose} className="block w-full text-left">
                <div className="aspect-4/3 bg-black flex items-center justify-center">
                    {thumb
                        ? <img src={thumb} alt="" className="w-full h-full object-contain" draggable={false} />
                        : <span className="text-[10px] font-mono text-slate-700">{entry.modality ?? 'DICOM'}</span>}
                </div>
                <div className="p-1.5 bg-slate-950">
                    <div className="text-[11px] text-slate-200 leading-tight line-clamp-2" title={row.label}>
                        {row.label}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono truncate">
                        {entry.modality ?? '—'}{entry.bodyRegion ? ` · ${entry.bodyRegion}` : ''}
                    </div>
                    <div className="text-[10px] text-slate-600 font-mono">{contentText(series, instances, t)}</div>
                    {abnormal && (
                        <div className={`text-[10px] mt-0.5 leading-tight line-clamp-2 ${confirmed ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {confirmed
                                ? (entry.review.finding ?? t('radoyon_review_confirmed', 'Read'))
                                : t('radoyon_review_primary_short', 'Not read')}
                        </div>
                    )}
                </div>
            </button>

            <div className="absolute top-1 left-1 right-1 flex items-start gap-1 pointer-events-none">
                {inUse && (
                    <span className="flex items-center gap-0.5 text-[9px] bg-emerald-600/90 text-white rounded px-1 py-0.5">
                        <Check className="w-2.5 h-2.5" aria-hidden="true" />
                        {t('radoyon_library_in_use', 'in use')}
                    </span>
                )}
                {sameOrder && !inUse && (
                    <span className="text-[9px] bg-indigo-600/90 text-white rounded px-1 py-0.5">
                        {t('radoyon_library_same_order', 'same order')}
                    </span>
                )}
                <button
                    type="button"
                    onClick={onOpen}
                    aria-expanded={open}
                    aria-label={t('radoyon_library_details', 'Details, provenance and geometry')}
                    title={t('radoyon_library_details', 'Details, provenance and geometry')}
                    className="ml-auto pointer-events-auto rounded bg-slate-900/80 hover:bg-slate-700 text-slate-300 p-0.5"
                >
                    <Info className="w-3 h-3" aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}

/**
 * One study, in full, with the choose button.
 *
 * The provenance and the per-series geometry are here rather than on the card
 * because they are what makes a choice defensible — the licence decides whether
 * the case can ever ship, and the pixel spacing decides whether a measurement
 * taken across a splice means anything.
 */
function StudyDetail({ entry, inUse, onChoose, onClose, t }) {
    const { series, instances } = entryStats(entry);
    const confirmed = entry.review.state === 'confirmed';
    const p = entry.provenance ?? {};

    return (
        <div className="border-t border-slate-800 bg-slate-900/60 p-3 flex flex-col gap-2">
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <h5 className="text-sm text-slate-100 font-medium">{entry.label || entry.id}</h5>
                    <p className="text-[11px] text-slate-500 font-mono">{entry.id}</p>
                    {entry.description && <p className="text-xs text-slate-400 mt-1">{entry.description}</p>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                        type="button"
                        onClick={onChoose}
                        className="text-xs rounded-md px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white"
                    >
                        {inUse
                            ? t('radoyon_library_keep', 'Keep this study')
                            : t('radoyon_library_use', 'Use this study')}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t('radoyon_close', 'Close')}
                        className="p-1.5 rounded text-slate-500 hover:text-slate-300"
                    >
                        <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                </div>
            </div>

            <div className={`text-[11px] flex items-start gap-1.5 ${confirmed ? 'text-emerald-400' : 'text-amber-400'}`}>
                <Info className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden="true" />
                <span>
                    {confirmed
                        ? `${entry.review.finding ?? t('radoyon_review_confirmed', 'Read')}${
                            entry.review.reviewedBy ? ` — ${entry.review.reviewedBy}` : ''}${
                            entry.review.reviewedOn ? `, ${entry.review.reviewedOn}` : ''}`
                        : t('radoyon_review_primary_long',
                            'An example is in place; nobody has read these images. What is claimed about them comes from the collection they were drawn from, not from the pixels.')}
                </span>
            </div>

            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-[11px]">
                <Fact label={t('radoyon_library_dataset', 'Dataset')} value={p.dataset} />
                <Fact label={t('radoyon_library_licence', 'Licence')} value={p.licence} />
                <Fact label={t('radoyon_library_redistribution', 'Redistribution')} value={p.redistribution} />
                <Fact label={t('radoyon_library_content', 'Content')} value={contentText(series, instances, t)} />
            </dl>
            {p.attribution && (
                <p className="text-[11px] text-slate-500">
                    {t('radoyon_library_attribution', 'Attribution')}: {p.attribution}
                </p>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-[11px] text-left">
                    <thead className="text-slate-500">
                        <tr>
                            <th className="font-normal py-0.5 pr-3">{t('radoyon_library_series', 'Series')}</th>
                            <th className="font-normal py-0.5 pr-3">{t('radoyon_library_plane', 'Plane')}</th>
                            <th className="font-normal py-0.5 pr-3">{t('radoyon_images', 'Images')}</th>
                            <th className="font-normal py-0.5">{t('radoyon_library_geometry', 'Geometry')}</th>
                        </tr>
                    </thead>
                    <tbody className="text-slate-300 font-mono">
                        {entry.series.map((s) => (
                            <tr key={s.key} className="border-t border-slate-800/60">
                                <td className="py-0.5 pr-3">{s.description || s.key}</td>
                                <td className="py-0.5 pr-3 text-slate-500">{s.plane}</td>
                                <td className="py-0.5 pr-3">{s.instances}</td>
                                <td className="py-0.5 text-slate-500">{geometryText(s.geometry, t)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/**
 * "3 series · 240 images", singularised.
 *
 * "1 images" on a plain radiograph is the kind of small wrongness that makes a
 * reader distrust the numbers next to it, and half this library is single-image.
 */
export function contentText(series, instances, t = (k, f) => f) {
    const s = series === 1 ? t('radoyon_series_one', 'series') : t('radoyon_series_many', 'series');
    const i = instances === 1 ? t('radoyon_image_one', 'image') : t('radoyon_image_many', 'images');
    return `${series} ${s} · ${instances} ${i}`;
}

function Fact({ label, value }) {
    return (
        <div className="min-w-0">
            <dt className="text-slate-600">{label}</dt>
            <dd className="text-slate-300 truncate" title={value ?? ''}>{value || '—'}</dd>
        </div>
    );
}

/** A series' geometry in one line, saying "not declared" rather than showing blanks. */
function geometryText(geometry, t) {
    if (!geometry) return t('radoyon_library_no_geometry', 'not declared');
    const parts = [];
    if (Number.isFinite(geometry.rows) && Number.isFinite(geometry.columns)) {
        parts.push(`${geometry.rows}x${geometry.columns}`);
    }
    if (Array.isArray(geometry.pixelSpacing) && Number.isFinite(geometry.pixelSpacing[0])) {
        parts.push(`${geometry.pixelSpacing[0]} mm px`);
    }
    if (Number.isFinite(geometry.spacing)) parts.push(`${geometry.spacing} mm slice`);
    return parts.length ? parts.join(' · ') : t('radoyon_library_no_geometry', 'not declared');
}

export default StudyLibrary;
