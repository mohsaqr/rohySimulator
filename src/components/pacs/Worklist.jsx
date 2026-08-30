import { useMemo, useState } from 'react';
import { CircleAlert, FileImage, Search } from 'lucide-react';

/** Modality accents: colour-blind-safe, and never the only cue — the modality
 *  code itself is printed inside the badge. */
const MODALITY_STYLE = {
    CT: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    MR: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    XR: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    CR: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    DX: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    US: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    CV: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    NM: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
    FL: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    MG: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
    DXA: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
};

/**
 * The study browser — every study this case (or catalogue) knows about.
 *
 * The skeleton is deliberately rohy's investigation-catalogue skeleton —
 * search with an inline icon, an All | Imaging | Diagnostics segment with live
 * counts, and `LABEL ─── count` hairline group headers — reimplemented here
 * with no imports from any host, so the two surfaces read as one product
 * while the package stays portable. Reconciliation is visual as well as
 * data-level.
 *
 * Availability is a first-class state, not a filter: a catalogue study with
 * no imaging material yet is listed dimmed rather than hidden, because the
 * gap between "orderable" and "readable" is real information — it is the
 * coverage map of the archive.
 *
 * The search header appears only when the list is big enough to need it
 * (or carries family metadata): a two-study case worklist in a host stays
 * as spare as it always was.
 */
export function Worklist({ entries = [], activeId, onSelect, t = (k, f) => f ?? k }) {
    const [query, setQuery] = useState('');
    const [family, setFamily] = useState('all');

    const hasFamilies = entries.some((e) => e.family);
    const showHeader = hasFamilies || entries.length > 8;

    const counts = useMemo(() => ({
        all: entries.length,
        imaging: entries.filter((e) => e.family === 'imaging').length,
        diagnostics: entries.filter((e) => e.family === 'diagnostics').length,
    }), [entries]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return entries.filter((e) => {
            if (family !== 'all' && e.family !== family) return false;
            if (!q) return true;
            return [e.description, e.group, e.detail, e.modality, e.accession]
                .some((field) => String(field ?? '').toLowerCase().includes(q));
        });
    }, [entries, query, family]);

    const sections = useMemo(() => {
        const grouped = filtered.some((e) => e.group);
        if (!grouped) return [{ name: null, rows: filtered }];
        return [...new Set(filtered.map((e) => e.group ?? ''))].map((name) => ({
            name,
            rows: filtered.filter((e) => (e.group ?? '') === name),
        }));
    }, [filtered]);

    if (entries.length === 0) {
        return (
            <div className="p-6 text-center text-slate-500 text-sm">
                {t('radoyon_worklist_empty', 'No imaging has been ordered for this patient.')}
            </div>
        );
    }

    const chip = (id, label, count) => (
        <button
            key={id}
            type="button"
            onClick={() => setFamily(id)}
            aria-pressed={family === id}
            className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${
                family === id
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600'
            }`}
        >
            {label} <span className="opacity-60">{count}</span>
        </button>
    );

    return (
        <div className="flex flex-col h-full min-h-0" aria-label={t('radoyon_worklist_label', 'Imaging worklist')}>
            {showHeader && (
                <div className="px-2 pt-2 pb-2 border-b border-slate-800 space-y-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('radoyon_search_studies', 'Search studies…')}
                            aria-label={t('radoyon_search_studies', 'Search studies')}
                            className="w-full pl-8 pr-2 py-1.5 bg-slate-900 border border-slate-800 rounded-md text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                        />
                    </div>
                    {hasFamilies && (
                        <div role="group" aria-label={t('radoyon_family_label', 'Study family')} className="flex gap-1">
                            {chip('all', t('radoyon_family_all', 'All'), counts.all)}
                            {chip('imaging', t('radoyon_family_imaging', 'Imaging'), counts.imaging)}
                            {chip('diagnostics', t('radoyon_family_diagnostics', 'Diagnostics'), counts.diagnostics)}
                        </div>
                    )}
                </div>
            )}

            <div className="flex-1 overflow-y-auto px-1.5 py-2 space-y-3">
                {filtered.length === 0 && (
                    <div className="flex flex-col items-center text-center text-slate-500 text-xs py-10 px-3">
                        <Search className="w-6 h-6 mb-2 opacity-40" aria-hidden="true" />
                        {t('radoyon_no_matches', 'Nothing matches.')}
                    </div>
                )}
                {sections.map(({ name, rows }) => (
                    <section key={name ?? '_flat'}>
                        {name !== null && name !== '' && (
                            <div className="px-1 pb-1 flex items-center gap-2">
                                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500">{name}</span>
                                <span className="flex-1 h-px bg-slate-800" aria-hidden="true" />
                                <span className="text-[10px] text-slate-600">{rows.length}</span>
                            </div>
                        )}
                        <ul className="space-y-1">
                            {rows.map((entry) => (
                                <WorklistRow
                                    key={entry.id}
                                    entry={entry}
                                    active={entry.id === activeId}
                                    onSelect={onSelect}
                                    t={t}
                                />
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}

function WorklistRow({ entry, active, onSelect, t }) {
    const badge = MODALITY_STYLE[entry.modality] ?? 'bg-slate-700/30 text-slate-300 border-slate-600/40';
    return (
        <li>
            <button
                type="button"
                disabled={!entry.available}
                onClick={() => onSelect?.(entry)}
                aria-current={active ? 'true' : undefined}
                title={entry.available ? undefined : (entry.statusLabel ?? t('radoyon_status_no_pixels', 'No imaging material in the archive yet'))}
                className={`w-full text-left px-2 py-1.5 rounded-md border flex items-center gap-2 min-w-0 transition-colors ${
                    active
                        ? 'border-cyan-400/60 bg-cyan-500/10'
                        : 'border-slate-800/80 bg-slate-900/40 hover:border-slate-600'
                } ${entry.available ? 'cursor-pointer' : 'opacity-40 cursor-default'}`}
            >
                {entry.modality ? (
                    <span className={`flex-shrink-0 min-w-8 px-1 text-center text-[10px] font-bold font-mono py-0.5 rounded border ${badge}`}>
                        {entry.modality}
                    </span>
                ) : (
                    <FileImage className="w-4 h-4 text-cyan-400 flex-shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] leading-tight text-slate-200 truncate" title={entry.description || entry.studyId}>
                        {entry.description || entry.studyId}
                    </span>
                    <span className="block text-[10px] font-mono text-slate-500 truncate">
                        {entry.detail ?? entry.accession ?? '—'}
                    </span>
                </span>
                {entry.error ? (
                    <CircleAlert className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" aria-label={t('radoyon_status_unavailable', 'Unavailable')} />
                ) : (
                    <span
                        className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${entry.available ? 'bg-emerald-400' : 'bg-slate-700'}`}
                        aria-label={entry.available ? t('radoyon_status_ready', 'Ready') : (entry.statusLabel ?? t('radoyon_status_no_pixels', 'No imaging material in the archive yet'))}
                    />
                )}
            </button>
        </li>
    );
}

export default Worklist;
