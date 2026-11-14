// Oyon per-sample streams on the wire: the client and server halves of one
// contract (Oyon 3.5.11, docs/ROHY_INTEGRATION.md §4.3a in the Oyon repo).
//
// Imported by BOTH the browser (src/components/oyon/captureBridge.js packs
// POST bodies) and the server (server/routes/oyon-routes.js stores and reads
// raw rows), so it lives in server/shared and stays dependency-free.
//
// RE-VENDOR NOTE (OyonR 3.3.3 → ≥ 3.5.11): `joinRawParts` below is a port of
// Oyon's own `joinRawParts` (oyon/records, src/records/rawParts.js), kept
// here only because the vendored 3.3.3 has no `oyon/records`. After the
// re-vendor, replace the port with
//     export { joinRawParts } from 'oyon/records';
// and keep the tests in tests/server/oyon-raw-streams.test.js passing.

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
 * Rebuild windows that were split across POSTs. PORT of Oyon's
 * `joinRawParts` (see the re-vendor note at the top): the parts sharing
 * `raw_part.id` are merged onto index 0 in index order — per stream the rows
 * are concatenated, a differing field list is unioned with missing cells null —
 * and the joined window keeps `raw_part` with `joined: n` (parts found), so an
 * incomplete set stays visible. Parts whose index-0 window is missing, and
 * raw-only envelopes without `raw_part`, are returned unchanged. Order follows
 * the input; nothing is dropped.
 *
 * @param {object[]} windows
 * @returns {object[]}
 */
export function joinRawParts(windows) {
    if (!Array.isArray(windows)) throw new TypeError('joinRawParts: windows must be an array');
    const groups = new Map();
    windows.forEach((w, position) => {
        const id = w?.raw_part?.id;
        if (typeof id !== 'string' || !id) return;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push({ w, position });
    });
    if (!groups.size) return windows.slice();

    const replaced = new Map(); // position → joined window, or null to skip
    for (const parts of groups.values()) {
        const head = parts.find(p => p.w.raw_part.index === 0);
        if (!head) continue;
        const ordered = parts.slice().sort((a, b) => a.w.raw_part.index - b.w.raw_part.index || a.position - b.position);
        const raw = {};
        for (const { w } of ordered) mergeStreams(raw, w.raw_streams);
        replaced.set(head.position, {
            ...head.w,
            raw_streams: raw,
            raw_part: { ...head.w.raw_part, joined: ordered.length },
        });
        for (const p of ordered) if (p !== head) replaced.set(p.position, null);
    }
    const out = [];
    windows.forEach((w, position) => {
        if (!replaced.has(position)) out.push(w);
        else if (replaced.get(position)) out.push(replaced.get(position));
    });
    return out;
}

function mergeStreams(into, streams) {
    if (!streams || typeof streams !== 'object') return;
    for (const [name, block] of Object.entries(streams)) {
        if (!block || !Array.isArray(block.fields) || !Array.isArray(block.rows)) continue;
        const target = into[name];
        if (!target) {
            into[name] = { ...block, fields: block.fields.slice(), rows: block.rows.slice() };
            continue;
        }
        const added = block.fields.filter(f => !target.fields.includes(f));
        if (added.length) {
            target.fields.push(...added);
            target.rows = target.rows.map(r => [...r, ...added.map(() => null)]);
        }
        const index = target.fields.map(f => block.fields.indexOf(f));
        for (const row of block.rows) target.rows.push(index.map(i => (i < 0 ? null : row[i])));
    }
}
