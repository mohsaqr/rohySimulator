import { manifest } from './manifest.js';
import { PacsRoom } from './PacsRoom.jsx';
import { resolveRemoteRefs, unresolveRemoteRefs } from '../context.js';
import { CaseEditor } from '../../components/pacs/CaseEditor.jsx';
import {
    documentIsServable, documentIssues, documentSummary, learnerDocument,
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

    component: PacsRoom,

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
    authorComponent: CaseEditor,

    authorProps: (ctx, draft) => ({
        // Resolved on the way IN, un-resolved on the way OUT. The editor shows
        // references to an author and must render host addresses for anything
        // it previews; the CASE must keep `remote:` references or it stops
        // being portable across deployments.
        initialCase: draft.value ? readDocument(draft.value) : undefined,
        onChange: (next) => draft.save(unresolveRemoteRefs(next, ctx.pluginId)),

        // The archive of normals, relayed by the host from the configured
        // origin. Absent origin means an empty catalogue and an author who can
        // still type a `remote:` reference by hand — degraded, not broken.
        archive: ctx.archive ?? { entries: [] },

        // rohy's own radiology catalogue, so an authored study can be LINKED to
        // the study a learner orders in the Radiology room. This is the join
        // that makes ordering a CT produce images rather than only a report.
        studyCatalogue: ctx.studyCatalogue ?? [],

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
function worklistProps(ctx) {
    const doc = learnerDocument(ctx.data);
    const archive = readArchive(ctx.archive ?? { entries: [] });

    const worklist = doc.worklist.map((entry) => {
        const baseline = entry.baseline.kind === 'archive'
            ? entryById(archive, entry.baseline.ref)
            : null;
        // A `remote:` baseline has no catalogue entry to expand — the series
        // IS the reference, and its geometry (instance count, plane) comes
        // from the index.json the loader fetches when the study is opened.
        // Without this synthesis the entry resolved to zero series and the
        // room showed it as an unclickable "Pending" with no explanation and
        // no network attempt.
        const remoteBaselineSeries = entry.baseline.kind === 'remote' && entry.baseline.ref
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
