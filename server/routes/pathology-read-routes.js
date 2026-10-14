// "How this slide was read" — the pathology read, scored on the server (0070).
//
// The pathology room's reading feedback (per-slide coverage, key and critical
// findings reached, magnification, time, missed findings) is computed from the
// case's RUBRIC: every ROI, threshold and dwell time — the answer key. The
// learner's projection of the case never carries it (manifest
// `document.learnerOmit`, server/shared/pluginDocument.js), so the room in the
// learner's browser cannot score anything. It records the viewport track
// rubric-free instead, and on report submission posts the packed read here:
//
//   POST /sessions/:sessionId/pathology-reads   the session's own learner
//   GET  /sessions/:sessionId/pathology-reads   educator: the kept assessments
//
// The server loads the rubric from the session's case snapshot (the case as it
// was when the session started — an educator editing the rubric mid-course
// does not rewrite a finished read), scores the read with the vendored
// package's own scorer (`assessPackedRead`, the same `scoreCaseRead` the live
// recorder uses), keeps the FULL result — read score included — and returns
// only the learner-safe summary (`readFeedbackSummary`: no ROI geometry, no
// thresholds, no read score).
//
// ONE ASSESSMENT PER SESSION AND TASK. The first submitted read of an activity
// is the one scored and kept; a later submission gets the same feedback back
// rather than a re-score. The summary names the missed findings, so scoring
// every submission would let a learner submit throwaway reports to locate
// what they missed. It is also what makes the client's retry safe.
//
// The scorer is imported from src/components/pathology/ (vendored, pure JS, no
// browser API — readFeedback.js runs under `node --test` upstream). The server
// already imports shared pure modules from src/ (analytics-routes.js) and the
// runtime image copies src/ for exactly that reason (deploy/docker/Dockerfile).

import express from 'express';
import dbAdapter from '../dbAdapter.js';
import { authenticateToken, requireEducator } from '../middleware/auth.js';
import { tenantId, auditSuccess } from './_helpers.js';
import { disabledRooms } from '../shared/caseRooms.js';
import { logger } from '../logger.js';
import { readCaseDocument } from '../../src/components/pathology/hostDocument.js';
import { assessPackedRead } from '../../src/components/pathology/readFeedback.js';

const router = express.Router();
const log = logger('routes-pathology-reads');

const PLUGIN_ID = 'pathology';

/** The body cap for a packed read; mounted ahead of the global 256 KB parser in server.js. */
export const PATHOLOGY_READ_MAX_BODY = '2mb';

/** A report or activity id: what the room generates, nothing that could be a path. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function parseJson(text) {
    if (!text || typeof text !== 'string') return null;
    try { return JSON.parse(text); } catch { return null; }
}

/**
 * The case config this session was played against: its snapshot, or — for a
 * session written before snapshots existed — the live case.
 */
async function sessionCaseConfig(session, tenant) {
    const snapshot = parseJson(session.case_snapshot);
    if (snapshot && typeof snapshot === 'object' && snapshot.config && typeof snapshot.config === 'object') {
        return snapshot.config;
    }
    if (session.case_id == null) return null;
    const row = await dbAdapter.get('SELECT config FROM cases WHERE id = ? AND tenant_id = ?', [session.case_id, tenant]);
    return parseJson(row?.config);
}

/** The kept assessment for this session and activity, as the learner may see it. */
async function keptFeedback(tenant, sessionId, activityId) {
    const row = await dbAdapter.get(
        `SELECT feedback, report_id FROM pathology_read_assessments
          WHERE tenant_id = ? AND session_id = ? AND activity_id = ?`,
        [tenant, sessionId, activityId]
    );
    return row ? { feedback: parseJson(row.feedback), reportId: row.report_id } : null;
}

