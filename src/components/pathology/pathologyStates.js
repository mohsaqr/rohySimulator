/**
 * TNA clinical-state rows for the pathology vocabulary.
 *
 * Rohy's clinicalStates.js documents its own extension contract:
 *   - fresh verb        → add a row to VERB_FALLBACKS
 *   - fresh object_type → add a row to OBJECT_OVERRIDES
 *   - wrong combo       → add a row to DEFAULT_INTERPRETATIONS
 * This file supplies exactly those three row-sets. `mergePathologyStates()`
 * folds them into Rohy's maps at wire-up (INTEGRATION.md step 3).
 *
 * DESIGN DECISION — no eleventh state.
 * Pathology screening arguably deserves its own state ('screening'), but
 * CLINICAL_STATES is a literal contract shared with the SVG chart components
 * and an equivalence test. Adding an element there is a Rohy-side change with
 * chart consequences, and this package is meant to be droppable. So every
 * pathology act maps into the existing ten. If you later decide screening
 * earns its own state, it is a one-line push to CLINICAL_STATES plus swapping
 * 'examining' for 'screening' in the SCREENING_ACTS set below — deliberately
 * factored out so that change is mechanical.
 *
 * DOMAIN RATIONALE for the mapping (this is the part a reviewer should argue
 * with, not the code):
 *
 *   examining     Panning and zooming a slide is NOT intent-neutral UI. In
 *                 pathology the low-power screen followed by high-power
 *                 confirmation IS the examination — the direct analogue of
 *                 palpating a body region. Mapping it to 'navigating' (which
 *                 is what the generic drawer/panel rows would do) would erase
 *                 the entire diagnostic act from the transition network.
 *   assessing     Opening a slide, reading its metadata, reviewing the gross
 *                 description — taking information in before acting on it.
 *   documenting   Annotating, submitting a diagnosis, signing a report.
 *   communicating Asking for a second opinion (same bucket as consultant chat).
 *   reflecting    Hints and formative feedback — the debrief-shaped acts.
 *   regulating    Task start/stop — session control, matching LOADED_CASE.
 */

// The acts that are "looking at tissue". Isolated so a future 'screening'
// state is a one-token change rather than a hunt through three maps.
const SCREENING_STATE = 'examining';

export const PATHOLOGY_VERB_FALLBACKS = {
    OPENED_SLIDE: 'assessing',
    CLOSED_SLIDE: 'assessing',

    PANNED_SLIDE: SCREENING_STATE,
    ZOOMED_SLIDE: SCREENING_STATE,
    CHANGED_OBJECTIVE: SCREENING_STATE,
    DWELLED_REGION: SCREENING_STATE,
    REACHED_ROI: SCREENING_STATE,
    MISSED_ROI: SCREENING_STATE,
    COUNTED_FEATURE: SCREENING_STATE,
    MEASURED_SLIDE: SCREENING_STATE,
    VIEWED_SPECIMEN: SCREENING_STATE,
    OPENED_PLATE: SCREENING_STATE,

    ANNOTATED_SLIDE: 'documenting',
    EXPORTED_ANNOTATIONS: 'documenting',
    SUBMITTED_DIAGNOSIS: 'documenting',
    REVISED_DIAGNOSIS: 'documenting',
    SAVED_REPORT: 'documenting',
    SIGNED_REPORT: 'documenting',

    REQUESTED_SECOND_OPINION: 'communicating',

    REQUESTED_HINT: 'reflecting',
    RECEIVED_FEEDBACK: 'reflecting',

    STARTED_SLIDE_TASK: 'regulating',
    COMPLETED_SLIDE_TASK: 'regulating',
};

export const PATHOLOGY_OBJECT_OVERRIDES = {
    slide: 'assessing',
    slide_region: SCREENING_STATE,
    slide_roi: SCREENING_STATE,
    specimen: SCREENING_STATE,
    specimen_plate: SCREENING_STATE,
    slide_measurement: SCREENING_STATE,
    slide_annotation: 'documenting',
    pathology_report: 'documenting',
    slide_task: 'regulating',
};

export const PATHOLOGY_INTERPRETATIONS = {
    // Generic VIEWED against a slide object is information intake, and must
    // beat the object override so it does not read as tissue examination.
    'VIEWED:slide': 'assessing',
    'VIEWED:pathology_report': 'assessing',
    // Opening the slide canvas is intent-to-examine, exactly as Rohy treats
    // 'OPENED:body_region'.
    'OPENED:slide_region': SCREENING_STATE,
    // A measurement recorded onto the report is documentation, not screening.
    'ANNOTATED_SLIDE:slide_measurement': 'documenting',
};

/**
 * Fold the pathology rows into Rohy's three maps.
 *
 * Non-destructive: returns NEW objects, never mutates the maps passed in, so
 * a caller that re-runs it (hot reload, test) cannot accumulate state.
 *
 * Collisions are a hard error, not a silent overwrite. If a future Rohy
 * release defines its own VIEWED_SPECIMEN, this throws at boot with the
 * colliding key rather than silently changing how existing events resolve.
 *
 * @param {object} rohyMaps  {VERB_FALLBACKS, OBJECT_OVERRIDES, DEFAULT_INTERPRETATIONS}
 * @returns {{VERB_FALLBACKS: object, OBJECT_OVERRIDES: object, DEFAULT_INTERPRETATIONS: object}}
 * @throws {Error} when any pathology key already exists in the Rohy map.
 */
export function mergePathologyStates(rohyMaps) {
    if (!rohyMaps || typeof rohyMaps !== 'object') {
        throw new TypeError('mergePathologyStates(rohyMaps): expected an object of Rohy state maps');
    }
    const pairs = [
        ['VERB_FALLBACKS', PATHOLOGY_VERB_FALLBACKS],
        ['OBJECT_OVERRIDES', PATHOLOGY_OBJECT_OVERRIDES],
        ['DEFAULT_INTERPRETATIONS', PATHOLOGY_INTERPRETATIONS],
    ];

    const collisions = pairs.flatMap(([name, additions]) =>
        Object.keys(additions)
            .filter((key) => Object.prototype.hasOwnProperty.call(rohyMaps[name] ?? {}, key))
            .map((key) => `${name}.${key}`));

    if (collisions.length > 0) {
        throw new Error(
            `mergePathologyStates(): ${collisions.length} key(s) already defined by Rohy: `
            + `${collisions.join(', ')}. Rename the pathology key rather than overwriting, `
            + 'or existing events will silently change state.',
        );
    }

    return Object.fromEntries(
        pairs.map(([name, additions]) => [name, { ...(rohyMaps[name] ?? {}), ...additions }]),
    );
}
