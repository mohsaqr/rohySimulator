import { Layers } from 'lucide-react';

/**
 * The series rail — the study's contents, one row per series.
 *
 * Each row states what a reader needs before opening it: plane, slice count and
 * reconstructed spacing. `orderedBy` is shown when a series had to fall back to
 * InstanceNumber ordering, because that is the case where the stack's order is
 * only as trustworthy as the scanner's numbering, and a reader should know.
 */
export function SeriesRail({ series = [], activeStackId, onSelect, t = (k, f) => f ?? k }) {
    if (series.length === 0) return null;
    return (
        <nav aria-label={t('radoyon_series_label', 'Series')} className="flex flex-col gap-1 p-2 overflow-y-auto">
            {series.map((s) => {
                const active = (s.stackId ?? s.seriesInstanceUid) === activeStackId;
                return (
                    <button
                        type="button"
                        key={s.stackId ?? s.seriesInstanceUid}
                        onClick={() => onSelect?.(s)}
                        aria-current={active ? 'true' : undefined}
                        className={`text-left rounded-md px-3 py-2 border transition-colors ${
                            active
                                ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-100'
                                : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'
                        }`}
                    >
                        <div className="flex items-center gap-2 text-sm font-medium">
                            <Layers className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                            <span className="truncate">{s.description || t('radoyon_series_untitled', 'Series')}</span>
                        </div>
                        <div className="mt-1 text-[11px] font-mono text-slate-400 flex flex-wrap gap-x-3">
                            <span>{s.count} {t('radoyon_images', 'img')}</span>
                            <span>{s.plane}</span>
                            {Number.isFinite(s.spacing) && <span>{s.spacing.toFixed(2)} mm</span>}
                        </div>
                        {s.spacingIsUniform === false && (
                            <div className="mt-1 text-[11px] text-amber-400">
                                {t('radoyon_spacing_irregular', 'Irregular slice spacing')}
                            </div>
                        )}
                        {s.orderedBy === 'instance_number' && (
                            <div className="mt-1 text-[11px] text-amber-400">
                                {t('radoyon_ordered_by_number', 'Ordered by image number')}
                            </div>
                        )}
                    </button>
                );
            })}
        </nav>
    );
}

export default SeriesRail;
