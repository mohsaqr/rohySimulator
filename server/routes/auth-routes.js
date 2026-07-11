import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import {
    authenticateToken,
    generateToken,
    recordActiveSession,
    revokeActiveSessionByHash,
    ROLE_RANKS,
    AUTH_COOKIE_NAME,
    getRoleRank,
} from '../middleware/auth.js';
import {
    CSRF_COOKIE_NAME,
    csrfCookieOptions,
    generateCsrfToken,
} from '../middleware/csrf.js';

// Account lockout: after MAX_FAILED_LOGINS consecutive failed attempts the
// account is locked for LOCKOUT_MINUTES. Restored after the routes.js split
// (commit 3a7a330) dropped these module-locals — without them the failed-login
// threshold branch ReferenceError'd in production.
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;



import { logger } from '../logger.js';
import {
    ensureAutoEnrollMemberships,
    isValidRole,
    logAudit,
    roleForStorage,
    tenantId,
    validatePassword
} from './_helpers.js';

function authCookieOptions(maxAgeSeconds = 4 * 60 * 60) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds * 1000,
    };
}

const authLog = logger('auth');
const radiologyLog = logger('radiology');

// The auth limiters guard the login + registration endpoints against
// password-guessing brute force. They're hardcoded for production — but
// in CI, dozens of e2e tests legitimately log in as fresh seeded users
// in the same wall-clock window from the same runner IP, which trips the
// 10-per-15-min cap and turns every later test into a 429. We honour an
// opt-in `ROHY_DISABLE_AUTH_RATE_LIMIT=1` env to scale the windows down
// to "effectively unlimited" — set only in the e2e workflow (NEVER in
// production). The cap stays on by default so nothing has to remember
// to flip it back for prod.
const RATE_LIMIT_DISABLED = process.env.ROHY_DISABLE_AUTH_RATE_LIMIT === '1';
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: RATE_LIMIT_DISABLED ? 100_000 : 10,
    message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: RATE_LIMIT_DISABLED ? 100_000 : 5,
    message: { error: 'Too many registration attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let radiologyDatabase = [];
try {
    const radiologyPath = path.join(__dirname, '../data/radiology_database.json');
    if (fs.existsSync(radiologyPath)) {
        const data = JSON.parse(fs.readFileSync(radiologyPath, 'utf8'));
        radiologyDatabase = data.studies || [];
        radiologyLog.info('radiology database loaded', { count: radiologyDatabase.length });
    }
} catch (err) {
    radiologyLog.error('radiology database load failed', { error: err.message });
}

const router = express.Router();

router.post('/auth/register', registerLimiter, async (req, res) => {
    const { username, name, email, password, role = 'student' } = req.body;
    const requestedRole = roleForStorage(role);

    // Validation
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
        return res.status(400).json({ error: passwordValidation.errors.join('. ') });
    }

    if (!isValidRole(requestedRole)) {
        return res.status(400).json({ error: 'Invalid role' });
    }

    const userCount = await new Promise((resolve, reject) => {
        dbAdapter.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
        });
    });

    let finalRole = 'student';
    if (userCount === 0 && requestedRole === 'admin') {
        finalRole = 'admin';
    } else if (getRoleRank(requestedRole) > ROLE_RANKS.student) {
        return res.status(403).json({ error: 'Only admins can create elevated accounts' });
    }

    try {
        // Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // Insert user
        const defaultTenantId = 1;
        const sql = `INSERT INTO users (username, name, email, password_hash, role, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`;
        dbAdapter.run(sql, [username, name || null, email, password_hash, finalRole, defaultTenantId], async function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: 'Username or email already exists' });
                }
                return res.status(500).json({ error: err.message });
            }

            const user = { id: this.lastID, username, name, email, role: finalRole, tenant_id: defaultTenantId };
            const token = generateToken(user);
            const ipAddress = req.ip || req.connection?.remoteAddress;
            const userAgent = req.headers['user-agent'];

            // F-004: previously register issued a JWT but never recorded
            // an active_sessions row or set the auth/CSRF cookies. The
            // legacy compat at middleware/auth.js L144 ("missing row =
            // allow through") meant the token worked, but logout /
            // admin-revoke couldn't touch it. Now we mirror login's
            // session-issuance path so register-issued sessions are
            // first-class: revocable, cookie-aware, CSRF-paired. Failure
            // is non-fatal — the JSON token in the response body is
            // still valid; the user just isn't server-revocable.
            try {
                await recordActiveSession(token, user, { ipAddress, userAgent });
            } catch (e) {
                (req.log || authLog).warn('register active session record failed', {
                    user_id: user.id,
                    tenant_id: defaultTenantId,
                    error: e.message
                });
            }

            // Auto-enrol into the tenant's "Basic course" default class so the
            // new user always has the default case (safety net for enforced
            // access). Idempotent + never throws.
            await ensureAutoEnrollMemberships(user.id, defaultTenantId);

            res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
            res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions());

            logAudit({
                userId: user.id,
                username,
                action: 'register_user_self',
                resourceType: 'user',
                resourceId: String(user.id),
                resourceName: username,
                newValue: { username, email, role: finalRole, tenant_id: defaultTenantId },
                tenantId: defaultTenantId,
                ipAddress,
                userAgent
            });

            res.status(201).json({
                message: 'User registered successfully',
                user: { id: user.id, username, name, email, role: finalRole, tenant_id: defaultTenantId },
                token
            });
        });
    } catch (err) {
        res.status(500).json({ error: 'Error registering user', details: err.message });
    }
});

