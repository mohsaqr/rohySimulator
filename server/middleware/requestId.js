import {
    generateRequestId,
    normalizeRequestId,
    runWithRequestContext
} from '../observability.js';
import { logger } from '../logger.js';

const requestLog = logger('request');

export function requestIdMiddleware(req, res, next) {
    const requestId = normalizeRequestId(req.get('X-Request-Id')) || generateRequestId();
    req.request_id = requestId;
    req.log = requestLog.child({ request_id: requestId });
    res.setHeader('X-Request-Id', requestId);

    runWithRequestContext({ request_id: requestId }, () => next());
}

export default requestIdMiddleware;
