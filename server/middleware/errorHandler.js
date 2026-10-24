import { logger } from '../logger.js';
import { shieldErrorBody } from './dbErrorShield.js';
import { redactRequestPath } from './requestLogger.js';

const errorLog = logger('error-handler');

// CORS rejections from the `cors` middleware throw a plain Error with
// message "Not allowed by CORS" and no `status`. Without explicit handling,
// they fall through to a generic 500 — and the browser shows
// `Failed to load resource: 500` with zero indication CORS was the cause.
// Production hit this in 2026-05 (see AGENT-NOTE-DEPLOY-2026-05-07.md §3):
// every asset 500'd silently after a `FRONTEND_URL` mismatch. Map the
// known cors message to 403 so the journal AND the network panel make
// the cause obvious.
function isCorsError(err) {
    return typeof err?.message === 'string' && /not allowed by cors/i.test(err.message);
}

// multer reports its own failures as `MulterError` with a `code` and no
// `status`, and a fileFilter rejection as whatever Error the filter built. Both
// used to fall through as 500 — "the server broke" — for what is the caller's
// own oversized or wrongly-typed file. Give each the status it means so the
// upload UI can say so, and so the production shield (which blanks 5xx text)
// leaves the explanation intact.
function multerStatus(err) {
    if (err?.name === 'MulterError') {
        return err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    }
    if (typeof err?.message === 'string' && /invalid file type|must be png or svg/i.test(err.message)) return 415;
    return null;
}

/**
 * Final Express error handler.
 *
 * Decides the status (an explicit err.status wins; CORS and multer errors
 * get theirs), logs the full error with the request id, and answers in the
 * API's `{ error }` shape. The body goes through shieldErrorBody so a 5xx in
 * production never carries the error's own text — the same rule the res.json
 * wrapper (dbErrorShield) applies to route handlers that answer 500 directly.
 */
export function errorHandler(err, req, res, next) {
    if (!err) return next();

    let status = err.status || err.statusCode || 500;
    if (status === 500 && isCorsError(err)) status = 403;
    if (status === 500) status = multerStatus(err) ?? status;
    errorLog[status >= 500 ? 'error' : 'warn']('request error', {
        request_id: req.request_id || null,
        route: redactRequestPath(req.originalUrl || req.url),
        status,
        user_id: req.user?.id || null,
        tenant_id: req.user?.tenant_id || null,
        error: {
            message: err.message || String(err),
            code: err.code || null,
            stack: err.stack || null
        }
    });

    if (res.headersSent) return next(err);
    const shielded = shieldErrorBody({
        status,
        body: { error: err.message || 'Internal server error', ...(typeof err.code === 'string' ? { code: err.code } : {}) },
        req,
    });
    res.status(shielded.status).json(shielded.body);
}

export default errorHandler;
