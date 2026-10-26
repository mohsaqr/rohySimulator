// Session and lock state that follows an ACCOUNT, not a single token
// (security audit 2026-10-26: F-11, F-12, L1-04, L2-15).
//
// Revocation by user id is deliberately NOT tenant-scoped. User ids are global,
// and active_sessions.tenant_id is a copy taken when the token was issued: a
// user moved to another tenant kept sessions tagged with the old one, and a
// password change revoked `WHERE user_id = ? AND tenant_id = <new>` — missing
// exactly the pre-move tokens it most needed to kill.
//
// Every helper takes an optional `executor`: dbAdapter itself (the default) or
// the `tx` of a dbAdapter.isolatedTransaction, so the write commits (or rolls
// back) with the change that caused it. Never a raw sqlite handle — the
// db-direct-access guard keeps persistence behind dbAdapter.

import dbAdapter from '../dbAdapter.js';

/**
 * Revoke every live session of a user, optionally keeping one (the caller's own).
 * @param {number|string} userId
 * @param {{exceptTokenHash?: string|null, executor?: {run: Function}}} [opts]
 * @returns {Promise<number>} sessions revoked
 */
export async function revokeUserSessions(userId, { exceptTokenHash = null, executor = dbAdapter } = {}) {
    const result = exceptTokenHash
        ? await executor.run(
            'UPDATE active_sessions SET is_active = 0 WHERE user_id = ? AND is_active = 1 AND token_hash <> ?',
            [userId, exceptTokenHash]
        )
        : await executor.run(
            'UPDATE active_sessions SET is_active = 0 WHERE user_id = ? AND is_active = 1',
            [userId]
        );
    return result?.changes ?? 0;
}

/**
 * Clear a login lockout: the failure counter and `locked_until`.
 * @param {number|string} userId
 * @param {{executor?: {run: Function}}} [opts]
 * @returns {Promise<number>} rows changed (0 when the user does not exist)
 */
export async function clearLoginLock(userId, { executor = dbAdapter } = {}) {
    const result = await executor.run(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
        [userId]
    );
    return result?.changes ?? 0;
}
