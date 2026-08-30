import { Layers } from 'lucide-react';

/**
 * The series rail — the study's contents, one THUMBNAIL per series.
 *
 * A reader recognises "the thin axial bone recon" from a picture in a tenth of
 * a second and from a row of text not at all, which is why every real PACS
 * shows the stack's face here. Warnings stay textual: irregular spacing and
 * InstanceNumber-ordering are trust problems, and trust problems are stated in
 * words.
 */
export function SeriesRail({
    series = [],
    activeStackId,
    assignments = {},
    onSelect,
    thumbnailFor = () => null,
    columns = 2,
    t = (k, f) => f ?? k,
}) {
    if (series.length === 0) return null;
    return (
        <nav
            aria-label={t('radoyon_series_label', 'Series')}
            className={`grid ${columns === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-1.5 p-2 overflow-y-auto content-start`}
        >
            {series.map((s) => {
                const id = s.stackId ?? s.seriesInstanceUid;
                const active = id === activeStackId;
                const thumb = s.ref ? thumbnailFor(s.ref) : null;
                const pane = assignments[id];
                return (
                    <button
                        type="button"
                        key={id}
                        onClick={() => onSelect?.(s)}
                        aria-current={active ? 'true' : undefined}
                        title={s.description || t('radoyon_series_untitled', 'Series')}
                        className={`relative text-left rounded-md overflow-hidden border transition-colors group ${
                            active
                                ? 'border-cyan-400/80 ring-1 ring-cyan-400/40'
                                : 'border-slate-800 hover:border-slate-600'
                        }`}
                    >
                        <div className="aspect-square bg-black flex items-center justify-center">
                            {thumb ? (
                                <img src={thumb} alt="" className="w-full h-full object-contain" draggable={false} />
                            ) : (
                                <Layers className="w-6 h-6 text-slate-700" aria-hidden="true" />
                            )}
                        </div>
                        {Number.isInteger(pane) && (
                            <span className="absolute top-1 left-1 min-w-4 h-4 px-1 rounded-sm bg-cyan-500/90 text-black text-[10px] font-bold flex items-center justify-center">
                                {pane + 1}
                            </span>
                        )}
                        <span className="absolute top-1 right-1 px-1 rounded-sm bg-black/70 text-[10px] font-mono text-slate-300">
                            {s.count}
                        </span>
                        <div className="px-1.5 py-1 bg-slate-950">
                            <div className="text-[11px] leading-tight text-slate-300 truncate">
                                {s.description || t('radoyon_series_untitled', 'Series')}
                            </div>
                            <div className="text-[10px] font-mono text-slate-500 flex gap-1.5">
                                {/* A radiograph has no plane, and printing
                                    'unknown' under every film is worse than
                                    printing nothing: it reads as a fault. The
                                    modality is what actually distinguishes the
                                    series in that case. */}
                                <span>{s.plane && s.plane !== 'unknown' ? s.plane : s.modality}</span>
                                {Number.isFinite(s.spacing) && <span>{s.spacing.toFixed(1)}mm</span>}
                            </div>
                            {/* Both warnings are about a STACK. A single image
                                cannot be misordered and has no spacing to be
                                irregular, so on a radiograph they are false alarms. */}
                            {s.count > 1 && (s.spacingIsUniform === false || s.orderedBy === 'instance_number') && (
                                <div className="text-[10px] text-amber-400 truncate">
                                    {s.spacingIsUniform === false
                                        ? t('radoyon_spacing_irregular', 'Irregular slice spacing')
                                        : t('radoyon_ordered_by_number', 'Ordered by image number')}
                                </div>
                            )}
                        </div>
                    </button>
                );
            })}
        </nav>
    );
}

export default SeriesRail;
