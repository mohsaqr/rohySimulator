// Registration invites — the admin CRUD plus the ONE public route the register
// screen needs.
//
// An invite is a copy-paste artifact, not an email. The platform has no mail
// transport of any kind, so the token is designed to survive being pasted into
// a URL, typed off a slide, and read aloud: one string, ambiguity-free alphabet
// (server/lib/joinCode.js), normalised on the way in.
//
// Redemption itself lives in POST /auth/register (auth-routes.js) — an invite is
// a property OF a registration, not a separate act.

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    authenticateToken,
    requireAdmin,
    getRoleRank,
} from '../middleware/auth.js';
import { logger } from '../logger.js';
import { allocateInviteToken, findInviteByToken, inviteRejection } from '../lib/invites.js';
// One time shape everywhere (RPS-1 §17): a user row created here gets an
// explicit UTC ISO created_at instead of sqlite's naive DEFAULT CURRENT_TIMESTAMP.
import { SQL_NOW } from '../shared/time.js';
import {
    auditSuccess,
    dbAll,
    dbGet,
    dbRun,
    ensureAutoEnrollMemberships,
    isValidRole,
    roleForStorage,
    tenantId,
} from './_helpers.js';

const inviteLog = logger('registration-invites');
const router = express.Router();

const RATE_LIMIT_DISABLED = process.env.ROHY_DISABLE_AUTH_RATE_LIMIT === '1';

