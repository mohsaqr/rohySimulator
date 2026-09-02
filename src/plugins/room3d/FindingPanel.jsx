import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Minimize2, X } from 'lucide-react';
import FindingDisplay from '../../components/examination/FindingDisplay';
import { BODY_REGIONS, EXAM_TECHNIQUES } from '../../data/examRegions';
import { regionLabel, techniqueLabel } from '../../components/examination/examinationLabels';

// The 3D room's examination finding surface.
//
// The finding itself is rendered by Rohy's REAL FindingDisplay, which
// routes auscultation to AuscultationPanel — the interactive chest /
// abdomen diagram with its clickable auscultation points, per-point audio,
// play/pause and volume. Nothing about a finding is re-implemented here;
// this component only frames it inside the 3D room:
//
//   - docked: a tall right-hand panel that scrolls,
//   - expanded: a near-fullscreen reading surface (the square icon),
//
// so long MRCP findings and the auscultation diagram both have room.
//
// Side: docked on the LEFT, opposite the vitals monitor, so the two never
// fight for the same edge. The room's navigation wheel is asked to step to
// the right while this is open (Exam3DScreen).
//
// z-order: docked sits at z-20 (over the room's z-10 chrome, under the
// fixed RoomNavigator at z-40); expanded rises to z-40 with its own
// backdrop but still below the OrdersDrawer (z-50).
export default function FindingPanel({ entry, onClose }) {
    const { t: tRoom } = useTranslation('room3d');
    const { t } = useTranslation('examination');
    const [expanded, setExpanded] = useState(false);

    // Escape closes the panel, or leaves fullscreen first.
    useEffect(() => {
        const handleKey = (event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            if (expanded) setExpanded(false);
            else onClose();
        };
        // Capture phase: the 3D room also listens for Escape on document,
        // and while a finding is open this panel owns the key.
        document.addEventListener('keydown', handleKey, true);
        return () => document.removeEventListener('keydown', handleKey, true);
    }, [expanded, onClose]);

    if (!entry) return null;

    const region = BODY_REGIONS[entry.regionId];
    const technique = EXAM_TECHNIQUES[entry.examType];
    const heading = entry.specialTest
        ?? techniqueLabel(t, entry.examType, technique?.name ?? entry.examType);

    return (
        <>
            {expanded && (
                <div
                    className="fixed inset-x-0 top-0 bottom-[72px] z-30 bg-black/70 backdrop-blur-sm"
                    onClick={() => setExpanded(false)}
                    aria-hidden="true"
                />
            )}
            {/* Expanded stops 88px from the viewport bottom: the host's
                fixed RoomNavigator owns the last 72px, and this panel lives
                inside the room's z-30 surface so it can never paint over
                it — running to the edge would just hide its own footer. */}
            {/* The chart is a clipboard: a board, a clip, and a page. The
                board carries the frame and the clip; everything clinical
                lives on the page, which is what actually scrolls. */}
            <aside
                aria-label={tRoom('finding_region')}
                className={expanded
                    ? 'fixed left-4 right-4 top-4 bottom-[88px] z-40 flex flex-col rounded-2xl border border-neutral-700 bg-gradient-to-b from-neutral-700 to-neutral-800 p-2.5 pt-9 shadow-[0_30px_80px_rgba(0,0,0,0.7)] md:left-10 md:right-10 md:top-8'
                    : 'absolute left-4 top-24 bottom-[176px] z-20 flex w-[430px] flex-col rounded-2xl border border-neutral-700 bg-gradient-to-b from-neutral-700 to-neutral-800 p-2.5 pt-9 shadow-[0_24px_60px_rgba(0,0,0,0.65)]'}
            >
                {/* The clip, straddling the board's top edge. */}
                <div
                    className="pointer-events-none absolute left-1/2 top-1 z-10 h-8 w-28 -translate-x-1/2 rounded-md border border-amber-800/50 bg-gradient-to-b from-amber-200 via-amber-400 to-amber-600 shadow-[0_5px_12px_rgba(0,0,0,0.5)]"
                    aria-hidden="true"
                >
                    <div className="mx-auto mt-1.5 h-2.5 w-2.5 rounded-full border border-amber-900/40 bg-amber-800/70" />
                    <div className="mx-auto mt-1.5 h-1 w-20 rounded-full bg-amber-900/25" />
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-inner">
                <header className="flex items-start justify-between gap-3 border-b border-neutral-800 px-4 pb-3 pt-3">
                    <div className="min-w-0">
                        <p className="truncate text-[10px] font-bold uppercase tracking-widest text-teal-400">
                            {regionLabel(t, entry.regionId, region?.name ?? entry.regionId)}
                        </p>
                        <h2 className="truncate text-lg font-semibold text-white">{heading}</h2>
                        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                            Physical examination · findings
                        </p>
                    </div>
                    <div className="flex flex-none items-center gap-1">
                        {entry.abnormal && (
                            <span className="mr-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                                {t('abnormal')}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => setExpanded((current) => !current)}
                            aria-pressed={expanded}
                            aria-label={expanded ? tRoom('finding_exit_fullscreen') : tRoom('finding_fullscreen')}
                            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
                        >
                            {expanded
                                ? <Minimize2 className="h-4 w-4" />
                                : <Maximize2 className="h-4 w-4" />}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={tRoom('finding_close')}
                            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </header>

                {/* The finding scrolls; in fullscreen the reading column is
                    centred so clinical paragraphs keep a sane measure. */}
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    <div className={expanded ? 'mx-auto w-full max-w-3xl' : ''}>
                        <FindingDisplay
                            figure="manikin"
                            layout={expanded ? 'row' : 'stack'}
                            transport="compact"
                            // The finding text says what was heard; deciding
                            // it is normal is the learner's work, not a badge.
                            normalLabel={false}
                            // The chart's own header names the region and
                            // technique; the page is the surface.
                            chrome="bare"
                            selectedRegion={entry.regionId}
                            selectedExamType={entry.examType}
                            finding={entry.finding}
                            isAbnormal={entry.abnormal}
                            audioUrl={entry.audioUrl}
                            audioUrls={entry.audioUrls || {}}
                            heartAudio={entry.heartAudio}
                            lungAudio={entry.lungAudio}
                        />
                    </div>
                </div>
                </div>
            </aside>
        </>
    );
}
