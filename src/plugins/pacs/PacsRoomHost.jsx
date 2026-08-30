import { useEffect, useRef, useState } from 'react';

import { manifest } from './manifest.js';
import { fetchArchive } from './hostArchive.js';
import { PacsRoom } from './PacsRoom.jsx';

/**
 * The room, with the archive resolved before it is handed over.
 *
 * A case entry says `baseline: { kind: 'archive', ref: 'normal/ct_chest' }`.
 * That id means nothing to the package — `resolveEntry()` is given the
 * baseline's SERIES and swaps substitutions into them, and only the host can
 * turn an archive id into series, because only the host knows where the archive
 * lives. The adapter's `worklistProps()` has always done that lookup; what was
 * missing is that nothing ever put an archive in the context, so every
 * archive-backed study resolved to zero series and rendered as an unclickable
 * "Pending".
 *
 * That is the exact study the new editor produces: "Wire imaging" writes an
 * archive baseline. So authoring and reading were broken at the same seam, and
 * fixing only the editor would have meant an author could now build a case that
 * a learner still could not open.
 *
 * WHY A WRAPPER RATHER THAN CONTEXT. `props(ctx, persist)` is synchronous and
 * `createPluginContext()` is too; the archive is a fetch. So the descriptor
 * hands over the worklist it can resolve NOW plus `resolveWorklist(archive)`,
 * and this component re-resolves once the archive lands. A case with no
 * archive baseline never asks for it — the common case costs no request.
 *
 * The learner receives a REDUCED archive (ids and series only — see
 * manifest.catalog.learnerKeys): enough to resolve a baseline, and carrying no
 * label, description or provenance, so the pathology library's names cannot
 * become a spoiler in the one room where they would be.
 */
export function PacsRoomHost({ worklist = [], resolveWorklist, needsArchive = false, ...props }) {
    const [resolved, setResolved] = useState(null);

    // Held in a ref because PluginRoom recomputes `props()` on every render, so
    // the function identity changes constantly. As an effect dependency it
    // would re-fetch the archive on every parent render — the same trap the
    // package documents for `loadSeries`.
    const resolveRef = useRef(resolveWorklist);
    useEffect(() => { resolveRef.current = resolveWorklist; });

    useEffect(() => {
        if (!needsArchive) return undefined;
        let live = true;
        fetchArchive({ pluginId: manifest.id }).then(({ archive }) => {
            // An unreachable archive leaves the pre-resolved worklist in place.
            // The study then shows as unavailable, which is true, and the series
            // loader says why the moment anyone tries to open one — better than
            // replacing a real worklist with an empty one.
            if (!live || archive.entries.length === 0) return;
            const next = resolveRef.current?.(archive);
            if (Array.isArray(next)) setResolved(next);
        });
        return () => { live = false; };
    }, [needsArchive]);

    return <PacsRoom {...props} worklist={resolved ?? worklist} />;
}

export default PacsRoomHost;