// The preview is public and hits the DB. The keyspace makes brute force
// pointless, but an unauthenticated endpoint still gets a budget.
const invitePreviewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: RATE_LIMIT_DISABLED ? 100_000 : 60,
    message: { error: 'Too many requests. Please try again shortly.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// --- Public -----------------------------------------------------------------

// GET /api/auth/invite/:token — PUBLIC. What the register screen shows someone
// who arrived on an invite link ("You're invited to Cardiology 101").
//
// ALWAYS 200, so the client has one code path. Returns only what the invited
// person legitimately needs to see: never the creator, the invite id, the
// admin's private note, or the tenant.
router.get('/auth/invite/:token', invitePreviewLimiter, async (req, res) => {
    try {
        const invite = await findInviteByToken(req.params.token);
        const reason = inviteRejection(invite);
        if (reason) return res.json({ valid: false, reason });

        let cohortName = null;
        if (invite.cohort_id) {
            const cohort = await dbGet(
                'SELECT name FROM cohorts WHERE id = ? AND deleted_at IS NULL',
                [invite.cohort_id]
            );
            cohortName = cohort?.name || null;
        }

        res.json({
            valid: true,
            role: invite.role,
            cohort_name: cohortName,
            expires_at: invite.expires_at,
            email_domain: invite.email_pattern,
            uses_left: invite.max_uses == null ? null : invite.max_uses - invite.uses,
        });
    } catch (err) {
        (req.log || inviteLog).warn('invite preview failed', { error: err.message });
        res.status(500).json({ error: 'Could not read that invite' });
    }
});

// --- Admin ------------------------------------------------------------------

router.post('/registration-invites', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const role = roleForStorage(req.body?.role || 'student');
        if (!isValidRole(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }
        // You cannot mint an invite to a rank above your own — otherwise an
        // invite is a privilege-escalation primitive with a nice UI.
        if (getRoleRank(role) > getRoleRank(req.user.role)) {
            return res.status(403).json({ error: 'Cannot invite a role higher than your own' });
        }

        const tid = tenantId(req);

        let cohortId = null;
        if (req.body?.cohort_id) {
            const cohort = await dbGet(
                'SELECT id FROM cohorts WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
                [req.body.cohort_id, tid]
            );
            if (!cohort) return res.status(404).json({ error: 'Course not found' });
            cohortId = cohort.id;
        }

        const maxUses = req.body?.max_uses == null || req.body.max_uses === ''
            ? null
            : Number(req.body.max_uses);
        if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 1)) {
            return res.status(400).json({ error: 'max_uses must be a positive whole number, or empty for unlimited' });
        }

        let expiresAt = null;
        if (req.body?.expires_at) {
            const when = new Date(req.body.expires_at);
            if (Number.isNaN(when.getTime())) {
                return res.status(400).json({ error: 'expires_at is not a valid date' });
            }
            expiresAt = when.toISOString();
        }

        const emailPattern = req.body?.email_pattern
            ? String(req.body.email_pattern).trim().toLowerCase().replace(/^@/, '')
            : null;

        const token = await allocateInviteToken();
        if (!token) {
            return res.status(500).json({ error: 'Could not allocate an invite code' });
        }

        const result = await dbRun(
            `INSERT INTO registration_invites
                (tenant_id, token, role, cohort_id, max_uses, expires_at, email_pattern, note, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tid, token, role, cohortId, maxUses, expiresAt, emailPattern,
             req.body?.note ? String(req.body.note).slice(0, 200) : null, req.user.id]
        );

        // The audit log redacts any field named `token` (server/redaction.js), so
        // this records WHO minted WHAT WITHOUT writing the credential to the log.
        auditSuccess(req, {
            action: 'registration_invite_created',
            resourceType: 'registration_invite',
            resourceId: String(result.lastID),
            newValue: { role, cohort_id: cohortId, max_uses: maxUses, expires_at: expiresAt, token },
        });

        const invite = await dbGet('SELECT * FROM registration_invites WHERE id = ?', [result.lastID]);
        res.status(201).json({ invite: { ...invite, uses_left: maxUses == null ? null : maxUses } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/registration-invites — the admin's list.
//
// NOTE: explicitly NOT piped through redactRows(). That helper hides any column
// called `token`, which is right for a session row and fatal here: the token IS
// the deliverable, and an admin who cannot re-copy the link has no way to share
// the invite they just made.
router.get('/registration-invites', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const rows = await dbAll(
            `SELECT i.*, u.username AS created_by_username, c.name AS cohort_name
               FROM registration_invites i
               LEFT JOIN users u ON u.id = i.created_by
               LEFT JOIN cohorts c ON c.id = i.cohort_id
              WHERE i.tenant_id = ?
              ORDER BY i.created_at DESC`,
            [tenantId(req)]
        );
        res.json({
            invites: rows.map((r) => ({
                ...r,
                uses_left: r.max_uses == null ? null : Math.max(0, r.max_uses - r.uses),
                status: inviteRejection(r) || 'active',
            })),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/registration-invites/:id — REVOKE, not delete. The row stays so
// the redemption ledger keeps meaning something. Idempotent.
router.delete('/registration-invites/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const invite = await dbGet(
            'SELECT * FROM registration_invites WHERE id = ? AND tenant_id = ?',
            [req.params.id, tenantId(req)]
        );
        if (!invite) return res.status(404).json({ error: 'Invite not found' });

        if (!invite.revoked_at) {
            await dbRun(
                'UPDATE registration_invites SET revoked_at = CURRENT_TIMESTAMP, revoked_by = ? WHERE id = ?',
                [req.user.id, invite.id]
            );
            auditSuccess(req, {
                action: 'registration_invite_revoked',
                resourceType: 'registration_invite',
                resourceId: String(invite.id),
                oldValue: { role: invite.role, uses: invite.uses },
            });
        }
        res.json({ revoked: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/registration-invites/:id/uses — who this invite actually let in.
router.get('/registration-invites/:id/uses', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const invite = await dbGet(
            'SELECT id FROM registration_invites WHERE id = ? AND tenant_id = ?',
            [req.params.id, tenantId(req)]
        );
        if (!invite) return res.status(404).json({ error: 'Invite not found' });

        const uses = await dbAll(
            `SELECT iu.used_at, u.id AS user_id, u.username, u.email
               FROM registration_invite_uses iu
               LEFT JOIN users u ON u.id = iu.user_id
              WHERE iu.invite_id = ?
              ORDER BY iu.used_at DESC`,
            [invite.id]
        );
        res.json({ uses });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
// The approval queue (registration_mode = 'approval').
//
// A pending applicant deliberately does NOT exist in `users` — see migration
// 0038 for why. Approving mints the user row from the request; rejecting closes
// the request and leaves no account behind. Both are terminal: the partial
// unique indexes only cover live rows, so a rejected applicant may apply again.
// ---------------------------------------------------------------------------

// GET /api/registration-requests?status=pending — the queue.
// The password hash is never selected; nobody, admin included, needs to see it.
router.get('/registration-requests', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
            ? req.query.status
            : 'pending';
        const requests = await dbAll(
            `SELECT r.id, r.username, r.name, r.email, r.status, r.requested_at,
                    r.decided_at, r.decision_note, r.user_id,
                    d.username AS decided_by_username
               FROM registration_requests r
               LEFT JOIN users d ON d.id = r.decided_by
              WHERE r.tenant_id = ? AND r.status = ?
              ORDER BY r.requested_at DESC`,
            [tenantId(req), status]
        );
        res.json({ requests, status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/registration-requests/:id/approve — mint the account.
//
// The role is the admin's to choose here (default student) and is rank-ceilinged
// against the approver, exactly like POST /users/create. The applicant never got
// to ask for a role: their request body's `role` was discarded at request time.
router.post('/registration-requests/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const request = await dbGet(
            `SELECT * FROM registration_requests WHERE id = ? AND tenant_id = ?`,
            [req.params.id, tenantId(req)]
        );
        if (!request) return res.status(404).json({ error: 'Request not found' });
        if (request.status !== 'pending') {
            return res.status(409).json({
                code: 'already_decided',
                error: `This request was already ${request.status}.`
            });
        }

        const role = roleForStorage(req.body?.role || 'student');
        if (!isValidRole(role)) return res.status(400).json({ error: 'Invalid role' });
        if (getRoleRank(role) > getRoleRank(req.user.role)) {
            return res.status(403).json({ error: 'Cannot approve a role higher than your own' });
        }

        // The hash moves across untouched — the applicant signs in with the password
        // they chose when they applied, and no admin ever sees or sets it.
        let userId;
        try {
            const result = await dbRun(
                // created_at is named, not defaulted — see the SQL_NOW import.
                `INSERT INTO users (username, name, email, password_hash, role, tenant_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ${SQL_NOW})`,
                [request.username, request.name, request.email, request.password_hash, role, request.tenant_id]
            );
            userId = result.lastID;
        } catch (err) {
            // Someone took the username while the request sat in the queue (an admin
            // created it by hand, or an invite let them in). The request stays pending
            // so the admin can see why it failed rather than losing it to a 500.
            if (String(err.message).includes('UNIQUE')) {
                return res.status(409).json({
                    code: 'username_taken',
                    error: 'That username or email now belongs to an existing account. Reject this request.'
                });
            }
            throw err;
        }

        await dbRun(
            `UPDATE registration_requests
                SET status = 'approved', decided_at = CURRENT_TIMESTAMP, decided_by = ?, user_id = ?
              WHERE id = ?`,
            [req.user.id, userId, request.id]
        );

        // Same courtesy every other entry path gets: land them in the auto-enrol
        // classes so an approved student opens the app inside their course.
        await ensureAutoEnrollMemberships(userId, request.tenant_id);

        auditSuccess(req, {
            action: 'registration_request_approved',
            resourceType: 'registration_request',
            resourceId: String(request.id),
            newValue: { username: request.username, role, user_id: userId },
        });

        res.status(201).json({
            approved: true,
            user: { id: userId, username: request.username, email: request.email, role }
        });
    } catch (err) {
        inviteLog.error('approve registration request failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});

// POST /api/registration-requests/:id/reject — no account is created, and the
// hashed password dies with the row's usefulness. The row itself stays as the
// record that someone asked and was told no.
router.post('/registration-requests/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const request = await dbGet(
            `SELECT * FROM registration_requests WHERE id = ? AND tenant_id = ?`,
            [req.params.id, tenantId(req)]
        );
        if (!request) return res.status(404).json({ error: 'Request not found' });
        if (request.status !== 'pending') {
            return res.status(409).json({
                code: 'already_decided',
                error: `This request was already ${request.status}.`
            });
        }

        await dbRun(
            `UPDATE registration_requests
                SET status = 'rejected', decided_at = CURRENT_TIMESTAMP, decided_by = ?, decision_note = ?
              WHERE id = ?`,
            [req.user.id, req.body?.note || null, request.id]
        );

        auditSuccess(req, {
            action: 'registration_request_rejected',
            resourceType: 'registration_request',
            resourceId: String(request.id),
            oldValue: { username: request.username },
        });

        res.json({ rejected: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
