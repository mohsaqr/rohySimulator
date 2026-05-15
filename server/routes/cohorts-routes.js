import express from 'express';
import crypto from 'crypto';
import dbAdapter from '../dbAdapter.js';
import {
    authenticateToken,
    requireEducator,
    requireStudent,
    ROLE_RANKS,
    hasRoleAtLeast,
} from '../middleware/auth.js';
import { logger } from '../logger.js';
import { auditSuccess, tenantId } from './_helpers.js';

const router = express.Router();
const cohortsLog = logger('routes-cohorts');

const isAdmin = (req) => hasRoleAtLeast(req.user, ROLE_RANKS.admin);

// Excludes ambiguous glyphs (0/O, 1/I/L) so a shared code can't be
// mistyped between teacher and student.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;
const JOIN_CODE_MAX_RETRIES = 6;

function generateJoinCode() {
    const bytes = crypto.randomBytes(JOIN_CODE_LENGTH);
    let out = '';
    for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
        out += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
    }
    return out;
}

// Owner or admin within the caller's tenant. Returns the cohort row, or
// sends the response and returns null. 404 (not 403) when the cohort is
// another owner's / another tenant's so existence doesn't leak — mirrors
// the ownership pattern in orders-routes.js / _helpers verifySessionOwnership.
async function loadOwnedCohort(req, res) {
    const cohort = await dbAdapter.get(
        `SELECT * FROM cohorts WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        [req.params.id, tenantId(req)]
    );
    if (!cohort) {
        res.status(404).json({ error: 'Cohort not found' });
        return null;
    }
    if (cohort.owner_user_id !== req.user.id && !isAdmin(req)) {
        res.status(404).json({ error: 'Cohort not found' });
        return null;
    }
    return cohort;
}

async function memberCount(cohortId) {
    const row = await dbAdapter.get(
        `SELECT COUNT(*) AS count FROM cohort_members WHERE cohort_id = ? AND deleted_at IS NULL`,
        [cohortId]
    );
    return row ? Number(row.count || 0) : 0;
}

router.post('/cohorts', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }
        const result = await dbAdapter.run(
            `INSERT INTO cohorts (name, owner_user_id, tenant_id) VALUES (?, ?, ?)`,
            [name, req.user.id, tenantId(req)]
        );
        const cohort = await dbAdapter.get(`SELECT * FROM cohorts WHERE id = ?`, [result.lastID]);
        auditSuccess(req, {
            action: 'cohort.create',
            resourceType: 'cohort',
            resourceId: cohort.id,
            resourceName: cohort.name,
        });
        res.status(201).json({ cohort: { ...cohort, member_count: 0 } });
    } catch (err) {
        next(err);
    }
});

router.get('/cohorts', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const params = [tenantId(req)];
        let where = `tenant_id = ? AND deleted_at IS NULL`;
        if (!isAdmin(req)) {
            where += ` AND owner_user_id = ?`;
            params.push(req.user.id);
        }
        const rows = await dbAdapter.all(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM cohort_members m
                      WHERE m.cohort_id = c.id AND m.deleted_at IS NULL) AS member_count
               FROM cohorts c
              WHERE ${where}
              ORDER BY c.created_at DESC, c.id DESC`,
            params
        );
        res.json({ cohorts: rows });
    } catch (err) {
        next(err);
    }
});

router.get('/cohorts/:id', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        const members = await dbAdapter.all(
            `SELECT u.id, u.username, u.name, u.role
               FROM cohort_members m
               JOIN users u ON u.id = m.user_id
              WHERE m.cohort_id = ? AND m.deleted_at IS NULL
              ORDER BY u.username ASC`,
            [cohort.id]
        );
        res.json({
            cohort: { ...cohort, member_count: members.length },
            members,
        });
    } catch (err) {
        next(err);
    }
});

router.patch('/cohorts/:id', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) {
            return res.status(400).json({ error: 'name is required' });
        }
        await dbAdapter.run(`UPDATE cohorts SET name = ? WHERE id = ?`, [name, cohort.id]);
        auditSuccess(req, {
            action: 'cohort.rename',
            resourceType: 'cohort',
            resourceId: cohort.id,
            oldValue: { name: cohort.name },
            newValue: { name },
        });
        const updated = await dbAdapter.get(`SELECT * FROM cohorts WHERE id = ?`, [cohort.id]);
        res.json({ cohort: { ...updated, member_count: await memberCount(cohort.id) } });
    } catch (err) {
        next(err);
    }
});

router.delete('/cohorts/:id', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        await dbAdapter.run(
            `UPDATE cohorts SET deleted_at = ${dbAdapter.now()} WHERE id = ? AND deleted_at IS NULL`,
            [cohort.id]
        );
        await dbAdapter.run(
            `UPDATE cohort_members SET deleted_at = ${dbAdapter.now()} WHERE cohort_id = ? AND deleted_at IS NULL`,
            [cohort.id]
        );
        auditSuccess(req, {
            action: 'cohort.delete',
            resourceType: 'cohort',
            resourceId: cohort.id,
            resourceName: cohort.name,
        });
        res.json({ deleted: true });
    } catch (err) {
        next(err);
    }
});

