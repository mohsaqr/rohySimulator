// Validation of Oyon 3.5.11 `raw_streams` and raw-only envelopes, across the
// OyonR vendor seam.
//
// The vendored OyonR (3.3.3) validator predates both: it rejects
// `modality: 'raw'` as an unknown modality and does not look at
// `raw_streams` at all. Oyon ≥ 3.5.11 validates both itself
// (`validateRawStreamsBlock`, 'raw' in OYON_MODALITIES). So:
//   - when the vendored validator knows 'raw' (`OYON_VALIDATES_RAW`), it is
//     the only validator and this module adds nothing;
//   - otherwise raw-only envelopes are checked here instead of by it, and
//     every event's raw_streams is checked with the same rules.
//
// RE-VENDOR NOTE: after OyonR ≥ 3.5.11, OYON_VALIDATES_RAW is true and the
// fallback below is dead code — delete `fallbackValidateRawStreams` and the
// envelope checks, keep the seam test.
//
// Shape and size only (Oyon's data policy): which streams and fields travel is
// never restricted here; consent and tenant switches are applied at storage
// (filterRawStreams), not by rejecting a batch.

import * as oyonValidation from 'oyon/validation';
import { OYON_MODALITIES } from 'oyon/version';
import { OYON_RAW_MODALITY, isRawOnlyEvent } from '../shared/oyonRawParts.js';

/** True when the vendored validator handles raw-only envelopes and raw_streams itself. */
export const OYON_VALIDATES_RAW = OYON_MODALITIES.includes(OYON_RAW_MODALITY)
    && typeof oyonValidation.validateRawStreamsBlock === 'function';

/** Oyon's transport bounds for raw_streams (src/validation/validateEmotionPayload.js). */
const MAX_RAW_STREAM_BYTES = 1_000_000;
const MAX_RAW_STREAM_FIELDS = 256;
const MAX_RAW_STREAM_NAME = 64;
const MAX_RAW_STREAM_CELL_STRING = 200;
const RAW_STREAM_NAME = /^[a-z][a-z0-9_]*$/;
const MAX_RAW_REASON = 64;
const MAX_RAW_PART_ID = 200;

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Same rules as Oyon 3.5.11 validateRawStreamsBlock (fallback for the 3.3.3 vendor). */
function fallbackValidateRawStreams(rawStreams, prefix, errors) {
    if (rawStreams === null || rawStreams === undefined) return;
    if (!isPlainObject(rawStreams)) {
        errors.push(`${prefix} must be an object of streams`);
        return;
    }
    for (const [name, block] of Object.entries(rawStreams)) {
        const path = `${prefix}.${name}`;
        if (name.length > MAX_RAW_STREAM_NAME || !RAW_STREAM_NAME.test(name)) {
            errors.push(`${path}: stream names are lower_snake_case, at most ${MAX_RAW_STREAM_NAME} characters`);
            continue;
        }
        if (!isPlainObject(block) || !Array.isArray(block.fields) || !Array.isArray(block.rows)) {
            errors.push(`${path} must be { fields: string[], rows: any[][] }`);
            continue;
        }
        const { fields, rows } = block;
        if (fields.length < 1 || fields.length > MAX_RAW_STREAM_FIELDS
            || fields.some(f => typeof f !== 'string' || !f || f.length > MAX_RAW_STREAM_NAME)) {
            errors.push(`${path}.fields must be 1-${MAX_RAW_STREAM_FIELDS} non-empty strings`);
            continue;
        }
        if (fields[0] !== 'ts_ms') errors.push(`${path}.fields[0] must be 'ts_ms'`);
        if (new Set(fields).size !== fields.length) errors.push(`${path}.fields must be unique`);
        const badRow = rows.findIndex(row => !Array.isArray(row) || row.length !== fields.length
            || row.some(cell => !(cell === null || Number.isFinite(cell)
                || (typeof cell === 'string' && cell.length <= MAX_RAW_STREAM_CELL_STRING))));
        if (badRow >= 0) errors.push(`${path}.rows[${badRow}] must have one number/short-string/null cell per field`);
    }
    if (JSON.stringify(rawStreams).length > MAX_RAW_STREAM_BYTES) {
        errors.push(`${prefix} is too large`);
    }
}

function validateRawStreams(rawStreams, prefix, errors) {
    if (OYON_VALIDATES_RAW) oyonValidation.validateRawStreamsBlock(rawStreams, prefix, errors, {});
    else fallbackValidateRawStreams(rawStreams, prefix, errors);
}

const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** The envelope rules Oyon 3.5.11 applies to a raw-only event (modality 'raw'). */
function validateRawOnlyEnvelope(event, prefix, errors) {
    if (!isIso(event.window_start)) errors.push(`${prefix}.window_start must be an ISO timestamp`);
    if (!isIso(event.window_end)) errors.push(`${prefix}.window_end must be an ISO timestamp`);
    if (isIso(event.window_start) && isIso(event.window_end)
        && Date.parse(event.window_end) < Date.parse(event.window_start)) {
        errors.push(`${prefix}.window_end must not precede window_start`);
    }
    if (event.raw_reason !== undefined && event.raw_reason !== null
        && (typeof event.raw_reason !== 'string' || event.raw_reason.length > MAX_RAW_REASON)) {
        errors.push(`${prefix}.raw_reason must be a short string`);
    }
}

/**
 * `raw_part` on any event: `{ id, index, count }`, index < count. Rohy's own
 * storage contract (oyon_raw_streams.raw_part_*), checked whatever OyonR is
 * vendored — Oyon's validator does not look at raw_part.
 */
function validateRawPart(part, prefix, errors) {
    if (part === undefined || part === null) return;
    if (!isPlainObject(part)
        || typeof part.id !== 'string' || !part.id || part.id.length > MAX_RAW_PART_ID
        || !Number.isInteger(part.index) || part.index < 0
        || !Number.isInteger(part.count) || part.count < 1 || part.index >= part.count) {
        errors.push(`${prefix}.raw_part must be { id, index, count } with 0 <= index < count`);
    }
}

/**
 * Validate a batch the way Oyon ≥ 3.5.11 does, whatever OyonR is vendored.
 *
 * @param {object} body  the POST body ({ events: [...] })
 * @param {(payload: object, options: object) => { ok: boolean, errors: string[] }} validateEmotionBatch
 * @param {object} options  validateEmotionBatch options (maxBatchEvents, …)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateOyonBatch(body, validateEmotionBatch, options) {
    const events = Array.isArray(body?.events) ? body.events : null;
    if (!events) return validateEmotionBatch(body, options);
    const partErrors = [];
    events.forEach((event, index) => validateRawPart(event?.raw_part, `events[${index}]`, partErrors));
    if (OYON_VALIDATES_RAW) {
        const result = validateEmotionBatch(body, options);
        const errors = [...result.errors, ...partErrors];
        return { ok: errors.length === 0, errors };
    }
    const errors = [...partErrors];
    if (events.length > options.maxBatchEvents) {
        errors.push(`events must contain at most ${options.maxBatchEvents} items`);
    }
    // Windows go to the vendored validator; raw-only events are checked here.
    const windows = events.filter(e => !isRawOnlyEvent(e));
    if (windows.length || !events.length) {
        errors.push(...validateEmotionBatch({ ...body, events: windows }, options).errors);
    }
    events.forEach((event, index) => {
        const prefix = `events[${index}]`;
        if (isRawOnlyEvent(event)) validateRawOnlyEnvelope(event, prefix, errors);
        validateRawStreams(event?.raw_streams, `${prefix}.raw_streams`, errors);
    });
    return { ok: errors.length === 0, errors };
}
