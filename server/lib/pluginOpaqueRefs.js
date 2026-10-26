// Opaque content references for learners (security audit 2026-10-26, F-25).
//
// A plugin's content is addressed by PATH, and the paths name the answer:
// `remote:dicom/abnormal/rul_nodule/s1/`, `remote:tiles/cardiac-mi-05-neutrophils.dzi`,
// an archive entry `abnormal/echo_endocarditis_aortic`. The learner's browser
// loads those addresses, so the finding was readable in the network panel of
// the person being assessed on finding it — the "no clues in learner-visible
// case text" rule, broken by a URL.
//
// So a learner is handed a SEALED reference instead: the real path, encrypted
// and authenticated under a key only the server holds, and the content proxy
// (routes/plugins-routes.js) opens it again on the way in. The learner can
// still load everything the case shows them; what they can no longer do is
// read what it is called.
//
// WHY ENCRYPTION AND NOT A LOOKUP TABLE
//
// A random token per path needs a table, a writer for every place a path is
// created (catalogs, case documents, imported slides, packages), and a
// migration. A deterministic authenticated encryption needs none of that: the
// same path always seals to the same token (so the case document and the
// catalog agree on an archive id without talking to each other), any path can
// be sealed wherever it is projected, and the proxy recovers the path from the
// token alone. The construction is SIV-shaped: IV = HMAC-SHA256(macKey,
// plaintext)[0:16], ciphertext = AES-256-CTR(encKey, IV, plaintext), and
// opening recomputes the HMAC over the decrypted text, so a forged or altered
// token opens to nothing rather than to a path of the caller's choosing.
//
// The plaintext is padded to a multiple of PAD_BYTES so the token's length does
// not separate `normal/` from `abnormal/`.
//
// Keys come from JWT_SECRET through HKDF, so an install needs no new secret and
// a rotated JWT_SECRET simply re-seals every reference (a learner reloads the
// case and gets the new ones; nothing stored holds a sealed reference).

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

const REMOTE_SCHEME = 'remote:';

/** The first path segment that marks a sealed reference in a content URL. */
export const OPAQUE_SEGMENT = '_o';

const IV_BYTES = 16;
const PAD_BYTES = 64;
// Longer than any content path rohy writes (the starter bundles' longest is
// under 80 bytes); a bound so a crafted token cannot make the proxy decrypt
// megabytes per request.
const MAX_PLAINTEXT_BYTES = 512;
const KIND_PATH = 'p';
const KIND_ARCHIVE_ID = 'i';

/** A DZI's tiles live beside it at `<stem>_files/`; a viewer derives that address from the descriptor's. */
const DZI_SUFFIX = '.dzi';
const DZI_TILES_SUFFIX = '_files';

let cachedKeys = null;

function keys() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        // The server refuses to boot without it (config/validateEnv.js); reaching
        // here without one is a test or tool misconfiguration, said plainly.
        const err = new Error('JWT_SECRET is required to seal plugin content references');
        err.code = 'opaque_ref_no_secret';
        throw err;
    }
    if (cachedKeys?.secret !== secret) {
        const material = Buffer.from(hkdfSync('sha256', secret, 'rohy-plugin-opaque-ref', 'v1', 64));
        cachedKeys = { secret, mac: material.subarray(0, 32), enc: material.subarray(32, 64) };
    }
    return cachedKeys;
}

function seal(kind, pluginId, value) {
    if (typeof value !== 'string' || value === '' || value.includes('\0')) return null;
    const plain = Buffer.from(`${kind}\0${pluginId}\0${value}`, 'utf8');
    if (plain.length > MAX_PLAINTEXT_BYTES) return null;
    const padded = Buffer.alloc(Math.ceil(plain.length / PAD_BYTES) * PAD_BYTES);
    plain.copy(padded);
    const { mac, enc } = keys();
    const iv = createHmac('sha256', mac).update(padded).digest().subarray(0, IV_BYTES);
    const cipher = createCipheriv('aes-256-ctr', enc, iv);
    return Buffer.concat([iv, cipher.update(padded), cipher.final()]).toString('hex');
}

function open(kind, pluginId, token) {
    if (typeof token !== 'string' || !/^[0-9a-f]+$/.test(token) || token.length % 2 !== 0) return null;
    const bytes = Buffer.from(token, 'hex');
    const body = bytes.length - IV_BYTES;
    if (body <= 0 || body % PAD_BYTES !== 0 || body > MAX_PLAINTEXT_BYTES + PAD_BYTES) return null;
    const iv = bytes.subarray(0, IV_BYTES);
    const { mac, enc } = keys();
    const decipher = createDecipheriv('aes-256-ctr', enc, iv);
    const padded = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES)), decipher.final()]);
    const expected = createHmac('sha256', mac).update(padded).digest().subarray(0, IV_BYTES);
    if (!timingSafeEqual(expected, iv)) return null;
    const text = padded.toString('utf8').replace(/\0+$/, '');
    const [gotKind, gotPlugin, ...rest] = text.split('\0');
    if (gotKind !== kind || gotPlugin !== pluginId || rest.length !== 1 || rest[0] === '') return null;
    return rest[0];
}

