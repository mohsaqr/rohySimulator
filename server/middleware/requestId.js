import {
    generateRequestId,
    normalizeRequestId,
    runWithRequestContext
} from '../observability.js';

export function requestIdMiddleware(req, res, next) {
    const requestId = normalizeRequestId(req.get('X-Request-Id')) || generateRequestId();
    req.request_id = requestId;
    res.setHeader('X-Request-Id', requestId);

    runWithRequestContext({ request_id: requestId }, () => next());
}

export default requestIdMiddleware;
