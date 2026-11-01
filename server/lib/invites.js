// Registration-invite logic — the SINGLE owner of what an invite means.
//
// Lives in lib/ rather than in a routes file because two routers need it and
// routes should not import routes: registration-routes.js mints/lists/revokes
// invites, and auth-routes.js REDEEMS them inside POST /auth/register (an
// invite is a property of a registration, not a separate act).

import dbAdapter from '../dbAdapter.js';
import { logger } from '../logger.js';
import { generateCode, normalizeCode } from './joinCode.js';
import { getRoleRank } from '../middleware/auth.js';

const inviteLog = logger('registration-invites');

// 12 chars of a 31-glyph alphabet ≈ 2^59: unguessable online, still short enough
// to read aloud. (Cohort join codes are 8 — those are shared inside a class that
// already trusts you; an invite mints an ACCOUNT.)
export const INVITE_TOKEN_LENGTH = 12;
const INVITE_MAX_RETRIES = 6;

/** What the person holding the invite is told. Never speculates about why. */
export const INVITE_ERRORS = {
    not_found: 'That invite code is not valid. Check it, or ask whoever sent it for a new one.',
    revoked: 'That invite has been withdrawn. Ask whoever sent it for a new one.',
    expired: 'That invite has expired. Ask whoever sent it for a new one.',
    exhausted: 'That invite has already been used the maximum number of times.',
};

/** A course's registration code on a platform that admits only invited people. */
export const COURSE_CODE_NOT_INVITE_ERROR =
    'A course code cannot create an account on this platform. Ask an administrator for an invite, then join the course with the code once you are signed in.';

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

/**
 * Why the invite's MINTER no longer vouches for it, or null when they still do
 * (security audit 2026-10-26, L2-10).
 *
 * An invite is an admin's standing decision to let someone in with a role. It
 * used to outlive the admin: delete, purge, suspend or demote the person who
 * minted it and their unlimited, never-expiring admin invite kept minting
 * accounts — through `closed` mode too. The rank ceiling enforced at mint time
 * is therefore re-checked at redemption: the creator must still exist, be
 * active, live in the invite's tenant, and hold at least the invite's role.
 * The holder is told "withdrawn", which is what it amounts to.
 *
 * @param {object} invite  a registration_invites row
 * @returns {Promise<'revoked'|null>}
 */
export async function inviteCreatorRejection(invite) {
    const creator = await dbAdapter.get(
        'SELECT role, status, deleted_at, tenant_id FROM users WHERE id = ?',
        [invite.created_by]
    );
    if (!creator || creator.deleted_at || creator.status !== 'active') return 'revoked';
    if (Number(creator.tenant_id || 1) !== Number(invite.tenant_id || 1)) return 'revoked';
    if (getRoleRank(creator.role) < getRoleRank(invite.role)) return 'revoked';
    return null;
}

/**
 * Every reason an invite cannot be redeemed right now: its own state
 * (inviteRejection) and then its minter's (inviteCreatorRejection).
 * @returns {Promise<string|null>}
 */
export async function inviteUsableRejection(invite) {
    return inviteRejection(invite) || inviteCreatorRejection(invite);
}

/** Look up an invite from raw user input (normalised). Null when there is none. */
export async function findInviteByToken(rawToken) {
    const token = normalizeCode(rawToken);
    if (!token) return null;
    return dbAdapter.get('SELECT * FROM registration_invites WHERE token = ?', [token]);
}

/**
 * The course a code names, when it is a course's join code rather than a
 * registration invite (PRV-68).
 *
 * A teacher's course page calls its join code the "Registration code" and the
 * teacher hands it to people who have no account yet, so the register form's
 * code field has to accept it. The two never collide: invites are
 * INVITE_TOKEN_LENGTH (12) characters and join codes 8, from the same alphabet.
 *
 * What a course code is NOT: an admin's invite. It carries no role (always
 * student), no use limit, no expiry and no email rule, and any educator can
 * mint one, so it never opens a door the registration policy keeps shut — it
 * says which course the newcomer joins, in that course's tenant.
 *
 * @returns {Promise<{course: {id:number, name:string, tenant_id:number}|null, reason: 'not_found'|'revoked'|null}>}
 *   `revoked` when the code belonged to a course that has since been closed
 *   (soft-deleted), so the holder is told "withdrawn" rather than "typo".
 */
export async function findCourseByJoinCode(rawCode) {
    const code = normalizeCode(rawCode);
    if (!code) return { course: null, reason: 'not_found' };
    // join_code is unique among LIVE courses (partial index, migration 0025);
    // a closed course may still hold a code a live one has since reused.
    const course = await dbAdapter.get(
        `SELECT id, name, tenant_id FROM cohorts WHERE join_code = ? AND deleted_at IS NULL`,
        [code]
    );
    if (course) return { course: { ...course, tenant_id: Number(course.tenant_id || 1) }, reason: null };
    const closed = await dbAdapter.get(
        `SELECT id FROM cohorts WHERE join_code = ? AND deleted_at IS NOT NULL LIMIT 1`,
        [code]
    );
    return { course: null, reason: closed ? 'revoked' : 'not_found' };
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
export async function claimInviteUse(inviteId) {
    // Two people redeeming at once can collide with the audit write of the
    // registration before them (the audit chain has its own connection); the
    // SQLITE_BUSY that raises is retried inside dbAdapter.run, so it resolves
    // to a clean "already used" rather than a 500.
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
