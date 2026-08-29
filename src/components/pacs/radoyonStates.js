/**
 * Clinical-state mapping — Radoyon's half of the RPS-1 `states` slot.
 *
 * The host resolves "what was this learner doing" from a verb, an object type,
 * or the pair. RPS-1 requires a fallback for EVERY verb the manifest declares,
 * so a new verb cannot land without someone deciding what it means.
 *
 * The distinction that carries the teaching weight is `assessing` vs
 * `documenting`. Looking at pixels — scrolling, windowing, measuring — is
 * assessing. Committing to words in a report is documenting. A learner who goes
 * straight from opening a study to submitting a report never assessed anything,
 * and that pattern is exactly what these states let the analytics surface.
 *
 * The state names are NOT free text. They are drawn from the host's clinical
 * state vocabulary, and a state outside it does not error — it falls through to
 * a literal `verb_objectType` bucket and quietly pollutes every TNA model with
 * a state nobody declared. `assessing` for reading images is also what the host
 * already maps its own VIEWED_RADIOLOGY_RESULT to, so a learner's imaging
 * behaviour resolves consistently whichever room produced it.
 */

import { RADOYON_OBJECT_TYPES } from './radoyonEvents.js';

export const RADOYON_VERB_FALLBACKS = Object.freeze({
    OPENED_STUDY: 'assessing',
    CLOSED_STUDY: 'assessing',
    SELECTED_SERIES: 'assessing',
    SCROLLED_SERIES: 'assessing',
    REVIEWED_SERIES: 'assessing',
    CHANGED_WINDOW: 'assessing',
    APPLIED_PRESET: 'assessing',
    MEASURED_DISTANCE: 'assessing',
    MEASURED_REGION: 'assessing',
    DRAFTED_REPORT: 'documenting',
    SUBMITTED_REPORT: 'documenting',
    FAILED_TO_LOAD: 'assessing',
});

export const RADOYON_OBJECT_OVERRIDES = Object.freeze({
    [RADOYON_OBJECT_TYPES.STUDY]: 'assessing',
    [RADOYON_OBJECT_TYPES.SERIES]: 'assessing',
    [RADOYON_OBJECT_TYPES.IMAGE]: 'assessing',
    [RADOYON_OBJECT_TYPES.MEASUREMENT]: 'assessing',
    [RADOYON_OBJECT_TYPES.REPORT]: 'documenting',
});

export const RADOYON_INTERPRETATIONS = Object.freeze({
    [`MEASURED_REGION:${RADOYON_OBJECT_TYPES.MEASUREMENT}`]: 'assessing',
    [`SUBMITTED_REPORT:${RADOYON_OBJECT_TYPES.REPORT}`]: 'documenting',
    [`DRAFTED_REPORT:${RADOYON_OBJECT_TYPES.REPORT}`]: 'documenting',
});
