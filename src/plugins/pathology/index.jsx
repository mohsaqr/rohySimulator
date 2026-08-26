import { manifest } from './manifest.js';
import { PathologyScreen } from '../../components/pathology/PathologyScreen.jsx';
import { CaseAuthor } from '../../components/pathology/CaseAuthor.jsx';

/**
 * Pathology, expressed as an RPS-1 plugin.
 *
 * This whole file is the adapter. src/components/pathology/ is a byte-identical
 * vendored copy of the upstream package and is not touched — which is the test
 * of whether the standard is real: if plugging something in required editing
 * it, it would not be plug-and-play.
 */
export default {
    manifest,

    component: PathologyScreen,

    // The gate, borrowed from the upstream workstation's own registry: the
    // gross module excludes itself when a case carries no specimen record.
    // Here, a case with no pathology material means no Pathology room in the
    // navigator at all — rather than a room that opens onto an empty state.
    available: (ctx) => ctx.data != null,

    // Map the generic context onto the plugin's own prop names.
    props: (ctx, persist) => ({
        pathologyCase: ctx.data,
        eventLogger: ctx.eventLogger,
        examMode: ctx.session.examMode,

        // The persistence seam VIEWER.md specifies: the package persists
        // nothing and hands back the whole document on every mutation, so the
        // host writes it wherever it likes without replaying a change log.
        initialAnnotations: persist.state.annotations ?? undefined,
        onAnnotationsChange: (slideId, annotations) => persist.save({
            annotations: { ...(persist.state.annotations ?? {}), [slideId]: annotations },
        }),
        // Now persisted: upstream exposes the `initialReports` seed this was
        // waiting on, so a saved report set can be read back and §8's rule
        // ("do not persist what you cannot restore") is satisfied. The seed is
        // read ONCE by the room, and PluginRoom holds the mount until the store
        // load settles — otherwise the room would seed empty and the next
        // mutation would overwrite last session's drafts with [].
        initialReports: persist.state.reports ?? undefined,
        onReportsChange: (reports) => persist.save({ reports }),

        // llmService is no longer passed at all. Upstream removed the prop
        // along with the free-text diagnosis box it existed to grade — there is
        // no longer an answer string for a model to settle, and matching a
        // written report against requireTerms/rejectTerms would misfire on any
        // legitimate differential ("no evidence of malignancy" contains
        // "malignancy"). The manifest's 'llm' request should go with it.
    }),

    // --- authoring ---------------------------------------------------------

    authorComponent: CaseAuthor,

    // The draft is the plugin's slice of the case config, and `save` is
    // whatever the host wires up. Same shape as the room's adapter: the
    // package keeps its own prop vocabulary (`initialCase` / `onChange`) and
    // the mapping lives out here, so src/components/pathology/ stays
    // byte-identical to upstream.
    authorProps: (ctx, draft) => ({
        initialCase: draft.value ?? undefined,
        onChange: draft.save,
    }),
};
