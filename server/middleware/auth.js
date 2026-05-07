import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { csrfRequired, verifyCsrf } from './csrf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from server/.env
dotenv.config({ path: path.join(__dirname, '../.env') });

// JWT_SECRET is required - fail fast if not configured
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set!');
    console.error('Please set JWT_SECRET in server/.env file');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    process.exit(1);
}

// Hash a bearer token the same way login/register does so we can look it up
// in active_sessions. SHA-256 is sufficient — the table is internal and never
// exposed to clients; we just need a deterministic, fixed-length key.
export function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Cookie name carrying the JWT for HttpOnly-cookie clients. The legacy
// bearer-header path still works in parallel; this is rolled out additively
// so existing localStorage-token clients keep working unchanged.
export const AUTH_COOKIE_NAME = 'rohy_auth';

// Pull the JWT from EITHER the Authorization header (legacy) OR a cookie
// (preferred, HttpOnly). Header wins when both are present — useful in
// migration windows where a tab might briefly hold a localStorage token
// while the cookie hasn't been set yet.
//
// We do not depend on `cookie-parser` (not currently a project dep). The
// parser inlined here handles a single named cookie correctly under the
// usual `name=value; Other=Foo` syntax. Quoted-string and Path-attribute
// edge cases are out of scope — Express's `Cookie:` header only carries
// name/value pairs, not attributes (those are server-to-client only).
function readCookie(req, name) {
    const raw = req.headers?.cookie;
    if (!raw) return null;
    for (const pair of raw.split(';')) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const k = pair.slice(0, eq).trim();
        if (k !== name) continue;
        const v = pair.slice(eq + 1).trim();
        try { return decodeURIComponent(v); }
        catch { return v; }
    }
    return null;
}

// Stricter parser: a present-but-malformed Authorization header is a
// client bug, not "no auth attempted". `malformed` carries a code so
// authenticateToken can return 400 (signal to the operator) instead of
// silently falling through to 401 (looks like an unauth request).
export function extractToken(req) {
    const authHeader = req.headers?.['authorization'];
    if (authHeader) {
        const raw = String(authHeader);
        // Don't trim the whole string — that would erase a trailing space
        // after `Bearer `, which is itself a malformed-empty-token signal.
        // We trim only the leading whitespace before the scheme.
        const lead = raw.match(/^\s*/)[0].length;
        const fromScheme = raw.slice(lead);
        const firstSpace = fromScheme.indexOf(' ');
        if (firstSpace === -1) {
            return { token: null, source: null, malformed: 'no-scheme-separator' };
        }
        const scheme = fromScheme.slice(0, firstSpace);
        // Don't trim the value either — internal whitespace is itself a
        // malformed-token signal, and an empty value (Bearer with only
        // trailing whitespace) trims down to '' here, which the empty
        // check below catches.
        const value = fromScheme.slice(firstSpace + 1);
        if (scheme !== 'Bearer') {
            return { token: null, source: null, malformed: 'unsupported-scheme' };
        }
        if (!value.trim()) {
            return { token: null, source: null, malformed: 'empty-token' };
        }
        if (/\s/.test(value.trim())) {
            // `Bearer a b` — a JWT cannot legitimately contain whitespace.
            return { token: null, source: null, malformed: 'whitespace-in-token' };
        }
        return { token: value.trim(), source: 'header', malformed: false };
    }
    const cookie = readCookie(req, AUTH_COOKIE_NAME);
    if (cookie) return { token: cookie, source: 'cookie', malformed: false };
    return { token: null, source: null, malformed: false };
}