router.post('/sessions/:sessionId/pathology-reads', authenticateToken, async (req, res) => {
    try {
        const sessionId = Number(req.params.sessionId);
        if (!Number.isInteger(sessionId) || sessionId <= 0) {
            return res.status(400).json({ error: 'A session id is a positive integer.', code: 'pathology_read_bad_session' });
        }
        const { reportId, activityId = null, read } = req.body ?? {};
        if (typeof reportId !== 'string' || !ID_PATTERN.test(reportId)) {
            return res.status(400).json({ error: 'reportId must be the submitted report\'s id.', code: 'pathology_read_bad_report' });
        }
        if (activityId !== null && (typeof activityId !== 'string' || !ID_PATTERN.test(activityId))) {
            return res.status(400).json({ error: 'activityId must be an activity id or null.', code: 'pathology_read_bad_activity' });
        }
        if (!read || typeof read !== 'object' || Array.isArray(read)) {
            return res.status(400).json({ error: 'read must be a packed read object.', code: 'pathology_read_invalid' });
        }

        const tenant = tenantId(req);
        const session = await dbAdapter.get(
            'SELECT id, user_id, case_id, case_snapshot FROM sessions WHERE id = ? AND tenant_id = ?',
            [sessionId, tenant]
        );
        if (!session) return res.status(404).json({ error: 'Session not found', code: 'pathology_read_no_session' });
        // Only the learner whose read it is. Staff can review it (GET below),
        // but a read submitted by anyone else is not this learner's read.
        if (session.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Only the learner whose session this is can submit its read.', code: 'pathology_read_not_owner' });
        }

        const config = await sessionCaseConfig(session, tenant);
        if (config && disabledRooms(config).includes(PLUGIN_ID)) {
            return res.status(403).json({ error: 'The pathology room is switched off for this case.', code: 'room_disabled' });
        }
        const document = readCaseDocument(config?.[PLUGIN_ID]);
        const activities = document?.rubric?.activities ?? [];
        // No rubric, or an activity with no slide criteria: there is nothing
        // to score against. Not an error — the room says no feedback exists.
        const activity = activityId === null
            ? (activities.length === 1 ? activities[0] : null)
            : activities.find((entry) => entry.activityId === activityId) ?? null;
        if (!activity || (activity.slideCriteria ?? []).length === 0) {
            if (activityId !== null && activities.length > 0 && !activity) {
                return res.status(422).json({ error: 'This case has no such pathology activity.', code: 'pathology_read_unknown_activity' });
            }
            return res.json({ feedback: null });
        }

        const kept = await keptFeedback(tenant, sessionId, activity.activityId);
        if (kept) return res.json({ feedback: kept.feedback, reportId: kept.reportId, assessed: 'earlier' });

        let assessed;
        try {
            assessed = assessPackedRead(read, document.rubric, { activityId: activity.activityId });
        } catch (err) {
            // The package validates the body and names what is wrong; a
            // malformed read is the client's to fix, not a server fault.
            if (err instanceof TypeError || err instanceof RangeError) {
                return res.status(400).json({ error: `That read could not be scored: ${err.message}`, code: 'pathology_read_invalid' });
            }
            throw err;
        }

        const now = new Date().toISOString();
        const inserted = await dbAdapter.run(
            `INSERT INTO pathology_read_assessments
                (tenant_id, session_id, user_id, case_id, activity_id, report_id, sample_count, read_score, result, feedback, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (session_id, activity_id) DO NOTHING`,
            [tenant, sessionId, session.user_id, session.case_id, activity.activityId, reportId,
                assessed.sampleCount, assessed.scored.aggregate.readScore ?? null,
                JSON.stringify(assessed.scored), JSON.stringify(assessed.feedback), now]
        );
        // Two tabs submitting at once: the other one's insert won. Its read is
        // the kept one, and this request returns that, like any later submit.
        if (inserted.changes !== 1) {
            const winner = await keptFeedback(tenant, sessionId, activity.activityId);
            return res.json({ feedback: winner?.feedback ?? null, reportId: winner?.reportId, assessed: 'earlier' });
        }

        auditSuccess(req, {
            action: 'pathology_read_assessed',
            resourceType: 'session',
            resourceId: String(sessionId),
            metadata: {
                activityId: activity.activityId,
                reportId,
                samples: assessed.sampleCount,
                roiReached: assessed.feedback.roiReached,
                roiTotal: assessed.feedback.roiTotal,
            },
        });
        (req.log || log).info('pathology read assessed', {
            session_id: sessionId, activity_id: activity.activityId, samples: assessed.sampleCount,
        });
        return res.status(201).json({ feedback: assessed.feedback, reportId, assessed: 'now' });
    } catch (err) {
        (req.log || log).error('pathology read assessment failed', { error: err.message });
        return res.status(500).json({ error: 'The read could not be assessed.', code: 'pathology_read_failed' });
    }
});

// The educator's view: every kept assessment of one session, full result
// included (read score, per-ROI dwell). Tenant-scoped; another tenant's
// session is "not found".
router.get('/sessions/:sessionId/pathology-reads', authenticateToken, requireEducator, async (req, res) => {
    try {
        const tenant = tenantId(req);
        const session = await dbAdapter.get('SELECT id FROM sessions WHERE id = ? AND tenant_id = ?', [req.params.sessionId, tenant]);
        if (!session) return res.status(404).json({ error: 'Session not found', code: 'pathology_read_no_session' });
        const rows = await dbAdapter.all(
            `SELECT activity_id, report_id, user_id, sample_count, read_score, result, feedback, created_at
               FROM pathology_read_assessments WHERE tenant_id = ? AND session_id = ? ORDER BY created_at ASC, id ASC`,
            [tenant, req.params.sessionId]
        );
        return res.json({
            assessments: rows.map((row) => ({
                activityId: row.activity_id,
                reportId: row.report_id,
                userId: row.user_id,
                sampleCount: row.sample_count,
                readScore: row.read_score,
                result: parseJson(row.result),
                feedback: parseJson(row.feedback),
                createdAt: row.created_at,
            })),
        });
    } catch (err) {
        (req.log || log).error('pathology read list failed', { error: err.message });
        return res.status(500).json({ error: 'Could not read the assessments.', code: 'pathology_read_list_failed' });
    }
});

export default router;
