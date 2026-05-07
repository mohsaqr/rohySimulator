import { logger } from '../logger.js';

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

export function errorHandler(err, req, res, next) {
    if (!err) return next();

    let status = err.status || err.statusCode || 500;
    if (status === 500 && isCorsError(err)) status = 403;
    errorLog[status >= 500 ? 'error' : 'warn']('request error', {
        request_id: req.request_id || null,
        route: req.originalUrl || req.url,
        status,
        user_id: req.user?.id || null,
        tenant_id: req.user?.tenant_id || null,
        error: {
            message: err.message || String(err),
            stack: err.stack || null
        }
    });

    if (res.headersSent) return next(err);
    res.status(status).json({ error: err.message || 'Internal server error' });
}

export default errorHandler;
