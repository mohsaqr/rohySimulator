// Per-request timeout middleware.
//
// Defense-in-depth against route hangs causing nginx 502s. If a handler
// takes longer than the configured deadline, we send a 504 with a clean
// payload (rather than letting the upstream nginx time out and surface a
// generic gateway error to the user).
//
// Streaming endpoints (/api/tts, /api/proxy/llm) get a longer deadline
// instead of the 30 s one: their own timers (the 5-minute LLM stream cap, the
// TTS synthesis deadline) are the real bound, and a 30 s timer here would cut
// off a long-but-legitimate reply. Until 2026-10-26 they were skipped
// entirely, so a handler that hung before its own timers started (a DB
// stall, a queue) was bounded by nothing (F-06 / L8-02). The backstop is
// ROHY_STREAM_ROUTE_TIMEOUT_MS (default 6 min): past it an uncommitted
// response is answered 504 and a stream still open is destroyed.
//
// Cleanup on response finish/close is essential — without it, a handler
// that responds faster than the timeout would leak a setTimeout that holds
// a reference to req/res, blocking GC. We use timer.unref() too so an
// idle timeout never keeps the event loop alive at process-exit time.

import { logger } from '../logger.js';

const log = logger('route-timeout');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 6 * 60_000;

// Paths where a global timeout is wrong because they stream.
// The patterns are matched against req.path (post-mount, no /api prefix).
const STREAMING_PATH_PREFIXES = [
    '/tts',           // kokoro streaming PCM, OpenAI/Google buffered audio
    '/proxy/llm',     // LLM upstream can be slow on long contexts
];

function isStreamingPath(path) {
    return STREAMING_PATH_PREFIXES.some(p => path.startsWith(p));
}

// The handler is still running when its 504 goes out, and it answers when it
// finishes. That answer used to throw "Cannot set headers after they are
// sent" from inside a database callback — an uncaught exception (83 of them
// in the stability run, rc.47). After a timeout has answered, the response's
// writers do nothing; the late answer is logged once.
function silenceLateResponse(req, res) {
    let logged = false;
    const late = () => {
        if (!logged) {
            logged = true;
            log.info('late response dropped after route timeout', { method: req.method, path: req.path, request_id: req.requestId || null });
        }
        return res;
    };
    for (const method of ['status', 'json', 'send', 'sendStatus', 'set', 'header', 'setHeader', 'type', 'cookie', 'clearCookie', 'redirect', 'end']) {
        res[method] = late;
    }
}

export function routeTimeout(opts = {}) {
    const ms = Number.isFinite(opts.ms) && opts.ms > 0
        ? opts.ms
        : (parseInt(process.env.ROHY_ROUTE_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS);

    const streamMs = Number.isFinite(opts.streamMs) && opts.streamMs > 0
        ? opts.streamMs
        : (parseInt(process.env.ROHY_STREAM_ROUTE_TIMEOUT_MS, 10) || DEFAULT_STREAM_TIMEOUT_MS);

    return function routeTimeoutMiddleware(req, res, next) {
        const streaming = isStreamingPath(req.path);
        const deadlineMs = streaming ? streamMs : ms;

        const timer = setTimeout(() => {
            if (res.writableEnded) return;
            // If the response has already started (headers sent or stream
            // open), we can't change the status code. An ordinary route is
            // left to finish (the client may receive a partial); a stream
            // past its backstop is cut, or it could hold a socket for ever.
            if (res.headersSent) {
                if (streaming) {
                    log.warn('stream route deadline reached; closing', { method: req.method, path: req.path, request_id: req.requestId || null, timeout_ms: deadlineMs });
                    res.destroy();
                }
                return;
            }

            log.warn('route timeout', {
                method: req.method,
                path: req.path,
                request_id: req.requestId || null,
                timeout_ms: deadlineMs,
            });

            res.status(504).json({
                error: 'Request timeout',
                message: `The server took longer than ${deadlineMs}ms to respond. Please retry.`,
                code: 'ROUTE_TIMEOUT',
            });
            silenceLateResponse(req, res);
        }, deadlineMs);

        // Don't keep the event loop alive just for this timer.
        timer.unref?.();

        let cleared = false;
        const cleanup = () => {
            if (cleared) return;
            cleared = true;
            clearTimeout(timer);
        };
        res.once('finish', cleanup);
        res.once('close', cleanup);
        next();
    };
}

// Exported for tests.
export const __test = { isStreamingPath, DEFAULT_TIMEOUT_MS, DEFAULT_STREAM_TIMEOUT_MS, STREAMING_PATH_PREFIXES };