/** A content path as both sides compare it: segments joined by `/`, no leading or trailing slash. */
function normalPath(path) {
    return String(path).split('/').filter(Boolean).join('/');
}

/**
 * One `remote:` reference, sealed for this plugin. Anything that is not a
 * `remote:` reference (an absolute URL, an embedded image, a non-string) is
 * returned unchanged, and so is a reference that is already sealed.
 *
 * A `.dzi` keeps its suffix outside the seal, because the viewer derives the
 * tile address from the descriptor's (`X.dzi` → `X_files/<level>/<x>_<y>`);
 * a sealed `X` then answers both.
 *
 * @param {string} pluginId
 * @param {*} ref
 * @returns {*}
 */
export function opaqueRemoteRef(pluginId, ref) {
    if (typeof ref !== 'string' || !ref.startsWith(REMOTE_SCHEME)) return ref;
    const path = normalPath(ref.slice(REMOTE_SCHEME.length));
    if (path === '' || path.split('/')[0] === OPAQUE_SEGMENT) return ref;
    const isDzi = path.toLowerCase().endsWith(DZI_SUFFIX);
    const stem = isDzi ? path.slice(0, -DZI_SUFFIX.length) : path;
    const token = seal(KIND_PATH, pluginId, stem);
    if (!token) return ref;
    return `${REMOTE_SCHEME}${OPAQUE_SEGMENT}/${token}${isDzi ? DZI_SUFFIX : ''}`;
}

/** Deep walk of opaqueRemoteRef: the same shape with every `remote:` string sealed. */
export function opaqueRemoteRefs(pluginId, value) {
    if (typeof value === 'string') return opaqueRemoteRef(pluginId, value);
    if (Array.isArray(value)) return value.map((v) => opaqueRemoteRefs(pluginId, v));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, opaqueRemoteRefs(pluginId, v)]));
    }
    return value;
}

/**
 * An archive entry id (PACS: `abnormal/rul_nodule`), sealed. Deterministic, so
 * a case document's `baseline.ref` and the learner catalog's `id` — projected
 * separately — still match.
 *
 * @param {string} pluginId
 * @param {string} id
 * @returns {string} the sealed id, or the input when it cannot be sealed
 */
export function opaqueArchiveId(pluginId, id) {
    return seal(KIND_ARCHIVE_ID, pluginId, typeof id === 'string' ? id : '') ?? id;
}

/**
 * A plugin's case document as a learner receives it: every `remote:` path
 * sealed, and every archive baseline (`{kind: 'archive', ref}` — the
 * vocabulary Radoyon's caseDocument.js defines) sealed as an archive id.
 *
 * Applied to the learner projection only; an author keeps the real
 * references, because the document they edit must stay portable.
 *
 * @param {string} pluginId
 * @param {*} document
 * @returns {*}
 */
export function opaqueLearnerDocument(pluginId, document) {
    const walk = (node) => {
        if (typeof node === 'string') return opaqueRemoteRef(pluginId, node);
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
            const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
            if (node.kind === 'archive' && typeof node.ref === 'string' && node.ref !== '') {
                out.ref = opaqueArchiveId(pluginId, node.ref);
            }
            return out;
        }
        return node;
    };
    return walk(document);
}

/**
 * The real content path behind a sealed request path, or null.
 *
 * `segments` are the proxy's decoded path segments AFTER the plugin id, e.g.
 * `['_o', '<token>.dzi']`, `['_o', '<token>_files', '12', '3_4.jpeg']` or
 * `['_o', '<token>', 'index.json']`. Returns `{opaque: false}` for a request
 * that is not sealed at all, so the caller can tell "not sealed" from
 * "sealed but invalid".
 *
 * @param {string} pluginId
 * @param {string[]} segments
 * @returns {{opaque: false}|{opaque: true, segments: string[]|null}}
 */
export function openOpaqueSegments(pluginId, segments) {
    if (!Array.isArray(segments) || segments[0] !== OPAQUE_SEGMENT) return { opaque: false };
    const match = /^([0-9a-f]+)(.*)$/.exec(segments[1] ?? '');
    if (!match) return { opaque: true, segments: null };
    const [, token, suffix] = match;
    const rest = segments.slice(2);
    if (suffix !== '' && suffix !== DZI_SUFFIX && suffix !== DZI_TILES_SUFFIX) return { opaque: true, segments: null };
    if (suffix === DZI_SUFFIX && rest.length > 0) return { opaque: true, segments: null };
    const stem = open(KIND_PATH, pluginId, token);
    if (!stem) return { opaque: true, segments: null };
    const real = [...`${stem}${suffix}`.split('/'), ...rest];
    return { opaque: true, segments: real };
}
