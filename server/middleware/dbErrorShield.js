// A database error never reaches a person as sqlite's own words.
//
// Many routes answer a failure with `{ error: err.message }`. When the error
// came from sqlite, that put "SQLITE_BUSY: database is locked" in a red toast
// in the case editor (found by the gate e2e under load, rc.47) — text a person
// cannot act on, naming the server's internals. This wraps res.json: a 5xx
// whose error is sqlite's text answers in plain words instead, and a busy
// database answers 503 with `retryable: true`, because a retry usually
// succeeds. The original text stays in the server log.
import { logger } from '../logger.js';

const log = logger('db-error-shield');

const SQLITE_TEXT = /^SQLITE_[A-Z_]+:/;
const BUSY_TEXT = /^SQLITE_(BUSY|LOCKED)\b/;

export function dbErrorShield(req, res, next) {
    const json = res.json.bind(res);
    res.json = (body) => {
        const text = body && typeof body.error === 'string' ? body.error : null;
        if (res.statusCode >= 500 && text && SQLITE_TEXT.test(text)) {
            (req.log || log).warn('database error answered in plain words', { path: req.path, error: text });
            if (BUSY_TEXT.test(text)) {
                res.status(503);
                return json({ error: 'The server is busy. Please try again in a moment.', code: 'DB_BUSY', retryable: true });
            }
            return json({ error: 'Something went wrong while saving. Please try again.', code: 'DB_ERROR' });
        }
        return json(body);
    };
    next();
}