// POST /api/users/create - Create user (Admin only, no auto-login)

router.post('/auth/login', authLimiter, (req, res) => {
    const { username, password } = req.body;
    const ipAddress = req.ip || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const sql = `SELECT * FROM users WHERE username = ?`;
    dbAdapter.get(sql, [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!user) {
            // Log failed login attempt — dual-write so the unified Activity
            // view sees auth events alongside in-session learning events.
            dbAdapter.run(
                `INSERT INTO login_logs (user_id, username, action, ip_address, user_agent, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`,
                [null, username, 'failed_login', ipAddress, userAgent, 1]
            );
            dbAdapter.run(
                `INSERT INTO learning_events (user_id, verb, object_type, object_name, severity, category, context, tenant_id, room)
                 VALUES (NULL, 'FAILED_LOGIN', 'auth', ?, 'IMPORTANT', 'SESSION', ?, 1, NULL)`,
                [username, JSON.stringify({ ip: ipAddress, ua: userAgent, reason: 'unknown_user' })]
            );
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Honour active lockout window. Users with a future `locked_until`
        // get rejected without bcrypt compare so timing-side-channel and
        // CPU-burn aren't escalation paths.
        if (user.locked_until) {
            const lockedUntilMs = new Date(user.locked_until).getTime();
            if (Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now()) {
                const minsLeft = Math.ceil((lockedUntilMs - Date.now()) / 60000);
                return res.status(423).json({
                    error: `Account locked. Try again in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}.`
                });
            }
        }

        try {
            const match = await bcrypt.compare(password, user.password_hash);
            if (!match) {
                // Log + bump fail counter; lock at threshold.
                const newAttempts = (user.failed_login_attempts || 0) + 1;
                if (newAttempts >= MAX_FAILED_LOGINS) {
                    dbAdapter.run(
                        `UPDATE users SET failed_login_attempts = ?,
                            locked_until = datetime('now', '+' || ? || ' minutes')
                         WHERE id = ?`,
                        [newAttempts, LOCKOUT_MINUTES, user.id]
                    );
                } else {
                    dbAdapter.run(
                        `UPDATE users SET failed_login_attempts = ? WHERE id = ?`,
                        [newAttempts, user.id]
                    );
                }
                dbAdapter.run(
                    `INSERT INTO login_logs (user_id, username, action, ip_address, user_agent, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`,
                    [user.id, username, 'failed_login', ipAddress, userAgent, user.tenant_id || 1]
                );
                dbAdapter.run(
                    `INSERT INTO learning_events (user_id, verb, object_type, object_name, severity, category, context, tenant_id, room)
                     VALUES (?, 'FAILED_LOGIN', 'auth', ?, 'IMPORTANT', 'SESSION', ?, ?, NULL)`,
                    [user.id, username, JSON.stringify({ ip: ipAddress, ua: userAgent, reason: 'bad_password', attempts: newAttempts }), user.tenant_id || 1]
                );
                return res.status(401).json({ error: 'Invalid username or password' });
            }

            // Log successful login (dual-write: legacy login_logs + canonical learning_events).
            dbAdapter.run(
                `INSERT INTO login_logs (user_id, username, action, ip_address, user_agent, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`,
                [user.id, username, 'login', ipAddress, userAgent, user.tenant_id || 1]
            );
            dbAdapter.run(
                `INSERT INTO learning_events (user_id, verb, object_type, object_name, severity, category, context, tenant_id, room)
                 VALUES (?, 'LOGGED_IN', 'auth', ?, 'INFO', 'SESSION', ?, ?, NULL)`,
                [user.id, username, JSON.stringify({ ip: ipAddress, ua: userAgent }), user.tenant_id || 1]
            );

            // Reset both failed_login_attempts and locked_until on success.
            dbAdapter.run(
                `UPDATE users SET last_login = CURRENT_TIMESTAMP,
                    failed_login_attempts = 0, locked_until = NULL
                 WHERE id = ?`,
                [user.id]
            );

            const token = generateToken(user);

            // Track active session via the centralised helper so the row
            // shape stays in lockstep with authenticateToken's revocation
            // check. Failure here is non-fatal — login still succeeds, the
            // user just won't be server-revocable on this token.
            try {
                await recordActiveSession(token, user, { ipAddress, userAgent });
            } catch (e) {
                (req.log || authLog).warn('active session record failed', {
                    user_id: user.id,
                    tenant_id: user.tenant_id || 1,
                    error: e.message
                });
            }

            // Ensure the returning user is enrolled in "Basic course" (covers
            // users created before the migration / outside the register flow).
            await ensureAutoEnrollMemberships(user.id, user.tenant_id || 1);

            // Set HttpOnly cookie alongside the JSON token. Cookie-aware
            // clients (apiFetch with credentials:'include') get the
            // protection; legacy clients keep using the JSON token.
            // Both paths verify against the SAME active_sessions row, so
            // logout/admin-revoke applies regardless of which the client is on.
            res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());

            // Pair the auth cookie with a (non-HttpOnly) CSRF token so
            // cookie-auth state-changing requests can satisfy the
            // double-submit check in authenticateToken. Client JS reads
            // this and echoes it as X-CSRF-Token. See middleware/csrf.js.
            res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions());

            res.json({
                message: 'Login successful',
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    tenant_id: user.tenant_id || 1
                },
                token
            });
        } catch (err) {
            res.status(500).json({ error: 'Error during login', details: err.message });
        }
    });
});

