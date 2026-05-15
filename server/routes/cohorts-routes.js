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

// ---------------------------------------------------------------------------
// Phase 4 — teacher-facing reporting read-models (SELECT only).
//
// Strictly additive: these are NEW endpoints scoped to the caller's own
// cohorts (admin = all). The existing flat analytics endpoints in
// analytics-routes.js are intentionally left untouched — admins keep the
// firehose, teachers get these scoped views.
//
// SECURITY BOUNDARY — every student-data query is restricted to the live
// members of the resolved (owned) cohort AND the caller's tenant. The
// reusable WHERE fragment is:
//
//   s.tenant_id = ?
//   AND s.user_id IN (
//       SELECT m.user_id FROM cohort_members m
//        WHERE m.cohort_id = ? AND m.deleted_at IS NULL
//   )
//
// The cohort id itself is only ever the one returned by loadOwnedCohort()
// (404 on wrong-owner / wrong-tenant / missing — no existence leak), so a
// teacher can never name another teacher's cohort id and the member
// sub-select can never reach another tenant's students.
//
// COMPLETED signal — a session is "completed" when the student reached the
// debrief. DiscussionScreen.jsx (the debrief screen) fires, on mount,
// `EventLogger.componentOpened(COMPONENTS.DISCUSSION_SCREEN, 'Discussion')`,
// which resolves (eventLogger.js) to a learning_events row with
// verb='OPENED', object_type='component', component='DiscussionScreen'.
// We key on (verb='OPENED' AND component='DiscussionScreen') joined back
// to the session — the most reliable end-of-case marker, since the debrief
// is the terminal screen of every run and is logged unconditionally on open.
// ---------------------------------------------------------------------------

const DEBRIEF_COMPLETED_SQL = `
    EXISTS (
        SELECT 1 FROM learning_events le
         WHERE le.session_id = s.id
           AND le.tenant_id = s.tenant_id
           AND le.verb = 'OPENED'
           AND le.component = 'DiscussionScreen'
    )`;

// Live members of an owned cohort, with stable ordering. Reused by every
// reporting endpoint so the member set is defined in exactly one place.
async function liveMembers(cohortId) {
    return dbAdapter.all(
        `SELECT u.id, u.username, u.name, u.role
           FROM cohort_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.cohort_id = ? AND m.deleted_at IS NULL
          ORDER BY u.username ASC`,
        [cohortId]
    );
}

const FEED_DEFAULT_LIMIT = 50;
const FEED_MAX_LIMIT = 200;
const STUDENT_EVENTS_DEFAULT_LIMIT = 100;
const STUDENT_EVENTS_MAX_LIMIT = 500;

function clampLimit(raw, def, max) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return def;
    return Math.min(n, max);
}

// 1. Roster — members + per-student rollup.
router.get('/cohorts/:id/roster', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        const members = await liveMembers(cohort.id);
        if (members.length === 0) {
            return res.json({ cohort: { id: cohort.id, name: cohort.name }, roster: [] });
        }
        const placeholders = members.map(() => '?').join(',');
        // Per (user) rollup over their sessions in this tenant, restricted to
        // the live member set. completed = a debrief OPENED event exists for
        // any session of that (user, case).
        const rows = await dbAdapter.all(
            `SELECT s.user_id AS user_id,
                    COUNT(*) AS session_count,
                    COUNT(DISTINCT s.case_id) AS cases_attempted,
                    COUNT(DISTINCT CASE WHEN ${DEBRIEF_COMPLETED_SQL} THEN s.case_id END) AS cases_completed,
                    MAX(COALESCE(s.end_time, s.start_time)) AS last_activity
               FROM sessions s
              WHERE s.tenant_id = ?
                AND s.deleted_at IS NULL
                AND s.user_id IN (${placeholders})
              GROUP BY s.user_id`,
            [tenantId(req), ...members.map(m => m.id)]
        );
        const byUser = new Map(rows.map(r => [r.user_id, r]));
        const roster = members.map(m => {
            const r = byUser.get(m.id);
            return {
                id: m.id,
                username: m.username,
                name: m.name,
                role: m.role,
                session_count: r ? Number(r.session_count) : 0,
                cases_attempted: r ? Number(r.cases_attempted) : 0,
                cases_completed: r ? Number(r.cases_completed) : 0,
                last_activity: r ? r.last_activity : null,
            };
        });
        res.json({ cohort: { id: cohort.id, name: cohort.name }, roster });
    } catch (err) {
        next(err);
    }
});