// Middleware to authenticate JWT token.
//
// Two-stage check:
//   1. JWT signature + expiry (fast, in-memory).
//   2. Server-side revocation: look up the token's sha256 hash in
//      active_sessions. If a row exists with is_active=0, the token has been
//      explicitly revoked (logout, admin force-logout, or password change)
//      and we reject 401 *even though* the JWT itself is still cryptographically
//      valid. This is the missing half of the audit's "token revocation not
//      enforced" finding.
//
// Tokens that pre-date this change have no active_sessions row at all. We
// accept those (legacy compatibility) so rolling out doesn't force every
// signed-in user to re-login on the deploy. Once they expire (4h default),
// the next login goes through the new path.
export const authenticateToken = (req, res, next) => {
    const { token, source, malformed } = extractToken(req);

    if (!token) {
        if (malformed) {
            return res.status(400).json({
                error: 'Malformed Authorization header',
                code: malformed,
            });
        }
        return res.status(401).json({ error: 'Access token required' });
    }
    req.tokenSource = source;

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }

        const tokenHash = hashToken(token);
        db.get(
            `SELECT is_active, expires_at FROM active_sessions WHERE token_hash = ? LIMIT 1`,
            [tokenHash],
            (sessionErr, sessionRow) => {
                if (sessionErr) {
                    return res.status(500).json({ error: 'Failed to verify session state' });
                }

                // If there IS a row, enforce its state. Missing row = legacy
                // token; fall through to the user lookup as before.
                if (sessionRow) {
                    if (!sessionRow.is_active) {
                        return res.status(401).json({ error: 'Session revoked' });
                    }
                    if (sessionRow.expires_at) {
                        // SQLite emits `YYYY-MM-DD HH:MM:SS` without a TZ
                        // marker — JS parses that as LOCAL time, which is
                        // wrong because the column is stored in UTC. Force
                        // UTC interpretation by appending 'Z' (or replacing
                        // the space with 'T' for older parsers).
                        const utcStamp = sessionRow.expires_at
                            .replace(' ', 'T') + 'Z';
                        if (new Date(utcStamp) < new Date()) {
                            return res.status(401).json({ error: 'Session expired' });
                        }
                    }
                    // Best-effort touch — failure is non-fatal.
                    db.run(
                        `UPDATE active_sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE token_hash = ?`,
                        [tokenHash],
                        () => { /* ignore */ }
                    );
                }

                db.get(
                    `SELECT tenant_id, role, status, deleted_at FROM users WHERE id = ?`,
                    [user.id],
                    (lookupErr, row) => {
                        if (lookupErr) {
                            return res.status(500).json({ error: 'Failed to resolve authenticated user' });
                        }
                        if (!row || row.deleted_at || row.status !== 'active') {
                            return res.status(403).json({ error: 'Invalid or inactive user' });
                        }
                        req.user = {
                            ...user,
                            role: row.role || user.role,
                            tenant_id: row.tenant_id || user.tenant_id || 1
                        };
                        // Stash the hash so /auth/logout can revoke this exact session
                        // without having to recompute it from the auth header.
                        req.tokenHash = tokenHash;

                        // CSRF: cookie-auth state-changing requests must
                        // present a matching X-CSRF-Token header. Bearer
                        // requests are exempt (the attacker can't auto-
                        // attach Authorization headers cross-site). See
                        // server/middleware/csrf.js for the full rationale.
                        if (csrfRequired(req)) {
                            const verdict = verifyCsrf(req);
                            if (verdict) {
                                return res.status(verdict.status).json(verdict.body);
                            }
                        }
                        next();
                    }
                );
            }
        );
    });
};

// Promise-style helpers so route handlers can await session state changes.

export function recordActiveSession(token, user, { ipAddress = null, userAgent = null, expiresIn = '+4 hours' } = {}) {
    const tokenHash = hashToken(token);
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO active_sessions (user_id, token_hash, ip_address, user_agent, expires_at, tenant_id)
             VALUES (?, ?, ?, ?, datetime('now', ?), ?)`,
            [user.id, tokenHash, ipAddress, userAgent, expiresIn, user.tenant_id || 1],
            (err) => err ? reject(err) : resolve(tokenHash)
        );
    });
}

export function revokeActiveSessionByToken(token) {
    return revokeActiveSessionByHash(hashToken(token));
}

export function revokeActiveSessionByHash(tokenHash) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE active_sessions SET is_active = 0 WHERE token_hash = ?`,
            [tokenHash],
            function (err) { err ? reject(err) : resolve(this.changes); }
        );
    });
}

export function resolveTenant(req) {
    return req.user?.tenant_id || 1;
}

export const requireSameTenant = (resourceTenantIdGetter) => async (req, res, next) => {
    try {
        const resourceTenantId = await resourceTenantIdGetter(req);
        if (resourceTenantId == null) {
            return res.status(404).json({ error: 'Resource not found' });
        }
        if (Number(resourceTenantId) !== Number(resolveTenant(req))) {
            return res.status(403).json({ error: 'Access denied: tenant mismatch' });
        }
        next();
    } catch (err) {
        res.status(500).json({ error: err.message || 'Tenant scope check failed' });
    }
};

export const ROLE_RANKS = Object.freeze({
    guest: 0,
    student: 1,
    user: 1,
    reviewer: 2,
    educator: 3,
    admin: 4
});

export const VALID_ROLES = Object.freeze(['guest', 'student', 'reviewer', 'educator', 'admin']);

export function normalizeRole(role) {
    return role === 'user' ? 'student' : role;
}

export function getRoleRank(roleOrUser) {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser?.role;
    return ROLE_RANKS[normalizeRole(role)] ?? ROLE_RANKS.guest;
}

export function hasRoleAtLeast(user, minRank) {
    return getRoleRank(user) >= minRank;
}

export const requireRole = (minRank) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!hasRoleAtLeast(req.user, minRank)) {
        return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
};

// Middleware to require specific minimum roles
export const requireAdmin = requireRole(ROLE_RANKS.admin);
export const requireEducator = requireRole(ROLE_RANKS.educator);
export const requireReviewer = requireRole(ROLE_RANKS.reviewer);
export const requireStudent = requireRole(ROLE_RANKS.student);

// Middleware to require authenticated user (admin or regular user)
export const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// Helper function to generate JWT token.
//
// Default TTL is 4h. Tokens are now server-revocable: authenticateToken
// consults active_sessions, so logout / admin force-logout / password change
// can immediately invalidate a still-cryptographically-valid JWT. The 4h
// TTL still bounds the worst-case window for legacy tokens (those issued
// before the active_sessions check landed) since those have no row to
// revoke.
//
// Override via JWT_EXPIRY env var (e.g. '7d' for a kiosk deployment).
export const generateToken = (user) => {
    const payload = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id || 1
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRY || '4h' });
};
