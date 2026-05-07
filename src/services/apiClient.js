/**
 * Centralized API client for rohy.
 *
 * Every authenticated request to /api/* should go through apiFetch() (or one
 * of its method shortcuts). It enforces three things that were previously
 * forgotten file-by-file:
 *
 *  1. `Authorization: Bearer <token>` is included by default. The
 *     patient-record auth gap that the 2026-05-06 audit pass fixed
 *     (src/services/PatientRecord/patientRecordSync.js) was a missing-header
 *     bug; routing through apiFetch makes that class of bug structurally
 *     impossible.
 *  2. A consistent error contract: ApiError carries `status`, `code`, `body`,
 *     `url`. Callers can branch on status without re-parsing arbitrary error
 *     shapes. Network failures throw ApiError with status 0.
 *  3. JSON in / JSON out is the default. Streaming, binary, or custom-status
 *     callers opt in via `parseAs: 'response'` and handle the Response
 *     directly — they still get the auth header for free.
 *
 * Public endpoints (login, register, public master-data) opt out with
 * `auth: false`. Token storage is read live from localStorage on each call so
 * a future cookie-based auth migration is contained to this file.
 */

import { apiUrl } from '../config/api.js';

export class ApiError extends Error {
    constructor(message, { status = 0, code = null, body = null, url = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.body = body;
        this.url = url;
    }
}

function readToken() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    } catch {
        return null;
    }
}

// Read the rohy_csrf cookie value. Set by the server at login (and on
// /auth/verify) — see server/middleware/csrf.js. Non-HttpOnly by design;
// document.cookie is the only reader.
function readCsrfToken() {
    try {
        if (typeof document === 'undefined' || !document.cookie) return null;
        for (const pair of document.cookie.split(';')) {
            const eq = pair.indexOf('=');
            if (eq === -1) continue;
            const k = pair.slice(0, eq).trim();
            if (k !== 'rohy_csrf') continue;
            const v = pair.slice(eq + 1).trim();
            try { return decodeURIComponent(v); }
            catch { return v; }
        }
        return null;
    } catch {
        return null;
    }
}

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REQUEST_ID_HEADER = 'X-Request-Id';

function generateClientRequestId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    // Old embedded browsers are not a supported primary target, but keep a
    // RFC4122-v4 fallback so the correlation header never disappears.
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16 >> (Number(c) / 4))).toString(16)
    );
}

function attachRequestId(value, requestId) {
    if (!requestId || value == null) return value;
    if ((typeof value !== 'object' && typeof value !== 'function')) return value;
    try {
        Object.defineProperty(value, '__requestId', {
            value: requestId,
            enumerable: false,
            configurable: true,
        });
    } catch {
        // Some host objects are non-extensible; callers can still read the
        // response header when parseAs:'response' was requested.
    }
    return value;
}

function responseRequestId(response, fallback) {
    try {
        return response?.headers?.get?.(REQUEST_ID_HEADER) || fallback;
    } catch {
        return fallback;
    }
}

function resolveUrl(path) {
    if (typeof path !== 'string') {
        throw new TypeError('apiFetch path must be a string');
    }
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:')) {
        return path;
    }
    return apiUrl(path);
}

// Common HTTP-shorthand for nginx/Cloudflare/origin failures so we can
// surface a single clean line instead of dumping the upstream HTML page
// into a toast (the previous behaviour pasted the entire `<html>…</html>`
// 502 body — unreadable in production).
const GATEWAY_STATUS_LABELS = {
    502: 'Server unavailable (bad gateway)',
    503: 'Server unavailable (overloaded or restarting)',
    504: 'Server timed out',
};

async function readErrorBody(response) {
    try {
        const text = await response.text();
        if (!text) return { body: null, message: response.statusText || 'Request failed' };

        // JSON path — preferred; the route layer is JSON-shaped on every
        // 4xx/5xx it generates itself.
        try {
            const parsed = JSON.parse(text);
            const msg = parsed?.error || parsed?.message || response.statusText || 'Request failed';
            return { body: parsed, message: msg };
        } catch {
            // Non-JSON response (typically nginx error pages on 502/503/504,
            // or upstream HTML when the node app didn't respond). Strip tags,
            // collapse whitespace, and surface a status-keyed label so the
            // user sees "Server unavailable (502)" rather than a wall of HTML.
            const ct = response.headers.get('content-type') || '';
            if (ct.includes('text/html') || /^\s*<(?:!doctype|html|head|body)/i.test(text)) {
                const label = GATEWAY_STATUS_LABELS[response.status] || `Request failed (${response.status})`;
                return { body: text, message: `${label} (${response.status})` };
            }
            // Plain text — surface a trimmed snippet, but cap aggressively.
            const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
            return { body: text, message: snippet || `Request failed (${response.status})` };
        }
    } catch {
        return { body: null, message: response.statusText || 'Request failed' };
    }
}

