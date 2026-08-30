import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, Loader2, ScanLine } from 'lucide-react';

import { manifest } from './manifest.js';
import { fetchArchive, fetchThumbnails } from './hostArchive.js';
import { fetchStudyCatalogue } from './hostStudyCatalogue.js';
import { createHostLazyLoaders } from './hostSeriesLoader.js';
import { CaseEditor } from '../../components/pacs/CaseEditor.jsx';

/**
 * The host shell around Radoyon's `CaseEditor`.
 *
 * Two things live here and neither belongs in the vendored package.
 *
 * THE DATA THE EDITOR CANNOT FETCH FOR ITSELF. `CaseEditor` takes `archive` and
 * `studyCatalogue` as plain props — data, not services — because a package that
 * fetched its own catalogue would have to know a host's URLs. So somebody has
 * to do the fetching, and `authorProps(ctx, draft)` cannot: it is synchronous
 * and recomputed on every render. This component is that somebody. Until it
 * existed both props defaulted to empty and the editor rendered its own honest
 * emptiness — 0 studies, "No study in the catalogue matches" — which is what
 * was reported as "imaging is not working at all".
 *
 * THE HOST CHROME. `CaseEditor` renders no `topBarControls` slot (pathology's
 * `CaseAuthor` does), so PluginAuthorSurface's Done and Discard had nowhere to
 * land and an author who opened the PACS editor could not commit or leave it.
 * The adapter renders that header itself, exactly as `PacsRoom` renders the
 * room's — the same seam, for the same reason.
 *
 * MOUNT ORDER MATTERS. `CaseEditor` is uncontrolled-with-seed: it reads
 * `initialCase` once and owns the document afterwards. It is mounted only once
 * the first load has settled, so the seed is not taken while the catalogue is
 * still empty — and so an author never sees the empty grid this component
 * exists to prevent.
 */
export function PacsCaseEditor({
    topBarControls = null,
    caseTitle = null,
    t = (key, fallback) => fallback ?? key,
    ...editorProps
}) {
    const [load, setLoad] = useState({ status: 'loading', catalogue: [], archive: null, reason: null, error: null });
    // Not part of `load`: a card with no picture is a normal card, so the
    // editor must not wait on the thumbnail index before it renders.
    const [thumbnailFor, setThumbnailFor] = useState(() => () => null);

    useEffect(() => {
        let live = true;
        // The catalogue is REQUIRED and the archive is not, so they are settled
        // separately: a deployment with no imaging origin still gets every
        // orderable study, marked "No imaging yet". Awaiting them together and
        // failing as a pair would have made a missing origin — the normal state
        // today — look like a broken editor.
        Promise.all([
            fetchStudyCatalogue().then(
                (catalogue) => ({ catalogue, error: null }),
                (error) => ({ catalogue: [], error }),
            ),
            fetchArchive({ pluginId: manifest.id }),
        ]).then(([studies, archive]) => {
            if (!live) return;
            setLoad({
                status: 'ready',
                catalogue: studies.catalogue,
                archive: archive.archive,
                reason: archive.unavailableReason,
                error: studies.error,
            });
        });
        // Settled on its own, and deliberately later: `thumbs/index.json` is
        // decoration. Folding it into the gate above would hold a usable
        // catalogue behind a file whose absence changes nothing.
        fetchThumbnails({ pluginId: manifest.id }).then((fn) => {
            // Wrapped: setState treats a bare function as an updater and would
            // CALL it with the previous state instead of storing it.
            if (live) setThumbnailFor(() => fn);
        });
        return () => { live = false; };
    }, []);

    // Built ONCE. `useStudy` and `useThumbnails` take these as effect
    // dependencies; a fresh identity per render re-fetches the study behind
    // every preview, forever.
    const loaders = useMemo(() => createHostLazyLoaders({ pluginId: manifest.id }), []);

    // The seed, frozen at first mount. `authorProps` rebuilds `initialCase`
    // from the stored document on every render, and CaseEditor only reads it
    // once — but holding it steady makes that a property of this component
    // rather than a detail of the package that could change under us. State
    // rather than a ref, because it is read during render.
    const [seed] = useState(() => editorProps.initialCase);

    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-900 text-slate-100">
            <header className="flex items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-6 py-3 shadow-lg shadow-black/20 backdrop-blur">
                <div className="flex min-w-0 items-center gap-3">
                    <ScanLine className="h-6 w-6 shrink-0 text-cyan-300" />
                    <div className="flex min-w-0 items-baseline gap-2 text-sm">
                        <span className="whitespace-nowrap text-base font-semibold text-slate-100">
                            {t('room_pacs_author', 'Imaging')}
                        </span>
                        {caseTitle && (
                            <>
                                <span className="text-slate-500">·</span>
                                <span className="truncate text-slate-300">{caseTitle}</span>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">{topBarControls}</div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {load.status === 'loading' ? (
                    <p className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {t('radoyon_host_loading_catalogue', 'Loading the imaging catalogue…')}
                    </p>
                ) : (
                    <>
                        {/*
                          * Said once, at the top, rather than repeated on 74
                          * cards. An author whose deployment has no imaging
                          * origin needs to know that the whole library is
                          * missing — not to infer it from every study saying
                          * "No imaging yet".
                          */}
                        {(load.reason || load.error) && (
                            <div className="mx-auto mt-4 flex max-w-5xl items-start gap-2 rounded border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
                                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>
                                    {load.error
                                        ? t('radoyon_host_catalogue_failed', 'The radiology catalogue could not be loaded, so no studies are listed. Reload the page or contact an administrator.')
                                        : load.reason}
                                </span>
                            </div>
                        )}
                        <CaseEditor
                            {...editorProps}
                            initialCase={seed}
                            archive={load.archive}
                            studyCatalogue={load.catalogue}
                            thumbnailFor={thumbnailFor}
                            loadSeriesIndex={loaders.loadSeriesIndex}
                            loadInstance={loaders.loadInstance}
                            t={t}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

export default PacsCaseEditor;
