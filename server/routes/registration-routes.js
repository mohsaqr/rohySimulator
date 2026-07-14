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
import {
    auditSuccess,
    dbAll,
    dbGet,
    dbRun,
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

export default router;
