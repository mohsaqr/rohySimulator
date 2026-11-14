// Oyon per-sample streams on the wire: the client and server halves of one
// contract (Oyon 3.5.11, docs/ROHY_INTEGRATION.md §4.3a in the Oyon repo).
//
// Imported by BOTH the browser (src/components/oyon/captureBridge.js packs
// POST bodies) and the server (server/routes/oyon-routes.js stores and reads
// raw rows), so it lives in server/shared; its one import is Oyon's light
// `oyon/records` subpath, which both sides resolve.
//
// joinRawParts is re-exported from Oyon (oyon/records, OyonR >= 3.5.11).

/** The modality of a raw-only envelope or continuation part. */
export const OYON_RAW_MODALITY = 'raw';

/**
 * Events per POST. The server validates batches against this (validateEmotionBatch
 * maxBatchEvents) and the client packs to it, so they cannot disagree.
 */
export const OYON_MAX_BATCH_EVENTS = 64;

/**
 * Target size of one POST body built by the client (240 KiB — Oyon's own
 * transport default). Whole events are packed up to it; one event larger than
 * it goes in a body of its own, which the route's parser accepts up to
 * OYON_EMOTION_RECORDS_MAX_BODY.
 */
export const OYON_PERSIST_TARGET_BYTES = 240 * 1024;

/**
 * The JSON body limit of POST /api/addons/oyon/emotion-records only (the
 * global parser stays at 256 KB). Rohy posts the element's windows itself
 * rather than through Oyon's HttpEmotionTransport, so a window is never split
 * into continuation parts on the way here: one window with its raw_streams
 * (bounded by Oyon's validator at 1 MB) must fit one body.
 */
export const OYON_EMOTION_RECORDS_MAX_BODY = '2mb';

/** A raw-only envelope or continuation part (`modality: 'raw'`). */
export function isRawOnlyEvent(event) {
    return Boolean(event) && typeof event === 'object' && event.modality === OYON_RAW_MODALITY;
}

/**
 * The Rohy modality a raw stream belongs to, for the same tenant switches and
 * consent checks the window blocks get. A stream not listed has no switch of
 * its own (affect and head come with the camera consent; eye with engagement).
 */
export const OYON_RAW_STREAM_MODALITY = Object.freeze({
    au: 'facial',
    blendshapes: 'facial',
    posture: 'posture',
    heart_rate: 'heart_rate',
    ibi: 'heart_rate',
    respiration: 'respiration',
    illumination: 'illumination',
    screen_gaze: 'gaze',
    speech: 'voice',
});

/**
 * The streams `allow(modality)` permits, or null when none are left (or there
 * were none). Pure; the input is not changed.
 *
 * @param {object|null|undefined} rawStreams `{ name: { fields, rows } }`
 * @param {(modality: string) => boolean} allow
 * @returns {{ streams: object|null, dropped: string[] }}
 */
export function filterRawStreams(rawStreams, allow) {
    if (!rawStreams || typeof rawStreams !== 'object') return { streams: null, dropped: [] };
    const streams = {};
    const dropped = [];
    for (const [name, block] of Object.entries(rawStreams)) {
        const modality = OYON_RAW_STREAM_MODALITY[name];
        if (modality && !allow(modality)) dropped.push(name);
        else streams[name] = block;
    }
    return { streams: Object.keys(streams).length ? streams : null, dropped };
}

/** Rows across every stream of a `raw_streams` block. */
export function rawStreamRowCount(rawStreams) {
    if (!rawStreams || typeof rawStreams !== 'object') return 0;
    return Object.values(rawStreams)
        .reduce((n, block) => n + (Array.isArray(block?.rows) ? block.rows.length : 0), 0);
}

const utf8 = typeof TextEncoder === 'function' ? new TextEncoder() : null;
function jsonBytes(value) {
    const text = JSON.stringify(value);
    return utf8 ? utf8.encode(text).length : text.length;
}

/**
 * Pack events into POST batches of at most `maxEvents` events and, where
 * possible, at most `maxBytes` of JSON. Whole events only, order kept, nothing
 * dropped: an event larger than `maxBytes` goes in a batch of its own.
 *
 * @param {object[]} events
 * @param {{ maxEvents?: number, maxBytes?: number, envelopeBytes?: number }} [options]
 *   envelopeBytes — the body's own bytes besides the events (schema_version, session_id).
 * @returns {object[][]}
 */
export function packPersistBatches(events, {
    maxEvents = OYON_MAX_BATCH_EVENTS,
    maxBytes = OYON_PERSIST_TARGET_BYTES,
    envelopeBytes = 256,
} = {}) {
    if (!Array.isArray(events)) throw new TypeError('packPersistBatches: events must be an array');
    if (!(Number.isInteger(maxEvents) && maxEvents >= 1)) throw new TypeError('packPersistBatches: maxEvents must be a positive integer');
    const batches = [];
    let current = [];
    let size = envelopeBytes;
    for (const event of events) {
        const bytes = jsonBytes(event) + 1; // + the comma between events
        if (current.length && (current.length >= maxEvents || size + bytes > maxBytes)) {
            batches.push(current);
            current = [];
            size = envelopeBytes;
        }
        current.push(event);
        size += bytes;
    }
    if (current.length) batches.push(current);
    return batches;
}

/**
 * Rebuild windows split across POSTs (Oyon's own joinRawParts; the parts that
 * share `raw_part.id` are merged onto index 0, nothing is dropped).
 */
export { joinRawParts } from 'oyon/records';
