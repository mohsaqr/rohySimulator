/**
 * Clinical-state mapping — Radoyon's half of the RPS-1 `states` slot.
 *
 * The host resolves "what was this learner doing" from a verb, an object type,
 * or the pair. RPS-1 requires a fallback for EVERY verb the manifest declares,
 * so a new verb cannot land without someone deciding what it means.
 *
 * Since 0.4.0 the per-verb state lives on the verb itself (`clinicalState` in
 * RADOYON_VERB_METADATA, RPS-1 1.6 R33) and this map is DERIVED from it, so
 * the two can never disagree. The object and pair maps stay here: they are
 * claims about object types, not verbs.
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
 * already maps its own radiology result reads to, so a learner's imaging
 * behaviour resolves consistently whichever room produced it.
 */

import { RADOYON_OBJECT_TYPES, RADOYON_VERB_METADATA } from './radoyonEvents.js';

export const RADOYON_VERB_FALLBACKS = Object.freeze(
    Object.fromEntries(Object.entries(RADOYON_VERB_METADATA).map(([verb, meta]) => [verb, meta.clinicalState])),
);

export const RADOYON_OBJECT_OVERRIDES = Object.freeze({
    [RADOYON_OBJECT_TYPES.IMAGING_STUDY]: 'assessing',
    [RADOYON_OBJECT_TYPES.IMAGING_SERIES]: 'assessing',
    [RADOYON_OBJECT_TYPES.IMAGING_IMAGE]: 'assessing',
    [RADOYON_OBJECT_TYPES.IMAGING_MEASUREMENT]: 'assessing',
    [RADOYON_OBJECT_TYPES.IMAGING_REPORT]: 'documenting',
});

export const RADOYON_INTERPRETATIONS = Object.freeze({
    [`MEASURED_REGION:${RADOYON_OBJECT_TYPES.IMAGING_MEASUREMENT}`]: 'assessing',
    [`SUBMITTED_REPORT:${RADOYON_OBJECT_TYPES.IMAGING_REPORT}`]: 'documenting',
    [`DRAFTED_REPORT:${RADOYON_OBJECT_TYPES.IMAGING_REPORT}`]: 'documenting',
});
