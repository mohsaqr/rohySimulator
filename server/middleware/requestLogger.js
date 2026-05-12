import {
    logStructured,
    shouldSkipRequestLog
} from '../observability.js';

function headerNumber(value) {
    if (Array.isArray(value)) return Number(value[0]) || 0;
    return Number(value) || 0;
}

function bytesIn(req) {
    return headerNumber(req.headers['content-length']);
}

function bytesOut(res, measured) {
    const header = res.getHeader('content-length');
    return headerNumber(header) || measured || 0;
}

function userFields(req) {
    return {
        user_id: req.user?.id || null,
        tenant_id: req.user?.tenant_id || null
    };
}

// Stage-E9 observability contract. Every completed response emits a single
// structured log entry via observability.logStructured so downstream
// log-shippers can filter on the `event` field (audit-observability.sh
// locks the contract):
//
//   event=request    — every response, regardless of status
//   event=http_error — additionally emitted for 4xx (warn) and 5xx (error)
//                      so alerts can match a single field for "anything
//                      that returned a client/server error this minute"
//
// `bytes_sent` is the spelling the audit asserts; we keep `bytes_in`
// alongside for symmetry on request size.
export function requestLoggerMiddleware(options = {}) {
    const skipPaths = options.skipPaths;
    return (req, res, next) => {
        const started = process.hrtime.bigint();
        let responseBytes = 0;
        const originalWrite = res.write;
        const originalEnd = res.end;

        res.write = function countedWrite(chunk, encoding, cb) {
            if (chunk) responseBytes += Buffer.byteLength(chunk, encoding);
            return originalWrite.call(this, chunk, encoding, cb);
        };
        res.end = function countedEnd(chunk, encoding, cb) {
            if (chunk) responseBytes += Buffer.byteLength(chunk, encoding);
            return originalEnd.call(this, chunk, encoding, cb);
        };

        res.on('finish', () => {
            if (shouldSkipRequestLog(req.path, skipPaths)) return;
            const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
            const status = res.statusCode;
            const fields = {
                request_id: req.request_id || null,
                method: req.method,
                path: req.originalUrl || req.url,
                status,
                duration_ms: Number(durationMs.toFixed(3)),
                bytes_in: bytesIn(req),
                bytes_sent: bytesOut(res, responseBytes),
                ...userFields(req)
            };
            const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
            logStructured(level, 'request', fields);
            // Companion 4xx/5xx event so log-shipper alerts can filter on a
            // single `event=http_error` field instead of `event=request AND
            // status>=400`. Same fields, different label.
            if (status >= 400) {
                logStructured(level, 'http_error', fields);
            }
        });
        next();
    };
}

export default requestLoggerMiddleware;
