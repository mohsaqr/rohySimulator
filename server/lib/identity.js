// Identity rules shared by every path that creates or renames an account
// (security audit 2026-10-26, L1-12).
//
// Self-registration has normalised its input since SEC-36 (auth-routes.js
// normalizeIdentity); the admin paths — create, batch, PUT, import, approval —
// stored whatever they were sent. Two consequences: `Alice@x` and `alice@x`
// could both exist, and a student could self-register `Admin` next to the real
// `admin` because the UNIQUE index on users.username is case-sensitive. There
// is no migration in this change, so case-insensitive uniqueness is enforced
// here, in code, before every INSERT/UPDATE of a username or email.
//
// Lives in lib/ because routes must not import routes, and both auth-routes.js
// and users-routes.js / registration-routes.js need it.

import dbAdapter from '../dbAdapter.js';

export const EMAIL_MAX_LENGTH = 254;
export const ADMIN_USERNAME_MAX_LENGTH = 64;

// Control characters (C0, DEL, C1). Nothing legitimate types these into a
// username, and they make log and audit lines lie about who acted.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Trim and lower-case an email and say whether it is acceptable.
 * @param {unknown} raw
 * @returns {{email: string, error: string|null}}
 */
export function normalizeEmail(raw) {
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const at = email.indexOf('@');
    const oneAt = at > 0 && at < email.length - 1 && at === email.lastIndexOf('@');
    if (email.length > EMAIL_MAX_LENGTH || !oneAt || /\s/.test(email)) {
        return { email, error: 'A valid email address is required' };
    }
    return { email, error: null };
}

/**
 * Normalise a username/email pair typed by an ADMIN (create, batch, PUT,
 * import). Deliberately looser than self-registration's USERNAME_PATTERN:
 * admins have always been able to create e.g. `jane.doe@uef.fi` or `Mäkinen`
 * as a username, and refusing those now would break existing CSV imports. What
 * it does enforce is what self-registration enforces too: no surrounding
 * whitespace (login trims, so a padded name could never sign in), no control
 * characters, a length cap, and a lower-cased email.
 *
 * @param {{username?: unknown, email?: unknown}} input
 * @returns {{username: string, email: string, error: string|null}}
 */
export function normalizeAdminIdentity({ username, email }) {
    const user = typeof username === 'string' ? username.trim() : '';
    const mail = normalizeEmail(email);
    if (!user || user.length > ADMIN_USERNAME_MAX_LENGTH || CONTROL_CHARS.test(user)) {
        return {
            username: user, email: mail.email,
            error: `Username must be 1-${ADMIN_USERNAME_MAX_LENGTH} characters with no control characters`,
        };
    }
    if (mail.error) return { username: user, email: mail.email, error: mail.error };
    return { username: user, email: mail.email, error: null };
}

/**
 * The id of an existing account whose username or email equals the given ones
 * ignoring ASCII case, or null. Global (all tenants, soft-deleted rows too),
 * because the UNIQUE indexes it stands in for are global.
 *
 * @param {{username?: string|null, email?: string|null, excludeUserId?: number|string|null}} q
 * @returns {Promise<number|null>}
 */
export async function findIdentityClash({ username = null, email = null, excludeUserId = null }) {
    if (!username && !email) return null;
    const row = await dbAdapter.get(
        `SELECT id FROM users
          WHERE ((? IS NOT NULL AND username = ? COLLATE NOCASE)
              OR (? IS NOT NULL AND email = ? COLLATE NOCASE))
            AND (? IS NULL OR id <> ?)
          LIMIT 1`,
        [username, username, email, email, excludeUserId, excludeUserId]
    );
    return row ? row.id : null;
}
