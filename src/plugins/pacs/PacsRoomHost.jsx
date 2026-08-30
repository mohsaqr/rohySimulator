import { useEffect, useState } from 'react';

import { manifest } from './manifest.js';
import { fetchArchive } from './hostArchive.js';
import { fetchStudyCatalogue } from './hostStudyCatalogue.js';
import { PacsRoom } from './PacsRoom.jsx';

/**
 * The room, with the archive and the study catalogue resolved before it is
 * handed over.
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
 * THE CATALOGUE IS HERE FOR THE SAME REASON. A learner's ORDER comes back from
 * rohy carrying the study's NAME, not the catalogue id the package's
 * `studyForOrder()` rule takes, so the name has to be looked up in the same
 * catalogue the learner ordered from. Like the archive it is a fetch, and like
 * the archive it is only fetched by a session that will actually read it —
 * `needsCatalogue` is false until the learner has ordered something.
 *
 * WHY A WRAPPER RATHER THAN CONTEXT. `props(ctx, persist)` is synchronous and
 * `createPluginContext()` is too; both of these are fetches. So the descriptor
 * hands over the worklist it can resolve NOW plus `resolveWorklist(archive,
 * catalogue)`, and this component holds the two fetched libraries and re-runs
 * that rule on every render. Re-running rather than caching the RESULT is the
 * point: the orders change under the learner — a study finishes its turnaround,
 * another is ordered — and the descriptor rebuilds `worklist` from the current
 * ones each render, so a cached resolved list would go stale and silently show
 * the previous minute's worklist. The rule is cheap (a few array maps over a
 * handful of studies); the fetches are not, and only they are cached.
 *
 * A case with no archive baseline and no orders never asks for either — the
 * common case costs no request.
 *
 * The learner receives a REDUCED archive (ids and series only — see
 * manifest.catalog.learnerKeys): enough to resolve a baseline, and carrying no
 * label, description or provenance, so the pathology library's names cannot
 * become a spoiler in the one room where they would be.
 */
export function PacsRoomHost({
    worklist = [], resolveWorklist, needsArchive = false, needsCatalogue = false, ...props
}) {
    // `null` until the fetches settle. The descriptor's own pre-resolved
    // worklist stands in until then, so the room renders immediately rather
    // than flashing an empty one.
    const [sources, setSources] = useState(null);

    useEffect(() => {
        if (!needsArchive && !needsCatalogue) return undefined;
        let live = true;
        Promise.all([
            needsArchive
                ? fetchArchive({ pluginId: manifest.id }).then(({ archive }) => archive)
                : Promise.resolve({ entries: [] }),
            // Settled separately, and neither may take the room down. An
            // unreachable archive is the normal state of a deployment with no
            // imaging origin, and a catalogue that fails to load leaves ordered
            // studies unmatched — which the join reports honestly, per study,
            // as "no images for this study" rather than as a crash.
            needsCatalogue ? fetchStudyCatalogue().catch(() => []) : Promise.resolve([]),
        ]).then(([archive, catalogue]) => {
            if (!live) return;
            // Nothing came back at all: keep the pre-resolved worklist rather
            // than replacing a real one with an empty one. The studies then
            // show as unavailable, which is true, and the series loader says
            // why the moment anyone tries to open one.
            if (archive.entries.length === 0 && catalogue.length === 0) return;
            setSources({ archive, catalogue });
        });
        return () => { live = false; };
    }, [needsArchive, needsCatalogue]);

    const resolved = sources && typeof resolveWorklist === 'function'
        ? resolveWorklist(sources.archive, sources.catalogue)
        : null;

    return <PacsRoom {...props} worklist={Array.isArray(resolved) ? resolved : worklist} />;
}

export default PacsRoomHost;
