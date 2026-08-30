import { manifest } from './manifest.js';
import { resolveRemoteRef, resolveRemoteRefs, unresolveRemoteRefs } from '../context.js';
import { createHostAssetService } from '../hostAssetService.js';
import { PathologyScreen } from '../../components/pathology/PathologyScreen.jsx';
import { CaseAuthor } from '../../components/pathology/CaseAuthor.jsx';
import {
    caseDocumentIsServable,
    caseDocumentIssues,
    caseDocumentSummary,
    learnerCase,
    readCaseDocument,
} from '../../components/pathology/hostDocument.js';
import { hasOpticalProfile } from '../../components/pathology/slideGeometry.js';

/**
 * Host-side tightening of the package's servability gate.
 *
 * `caseDocumentIsServable()` admits a slide on `dzi` alone, but the viewer's
 * `opticalProfile()` THROWS on a slide with no optical description (by design:
 * honest magnification) — so a legacy-shaped, dzi-only document passed the
 * gate and then crashed the room at render time. Until the fix lands upstream
 * and is re-vendored, the host asks the stricter question here: material is a
 * slide the viewer can actually render (dzi + complete optics) or a gross
 * photograph. Total by construction, like the gate it wraps.
 */
function hasRenderableMaterial(stored) {
    const viewer = learnerCase(stored);
    if (!viewer) return false;
    const renderableSlide = (viewer.slides ?? []).some(
        (slide) => typeof slide?.dzi === 'string' && slide.dzi !== '' && hasOpticalProfile(slide),
    );
    const photograph = (viewer.specimens ?? []).some((specimen) => (specimen?.images ?? [])
        .some((image) => typeof image?.src === 'string' && image.src !== ''));
    return renderableSlide || photograph;
}

/**
 * Pathology, expressed as an RPS-1 plugin.
 *
 * This whole file is the adapter. src/components/pathology/ is a byte-identical
 * vendored copy of the upstream package and is not touched — which is the test
 * of whether the standard is real: if plugging something in required editing
 * it, it would not be plug-and-play.
 *
 * Every judgement below is DELEGATED to the package rather than made here. The
 * moment this file decides what counts as material or what counts as an error,
 * rohy and any other host answer the same question differently, and a case that
 * is publishable in one is not publishable in the other. The adapter's job is
 * to rename things; upstream's `hostDocument.js` is what actually knows what a
 * pathology case is.
 */