async function addMember(cohortId, userId) {
    const existing = await dbAdapter.get(
        `SELECT * FROM cohort_members WHERE cohort_id = ? AND user_id = ?
          ORDER BY (deleted_at IS NULL) DESC, id DESC LIMIT 1`,
        [cohortId, userId]
    );
    if (existing && existing.deleted_at == null) {
        return { membership: existing, created: false, revived: false };
    }
    if (existing) {
        await dbAdapter.run(
            `UPDATE cohort_members SET deleted_at = NULL, joined_at = ${dbAdapter.now()} WHERE id = ?`,
            [existing.id]
        );
        const revived = await dbAdapter.get(`SELECT * FROM cohort_members WHERE id = ?`, [existing.id]);
        return { membership: revived, created: false, revived: true };
    }
    const result = await dbAdapter.run(
        `INSERT INTO cohort_members (cohort_id, user_id) VALUES (?, ?)`,
        [cohortId, userId]
    );
    const membership = await dbAdapter.get(`SELECT * FROM cohort_members WHERE id = ?`, [result.lastID]);
    return { membership, created: true, revived: false };
}

router.post('/cohorts/:id/members', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
        if (!identifier) {
            return res.status(400).json({ error: 'identifier is required' });
        }
        const target = await dbAdapter.get(
            `SELECT id, username, name, role FROM users
              WHERE (username = ? OR email = ?) AND tenant_id = ? AND deleted_at IS NULL`,
            [identifier, identifier, tenantId(req)]
        );
        if (!target) {
            return res.status(404).json({ error: 'User not found in this tenant' });
        }
        const { membership, created, revived } = await addMember(cohort.id, target.id);
        if (created || revived) {
            auditSuccess(req, {
                action: 'cohort.member.add',
                resourceType: 'cohort',
                resourceId: cohort.id,
                targetType: 'user',
                targetId: target.id,
                metadata: { revived },
            });
        }
        res.status(created ? 201 : 200).json({ membership, member: target });
    } catch (err) {
        next(err);
    }
});

router.delete('/cohorts/:id/members/:userId', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        const result = await dbAdapter.run(
            `UPDATE cohort_members SET deleted_at = ${dbAdapter.now()}
              WHERE cohort_id = ? AND user_id = ? AND deleted_at IS NULL`,
            [cohort.id, req.params.userId]
        );
        if (!result.changes) {
            return res.status(404).json({ error: 'Membership not found' });
        }
        auditSuccess(req, {
            action: 'cohort.member.remove',
            resourceType: 'cohort',
            resourceId: cohort.id,
            targetType: 'user',
            targetId: Number(req.params.userId),
        });
        res.json({ removed: true });
    } catch (err) {
        next(err);
    }
});

router.post('/cohorts/:id/join-code', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        let lastErr = null;
        for (let attempt = 0; attempt < JOIN_CODE_MAX_RETRIES; attempt++) {
            const code = generateJoinCode();
            try {
                await dbAdapter.run(
                    `UPDATE cohorts SET join_code = ? WHERE id = ?`,
                    [code, cohort.id]
                );
                auditSuccess(req, {
                    action: 'cohort.join_code.set',
                    resourceType: 'cohort',
                    resourceId: cohort.id,
                });
                return res.json({ join_code: code });
            } catch (err) {
                // Partial-unique collision on a live join_code — retry with
                // a fresh code. Any other error is fatal.
                if (/UNIQUE constraint/i.test(err.message)) {
                    lastErr = err;
                    continue;
                }
                throw err;
            }
        }
        cohortsLog.error('join code generation exhausted retries', {
            cohort_id: cohort.id,
            error: lastErr?.message,
        });
        res.status(500).json({ error: 'Could not allocate a unique join code' });
    } catch (err) {
        next(err);
    }
});

router.delete('/cohorts/:id/join-code', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        await dbAdapter.run(`UPDATE cohorts SET join_code = NULL WHERE id = ?`, [cohort.id]);
        auditSuccess(req, {
            action: 'cohort.join_code.clear',
            resourceType: 'cohort',
            resourceId: cohort.id,
        });
        res.json({ join_code: null });
    } catch (err) {
        next(err);
    }
});

router.post('/cohorts/join', authenticateToken, requireStudent, async (req, res, next) => {
    try {
        const joinCode = typeof req.body?.join_code === 'string' ? req.body.join_code.trim() : '';
        if (!joinCode) {
            return res.status(400).json({ error: 'join_code is required' });
        }
        const cohort = await dbAdapter.get(
            `SELECT id, name FROM cohorts
              WHERE join_code = ? AND tenant_id = ? AND deleted_at IS NULL`,
            [joinCode, tenantId(req)]
        );
        if (!cohort) {
            return res.status(404).json({ error: 'No cohort found for that join code' });
        }
        const { created, revived } = await addMember(cohort.id, req.user.id);
        if (created || revived) {
            auditSuccess(req, {
                action: 'cohort.join',
                resourceType: 'cohort',
                resourceId: cohort.id,
                targetType: 'user',
                targetId: req.user.id,
            });
        }
        res.json({ cohort: { id: cohort.id, name: cohort.name } });
    } catch (err) {
        next(err);
    }
});

export default router;