// GET /api/auth/verify - Verify token validity AND refresh the CSRF cookie.
// The client calls this on app mount; using it as the rotation point keeps
// the CSRF cookie aligned with the auth cookie's lifetime without an
// extra dedicated endpoint.
router.get('/auth/verify', authenticateToken, (req, res) => {
    if (req.tokenSource === 'cookie') {
        res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions());
    }
    res.json({
        valid: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            email: req.user.email,
            role: req.user.role
            ,
            tenant_id: tenantId(req)
        }
    });
});

// POST /api/auth/refresh — rotate the JWT inside an active session.
//
// The client calls this proactively before the 4h JWT expires (from
// AuthContext via a setInterval). We:
//   1. Re-issue a fresh JWT bound to the same user (same role/tenant).
//   2. Insert a new active_sessions row keyed on the new token's hash.
//   3. Revoke the OLD active_sessions row (the one used to authenticate
//      this very request — it's stashed in req.tokenHash).
//   4. Reset the rohy_auth + rohy_csrf cookies so the next request rides
//      the new pair.
//
// Result: the user's session can extend indefinitely as long as their
// tab is open and they keep refreshing. The active_sessions audit trail
// stays accurate (one row per live JWT). Logout / admin force-logout
// still works because revocation is keyed by token-hash, and the new
// hash is in the new row.
router.post('/auth/refresh', authenticateToken, async (req, res) => {
    try {
        // Fetch a fresh row in case role/tenant_id changed since this token
        // was issued — the new JWT must reflect current state.
        const fresh = await new Promise((resolve, reject) => {
            dbAdapter.get(
                `SELECT id, username, email, role, tenant_id FROM users WHERE id = ?`,
                [req.user.id],
                (err, row) => err ? reject(err) : resolve(row)
            );
        });
        if (!fresh) {
            return res.status(403).json({ error: 'User no longer exists' });
        }

        const newToken = generateToken(fresh);
        const ipAddress = req.ip || req.socket?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        try {
            await recordActiveSession(newToken, fresh, { ipAddress, userAgent });
        } catch (e) {
            (req.log || authLog).warn('refresh active session record failed', {
                user_id: fresh.id,
                tenant_id: fresh.tenant_id || 1,
                error: e.message
            });
        }

        // Revoke the old token AFTER inserting the new row so there's no
        // window where the user has zero valid sessions.
        if (req.tokenHash) {
            try {
                await revokeActiveSessionByHash(req.tokenHash);
            } catch (e) {
                (req.log || authLog).warn('refresh old session revoke failed', {
                    user_id: fresh.id,
                    tenant_id: fresh.tenant_id || 1,
                    error: e.message
                });
            }
        }

        // Refresh both cookies. Cookie-mode clients rotate transparently;
        // bearer-mode clients also get the new JSON token in the body
        // and can update their localStorage if they're still on that path.
        res.cookie(AUTH_COOKIE_NAME, newToken, authCookieOptions());
        res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions());

        res.json({
            message: 'Token refreshed',
            user: {
                id: fresh.id,
                username: fresh.username,
                email: fresh.email,
                role: fresh.role,
                tenant_id: fresh.tenant_id || 1,
            },
            token: newToken,
        });
    } catch (err) {
        res.status(500).json({ error: 'Refresh failed', details: err.message });
    }
});

