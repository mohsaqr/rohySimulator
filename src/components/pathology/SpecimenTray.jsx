import { useCallback, useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { plateScaleBar } from './specimenGeometry.js';

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
export function SpecimenTray({ specimens, logger }) {
    const [activePart, setActivePart] = useState(specimens?.[0]?.part ?? null);
    const [activePlateId, setActivePlateId] = useState(null);
    const [bar, setBar] = useState(null);
    const hostRef = useRef(null);
    const loggedPartRef = useRef(null);
    const loggedPlateRef = useRef(null);

    const specimen = specimens?.find((s) => s.part === activePart) ?? null;
    const plates = specimen?.images ?? [];
    const plate = plates.find((p) => p.id === activePlateId) ?? plates[0] ?? null;

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
    }, []);

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
            viewer.addHandler('open', measure);
            viewer.addHandler('animation', measure);
            viewer.addHandler('animation-finish', measure);
        }, 0);

        return () => {
            disposed = true;
            clearTimeout(timer);
            if (viewer) viewer.destroy();
        };
    }, [plate, specimen, logger]);

    if (!specimens || specimens.length === 0) {
        return (
            <p className="m-auto max-w-sm p-6 text-center text-sm text-slate-500">
                No gross specimen has been photographed for this case.
            </p>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 overflow-hidden">
            <nav aria-label="Specimen parts" className="flex w-56 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-slate-800/80 bg-slate-950/40 p-3">
                {specimens.map((s) => {
                    const active = s.part === activePart;
                    return (
                        <button
                            key={s.part}
                            type="button"
                            aria-current={active}
                            onClick={() => selectPart(s.part)}
                            className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left ring-1 transition-colors ${
                                active ? 'bg-fuchsia-500/15 text-fuchsia-100 ring-fuchsia-500/30'
                                    : 'text-slate-300 ring-slate-800 hover:bg-slate-800/50'
                            }`}
                        >
                            <span className="text-[13px] font-semibold">Part {s.part}</span>
                            <span className="line-clamp-2 text-[11px] text-slate-500">{s.description}</span>
                        </button>
                    );
                })}
            </nav>

            <main className="flex min-w-0 flex-1 flex-col">
                <div className="relative flex-1 min-h-0 bg-slate-950">
                    <div ref={hostRef} className="absolute inset-0" />
                    {bar && (
                        <div className="pointer-events-none absolute left-3 top-3">
                            <span className="flex items-center gap-2 rounded-md bg-slate-950/80 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-slate-200 ring-1 ring-slate-700/60 backdrop-blur">
                                <span className="inline-block h-[3px] shrink-0 rounded-sm bg-slate-200" style={{ width: `${Math.round(bar.px)}px` }} />
                                {bar.label}
                            </span>
                        </div>
                    )}
                    {plate && !plate.scaleMm && (
                        // Silence would imply the absent bar is a rendering bug.
                        <p className="pointer-events-none absolute left-3 top-3 rounded-md bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-500/30">
                            No scale declared for this plate
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
                            <img src={p.src} alt={p.caption} className="h-16 w-24 object-cover" />
                            <span className="block max-w-[6rem] truncate px-1.5 py-1 text-[10px] text-slate-400">{p.caption}</span>
                        </button>
                    ))}
                </div>
            </main>

            <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-800/80 bg-slate-950/40 p-4 max-xl:w-72">
                <h2 className="text-sm font-semibold text-slate-100">Part {specimen.part}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{specimen.description}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                    {[
                        ['Dimensions', specimen.dimensions || 'not recorded'],
                        ['Weight', specimen.weight || 'not recorded'],
                        ['Plates', String(plates.length)],
                        ['Scale', plate?.scaleMm ? `${plate.scaleMm} mm across` : '—'],
                    ].map(([label, value]) => (
                        <div key={label} className="rounded-lg bg-slate-950/50 px-2.5 py-2">
                            <dt className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</dt>
                            <dd className="text-sm font-bold text-slate-100">{value}</dd>
                        </div>
                    ))}
                </dl>
            </aside>
        </div>
    );
}
