// Who may write a learner-authored record of a session, and until when.
//
// The transcript (`interactions`) and the encounter record
// (`patient_record_events` / `_documents`) are written by the learner's
// browser: the server relays the LLM reply but does not persist it, so the
// client posts both the learner's turn and the reply it was shown. Two things
// keep that honest enough for the debrief and analytics that read it
// (security audit 2026-10-26, L8-12 / L2-13):
//
//   1. Only the session's OWNER writes. Staff reach a learner's session to
//      read it; a write by them would be indistinguishable from the learner's
//      own work. Staff try a case in a session of their own.
//   2. Writes stop once the session has ended. A short grace window after
//      `end_time` lets the client's last periodic sync (every 60 s) and the
//      reply that was streaming when End was pressed land; after it, the
//      record is closed — a learner cannot rewrite it after reading the
//      debrief.
//
// What this does NOT do: prove an `assistant` row is the reply the server
// relayed. That needs the proxy to persist its own replies (a server-authored
// transcript), which is a change to the LLM proxy, not to these routes.

import dbAdapter from '../dbAdapter.js';
import { timeMs } from '../shared/time.js';

/** How long after `end_time` the record still accepts writes. */
export const SESSION_WRITE_GRACE_MS = 2 * 60 * 1000;

/**
 * Has this session closed for learner-authored writes?
 * @param {{status?: string, end_time?: string|null}} session
 * @param {number} [nowMs]
 */
export function sessionClosedForWrites(session, nowMs = Date.now()) {
    if (!session) return true;
    const ended = timeMs(session.end_time);
    if (ended !== null) return nowMs - ended > SESSION_WRITE_GRACE_MS;
    // Ended without an end_time (abandoned by a sweep): closed.
    return session.status === 'abandoned';
}

/**
 * Load a session the caller may write a learner record into, or answer the
 * request and resolve null. 404 when the session is not in the caller's
 * tenant (or erased), 403 `NOT_SESSION_OWNER` when it is someone else's,
 * 409 `SESSION_ENDED` once the session closed for writes.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {number|string} sessionId
 * @param {number} tenant
 * @returns {Promise<{user_id: number, case_id: number, status: string, end_time: string|null}|null>}
 */
export async function loadOwnSessionForWrite(req, res, sessionId, tenant) {
    if (sessionId === undefined || sessionId === null || sessionId === '') {
        res.status(400).json({ error: 'session_id required' });
        return null;
    }
    const session = await dbAdapter.get(
        'SELECT user_id, case_id, status, end_time FROM sessions WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
        [sessionId, tenant]
    );
    if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return null;
    }
    if (Number(session.user_id) !== Number(req.user?.id)) {
        res.status(403).json({ error: 'Only the learner who owns this session can write to it', code: 'NOT_SESSION_OWNER' });
        return null;
    }
    if (sessionClosedForWrites(session)) {
        res.status(409).json({ error: 'Session has ended — its record is closed', code: 'SESSION_ENDED' });
        return null;
    }
    return session;
}
