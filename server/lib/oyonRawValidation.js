// Validation of Oyon's per-sample streams, raw-only envelopes and split
// windows, at the OyonR vendor seam.
//
// OyonR ≥ 3.5.11 validates all of it itself: 'raw' is in OYON_MODALITIES,
// validateRawStreamsBlock checks every event's raw_streams, and
// validateRawPart checks `raw_part: { id, index, count }`. Rohy therefore
// validates a batch with Oyon's validator alone (validateOyonBatch below).
// The fallback this module carried while OyonR was 3.3.3 is gone; the guard
// makes a re-vendor to an Oyon without those checks fail at start-up rather
// than accept unchecked payloads.
//
// Shape and size only (Oyon's data policy): which streams and fields travel is
// never restricted here; consent and tenant switches are applied at storage
// (filterRawStreams), not by rejecting a batch.

import * as oyonValidation from 'oyon/validation';
import { OYON_MODALITIES } from 'oyon/version';
import { OYON_RAW_MODALITY } from '../shared/oyonRawParts.js';

/** True when the vendored validator handles raw-only envelopes, raw_streams and raw_part itself. */
export const OYON_VALIDATES_RAW = OYON_MODALITIES.includes(OYON_RAW_MODALITY)
    && typeof oyonValidation.validateRawStreamsBlock === 'function'
    && typeof oyonValidation.validateRawPart === 'function';

if (!OYON_VALIDATES_RAW) {
    throw new Error('OyonR predates Oyon 3.5.11: its validator does not check raw-only envelopes, '
        + 'raw_streams or raw_part. Re-vendor Oyon ≥ 3.5.11 (npm run oyon:update).');
}

/**
 * Validate an Oyon window batch.
 *
 * @param {object} body  the POST body ({ events: [...] })
 * @param {(payload: object, options: object) => { ok: boolean, errors: string[] }} validateEmotionBatch
 * @param {object} options  validateEmotionBatch options (maxBatchEvents, …)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateOyonBatch(body, validateEmotionBatch, options) {
    return validateEmotionBatch(body, options);
}
