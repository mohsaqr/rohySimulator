import { useMemo } from 'react';

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
export function PacsRoom(props) {
    const loadSeries = useMemo(() => createHostSeriesLoader({ pluginId: manifest.id }), []);
    return <PacsScreen {...props} loadSeries={loadSeries} />;
}

export default PacsRoom;
