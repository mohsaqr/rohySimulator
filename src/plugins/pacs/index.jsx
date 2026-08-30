import { manifest } from './manifest.js';
import { PacsRoomHost } from './PacsRoomHost.jsx';
import { PacsCaseEditor } from './PacsCaseEditor.jsx';
import { resolveRemoteRef, resolveRemoteRefs, unresolveRemoteRefs } from '../context.js';
import {
    SOURCE_KIND, documentIsServable, documentIssues, documentSummary, learnerDocument,
    readDocument, resolveEntry,
} from '../../components/pacs/caseDocument.js';
import { entryById, readArchive } from '../../components/pacs/archive.js';

/**
 * The PACS reading room, expressed as an RPS-1 plugin.
 *
 * This whole file is the adapter. src/components/pacs/ is a byte-identical
 * vendored copy of the upstream Radoyon package and is not touched — which is
 * the test of whether the standard is real: if plugging something in required
 * editing it, it would not be plug-and-play.
 *
 * Every clinical judgement below is DELEGATED to the package rather than made
 * here. The moment this file decides what counts as a servable study or what
 * counts as an error, rohy and any other host answer the same question
 * differently and a case publishable in one is not publishable in the other.
 * The adapter's job is to rename things and to supply rohy's services.
 */
export default {
    manifest,

    component: PacsRoomHost,

    // --- the gate (RPS-1 R20) ----------------------------------------------
    //
    // Not `ctx.data != null`, which the standard names as the anti-pattern: a
    // case whose document was saved but never filled would put PACS in the
    // navigator and then show the room's own empty state, the precise failure
    // available() exists to prevent. The question is "is there anything a
    // learner can open", and only the package can answer it.
    //
    // Total by construction — it cannot throw on a malformed document, so one
    // bad row cannot take the navigator down for every other case.
    available: (ctx) => documentIsServable(ctx.data),

    // --- the document contract (RPS-1 §11a.2) ------------------------------
    //
    // Pure functions of the document, taking no context, so the server runs the
    // same judgements. `validate` is REQUIRED because this plugin declares
    // `authoring` (R19): an editor whose output the host cannot judge ships the
    // material every learner is assessed against, unreviewable.
    //
    // Used to show issues on the wizard card and to refuse to mark a case
    // available to students — never to refuse to SAVE.
    validate: (doc) => documentIssues(doc).map(({ level, message }) => ({ level, message })),

    // `count` fills the plural slot; `labelKey` names the sentence rather than
    // writing it, so the package never ships English into rohy's locales.
    summarize: (doc) => {
        const { count, labelKey } = documentSummary(doc);
        return { count, labelKey };
    },

    props: (ctx, persist) => ({
        // The LEARNER projection, not the stored document. `ctx.data` is the
        // author's and carries the rubric — every expected finding, every key
        // image. Handing it to the room would put the answer key in the browser
        // of the person being assessed with it. `learnerDocument()` returns the
        // published projection, where the rubric is absent by construction
        // rather than filtered out afterwards.
        //
        // The server ALSO strips it (manifest.document.learnerOmit), so this is
        // defence in depth, not the only defence.
        ...worklistProps(ctx),

        // The room's half of the archive problem. `worklistProps` above can
        // only resolve what `ctx.archive` holds, and the context is built
        // synchronously — so the descriptor also hands over the RULE, and
        // PacsRoomHost re-runs it once the archive has been fetched. Passing a
        // resolver rather than the resolved list keeps the swap in exactly one
        // place; a second copy in the wrapper is how the room and the editor
        // start disagreeing about what a learner sees.
        resolveWorklist: (archive) => worklistProps({ ...ctx, archive }).worklist,
        // Only a case that actually names an archive entry pays for the fetch.
        needsArchive: documentNeedsArchive(ctx.data),

        eventLogger: ctx.eventLogger,
        // Upstream takes `t` as a prop rather than calling useTranslation()
        // itself, which would make the package unable to render outside a host
        // that had already mounted an i18n provider. This is the seam the
        // standard describes and rohy is simply the host that fills it.
        t: ctx.t,

        // The learner's own work: measurements belong in ctx.store, per
        // session — never in the case document, which is the author's.
        // RPS-1 §11a.4: two documents, two stores, never confused.
        initialMeasurements: persist.state.measurements ?? undefined,
        onMeasurementsChange: (measurements) => persist.save({ measurements }),
    }),

    // --- authoring ---------------------------------------------------------
    //
    // `CaseEditor` is uncontrolled-with-seed: PluginAuthor re-renders and
    // recomputes authorProps on every change, so a controlled mount would need
    // a document stable across renders and there is nowhere stable to keep one.
    //
    // Mounted through the adapter's own shell (PacsCaseEditor) rather than
    // directly, because two of the things the editor needs cannot come from a
    // synchronous props adapter: the ARCHIVE and the STUDY CATALOGUE are
    // fetched, and the host's Done/Discard controls have no slot in a package
    // that renders no top bar. Both are host concerns, so both live in the
    // adapter — the vendored file is still untouched.
    authorComponent: PacsCaseEditor,

    authorProps: (ctx, draft) => ({
        // Resolved on the way IN, un-resolved on the way OUT. The editor shows
        // references to an author and must render host addresses for anything
        // it previews; the CASE must keep `remote:` references or it stops
        // being portable across deployments.
        initialCase: draft.value ? readDocument(draft.value) : undefined,
        onChange: (next) => draft.save(unresolveRemoteRefs(next, ctx.pluginId)),

        // The archive of normals and rohy's radiology catalogue are fetched by
        // PacsCaseEditor — see hostArchive.js and hostStudyCatalogue.js. They
        // are deliberately NOT read off `ctx` here: nothing ever put them
        // there, which is precisely how both silently defaulted to empty and
        // left the editor showing 0 studies against a 74-study catalogue.

        // The editor is handed the RAW stored document, so it needs the
        // resolution rule itself — its preview and its picker load addresses
        // directly and know nothing about `remote:`.
        resolveRef: (uri) => resolveRemoteRef(uri, ctx.pluginId),

        eventLogger: ctx.eventLogger,
        t: ctx.t,
    }),
};