async function parseResponse(response, parseAs, requestId) {
    if (parseAs === 'response') return response;
    if (parseAs === 'blob') return attachRequestId(await response.blob(), requestId);
    if (parseAs === 'arrayBuffer') return response.arrayBuffer();
    if (parseAs === 'text') return response.text();
    if (parseAs === 'json') return attachRequestId(await response.json(), requestId);
    if (response.status === 204) return null;
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) return attachRequestId(await response.json(), requestId);
    return response.text();
}

/**
 * Make an API request. Returns parsed JSON by default; the request always
 * carries the bearer token unless explicitly disabled.
 *
 * @param {string} path - path under /api (e.g. '/sessions') or absolute URL
 * @param {object} [options]
 * @param {string} [options.method='GET']
 * @param {object} [options.headers] - extra headers merged last
 * @param {*} [options.body] - raw body (string/FormData/etc.)
 * @param {*} [options.json] - convenience: serialised + Content-Type set
 * @param {boolean} [options.auth=true] - include Authorization: Bearer
 * @param {'auto'|'json'|'text'|'blob'|'arrayBuffer'|'response'} [options.parseAs='auto']
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<*>} parsed body or Response if parseAs='response'
 * @throws {ApiError} on non-2xx (unless parseAs='response') or network failure
 */
export async function apiFetch(path, options = {}) {
    const {
        method = 'GET',
        headers: extraHeaders = {},
        body: rawBody,
        json,
        auth = true,
        parseAs = 'auto',
        signal,
        ...rest
    } = options;

    const url = resolveUrl(path);
    const headers = {};
    const clientRequestId = generateClientRequestId();
    headers[REQUEST_ID_HEADER] = clientRequestId;

    if (auth) {
        const token = readToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    let body = rawBody;
    if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
    }

    // CSRF: cookie-auth state-changing requests need a matching
    // X-CSRF-Token header. We always set it when the cookie exists and
    // the method is state-changing — server-side `csrfRequired` skips
    // bearer-auth requests, so the header is harmless on those, and
    // saying "always set when available" keeps the client from having
    // to know which auth mode it's on.
    if (auth && STATE_CHANGING_METHODS.has(method.toUpperCase())) {
        const csrf = readCsrfToken();
        if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    Object.assign(headers, extraHeaders);

    // credentials:'same-origin' is fetch's default for same-origin URLs but
    // we set it explicitly so the rohy_auth HttpOnly cookie travels — this
    // is the client side of the audit's "JWT in localStorage → cookies"
    // migration. Cross-origin callers can still override via `rest`.
    let response;
    try {
        response = await fetch(url, {
            method,
            headers,
            body,
            signal,
            credentials: 'same-origin',
            ...rest,
        });
    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        throw new ApiError(`Network error: ${err?.message || 'request failed'}`, {
            status: 0,
            code: 'NETWORK',
            url,
        });
    }

    if (parseAs === 'response') {
        attachRequestId(response, responseRequestId(response, clientRequestId));
        return response;
    }

    if (!response.ok) {
        const { body: errBody, message } = await readErrorBody(response);
        throw new ApiError(message, {
            status: response.status,
            code: (errBody && typeof errBody === 'object' && errBody.code) || `HTTP_${response.status}`,
            body: errBody,
            url,
        });
    }

    return parseResponse(response, parseAs, responseRequestId(response, clientRequestId));
}

export const apiGet = (path, options = {}) =>
    apiFetch(path, { ...options, method: 'GET' });

export const apiPost = (path, json, options = {}) =>
    apiFetch(path, { ...options, method: 'POST', json });

export const apiPut = (path, json, options = {}) =>
    apiFetch(path, { ...options, method: 'PUT', json });

export const apiPatch = (path, json, options = {}) =>
    apiFetch(path, { ...options, method: 'PATCH', json });

export const apiDelete = (path, options = {}) =>
    apiFetch(path, { ...options, method: 'DELETE' });

export default {
    apiFetch,
    apiGet,
    apiPost,
    apiPut,
    apiPatch,
    apiDelete,
    ApiError,
};
