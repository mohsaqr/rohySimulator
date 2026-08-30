import { useMemo } from 'react';
import { ScanLine } from 'lucide-react';

import { manifest } from './manifest.js';
import { createHostSeriesLoader } from './hostSeriesLoader.js';
import { PacsScreen } from '../../components/pacs/PacsScreen.jsx';

/**
 * The room, wrapped so the series loader is built ONCE rather than on every
 * render.
 *
 * Not a micro-optimisation: `loadSeries` is a dependency of the package's load
 * effect, so a fresh function identity on each render would re-run it and
 * re-fetch the entire study — hundreds of megabytes — every time any parent
 * re-rendered. useMemo here is what makes that impossible rather than unlikely.
 *
 * It lives in its own file because a descriptor module that also exports a
 * component breaks React Fast Refresh for the whole module.
 */
export function PacsRoom({ topBarControls = null, caseTitle = null, roomNav = null, ...props }) {
    const loadSeries = useMemo(() => createHostSeriesLoader({ pluginId: manifest.id }), []);
    const t = props.t ?? ((key, fallback) => fallback ?? key);

    // Host chrome lives HERE, in the adapter, because the vendored PacsScreen
    // destructures a closed prop list and (correctly) knows nothing about
    // rohy's top bar or room navigator. Without this wrapper the PACS room
    // dropped both — no room tabs, no End & Debrief — and the only way out
    // was a page reload. Mirrors PathologyScreen's own header + roomNav shell.
    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-900 text-slate-100">
            <header className="flex items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-6 py-3 shadow-lg shadow-black/20 backdrop-blur">
                <div className="flex min-w-0 items-center gap-3 max-lg:max-w-[40%]">
                    <ScanLine className="h-6 w-6 shrink-0 text-cyan-300" />
                    <div className="flex min-w-0 items-baseline gap-2 text-sm">
                        <span className="whitespace-nowrap text-base font-semibold text-slate-100">
                            {t('room_pacs', 'PACS')}
                        </span>
                        {caseTitle && (
                            <>
                                <span className="text-slate-500 max-lg:hidden">·</span>
                                <span className="truncate text-slate-300 max-lg:hidden">{caseTitle}</span>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">{topBarControls}</div>
            </header>

            <div className="min-h-0 flex-1">
                <PacsScreen {...props} loadSeries={loadSeries} />
            </div>

            {/* Bottom RoomNavigator — rendered by App.jsx and passed in so the
                bar stays consistent across every room. */}
            {roomNav}
        </div>
    );
}

export default PacsRoom;