/**
 * Flatten the learner's document into the worklist the room renders, resolving
 * each entry's baseline against the archive and applying its substitutions.
 *
 * The swap happens HERE, in the host, because only the host can resolve an
 * `archive:` id into series — the package deliberately does not know where the
 * archive lives.
 */
export function worklistProps(ctx) {
    const doc = learnerDocument(ctx.data);
    const archive = readArchive(ctx.archive ?? { entries: [] });

    const worklist = doc.worklist.map((entry) => {
        const baseline = entry.baseline.kind === SOURCE_KIND.ARCHIVE
            ? entryById(archive, entry.baseline.ref)
            : null;
        // A `remote:` baseline has no catalogue entry to expand — the series
        // IS the reference, and its geometry (instance count, plane) comes
        // from the index.json the loader fetches when the study is opened.
        // Without this synthesis the entry resolved to zero series and the
        // room showed it as an unclickable "Pending" with no explanation and
        // no network attempt.
        const remoteBaselineSeries = entry.baseline.kind === SOURCE_KIND.REMOTE && entry.baseline.ref
            ? [{
                key: 'baseline',
                description: entry.description || entry.studyId,
                plane: 'unknown',
                instances: 0,
                ref: entry.baseline.ref,
            }]
            : [];
        const { series } = resolveEntry(entry, {
            baselineSeries: baseline?.series ?? remoteBaselineSeries,
        });

        // The first series is what the room opens; the rest are the rail.
        // `remote:` is rewritten to this plugin's proxy mount so the loader
        // receives an address it can actually fetch.
        return {
            id: entry.id,
            studyId: entry.studyId,
            description: entry.description || baseline?.label || entry.studyId,
            accession: entry.accession,
            available: series.length > 0,
            ref: resolveRemoteRefs(series[0]?.ref ?? null, ctx.pluginId),
            series: resolveRemoteRefs(series, ctx.pluginId),
            report: entry.report,
        };
    });

    return { worklist };
}

/**
 * Does this case need the host to fetch the archive before its worklist means
 * anything?
 *
 * True exactly when some entry's baseline is an archive id — the one thing the
 * document can say that the host alone can resolve. A case built entirely from
 * `remote:` references resolves fully from the document, and asking for a
 * catalogue it will not read would put an extra request in front of every
 * learner opening the room.
 *
 * Total by construction, like every other judgement in this file: it runs on a
 * stored document that may be anything.
 *
 * @param {*} doc the stored case document
 * @returns {boolean}
 */
export function documentNeedsArchive(doc) {
    return readDocument(doc).worklist.some(
        (entry) => entry.baseline.kind === SOURCE_KIND.ARCHIVE && Boolean(entry.baseline.ref),
    );
}
