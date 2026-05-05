import { logStructured } from '../observability.js';

export function errorHandler(err, req, res, next) {
    if (!err) return next();

    const status = err.status || err.statusCode || 500;
    logStructured(status >= 500 ? 'error' : 'warn', 'error', {
        request_id: req.request_id || null,
        route: req.originalUrl || req.url,
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
