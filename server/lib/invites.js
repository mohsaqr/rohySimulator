// Registration-invite logic — the SINGLE owner of what an invite means.
//
// Lives in lib/ rather than in a routes file because two routers need it and
// routes should not import routes: registration-routes.js mints/lists/revokes
// invites, and auth-routes.js REDEEMS them inside POST /auth/register (an
// invite is a property of a registration, not a separate act).

import dbAdapter from '../dbAdapter.js';
import { logger } from '../logger.js';
import { generateCode, normalizeCode } from './joinCode.js';

const inviteLog = logger('registration-invites');

// 12 chars of a 31-glyph alphabet ≈ 2^59: unguessable online, still short enough
// to read aloud. (Cohort join codes are 8 — those are shared inside a class that
// already trusts you; an invite mints an ACCOUNT.)
export const INVITE_TOKEN_LENGTH = 12;
const INVITE_MAX_RETRIES = 6;
const CLAIM_MAX_RETRIES = 4;

/** What the person holding the invite is told. Never speculates about why. */
export const INVITE_ERRORS = {
    not_found: 'That invite code is not valid. Check it, or ask whoever sent it for a new one.',
    revoked: 'That invite has been withdrawn. Ask whoever sent it for a new one.',
    expired: 'That invite has expired. Ask whoever sent it for a new one.',
    exhausted: 'That invite has already been used the maximum number of times.',
};

/** Mint a token, retrying on the (vanishingly unlikely) UNIQUE collision. */
export async function allocateInviteToken() {
    for (let attempt = 0; attempt < INVITE_MAX_RETRIES; attempt++) {
        const token = generateCode(INVITE_TOKEN_LENGTH);
        const clash = await dbAdapter.get('SELECT 1 FROM registration_invites WHERE token = ?', [token]);
        if (!clash) return token;
    }
    inviteLog.error('invite token generation exhausted retries');
    return null;
}

/**
 * Why an invite cannot be used, or null when it can.
 *
 * Order matters for what the holder is told: revoked → expired → exhausted,
 * i.e. "someone decided" → "time decided" → "other people decided".
 */
export function inviteRejection(invite) {
    if (!invite) return 'not_found';
    if (invite.revoked_at) return 'revoked';
    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return 'expired';
    if (invite.max_uses != null && invite.uses >= invite.max_uses) return 'exhausted';
    return null;
}

/** Look up an invite from raw user input (normalised). Null when there is none. */
export async function findInviteByToken(rawToken) {
    const token = normalizeCode(rawToken);
    if (!token) return null;
    return dbAdapter.get('SELECT * FROM registration_invites WHERE token = ?', [token]);
}

/**
 * Claim ONE use, atomically.
 *
 * The conditional UPDATE is the whole point: it re-checks revoked / expired /
 * exhausted in the same statement that increments the counter, so two people
 * redeeming the last use of an invite at the same moment cannot both win.
 * Callers MUST check the result before creating a user, and MUST call
 * releaseInviteUse() if that user creation then fails.
 *
 * @returns {Promise<boolean>} true when THIS caller got the use.
 */
export async function claimInviteUse(inviteId, attempt = 0) {
    try {
        const result = await dbAdapter.run(
            `UPDATE registration_invites
                SET uses = uses + 1
              WHERE id = ?
                AND revoked_at IS NULL
                AND (max_uses IS NULL OR uses < max_uses)
                AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
            [inviteId]
        );
        return (result?.changes ?? 0) === 1;
    } catch (err) {
        // SQLITE_BUSY is expected here, not exceptional: the audit chain writes on
        // its OWN dedicated sqlite connection (audit-chain.js), so a registration
        // in flight can collide with the audit write of the one before it. The
        // same retry-with-backoff exists in stampCaseCode() for exactly this
        // reason. Without it, two people redeeming an invite at the same moment
        // can turn a clean "already used" into a 500.
        if (/SQLITE_BUSY/i.test(err.message) && attempt < CLAIM_MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
            return claimInviteUse(inviteId, attempt + 1);
        }
        throw err;
    }
}

/** Hand a claimed use back when the registration it was claimed for failed. */
export async function releaseInviteUse(inviteId) {
    try {
        await dbAdapter.run(
            'UPDATE registration_invites SET uses = uses - 1 WHERE id = ? AND uses > 0',
            [inviteId]
        );
    } catch (err) {
        // Over-counting one use fails CLOSED (the invite admits one person
        // fewer), so this must never fail the request it is cleaning up after.
        inviteLog.warn('invite use release failed', { invite_id: inviteId, error: err.message });
    }
}

/** Record who came in on which invite. Never throws — the account already exists. */
export async function recordInviteUse(inviteId, userId, ipAddress) {
    try {
        await dbAdapter.run(
            'INSERT INTO registration_invite_uses (invite_id, user_id, ip_address) VALUES (?, ?, ?)',
            [inviteId, userId, ipAddress || null]
        );
    } catch (err) {
        inviteLog.warn('invite use ledger write failed', { invite_id: inviteId, error: err.message });
    }
}