// 2. Grid — students × cases matrix.
router.get('/cohorts/:id/grid', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        const members = await liveMembers(cohort.id);
        const students = members.map(m => ({ id: m.id, username: m.username, name: m.name }));
        if (members.length === 0) {
            return res.json({ cohort: { id: cohort.id, name: cohort.name }, students: [], cases: [], cells: {} });
        }
        const placeholders = members.map(() => '?').join(',');
        // One row per (user, case): did they attempt it, did any session of
        // that pair reach the debrief, and the latest activity timestamp.
        const rows = await dbAdapter.all(
            `SELECT s.user_id AS user_id,
                    s.case_id AS case_id,
                    c.name AS case_name,
                    MAX(${DEBRIEF_COMPLETED_SQL}) AS completed,
                    MAX(COALESCE(s.end_time, s.start_time)) AS last_activity
               FROM sessions s
               LEFT JOIN cases c ON c.id = s.case_id
              WHERE s.tenant_id = ?
                AND s.deleted_at IS NULL
                AND s.user_id IN (${placeholders})
              GROUP BY s.user_id, s.case_id`,
            [tenantId(req), ...members.map(m => m.id)]
        );
        const caseMap = new Map();
        const cells = {};
        for (const m of members) cells[m.id] = {};
        for (const r of rows) {
            if (r.case_id == null) continue;
            if (!caseMap.has(r.case_id)) {
                caseMap.set(r.case_id, { id: r.case_id, name: r.case_name || `Case ${r.case_id}` });
            }
            cells[r.user_id][r.case_id] = {
                attempted: true,
                completed: !!r.completed,
                last_activity: r.last_activity,
            };
        }
        const cases = [...caseMap.values()].sort(
            (a, b) => String(a.name).localeCompare(String(b.name)) || a.id - b.id
        );
        res.json({ cohort: { id: cohort.id, name: cohort.name }, students, cases, cells });
    } catch (err) {
        next(err);
    }
});

// 3. Single student detail — sessions + chronological events. Student MUST
// be a live member of this cohort, else 404 (no existence leak).
router.get('/cohorts/:id/student/:userId', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        const studentId = Number.parseInt(req.params.userId, 10);
        const member = await dbAdapter.get(
            `SELECT u.id, u.username, u.name, u.role
               FROM cohort_members m
               JOIN users u ON u.id = m.user_id
              WHERE m.cohort_id = ? AND m.user_id = ? AND m.deleted_at IS NULL`,
            [cohort.id, studentId]
        );
        if (!member) {
            return res.status(404).json({ error: 'Student not found in this cohort' });
        }
        const sessions = await dbAdapter.all(
            `SELECT s.id,
                    s.case_id,
                    c.name AS case_name,
                    s.start_time,
                    s.end_time,
                    s.status,
                    ${DEBRIEF_COMPLETED_SQL} AS completed
               FROM sessions s
               LEFT JOIN cases c ON c.id = s.case_id
              WHERE s.tenant_id = ?
                AND s.deleted_at IS NULL
                AND s.user_id = ?
              ORDER BY s.start_time DESC, s.id DESC`,
            [tenantId(req), studentId]
        );
        const limit = clampLimit(req.query.limit, STUDENT_EVENTS_DEFAULT_LIMIT, STUDENT_EVENTS_MAX_LIMIT);
        const events = await dbAdapter.all(
            `SELECT le.id, le.session_id, le.case_id, le.timestamp, le.verb,
                    le.object_type, le.object_id, le.object_name, le.component,
                    le.result, le.duration_ms, le.room, le.severity, le.category
               FROM learning_events le
              WHERE le.tenant_id = ?
                AND le.user_id = ?
              ORDER BY le.timestamp DESC, le.id DESC
              LIMIT ?`,
            [tenantId(req), studentId, limit]
        );
        res.json({
            cohort: { id: cohort.id, name: cohort.name },
            student: member,
            sessions: sessions.map(s => ({ ...s, completed: !!s.completed })),
            events,
        });
    } catch (err) {
        next(err);
    }
});

