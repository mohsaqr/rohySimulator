import {
    logStructured,
    shouldSkipRequestLog
} from '../observability.js';

function bytesSent(res) {
    const header = res.getHeader('content-length');
    if (Array.isArray(header)) return Number(header[0]) || 0;
    return Number(header) || 0;
}

function userFields(req) {
    return {
        user_id: req.user?.id || null,
        tenant_id: req.user?.tenant_id || null
    };
}

export function requestLoggerMiddleware(options = {}) {
    const skipPaths = options.skipPaths;
    return (req, res, next) => {
        const started = process.hrtime.bigint();
        res.on('finish', () => {
            if (shouldSkipRequestLog(req.path, skipPaths)) return;
            const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
            const entry = {
                request_id: req.request_id || null,
                method: req.method,
                path: req.originalUrl || req.url,
                status: res.statusCode,
                duration_ms: Number(durationMs.toFixed(3)),
                bytes_sent: bytesSent(res),
                ...userFields(req)
            };
            logStructured(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'request', entry);
            if (res.statusCode >= 400) {
                logStructured(res.statusCode >= 500 ? 'error' : 'warn', 'http_error', {
                    ...entry,
                    route: req.route?.path || req.path
                });
            }
        });
        next();
    };
}

export default requestLoggerMiddleware;
