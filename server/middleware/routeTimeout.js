// Per-request timeout middleware.
//
// Defense-in-depth against route hangs causing nginx 502s. If a handler
// takes longer than the configured deadline, we send a 504 with a clean
// payload (rather than letting the upstream nginx time out and surface a
// generic gateway error to the user).
//
// Skips streaming endpoints (/api/tts, /api/proxy/llm) — those have their
// own per-request timeouts inside the service layer (kokoroTts, the
// upstream OpenAI/Google client) and a global timer here would cut off
// long-but-legitimate audio synthesis.
//
// Cleanup on response finish/close is essential — without it, a handler
// that responds faster than the timeout would leak a setTimeout that holds
// a reference to req/res, blocking GC. We use timer.unref() too so an
// idle timeout never keeps the event loop alive at process-exit time.

import { logger } from '../logger.js';

const log = logger('route-timeout');

const DEFAULT_TIMEOUT_MS = 30_000;

// Paths where a global timeout is wrong because they stream.
// The patterns are matched against req.path (post-mount, no /api prefix).
const STREAMING_PATH_PREFIXES = [
    '/tts',           // kokoro streaming PCM, OpenAI/Google buffered audio
    '/proxy/llm',     // LLM upstream can be slow on long contexts
];

function isStreamingPath(path) {
    return STREAMING_PATH_PREFIXES.some(p => path.startsWith(p));
}

export function routeTimeout(opts = {}) {
    const ms = Number.isFinite(opts.ms) && opts.ms > 0
        ? opts.ms
        : (parseInt(process.env.ROHY_ROUTE_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS);

    return function routeTimeoutMiddleware(req, res, next) {
        if (isStreamingPath(req.path)) return next();

        const timer = setTimeout(() => {
            // If the response has already started (headers sent or stream
            // open), we can't change the status code. Just log and let the
            // existing response finish — the client may receive a partial.
            if (res.headersSent || res.writableEnded) return;

            log.warn('route timeout', {
                method: req.method,
                path: req.path,
                request_id: req.requestId || null,
                timeout_ms: ms,
            });

            res.status(504).json({
                error: 'Request timeout',
                message: `The server took longer than ${ms}ms to respond. Please retry.`,
                code: 'ROUTE_TIMEOUT',
            });
        }, ms);

        // Don't keep the event loop alive just for this timer.
        timer.unref?.();

        const cleanup = () => clearTimeout(timer);
        res.on('finish', cleanup);
        res.on('close', cleanup);
        next();
    };
}

// Exported for tests.
export const __test = { isStreamingPath, DEFAULT_TIMEOUT_MS, STREAMING_PATH_PREFIXES };
