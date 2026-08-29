import { CircleAlert, FileImage } from 'lucide-react';

/**
 * The worklist — the studies available to read in this case.
 *
 * Modelled on a real reading worklist rather than a file list: accession,
 * study, modality and status. `pending` exists because a host may release a
 * study on the same turnaround as its report, and a row that is present but not
 * yet available is more informative than a row that is simply absent — the
 * learner knows the study was ordered.
 */
export function Worklist({ entries = [], activeId, onSelect, t = (k, f) => f ?? k }) {
    if (entries.length === 0) {
        return (
            <div className="p-6 text-center text-slate-400 text-sm">
                {t('radoyon_worklist_empty', 'No imaging has been ordered for this patient.')}
            </div>
        );
    }
    return (
        <table className="w-full text-sm">
            <caption className="sr-only">{t('radoyon_worklist_label', 'Imaging worklist')}</caption>
            <thead className="text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-700">
                <tr>
                    <th scope="col" className="text-left font-medium px-3 py-2">{t('radoyon_study', 'Study')}</th>
                    <th scope="col" className="text-left font-medium px-3 py-2">{t('radoyon_accession', 'Accession')}</th>
                    <th scope="col" className="text-left font-medium px-3 py-2">{t('radoyon_status', 'Status')}</th>
                </tr>
            </thead>
            <tbody>
                {entries.map((entry) => {
                    const active = entry.id === activeId;
                    return (
                        <tr
                            key={entry.id}
                            onClick={() => entry.available && onSelect?.(entry)}
                            aria-current={active ? 'true' : undefined}
                            className={`border-b border-slate-800 ${
                                entry.available ? 'cursor-pointer hover:bg-slate-800/60' : 'opacity-50'
                            } ${active ? 'bg-cyan-500/10' : ''}`}
                        >
                            <td className="px-3 py-2">
                                <div className="flex items-center gap-2 text-slate-200">
                                    <FileImage className="w-4 h-4 text-cyan-400 flex-shrink-0" aria-hidden="true" />
                                    <span>{entry.description || entry.studyId}</span>
                                </div>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-400">{entry.accession ?? '—'}</td>
                            <td className="px-3 py-2">
                                {entry.error ? (
                                    <span className="inline-flex items-center gap-1 text-amber-400 text-xs">
                                        <CircleAlert className="w-3.5 h-3.5" aria-hidden="true" />
                                        {t('radoyon_status_unavailable', 'Unavailable')}
                                    </span>
                                ) : entry.available ? (
                                    <span className="text-emerald-400 text-xs">{t('radoyon_status_ready', 'Ready')}</span>
                                ) : (
                                    <span className="text-slate-500 text-xs">{t('radoyon_status_pending', 'Pending')}</span>
                                )}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

export default Worklist;
