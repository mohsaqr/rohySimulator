// Clinical-state resolver — the simulator-domain analogue of LAILA's
// 12 educational learning states (learning/progressing/engaged/…). Where
// LAILA's space is shaped by "what type of LMS object did the student
// touch", ours is shaped by "what part of the clinical reasoning loop
// is the trainee in". The states themselves are documented next to the
// enum in server/shared/learningVerbFacets.js.
//
// This file used to hold three hand-written maps (verb fallbacks, object
// overrides, verb:object interpretations). They are now DERIVED from the verb
// registry's facets — one row per verb, shared with the server and with the
// six other lenses — so a verb added to the registry, or a plugin verb folded
// in from its manifest, resolves here without a second edit. The exported
// names are unchanged so resolveClinicalState() callers and the settings-tab
// override UI keep working untouched.
//
// Resolution chain (matches LAILA's contract):
//   1. explicit `verb:object_type` map  →
//   2. object_type override             →
//   3. verb fallback                    →
//   4. literal `verb_object_type` (so unknown combos are visible in the UI
//      and can be folded into the maps when curated).
//
// Adding a new event source:
//   - a fresh rohy verb → add its facet row to server/shared/learningVerbs.js
//   - a fresh object_type → add it to server/shared/learningObjectTypes.js
//   - a verb:object combo that would otherwise resolve wrong → add an
//     explicit interpretation in server/shared/eventFacets.js
//   - a plugin verb → its manifest's vocabulary/states (RPS-1)

export {
    CLINICAL_STATES,
    VERB_FALLBACKS,
    OBJECT_OVERRIDES,
    DEFAULT_INTERPRETATIONS,
    resolveClinicalState,
} from '../../../../server/shared/eventFacets.js';
