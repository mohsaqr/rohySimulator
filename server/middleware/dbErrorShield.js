// A server failure never reaches a person as the server's own words.
//
// Many routes answer a failure with `{ error: err.message }` — 236 handlers do
// `res.status(500).json({ error: err.message })` directly. Two problems with
// that text leaving the process:
//
//   * sqlite's own words. "SQLITE_BUSY: database is locked" in a red toast in
//     the case editor (found by the gate e2e under load, rc.47) is text a
//     person cannot act on, naming the server's internals. A busy database
//     answers 503 with `retryable: true`, because a retry usually succeeds.
//
//   * any other 5xx message in production. A stack-adjacent message (a file
//     path, a table name, a dependency's error text) is a map of the
//     deployment for whoever is probing it. In production every 5xx body
//     becomes 'Internal server error' plus the request id, so the person can
//     quote the id and the operator finds the real message in the log.
//
// This wraps res.json for every request. Status codes below 500 keep their
// messages (they are the route's own words to the caller), and outside
// production the original text stays so a developer sees it in the toast.
// The original text is logged at error level either way.
import { logger } from '../logger.js';

const log = logger('db-error-shield');

const SQLITE_TEXT = /^SQLITE_[A-Z_]+:/;
const BUSY_TEXT = /^SQLITE_(BUSY|LOCKED)\b/;

export const GENERIC_SERVER_ERROR = 'Internal server error';

// 5xx answers whose words are the route's own fixed text, written for the
// person reading them, never an error's message. The production blanking
// below erased them: with Oyon switched off every settings tab showed
// "Internal server error" instead of "Oyon is disabled on this server. Set
// OYON_ENABLED=1 …" (server/routes.js buildOyonDisabledStub; security audit
// 2026-10-26, L9). Only these fields of such a body survive. OYON_IMPORT_FAILED
// is deliberately absent: its message embeds the import error's own text.
export const PASSTHROUGH_5XX_CODES = Object.freeze(new Set(['OYON_DISABLED', 'oyon_unavailable']));
const PASSTHROUGH_FIELDS = ['error', 'code', 'message', 'retryable'];

function isProduction(env = process.env) {
    return env.NODE_ENV === 'production';
}

/**
 * The body a 5xx response is allowed to carry, given what the route produced.
 *
 * Pure apart from the log line, and idempotent: a body that already carries
 * the generic message comes back unchanged (and is not logged again), so the
 * error handler and the res.json wrapper can both apply it to one response.
 *
 * @param {object} args
 * @param {number} args.status        the response status
 * @param {*} args.body               what the route passed to res.json
 * @param {object} args.req           the request (for req.log and req.request_id)
 * @param {object} [args.env]         process.env substitute, for tests
 * @returns {{status: number, body: *}} what to send
 */
export function shieldErrorBody({ status, body, req, env = process.env }) {
    const text = body && typeof body.error === 'string' ? body.error : null;
    if (status < 500 || !text) return { status, body };
    const reqLog = req?.log || log;

    if (SQLITE_TEXT.test(text)) {
        reqLog.warn('database error answered in plain words', { path: req?.path, error: text });
        if (BUSY_TEXT.test(text)) {
            return { status: 503, body: { error: 'The server is busy. Please try again in a moment.', code: 'DB_BUSY', retryable: true } };
        }
        return { status, body: { error: 'Something went wrong while saving. Please try again.', code: 'DB_ERROR' } };
    }

    if (!isProduction(env) || text === GENERIC_SERVER_ERROR) return { status, body };

    if (typeof body.code === 'string' && PASSTHROUGH_5XX_CODES.has(body.code)) {
        const kept = Object.fromEntries(
            PASSTHROUGH_FIELDS.filter((k) => body[k] !== undefined && typeof body[k] !== 'object').map((k) => [k, body[k]]),
        );
        return { status, body: kept };
    }

    reqLog.error('server error answered generically', { path: req?.path, status, error: text });
    // Only the machine-readable code survives: any other field (`details`,
    // `stack`, a wrapped cause) is as much of a leak as the message was.
    const requestId = req?.request_id || null;
    return {
        status,
        body: {
            error: GENERIC_SERVER_ERROR,
            ...(typeof body.code === 'string' ? { code: body.code } : {}),
            ...(requestId ? { request_id: requestId } : {}),
        },
    };
}

export function dbErrorShield(req, res, next) {
    const json = res.json.bind(res);
    res.json = (payload) => {
        const shielded = shieldErrorBody({ status: res.statusCode, body: payload, req });
        if (shielded.status !== res.statusCode) res.status(shielded.status);
        return json(shielded.body);
    };
    next();
}