// GET /api/auth/profile - Get current user profile
router.get('/auth/profile', authenticateToken, (req, res) => {
    const sql = `SELECT id, username, email, role, tenant_id, created_at FROM users WHERE id = ? AND tenant_id = ?`;
    dbAdapter.get(sql, [req.user.id, tenantId(req)], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user });
    });
});

// POST /api/auth/logout - Log logout event AND revoke this session.
// The revoke half is what makes server-side logout actually work: even though
// the JWT is still cryptographically valid, future requests presenting it will
// fail at authenticateToken's active_sessions check.
router.post('/auth/logout', authenticateToken, async (req, res) => {
    const ipAddress = req.ip || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (req.tokenHash) {
        try {
            await revokeActiveSessionByHash(req.tokenHash);
        } catch (e) {
            (req.log || authLog).warn('logout session revoke failed', {
                user_id: req.user.id,
                tenant_id: tenantId(req),
                error: e.message
            });
        }
    }

    // Drop the cookie regardless of how the client authed — cookie-mode
    // clients lose their token, header-mode clients are unaffected.
    res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions(0));
    // Drop the CSRF half too so a stale token can't sit around in the
    // browser after logout.
    res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions(0));

    // Dual-write: legacy login_logs + canonical learning_events. Auth
    // events never carry a room (logout fires from the menu, not a room);
    // column included as NULL for parity with the canonical schema.
    dbAdapter.run(
        `INSERT INTO learning_events (user_id, verb, object_type, object_name, severity, category, context, tenant_id, room)
         VALUES (?, 'LOGGED_OUT', 'auth', ?, 'INFO', 'SESSION', ?, ?, NULL)`,
        [req.user.id, req.user.username, JSON.stringify({ ip: ipAddress, ua: userAgent }), tenantId(req)]
    );

    dbAdapter.run(
        `INSERT INTO login_logs (user_id, username, action, ip_address, user_agent, tenant_id) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user.id, req.user.username, 'logout', ipAddress, userAgent, tenantId(req)],
        (err) => {
            if (err) {
                (req.log || authLog).error('logout log write failed', {
                    user_id: req.user.id,
                    tenant_id: tenantId(req),
                    error: err.message
                });
            }
            res.json({ message: 'Logout logged successfully' });
        }
    );
});

// --- GENERIC MEDIA UPLOAD ---
// Used by PhysicalExamEditor (auscultation audio) and RadiologyEditor
// (study images / videos). Authenticated; field name is 'photo' for
// historical reasons (also accepts other media types — multer doesn't
// inspect content). Cases no longer use this for patient photos
// (avatars are 3D), so this is admin-authoring media only.

export default router;
