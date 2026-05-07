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

function resolveUrl(path) {
    if (typeof path !== 'string') {
        throw new TypeError('apiFetch path must be a string');
    }
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:')) {
        return path;
    }
    return apiUrl(path);
}

async function readErrorBody(response) {
    try {
        const text = await response.text();
        if (!text) return { body: null, message: response.statusText || 'Request failed' };
        try {
            const parsed = JSON.parse(text);
            const msg = parsed?.error || parsed?.message || response.statusText || 'Request failed';
            return { body: parsed, message: msg };
        } catch {
            return { body: text, message: text.slice(0, 200) };
        }
    } catch {
        return { body: null, message: response.statusText || 'Request failed' };
    }
}

async function parseResponse(response, parseAs) {
    if (parseAs === 'response') return response;
    if (parseAs === 'blob') return response.blob();
    if (parseAs === 'arrayBuffer') return response.arrayBuffer();
    if (parseAs === 'text') return response.text();
    if (parseAs === 'json') return response.json();
    if (response.status === 204) return null;
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) return response.json();
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

    if (auth) {
        const token = readToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    let body = rawBody;
    if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
    }

    Object.assign(headers, extraHeaders);

    let response;
    try {
        response = await fetch(url, { method, headers, body, signal, ...rest });
    } catch (err) {
        if (err?.name === 'AbortError') throw err;
        throw new ApiError(`Network error: ${err?.message || 'request failed'}`, {
            status: 0,
            code: 'NETWORK',
            url,
        });
    }

    if (parseAs === 'response') {
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

    return parseResponse(response, parseAs);
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
