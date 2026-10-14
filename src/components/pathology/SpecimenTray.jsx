import { useCallback, useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { FileText, ImageOff, Layers, X } from 'lucide-react';
import { plateScaleBar } from './specimenGeometry.js';
import { plural } from './i18n.js';

/** How many times a learner may ask to reload a photograph that failed. */
export const MAX_PLATE_RETRIES = 2;

/**
 * Gross pathology — macroscopic specimen photography.
 *
 * Same room, different subject: specimen plates rather than whole-slide
 * pyramids. Two deliberate differences from SlideCanvas:
 *
 *  - The contact sheet is plain <img>. A gross photograph is an ordinary
 *    image; pulling a tiled pyramid viewer into a thumbnail grid would buy
 *    nothing. OSD is used only for the enlarged plate, where pan/zoom on a
 *    margin actually earns its place.
 *  - The scale bar comes from the plate's declared `scaleMm` (the real-world
 *    width it spans) rather than scanner metadata, so it stays true at any
 *    zoom — which a ruler baked into the photograph cannot do.
 */
export function SpecimenTray({ specimens, logger, t = (key, fallback) => fallback ?? key }) {
    const [activePart, setActivePart] = useState(specimens?.[0]?.part ?? null);
    const [activePlateId, setActivePlateId] = useState(null);
    const [bar, setBar] = useState(null);
    // Narrow screens: parts list and specimen details become drawers (see the
    // layout below), as in the microscopy module.
    const [drawer, setDrawer] = useState(null);
    // Retries per plate; a status is keyed by plate and attempt, so a status
    // left over from another photograph reads as 'loading', which it is.
    const [retry, setRetry] = useState({ plateId: null, count: 0 });
    const [plateStatus, setPlateStatus] = useState({ key: null, state: 'loading' });
    const [brokenThumbs, setBrokenThumbs] = useState(() => new Set());
    const hostRef = useRef(null);
    const loggedPartRef = useRef(null);
    const loggedPlateRef = useRef(null);

    const specimen = specimens?.find((s) => s.part === activePart) ?? null;
    const plates = specimen?.images ?? [];
    const plate = plates.find((p) => p.id === activePlateId) ?? plates[0] ?? null;
    const attempt = retry.plateId === (plate?.id ?? null) ? retry.count : 0;
    const plateKey = `${plate?.id ?? ''}#${attempt}`;
    const plateLoad = plateStatus.key === plateKey ? plateStatus.state : 'loading';
    const partName = specimen
        ? (specimen.name ?? t('specimen_part_n', `Part ${specimen.part}`, { part: specimen.part }))
        : '';
    const plateName = plate?.caption || partName;

    // Log the part the same way the slide side does: from an effect on the
    // ACTIVE part, so the initially selected one is not silently missed.
    useEffect(() => {
        if (!specimen || loggedPartRef.current === specimen.part) return;
        loggedPartRef.current = specimen.part;
        logger.specimenViewed(specimen);
    }, [specimen, logger]);

    const selectPart = useCallback((part) => {
        setActivePart(part);
        setActivePlateId(null);
        setDrawer(null);
    }, []);

    useEffect(() => {
        if (!drawer) return undefined;
        const onKeyDown = (event) => { if (event.key === 'Escape') setDrawer(null); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [drawer]);

    useEffect(() => {
        if (!hostRef.current || !plate?.src) return undefined;
        // Guarded for the same reason the part log is: StrictMode runs this
        // effect body twice on mount, which double-logged every plate open.
        if (loggedPlateRef.current !== plate.id) {
            loggedPlateRef.current = plate.id;
            logger.plateOpened(plate, specimen);
        }

        // Deferred construction for the same StrictMode reason as SlideCanvas
        // — see the long comment there.
        let disposed = false;
        let viewer = null;

        const timer = setTimeout(() => {
            if (disposed) return;
            viewer = OpenSeadragon({
                element: hostRef.current,
                tileSources: { type: 'image', url: plate.src },
                showNavigationControl: false,
                showNavigator: false,
                animationTime: 0.18,
                blendTime: 0.08,
                constrainDuringPan: true,
                visibilityRatio: 1,
                minZoomImageRatio: 0.9,
                // A little past native helps when inspecting a margin; 3x into
                // interpolation would just be a blur presented as detail.
                maxZoomPixelRatio: 1.5,
            });

            const measure = () => {
                const item = viewer.world.getItemAt(0);
                if (!item || !plate.scaleMm) return;
                // The plate's full width as currently drawn, in screen px.
                const widthOnScreen = viewer.container.clientWidth
                    / viewer.viewport.getBounds(true).width;
                setBar(plateScaleBar(plate.scaleMm, widthOnScreen, 160));
            };
            viewer.addHandler('open', () => {
                setPlateStatus({ key: plateKey, state: 'ready' });
                measure();
            });
            viewer.addHandler('animation', measure);
            viewer.addHandler('animation-finish', measure);
            // The photograph could not be fetched or decoded. Without this the
            // enlarged view stayed black — indistinguishable from "loading".
            viewer.addHandler('open-failed', () => setPlateStatus({ key: plateKey, state: 'failed' }));
        }, 0);

        return () => {
            disposed = true;
            clearTimeout(timer);
            if (viewer) viewer.destroy();
        };
    }, [plate, specimen, logger, plateKey]);

    if (!specimens || specimens.length === 0) {
        return (
            <p className="m-auto max-w-sm p-6 text-center text-sm text-slate-500">
                {t('gross_none_for_case', 'No gross specimen has been photographed for this case.')}
            </p>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* NARROW SCREENS (below lg): the parts list and the specimen
                details are drawers over the photograph, opened from this bar,
                so a phone still has the photograph as its main view. Desktop
                is unchanged — every max-lg: class is inert at lg and up. */}
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-800/80 bg-slate-950/60 px-3 py-1.5 lg:hidden">
                <button
                    type="button"
                    aria-expanded={drawer === 'parts'}
                    aria-controls="pathology-parts-drawer"
                    onClick={() => setDrawer((open) => (open === 'parts' ? null : 'parts'))}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors ${
                        drawer === 'parts' ? 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-500/30'
                            : 'text-slate-300 ring-slate-700 hover:bg-slate-800/50'
                    }`}
                >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('specimen_parts', 'Specimen parts')}
                </button>
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{partName}</span>
                <button
                    type="button"
                    aria-expanded={drawer === 'details'}
                    aria-controls="pathology-specimen-drawer"
                    onClick={() => setDrawer((open) => (open === 'details' ? null : 'details'))}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors ${
                        drawer === 'details' ? 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-500/30'
                            : 'text-slate-300 ring-slate-700 hover:bg-slate-800/50'
                    }`}
                >
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('specimen_details', 'Details')}
                </button>
            </div>

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {drawer && (
                <button
                    type="button"
                    aria-label={t('close_panel', 'Close panel')}
                    onClick={() => setDrawer(null)}
                    className="absolute inset-0 z-20 bg-slate-950/60 lg:hidden"
                />
            )}
            <nav
                id="pathology-parts-drawer"
                aria-label={t('specimen_parts', 'Specimen parts')}
                className={`flex w-56 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-slate-800/80 bg-slate-950/40 p-3 max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 max-lg:w-[min(18rem,85%)] max-lg:bg-slate-950 max-lg:shadow-2xl ${
                    drawer === 'parts' ? '' : 'max-lg:hidden'
                }`}
            >
                {specimens.map((s) => {
                    const active = s.part === activePart;
                    return (
                        <button
                            key={s.id ?? s.part}
                            type="button"
                            aria-current={active}
                            onClick={() => selectPart(s.part)}
                            className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left ring-1 transition-colors ${
                                active ? 'bg-fuchsia-500/15 text-fuchsia-100 ring-fuchsia-500/30'
                                    : 'text-slate-300 ring-slate-800 hover:bg-slate-800/50'
                            }`}
                        >
                            <span className="text-[13px] font-semibold">{s.name ?? t('specimen_part_n', `Part ${s.part}`, { part: s.part })}</span>
                            <span className="line-clamp-2 text-[11px] text-slate-500">{s.description}</span>
                        </button>
                    );
                })}
            </nav>

            <main className="flex min-w-0 flex-1 flex-col">
                <div className="relative flex-1 min-h-0 bg-slate-950">
                    <div ref={hostRef} className="absolute inset-0" />
                    {/* A part can exist without photographs — it may only have
                        blocks. Saying so beats a black rectangle that looks
                        like a viewer that failed to start. */}
                    {plates.length === 0 && (
                        <p className="absolute inset-0 m-auto flex max-w-sm items-center justify-center p-6 text-center text-sm text-slate-500">
                            {t(
                                'gross_none_for_part',
                                `No gross photograph was taken of ${partName}.`,
                                { part: partName },
                            )}
                        </p>
                    )}
                    {/* A photograph that exists but has not arrived, and one
                        that failed, are different things from "no photograph"
                        — and from each other. */}
                    {plate?.src && plateLoad === 'loading' && (
                        <p role="status" className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-md bg-slate-950/80 px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-slate-700/60">
                            {plural(t, 'plate_loading', 'Loading photograph “{name}”…', { name: plateName })}
                        </p>
                    )}
                    {plate?.src && plateLoad === 'failed' && (
                        <div role="alert" className="absolute inset-0 z-10 flex items-center justify-center p-6">
                            <div className="max-w-sm space-y-2 rounded-lg bg-slate-900/95 p-4 text-center ring-1 ring-rose-500/30">
                                <p className="text-sm font-semibold text-rose-200">
                                    {plural(t, 'plate_load_failed', 'The photograph “{name}” could not be loaded.', { name: plateName })}
                                </p>
                                {attempt < MAX_PLATE_RETRIES ? (
                                    <button
                                        type="button"
                                        onClick={() => setRetry({ plateId: plate.id, count: attempt + 1 })}
                                        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100 ring-1 ring-slate-600 hover:bg-slate-800"
                                    >
                                        {t('retry', 'Try again')}
                                    </button>
                                ) : (
                                    <p className="text-xs text-slate-400">
                                        {t('plate_load_gave_up', 'It still could not be loaded. Tell your instructor which photograph it was.')}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                    {bar && (
                        <div className="pointer-events-none absolute left-3 top-3">
                            <span className="flex items-center gap-2 rounded-md bg-slate-950/80 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-slate-200 ring-1 ring-slate-700/60 backdrop-blur">
                                <span className="inline-block h-[3px] shrink-0 rounded-sm bg-slate-200" style={{ width: `${Math.round(bar.px)}px` }} />
                                {bar.label}
                            </span>
                        </div>
                    )}
                    {plate && !plate.scaleMm && plateLoad !== 'failed' && (
                        // Silence would imply the absent bar is a rendering bug.
                        <p className="pointer-events-none absolute left-3 top-3 rounded-md bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-500/30">
                            {t('plate_no_scale', 'No scale declared for this plate')}
                        </p>
                    )}
                </div>

                {/* Contact sheet — plain images, no pyramid needed. */}
                <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-slate-800/80 bg-slate-950/60 p-2">
                    {plates.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => setActivePlateId(p.id)}
                            aria-current={p.id === plate?.id}
                            className={`shrink-0 overflow-hidden rounded-lg ring-1 transition-colors ${
                                p.id === plate?.id ? 'ring-fuchsia-500/60' : 'ring-slate-800 hover:ring-slate-600'
                            }`}
                        >
                            {brokenThumbs.has(p.id) ? (
                                <span className="flex h-16 w-24 items-center justify-center bg-slate-900 text-slate-500" title={t('thumbnail_failed', 'This thumbnail could not be loaded')}>
                                    <ImageOff className="h-5 w-5" aria-hidden="true" />
                                    <span className="sr-only">{t('thumbnail_failed', 'This thumbnail could not be loaded')}</span>
                                </span>
                            ) : (
                                <img
                                    src={p.src}
                                    referrerPolicy="no-referrer"
                                    alt={p.caption}
                                    onError={() => setBrokenThumbs((current) => new Set(current).add(p.id))}
                                    className="h-16 w-24 object-cover"
                                />
                            )}
                            <span className="block max-w-[6rem] truncate px-1.5 py-1 text-[10px] text-slate-400">{p.caption}</span>
                        </button>
                    ))}
                </div>
            </main>

            <aside
                id="pathology-specimen-drawer"
                className={`w-80 shrink-0 overflow-y-auto border-l border-slate-800/80 bg-slate-950/40 p-4 max-xl:w-72 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-[min(22rem,100%)] max-lg:bg-slate-950 max-lg:shadow-2xl ${
                    drawer === 'details' ? '' : 'max-lg:hidden'
                }`}
            >
                <div className="flex items-start gap-2">
                    <h2 className="min-w-0 flex-1 text-sm font-semibold text-slate-100">{partName}</h2>
                    <button
                        type="button"
                        aria-label={t('close_panel', 'Close panel')}
                        onClick={() => setDrawer(null)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-800/50 lg:hidden"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{specimen.description}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                    {[
                        ['dimensions', t('dimensions', 'Dimensions'), specimen.dimensions || t('not_recorded', 'not recorded')],
                        ['weight', t('weight', 'Weight'), specimen.weight || t('not_recorded', 'not recorded')],
                        ['plates', t('plates', 'Plates'), String(plates.length)],
                        ['scale', t('scale', 'Scale'), plate?.scaleMm ? t('plate_width_mm', `${plate.scaleMm} mm across`, { mm: plate.scaleMm }) : '—'],
                    ].map(([key, label, value]) => (
                        <div key={key} className="rounded-lg bg-slate-950/50 px-2.5 py-2">
                            <dt className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</dt>
                            <dd className="text-sm font-bold text-slate-100">{value}</dd>
                        </div>
                    ))}
                </dl>
            </aside>
        </div>
        </div>
    );
}