// 4. Activity feed — recent events for live members, newest first.
// `since` cursor: the learning_events.id of the last seen row (numeric,
// monotonic, collision-free — preferred over timestamp which can tie at
// millisecond granularity). Only events with id > since are returned.
router.get('/cohorts/:id/feed', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        const members = await liveMembers(cohort.id);
        if (members.length === 0) {
            return res.json({ cohort: { id: cohort.id, name: cohort.name }, events: [], next_since: null });
        }
        const placeholders = members.map(() => '?').join(',');
        const limit = clampLimit(req.query.limit, FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT);
        const params = [tenantId(req), ...members.map(m => m.id)];
        let sinceClause = '';
        const sinceRaw = req.query.since;
        if (sinceRaw != null && sinceRaw !== '') {
            const sinceId = Number.parseInt(sinceRaw, 10);
            if (Number.isFinite(sinceId) && sinceId > 0) {
                sinceClause = ' AND le.id > ?';
                params.push(sinceId);
            }
        }
        params.push(limit);
        const events = await dbAdapter.all(
            `SELECT le.id, le.session_id, le.user_id, le.case_id, le.timestamp,
                    le.verb, le.object_type, le.object_id, le.object_name,
                    le.component, le.result, le.duration_ms, le.room,
                    le.severity, le.category
               FROM learning_events le
              WHERE le.tenant_id = ?
                AND le.user_id IN (${placeholders})${sinceClause}
              ORDER BY le.id DESC
              LIMIT ?`,
            params
        );
        const nextSince = events.length > 0 ? events[0].id : (sinceRaw != null ? Number.parseInt(sinceRaw, 10) || null : null);
        res.json({ cohort: { id: cohort.id, name: cohort.name }, events, next_since: nextSince });
    } catch (err) {
        next(err);
    }
});

// CSV-safe cell: quote-wrap, double internal quotes, and neutralise
// spreadsheet formula injection by prefixing a leading =,+,-,@ with a
// single quote. Standard RFC-4180 escaping otherwise.
function csvCell(value) {
    if (value == null) return '';
    let s = String(value);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
}

// 5. Export — flattened roster × case rows for grading/LMS.
router.get('/cohorts/:id/export', authenticateToken, requireEducator, async (req, res, next) => {
    try {
        const cohort = await loadOwnedCohort(req, res);
        if (!cohort) return;
        const members = await liveMembers(cohort.id);
        const format = req.query.format === 'csv' ? 'csv' : 'json';
        let rows = [];
        if (members.length > 0) {
            const placeholders = members.map(() => '?').join(',');
            const raw = await dbAdapter.all(
                `SELECT s.user_id AS user_id,
                        s.case_id AS case_id,
                        c.name AS case_name,
                        MAX(${DEBRIEF_COMPLETED_SQL}) AS completed,
                        MAX(COALESCE(s.end_time, s.start_time)) AS last_activity
                   FROM sessions s
                   LEFT JOIN cases c ON c.id = s.case_id
                  WHERE s.tenant_id = ?
                    AND s.deleted_at IS NULL
                    AND s.user_id IN (${placeholders})
                  GROUP BY s.user_id, s.case_id`,
                [tenantId(req), ...members.map(m => m.id)]
            );
            const byUser = new Map(members.map(m => [m.id, m]));
            rows = raw
                .filter(r => r.case_id != null)
                .map(r => {
                    const m = byUser.get(r.user_id);
                    return {
                        cohort_id: cohort.id,
                        cohort_name: cohort.name,
                        user_id: r.user_id,
                        username: m ? m.username : null,
                        name: m ? m.name : null,
                        case_id: r.case_id,
                        case_name: r.case_name || `Case ${r.case_id}`,
                        attempted: true,
                        completed: !!r.completed,
                        last_activity: r.last_activity,
                    };
                });
        }
        if (format === 'csv') {
            const cols = [
                'cohort_id', 'cohort_name', 'user_id', 'username', 'name',
                'case_id', 'case_name', 'attempted', 'completed', 'last_activity',
            ];
            const lines = [cols.join(',')];
            for (const r of rows) lines.push(cols.map(c => csvCell(r[c])).join(','));
            const filename = `cohort-${cohort.id}-export.csv`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(lines.join('\r\n') + '\r\n');
        }
        res.json({ cohort: { id: cohort.id, name: cohort.name }, rows });
    } catch (err) {
        next(err);
    }
});

export default router;