export default {
    manifest,

    component: PathologyScreen,

    // --- the gate (RPS-1 R20) ----------------------------------------------
    //
    // This used to be `ctx.data != null`, which the standard now names as the
    // anti-pattern — and it was one: a case whose document had been saved but
    // never filled put Pathology in the navigator, and opening it showed the
    // room's own empty state, the precise failure available() exists to
    // prevent. The question is not "is there a key" but "is there anything a
    // learner can look at", and only the package can answer it: a slide with a
    // resolvable source, or a gross photograph. Either alone is a real case —
    // a specimen photographed but not yet sectioned is normal teaching
    // material, not a broken case.
    //
    // Total by construction: it cannot throw on a malformed document, so one
    // bad row cannot take the navigator down for every other case.
    available: (ctx) => caseDocumentIsServable(ctx.data) && hasRenderableMaterial(ctx.data),

    // --- the document contract (RPS-1 §11a.2) ------------------------------
    //
    // Pure functions of the document, taking no context, so the server could
    // run them too. `validate` is REQUIRED because this plugin declares
    // `authoring` (R19): an editor whose output the host cannot judge ships
    // the material every learner is assessed against, unreviewable.
    //
    // The host uses these to show issues on the wizard card and to refuse to
    // mark a case available to students — never to refuse to SAVE. A
    // half-finished case is the normal state of an unfinished one.
    validate: (doc) => caseDocumentIssues(doc).map(({ level, message }) => ({ level, message })),

    // `count` fills the plural slot; `labelKey` names the sentence rather than
    // writing it, so the package never ships English into rohy's locales.
    summarize: (doc) => {
        const { count, labelKey } = caseDocumentSummary(doc);
        return { count, labelKey };
    },

    // Map the generic context onto the plugin's own prop names.
    props: (ctx, persist) => ({
        // The LEARNER projection, not the stored document.
        //
        // `ctx.data` is the author's document and carries the rubric — every
        // expected answer, every ROI, every dwell threshold. Handing it to the
        // room would put the answer key in the browser of the person being
        // assessed with it. `learnerCase()` returns the published projection,
        // where protected material is absent by construction rather than
        // filtered out afterwards. `remote:` references have already been
        // rewritten to this plugin's proxy mount by createPluginContext, so
        // this is the case as the viewer can actually open it.
        pathologyCase: learnerCase(ctx.data),
        caseTitle: readCaseDocument(ctx.data)?.manifest?.title ?? undefined,

        eventLogger: ctx.eventLogger,
        examMode: ctx.session.examMode,

        // Upstream used to call `useTranslation()` itself, which quietly made
        // the package unable to render outside a host that had already mounted
        // an i18n provider — it could only ever be a rohy component. It now
        // takes `t` as a prop, defaulting to "use the fallback string", so this
        // is the seam the standard always described and rohy is simply the host
        // that fills it.
        t: ctx.t,

        // The persistence seam: the package persists nothing and hands back the
        // whole document on every mutation, so the host writes it wherever it
        // likes without replaying a change log.
        //
        // This is the LEARNER's work and belongs in ctx.store, per session —
        // never in the case document, which is the author's. RPS-1 §11a.4: two
        // documents, two stores, never confused.
        initialAnnotations: persist.state.annotations ?? undefined,
        onAnnotationsChange: (slideId, annotations) => persist.save({
            annotations: { ...(persist.state.annotations ?? {}), [slideId]: annotations },
        }),
        initialReports: persist.state.reports ?? undefined,
        onReportsChange: (reports) => persist.save({ reports }),
    }),

    // --- authoring ---------------------------------------------------------

    // `CaseAuthor` rather than `CaseStudio`, deliberately — this is §8's
    // ordering trap, not a preference. CaseStudio is CONTROLLED: it renders the
    // `document` prop and expects its owner to hold that state. PluginAuthor
    // re-renders and calls authorProps() each time, so a controlled mount needs
    // a document that is stable across renders, and with no case-config write
    // path yet there is nowhere stable to keep one. CaseAuthor seeds ONCE from
    // `initialCase` and owns the document itself, which is exactly the
    // uncontrolled shape this mount point has.
    //
    // When the wizard surface lands and holds the draft in its own state
    // (todo/pathology-authoring-plan.md WP4), that owner exists and this
    // should become a controlled CaseStudio mount.
    authorComponent: CaseAuthor,

    // The draft is the plugin's slice of the case config; `save` is whatever the
    // host wires up. Normalised on the way IN, so the editor opens the same way
    // on a canonical document, a bare manifest, or a legacy flat case — and the
    // whole canonical document, manifest AND rubric, comes back out.
    //
    // `undefined` rather than `null` for a new case: it means "no case", which
    // is what makes the editor create one and hand back the canonical shape.
    // Handing it a legacy case makes it hand a legacy case back, and that
    // projection drops the rubric — every expected answer with it.
    authorProps: (ctx, draft) => ({
        // Resolved on the way IN, un-resolved on the way OUT. The editor's
        // thumbnails and picker load `<img src>` directly, so they need host
        // addresses; the CASE must keep `remote:` references or it stops being
        // portable. resolve/unresolve round-trip exactly (context.js).
        initialCase: (() => { const doc = readCaseDocument(draft.value); return doc ? resolveRemoteRefs(doc, ctx.pluginId) : undefined; })(),
        onChange: (next) => draft.save(unresolveRemoteRefs(next, ctx.pluginId)),

        // The slide library (§7a.1): the content bundle's catalog.json, relayed
        // by the host to authors and handed over with references resolved.
        assetService: createHostAssetService({ pluginId: ctx.pluginId }),

        // The editor is handed the RAW stored document — unlike the room, whose
        // `ctx.data` createPluginContext has already resolved. So the editor
        // needs the rule itself, or an author referencing a gross photograph
        // would see a placeholder instead of their own picture and have no way
        // to tell a correct reference from a typo.
        //
        // This is also what makes referencing usable at all: a photograph
        // carried inline as a data: URL puts one case at 34 KB and two past the
        // 64 KB a host will store, while the same photographs referenced leave
        // the document at about 2 KB.
        resolveRef: (uri) => resolveRemoteRef(uri, ctx.pluginId),
    }),
};
