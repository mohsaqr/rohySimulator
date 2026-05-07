import {
    shouldSkipRequestLog
} from '../observability.js';
import { logger } from '../logger.js';

const accessLog = logger('access');

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
            const entry = {
                request_id: req.request_id || null,
                method: req.method,
                path: req.originalUrl || req.url,
                status: res.statusCode,
                duration_ms: Number(durationMs.toFixed(3)),
                bytes_in: bytesIn(req),
                bytes_out: bytesOut(res, responseBytes),
                ...userFields(req)
            };
            const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
            accessLog[level]('request completed', entry);
        });
        next();
    };
}

export default requestLoggerMiddleware;
