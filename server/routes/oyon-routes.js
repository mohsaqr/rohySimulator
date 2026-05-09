import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEmotionBatch } from 'oyon/validation';
import dbAdapter from '../dbAdapter.js';
import { authenticateToken, hasRoleAtLeast, requireAdmin, ROLE_RANKS } from '../middleware/auth.js';
import { dbAll, dbGet, dbRun, logAuditAsync, redactRow, tenantId } from './_helpers.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const oyonLog = logger('oyon-addon');
const router = express.Router();
const ASSET_ROOT = path.resolve(__dirname, '../../OyonR/standalone');
const DEFAULT_CONSENT_VERSION = 'oyon-consent-v1';

// Runtime defaults match the hard-coded values previously baked into the
// frontends. Migration 0012 stamps the same defaults onto oyon_settings, so
// these are only used if the migration hasn't run yet (defensive).
const DEFAULT_RUNTIME = {
    model_profile: 'hse-emotion-mtl',
    // 500ms ≈ 2 Hz. Earlier we tried 333ms (3Hz) but inference + ONNX
    // preprocessing run on the React main thread (no app-level worker —
    // see HANDOFF.md, MediaPipe + module workers don't compose cleanly),
    // so 3Hz stalls the simulator UI on mid-tier hardware. 500ms keeps the
    // pill responsive without monopolising the main thread. Admins can
    // tune per tenant in Settings → Oyon → Capture engine.
    sample_interval_ms: 500,
    window_ms: 10000,
    min_valid_frames: 6,
    smoothing_alpha: 0.28,
    min_hold_ms: 3000,
    min_switch_confidence: 0.5,
};

const ALLOWED_MODEL_PROFILES = new Set([
    'hse-emotion-mtl',
    'emotieff-mobilevit',
    'emotieff-mbf-mtl',
]);

router.use('/assets', express.static(ASSET_ROOT, {
    fallthrough: false,
    immutable: true,
    maxAge: '1h',
}));

router.get('/config', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    const runtime = runtimeFromSettings(settings);
    res.json({
        enabled: Boolean(settings.emotion_capture_enabled),
        consent_version: settings.consent_version || DEFAULT_CONSENT_VERSION,
        views: {
            admin: Boolean(settings.admin_emotion_view_enabled),
            educator: Boolean(settings.educator_emotion_view_enabled),
            student: Boolean(settings.student_emotion_view_enabled),
        },
        runtime,
        // Mirror runtime fields at the top level too — keeps the contract
        // forgiving for older clients that might not look inside `runtime`.
        model_profile: runtime.model_profile,
        asset_base: '/api/addons/oyon/assets',
    });
});

router.get('/settings', authenticateToken, requireAdmin, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    res.json({ settings: normalizeSettings(settings) });
});

router.put('/settings', authenticateToken, requireAdmin, async (req, res) => {
    const currentTenant = tenantId(req);
    const previous = await ensureSettings(currentTenant);
    const previousRuntime = runtimeFromSettings(previous);
    const next = {
        emotion_capture_enabled: boolToInt(req.body?.emotion_capture_enabled),
        admin_emotion_view_enabled: boolToInt(req.body?.admin_emotion_view_enabled),
        educator_emotion_view_enabled: boolToInt(req.body?.educator_emotion_view_enabled),
        student_emotion_view_enabled: boolToInt(req.body?.student_emotion_view_enabled),
        retention_days: nullablePositiveInteger(req.body?.retention_days),
        consent_version: shortText(req.body?.consent_version || DEFAULT_CONSENT_VERSION, 100),
        model_profile: pickModelProfile(req.body?.model_profile, previousRuntime.model_profile),
        sample_interval_ms: clampInt(req.body?.sample_interval_ms, 100, 10_000, previousRuntime.sample_interval_ms),
        window_ms: clampInt(req.body?.window_ms, 1000, 120_000, previousRuntime.window_ms),
        min_valid_frames: clampInt(req.body?.min_valid_frames, 1, 600, previousRuntime.min_valid_frames),
        smoothing_alpha: clampFloat(req.body?.smoothing_alpha, 0, 1, previousRuntime.smoothing_alpha),
        min_hold_ms: clampInt(req.body?.min_hold_ms, 0, 60_000, previousRuntime.min_hold_ms),
        min_switch_confidence: clampFloat(req.body?.min_switch_confidence, 0, 1, previousRuntime.min_switch_confidence),
    };

    await dbRun(
        `UPDATE oyon_settings
         SET emotion_capture_enabled = ?,
             admin_emotion_view_enabled = ?,
             educator_emotion_view_enabled = ?,
             student_emotion_view_enabled = ?,
             retention_days = ?,
             consent_version = ?,
             model_profile = ?,
             sample_interval_ms = ?,
             window_ms = ?,
             min_valid_frames = ?,
             smoothing_alpha = ?,
             min_hold_ms = ?,
             min_switch_confidence = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ?`,
        [
            next.emotion_capture_enabled,
            next.admin_emotion_view_enabled,
            next.educator_emotion_view_enabled,
            next.student_emotion_view_enabled,
            next.retention_days,
            next.consent_version,
            next.model_profile,
            next.sample_interval_ms,
            next.window_ms,
            next.min_valid_frames,
            next.smoothing_alpha,
            next.min_hold_ms,
            next.min_switch_confidence,
            String(currentTenant),
        ]
    );

    oyonLog.info('settings updated', {
        user_id: req.user.id,
        tenant_id: currentTenant,
        model_profile: next.model_profile,
        capture_enabled: Boolean(next.emotion_capture_enabled),
    });

    await logAuditAsync({
        userId: req.user.id,
        username: req.user.username,
        action: 'oyon.settings_updated',
        resourceType: 'oyon_settings',
        resourceId: String(currentTenant),
        tenantId: currentTenant,
        metadata: next,
    });

    const settings = await ensureSettings(currentTenant);
    res.json({ settings: normalizeSettings(settings) });
});

router.post('/consent', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    const session = await resolveSession(req, req.body?.session_id);
    if (!session) {
        oyonLog.warn('consent rejected: session not found', { user_id: req.user?.id, session_id: req.body?.session_id });
        return res.status(404).json({ error: 'Session not found' });
    }
    // Consent must be granted by the actual session owner — never by an
    // educator/admin "on behalf of" a student. canReadSession allows
    // educator+ access (correct for read paths) but writing consent + records
    // for a student session under another user's identity is a trust
    // boundary failure that corrupts audit + analytics. Hard-require
    // self-ownership here.
    if (String(session.user_id) !== String(req.user.id)) {
        oyonLog.warn('consent rejected: not session owner', {
            user_id: req.user?.id,
            user_role: req.user?.role,
            session_owner: session.user_id,
            session_id: session.id,
        });
        return res.status(403).json({ error: 'Access denied' });
    }

    const granted = req.body?.consent_granted === true;
    await dbRun(
        `INSERT INTO oyon_emotion_consents (
            tenant_id, user_id, student_id, session_id, case_id,
            consent_granted, consent_version, source_page, user_agent
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            tenantId(req),
            String(req.user.id),
            String(session.user_id),
            String(session.id),
            session.case_id == null ? null : String(session.case_id),
            granted ? 1 : 0,
            settings.consent_version || DEFAULT_CONSENT_VERSION,
            shortText(req.body?.source_page, 200),
            shortText(req.headers['user-agent'], 500),
        ]
    );

    await logAuditAsync({
        userId: req.user.id,
        username: req.user.username,
        action: granted ? 'oyon.consent_granted' : 'oyon.consent_revoked',
        resourceType: 'oyon_emotion_consent',
        resourceId: String(session.id),
        sessionId: String(session.id),
        tenantId: tenantId(req),
        metadata: { case_id: session.case_id, consent_version: settings.consent_version },
    });

    oyonLog.info('consent recorded', {
        user_id: req.user.id,
        session_id: session.id,
        case_id: session.case_id,
        consent_granted: granted,
        consent_version: settings.consent_version,
    });
    res.json({ ok: true, consent_granted: granted });
});

router.post('/emotion-records', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    if (!settings.emotion_capture_enabled) {
        return res.status(403).json({ error: 'Oyon is disabled' });
    }

    const validation = validateEmotionBatch(req.body, {
        maxBatchEvents: 64,
        maxJsonStringLength: 4096,
    });
    if (!validation.ok) {
        oyonLog.warn('emotion batch rejected', { user_id: req.user.id, errors: validation.errors.slice(0, 5) });
        return res.status(400).json({ error: 'Invalid emotion batch', details: validation.errors });
    }

    const events = req.body.events || [];
    const sessionId = firstValue(events, 'session_id') || firstValue(events, 'sessionId') || req.body.session_id;
    const session = await resolveSession(req, sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    // Same trust-boundary rule as /consent: writes must come from the
    // session owner. Educator/admin read access does NOT extend to
    // injecting emotion records into another user's session.
    if (String(session.user_id) !== String(req.user.id)) {
        oyonLog.warn('emotion write rejected: not session owner', {
            user_id: req.user?.id,
            user_role: req.user?.role,
            session_owner: session.user_id,
            session_id: session.id,
        });
        return res.status(403).json({ error: 'Access denied' });
    }

    const consent = await latestConsent(req, session.id);
    if (!consent?.consent_granted) {
        return res.status(403).json({ error: 'Oyon consent required' });
    }

    let inserted = 0;
    let skipped = 0;
    for (const event of events) {
        const serverErrors = validateServerEvent(event, session);
        if (serverErrors.length) {
            return res.status(400).json({ error: 'Invalid emotion event', details: serverErrors });
        }
        // insertEmotionRecord uses INSERT ... ON CONFLICT DO NOTHING on
        // (tenant_id, session_id, record_id). For duplicate retries the
        // statement runs to completion but the row is dropped — `changes`
        // is 0 in that case. Distinguishing inserted vs skipped here lets
        // clients tell "the second batch arrived but was a no-op" from
        // "the first batch failed mid-way".
        const result = await insertEmotionRecord(req, session, settings, consent, event);
        if (result?.changes === 1) inserted += 1;
        else skipped += 1;
    }

    oyonLog.info('emotion batch accepted', { session_id: session.id, inserted, skipped });
    res.json({ ok: true, inserted, skipped });
});

router.get('/emotion-records', authenticateToken, async (req, res) => {
    // Educator+ path only. Students use GET /student/me. The shared
    // assertOyonReadAccess helper enforces both role and the per-role
    // tenant view-enabled flag so policy stays in one place.
    const settings = await ensureSettings(tenantId(req));
    if (!assertOyonReadAccess(req, res, settings)) return;

    const session = req.query.session_id ? await resolveSession(req, req.query.session_id) : null;
    if (req.query.session_id && !session) return res.status(404).json({ error: 'Session not found' });
    if (session && !canReadSession(req.user, session)) return res.status(403).json({ error: 'Access denied' });

    const { whereSql, params: whereParams } = buildEmotionRecordsWhere(req, { session });

    // total uses the same WHERE so pagination UI can show "X of N".
    const countRow = await dbGet(
        `SELECT COUNT(*) AS total FROM oyon_emotion_records r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE ${whereSql}`,
        whereParams
    );
    const total = Number(countRow?.total) || 0;

    const pageParams = [...whereParams, limit(req.query.limit, 200), offsetParam(req.query.offset)];
    const rows = await dbAll(
        `SELECT r.*, u.username, u.role AS user_role
         FROM oyon_emotion_records r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE ${whereSql}
         ORDER BY r.window_start DESC, r.id DESC
         LIMIT ? OFFSET ?`,
        pageParams
    );
    oyonLog.debug('emotion records read', {
        user_id: req.user.id,
        role: req.user.role,
        session_id: session?.id,
        case_id: req.query.case_id || null,
        scope: session ? 'session' : 'tenant',
        returned: rows.length,
        total,
        filters: pickFilterFields(req),
    });
    res.json({
        records: rows.map(hydrateRecord).map(r => redactRow(r)),
        total,
    });
});

// ──────────────────────────────────────────────────────────────────────
// Learning Analytics aggregates.
// All three endpoints sit behind assertOyonReadAccess and reuse the same
// filter builder so admins/educators see a coherent view across views.
// "Estimate" framing only — no copy that asserts internal student state.
// ──────────────────────────────────────────────────────────────────────

router.get('/analytics/students', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    if (!assertOyonReadAccess(req, res, settings)) return;

    const { whereSql, params } = buildEmotionRecordsWhere(req, {});
    const rows = await dbAll(
        `SELECT
            r.user_id,
            u.username,
            u.role AS user_role,
            -- when records have been anonymised user_id is NULL but the
            -- snapshot label survives, so coalesce gives a stable group key
            COALESCE(u.username, r.student_name_snapshot, 'unknown') AS student_label,
            COUNT(*) AS window_count,
            COUNT(DISTINCT r.session_id) AS sessions_count,
            COUNT(DISTINCT r.case_id) AS cases_count,
            AVG(r.valence)             AS mean_valence,
            AVG(r.arousal)             AS mean_arousal,
            AVG(r.confidence)          AS mean_confidence,
            AVG(r.missing_face_ratio)  AS mean_missing_face_ratio,
            MIN(r.window_start)        AS first_window,
            MAX(r.window_end)          AS last_window,
            (SELECT r2.dominant_emotion
               FROM oyon_emotion_records r2
              WHERE r2.tenant_id = r.tenant_id
                AND ((r2.user_id IS NULL AND r.user_id IS NULL) OR r2.user_id = r.user_id)
                AND r2.dominant_emotion IS NOT NULL
              GROUP BY r2.dominant_emotion
              ORDER BY COUNT(*) DESC, r2.dominant_emotion ASC
              LIMIT 1) AS top_dominant_estimate
         FROM oyon_emotion_records r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE ${whereSql}
         GROUP BY r.user_id, u.username, u.role, r.student_name_snapshot
         ORDER BY window_count DESC`,
        params
    );
    oyonLog.debug('analytics read', {
        scope: 'students', user_id: req.user.id, role: req.user.role,
        returned: rows.length, filters: pickFilterFields(req),
    });
    res.json({ students: rows.map(r => redactRow(r)) });
});

router.get('/analytics/cases', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    if (!assertOyonReadAccess(req, res, settings)) return;

    const { whereSql, params } = buildEmotionRecordsWhere(req, {});
    const summaryRows = await dbAll(
        `SELECT
            r.case_id,
            COALESCE(r.case_title_snapshot, 'unknown') AS case_title,
            r.case_category_snapshot AS case_category,
            COUNT(*) AS window_count,
            COUNT(DISTINCT r.user_id) AS students_count,
            COUNT(DISTINCT r.session_id) AS sessions_count,
            AVG(r.valence)            AS mean_valence,
            AVG(r.arousal)            AS mean_arousal,
            AVG(r.confidence)         AS mean_confidence,
            AVG(r.missing_face_ratio) AS mean_missing_face_ratio,
            MIN(r.window_start)       AS first_window,
            MAX(r.window_end)         AS last_window
         FROM oyon_emotion_records r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE ${whereSql}
         GROUP BY r.case_id, r.case_title_snapshot, r.case_category_snapshot
         ORDER BY window_count DESC`,
        params
    );

    // Distribution of dominant_estimate per case — separate query so the
    // main aggregate stays one row per case. Group key matches summary's
    // (case_id, case_title_snapshot, case_category_snapshot) so distribution
    // sums never exceed the row's window_count when case_id is NULL but
    // titles differ.
    const distRows = await dbAll(
        `SELECT
            r.case_id,
            r.case_title_snapshot,
            r.case_category_snapshot,
            r.dominant_emotion,
            COUNT(*) AS n
         FROM oyon_emotion_records r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE ${whereSql} AND r.dominant_emotion IS NOT NULL
         GROUP BY r.case_id, r.case_title_snapshot, r.case_category_snapshot, r.dominant_emotion`,
        params
    );
    const caseKey = (c) => `${c.case_id == null ? 'null' : c.case_id}|${c.case_title_snapshot ?? ''}|${c.case_category_snapshot ?? ''}`;
    const distByCase = {};
    for (const d of distRows) {
        const k = caseKey(d);
        if (!distByCase[k]) distByCase[k] = {};
        distByCase[k][d.dominant_emotion] = Number(d.n);
    }

    const cases = summaryRows.map(c => ({
        ...c,
        dominant_estimate_distribution: distByCase[caseKey({
            case_id: c.case_id,
            case_title_snapshot: c.case_title,
            case_category_snapshot: c.case_category,
        })] || {},
    }));

    oyonLog.debug('analytics read', {
        scope: 'cases', user_id: req.user.id, role: req.user.role,
        returned: cases.length, filters: pickFilterFields(req),
    });
    res.json({ cases });
});

router.get('/analytics/session/:sessionId', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    if (!assertOyonReadAccess(req, res, settings)) return;

    const session = await resolveSession(req, req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!canReadSession(req.user, session)) return res.status(403).json({ error: 'Access denied' });

    // Oyon windows only. We deliberately do NOT join learning_events here —
    // the unifying keys (session_id, user_id, case_id) are already on every
    // window so researchers can combine Oyon output with Rohy's session/case
    // data offline (CSV/JSON export, or external joins). This keeps the live
    // path read-light: one indexed query per session.
    const windows = await dbAll(
        `SELECT r.*, u.username, u.role AS user_role
         FROM oyon_emotion_records r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE r.tenant_id = ? AND r.session_id = ?
         ORDER BY r.window_start ASC, r.id ASC`,
        [tenantId(req), String(session.id)]
    );

    oyonLog.debug('analytics read', {
        scope: 'session', session_id: session.id, user_id: req.user.id, role: req.user.role,
        windows: windows.length,
    });

    res.json({
        session: {
            id: session.id,
            user_id: session.user_id,
            case_id: session.case_id,
            start_time: session.start_time,
            end_time: session.end_time,
            student_name: session.student_name,
            case_title: session.live_case_name,
        },
        oyon_windows: windows.map(hydrateRecord).map(r => redactRow(r)),
    });
});

router.get('/student/me', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    if (!settings.student_emotion_view_enabled) {
        return res.status(403).json({ error: 'Student emotion view is disabled' });
    }
    const rows = await dbAll(
        `SELECT * FROM oyon_emotion_records
         WHERE tenant_id = ? AND user_id = ? AND student_can_view = 1
         ORDER BY window_start DESC, id DESC
         LIMIT ?`,
        [tenantId(req), String(req.user.id), limit(req.query.limit, 100)]
    );
    oyonLog.debug('student self-records read', { user_id: req.user.id, returned: rows.length });
    res.json({ records: rows.map(hydrateRecord) });
});

router.get('/admin/live', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    if (!assertOyonReadAccess(req, res, settings)) return;

    const rows = await dbAll(
        `SELECT r.*
         FROM oyon_emotion_records r
         JOIN (
           SELECT session_id, MAX(window_start) AS latest_window
           FROM oyon_emotion_records
           WHERE tenant_id = ? AND (admin_can_view = 1 OR educator_can_view = 1)
           GROUP BY session_id
         ) latest
           ON latest.session_id = r.session_id AND latest.latest_window = r.window_start
         WHERE r.tenant_id = ?
         ORDER BY r.window_start DESC, r.id DESC
         LIMIT ?`,
        [tenantId(req), tenantId(req), limit(req.query.limit, 100)]
    );
    oyonLog.debug('admin live read', { user_id: req.user.id, returned: rows.length });
    res.json({ records: rows.map(hydrateRecord) });
});

async function ensureSettings(currentTenantId) {
    // Insert ALL runtime fields explicitly. Earlier code relied on the SQL
    // column DEFAULTs from migration 0012, which still has 1000ms baked in.
    // Migration 0013 only patched existing rows, so any tenant created
    // afterwards would silently regress to the laggy 1Hz default. Sourcing
    // from DEFAULT_RUNTIME here keeps fresh-tenant behaviour aligned with
    // the runtime contract regardless of what the SQL DEFAULTs say.
    await dbRun(
        `INSERT INTO oyon_settings (
            tenant_id,
            model_profile, sample_interval_ms, window_ms, min_valid_frames,
            smoothing_alpha, min_hold_ms, min_switch_confidence
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id) DO NOTHING`,
        [
            String(currentTenantId),
            DEFAULT_RUNTIME.model_profile,
            DEFAULT_RUNTIME.sample_interval_ms,
            DEFAULT_RUNTIME.window_ms,
            DEFAULT_RUNTIME.min_valid_frames,
            DEFAULT_RUNTIME.smoothing_alpha,
            DEFAULT_RUNTIME.min_hold_ms,
            DEFAULT_RUNTIME.min_switch_confidence,
        ]
    );
    return dbGet('SELECT * FROM oyon_settings WHERE tenant_id = ?', [String(currentTenantId)]);
}

async function resolveSession(req, rawSessionId) {
    if (!rawSessionId) return null;
    return dbGet(
        `SELECT s.id, s.user_id, s.case_id, s.start_time, s.end_time,
                s.tenant_id, s.student_name, s.case_snapshot,
                c.name AS live_case_name, c.config AS live_case_config,
                u.username, u.email, u.role
         FROM sessions s
         LEFT JOIN cases c ON c.id = s.case_id AND c.tenant_id = s.tenant_id
         LEFT JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
         WHERE s.id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL`,
        [rawSessionId, tenantId(req)]
    );
}

function canReadSession(user, session) {
    return String(session.user_id) === String(user.id) || hasRoleAtLeast(user, ROLE_RANKS.educator);
}

/**
 * Single source of truth for whether an educator-or-higher caller is allowed
 * to read Oyon analytics in their tenant. Combines role hierarchy with the
 * per-role tenant view-enabled flags so policy can't drift between
 * /emotion-records, /admin/live, and the analytics roll-ups.
 *
 * Behaviour:
 *   - Admin (or higher) AND admin_emotion_view_enabled = 1 → allow.
 *   - Educator (exactly) AND educator_emotion_view_enabled = 1 → allow.
 *   - Anything else (admin with the toggle off, educator with the toggle
 *     off, students, guests) → block with 403.
 *
 * Note: students have their own self-only path at GET /student/me. They
 * cannot use the educator+ surfaces.
 *
 * Returns true on allow. On block, writes the 403 directly and returns false
 * so the caller just `return`s.
 */
function assertOyonReadAccess(req, res, settings) {
    const isAdmin = hasRoleAtLeast(req.user, ROLE_RANKS.admin);
    const isEducator = hasRoleAtLeast(req.user, ROLE_RANKS.educator);
    if (isAdmin) {
        if (!settings.admin_emotion_view_enabled) {
            res.status(403).json({ error: 'Oyon view disabled for this role', code: 'oyon_view_disabled' });
            return false;
        }
        return true;
    }
    if (isEducator) {
        if (!settings.educator_emotion_view_enabled) {
            res.status(403).json({ error: 'Oyon view disabled for this role', code: 'oyon_view_disabled' });
            return false;
        }
        return true;
    }
    res.status(403).json({ error: 'Oyon view requires educator role', code: 'oyon_role_required' });
    return false;
}

async function latestConsent(req, sessionId) {
    return dbGet(
        `SELECT *
         FROM oyon_emotion_consents
         WHERE tenant_id = ? AND session_id = ? AND user_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [tenantId(req), String(sessionId), String(req.user.id)]
    );
}

function validateServerEvent(event, session) {
    const errors = [];
    if (JSON.stringify(event).length > 4096) errors.push('Emotion event is too large');
    if (event.capture_mode !== 'local-browser') errors.push('capture_mode must be local-browser');
    if (!event.consent_version) errors.push('consent_version is required');
    if (!timestampWithinSession(event.window_start, event.window_end, session)) {
        errors.push('Emotion event timestamp is outside session bounds');
    }
    return errors;
}

async function insertEmotionRecord(req, session, settings, consent, event) {
    const snapshot = parseJson(session.case_snapshot) || {};
    const liveConfig = parseJson(session.live_case_config) || {};
    const config = snapshot.config || liveConfig || {};
    const demographics = config.demographics || {};
    const caseTitle = snapshot.name || session.live_case_name || null;
    const studentName = session.student_name || req.user.username || session.username || null;
    const studentCanView = settings.student_emotion_view_enabled ? 1 : 0;
    const educatorCanView = settings.educator_emotion_view_enabled ? 1 : 0;
    const adminCanView = settings.admin_emotion_view_enabled ? 1 : 0;
    const recordId = event.record_id == null
        ? deriveRecordId(tenantId(req), session.id, event.window_start, event.window_end)
        : String(event.record_id);
    const modelProfile = event.model_profile
        || event.settings_snapshot?.model_profile
        || event.settings?.model_profile
        || null;
    const settingsHash = event.settings_hash
        || event.settings_snapshot?.settings_hash
        || null;
    const columns = [
        'tenant_id', 'user_id', 'student_id', 'session_id', 'case_id', 'record_id',
        'course_id', 'cohort_id', 'student_name_snapshot', 'student_role_snapshot',
        'case_title_snapshot', 'case_category_snapshot', 'course_title_snapshot',
        'cohort_title_snapshot', 'session_type', 'attempt_number', 'started_from_page',
        'window_start', 'window_end', 'duration_ms', 'expected_samples', 'dominant_emotion',
        'emotion_probabilities_json', 'valence', 'valence_std', 'valence_min', 'valence_max',
        'arousal', 'arousal_std', 'arousal_min', 'arousal_max', 'confidence',
        'confidence_std', 'entropy', 'entropy_std', 'stability_score', 'label_switch_count',
        'valid_frames', 'missing_face_ratio', 'quality_json', 'model_name', 'model_version',
        'model_profile', 'settings_hash', 'settings_snapshot_json', 'dynamics_json',
        'capture_mode', 'capture_status', 'student_consent_enabled', 'student_can_view',
        'admin_can_view', 'educator_can_view', 'consent_version', 'consent_recorded_at',
    ];
    const values = [
        String(tenantId(req)),
        String(req.user.id),
        String(session.user_id),
        String(session.id),
        session.case_id == null ? null : String(session.case_id),
        // Derive a stable record_id when the client doesn't supply one so
        // the partial unique index in migration 0016 actually engages on
        // replays. Hash inputs are tenant + session + the window's start
        // and end timestamps - the natural identity of a captured window.
        // Two batches re-sending the same window collapse to one row;
        // legitimately distinct windows (different timestamps) hash apart.
        recordId,
        event.course_id == null ? null : String(event.course_id),
        event.cohort_id == null ? null : String(event.cohort_id),
        shortText(studentName, 200),
        shortText(session.role || req.user.role, 80),
        shortText(caseTitle, 300),
        shortText(config.category || config.specialty || demographics.category, 200),
        shortText(event.course_title, 300),
        shortText(event.cohort_title, 300),
        shortText(event.session_type || 'simulation', 100),
        Number.isInteger(event.attempt_number) ? event.attempt_number : null,
        shortText(event.started_from_page, 200),
        event.window_start,
        event.window_end,
        integerOrNull(event.duration_ms),
        integerOrNull(event.expected_samples),
        event.dominant_emotion || null,
        jsonTextOrNull(event.probabilities),
        finiteNumberOrNull(event.valence),
        finiteNumberOrNull(event.valence_std),
        finiteNumberOrNull(event.valence_min),
        finiteNumberOrNull(event.valence_max),
        finiteNumberOrNull(event.arousal),
        finiteNumberOrNull(event.arousal_std),
        finiteNumberOrNull(event.arousal_min),
        finiteNumberOrNull(event.arousal_max),
        finiteNumberOrNull(event.confidence),
        finiteNumberOrNull(event.confidence_std),
        finiteNumberOrNull(event.entropy),
        finiteNumberOrNull(event.entropy_std),
        finiteNumberOrNull(event.stability_score),
        integerOrNull(event.label_switch_count),
        event.valid_frames,
        event.missing_face_ratio,
        jsonTextOrNull(event.quality),
        event.model_name || event.model?.name || null,
        event.model_version || event.model?.version || null,
        shortText(modelProfile, 200),
        shortText(settingsHash, 100),
        jsonTextOrNull(event.settings_snapshot),
        jsonTextOrNull(event.dynamics),
        event.capture_mode,
        'captured',
        consent.consent_granted ? 1 : 0,
        studentCanView,
        adminCanView,
        educatorCanView,
        // Server-authoritative consent version: always sourced from the
        // actual consent row. Ignoring the client-provided
        // event.consent_version closes the gap where the widget could
        // claim "fer-consent-v1" while the real consent on file was
        // "oyon-consent-v1" (or vice versa for any future bump). Falls
        // back to tenant settings then DEFAULT_CONSENT_VERSION only if
        // the consent row somehow lacks the field.
        consent.consent_version || settings.consent_version || DEFAULT_CONSENT_VERSION,
        consent.created_at || null,
    ];

    // INSERT ... ON CONFLICT DO NOTHING is the partner of the partial
    // unique index in migration 0016. Conflicts on
    // (tenant_id, session_id, record_id) — i.e. retried/replayed batches —
    // are dropped silently and reflected as `changes === 0` so the route
    // handler can report skipped counts. Rows without a record_id fall
    // outside the partial index and behave as plain INSERTs (no dedup).
    return dbRun(
        `INSERT INTO oyon_emotion_records (${columns.join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})
         ON CONFLICT(tenant_id, session_id, record_id) WHERE record_id IS NOT NULL DO NOTHING`,
        values
    );
}

function hydrateRecord(row) {
    return {
        ...row,
        probabilities: parseJson(row.emotion_probabilities_json),
        quality: parseJson(row.quality_json),
        settings_snapshot: parseJson(row.settings_snapshot_json),
        dynamics: parseJson(row.dynamics_json),
    };
}

function normalizeSettings(settings) {
    const runtime = runtimeFromSettings(settings);
    return {
        tenant_id: settings.tenant_id,
        emotion_capture_enabled: Boolean(settings.emotion_capture_enabled),
        admin_emotion_view_enabled: Boolean(settings.admin_emotion_view_enabled),
        educator_emotion_view_enabled: Boolean(settings.educator_emotion_view_enabled),
        student_emotion_view_enabled: Boolean(settings.student_emotion_view_enabled),
        retention_days: settings.retention_days,
        consent_version: settings.consent_version || DEFAULT_CONSENT_VERSION,
        ...runtime,
        updated_at: settings.updated_at,
    };
}

// Pull runtime knobs out of an oyon_settings row, falling back to the
// hard-coded defaults when migration 0012 hasn't run yet (e.g. a stale
// tenant row from before the column existed). Keeps the API contract
// stable across migration boundaries.
function runtimeFromSettings(settings) {
    return {
        model_profile: ALLOWED_MODEL_PROFILES.has(settings.model_profile)
            ? settings.model_profile
            : DEFAULT_RUNTIME.model_profile,
        sample_interval_ms: numberOr(settings.sample_interval_ms, DEFAULT_RUNTIME.sample_interval_ms),
        window_ms: numberOr(settings.window_ms, DEFAULT_RUNTIME.window_ms),
        min_valid_frames: numberOr(settings.min_valid_frames, DEFAULT_RUNTIME.min_valid_frames),
        smoothing_alpha: numberOr(settings.smoothing_alpha, DEFAULT_RUNTIME.smoothing_alpha),
        min_hold_ms: numberOr(settings.min_hold_ms, DEFAULT_RUNTIME.min_hold_ms),
        min_switch_confidence: numberOr(settings.min_switch_confidence, DEFAULT_RUNTIME.min_switch_confidence),
    };
}

function pickModelProfile(value, fallback) {
    if (typeof value !== 'string') return fallback;
    return ALLOWED_MODEL_PROFILES.has(value) ? value : fallback;
}

function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function timestampWithinSession(start, end, session) {
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    const sessionStart = Date.parse(session.start_time);
    const sessionEnd = session.end_time ? Date.parse(session.end_time) + 60_000 : Date.now() + 60_000;
    return Number.isFinite(startMs)
        && Number.isFinite(endMs)
        && Number.isFinite(sessionStart)
        && startMs <= endMs
        && startMs >= sessionStart - 60_000
        && endMs <= sessionEnd;
}

// Allowed dominant_emotion values for the multi-select filter. Anything not
// on this list is silently dropped from the IN clause so a hostile `?dominant=`
// can't smuggle SQL.
const ALLOWED_DOMINANT = new Set([
    'happy', 'happiness', 'joy',
    'sad', 'sadness',
    'angry', 'anger',
    'fear',
    'surprise',
    'disgust',
    'contempt',
    'neutral',
]);
const ALLOWED_ROLES = new Set(['student', 'reviewer', 'educator', 'admin']);

/**
 * Build a parameterised WHERE clause for /emotion-records and the analytics
 * roll-ups. All comparisons go through `?` placeholders — no string
 * concatenation of user input. The `q` free-text search uses LIKE with
 * already-escaped values; `dominant` and `role` are filtered against fixed
 * allowlists. Returns { whereSql, params }.
 */
function buildEmotionRecordsWhere(req, { session = null } = {}) {
    const params = [tenantId(req)];
    const parts = ['r.tenant_id = ?'];

    if (session) {
        parts.push('r.session_id = ?');
        params.push(String(session.id));
    } else {
        if (req.query.case_id) {
            parts.push('r.case_id = ?');
            params.push(String(req.query.case_id));
        }
        if (req.query.user_id) {
            parts.push('r.user_id = ?');
            params.push(String(req.query.user_id));
        }
    }

    // Date filters. UI date inputs send YYYY-MM-DD without a time, but
    // window_start is a full ISO timestamp — so a literal `<= '2026-05-09'`
    // string-comparison drops every record stamped later that same day.
    // Detect bare dates and use SQLite's date(?, '+1 day') as an exclusive
    // next-day upper bound; full timestamps still go through unchanged.
    const dateOnly = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    if (req.query.from) {
        parts.push('r.window_start >= ?');
        params.push(String(req.query.from));
    }
    if (req.query.to) {
        if (dateOnly(req.query.to)) {
            parts.push("r.window_start < date(?, '+1 day')");
            params.push(String(req.query.to));
        } else {
            parts.push('r.window_start <= ?');
            params.push(String(req.query.to));
        }
    }

    const dominantList = parseDominantList(req.query.dominant);
    if (dominantList.length) {
        parts.push(`r.dominant_emotion IN (${dominantList.map(() => '?').join(',')})`);
        for (const d of dominantList) params.push(d);
    }

    if (typeof req.query.role === 'string' && ALLOWED_ROLES.has(req.query.role)) {
        parts.push('u.role = ?');
        params.push(req.query.role);
    }

    if (req.query.q && typeof req.query.q === 'string' && req.query.q.trim()) {
        // Free-text needle. We treat `%` / `_` from the user as wildcards
        // (typical search ergonomics, not a security concern) and rely on
        // parameter binding to neutralise quote-based injection — that's why
        // tests/server/oyon-routes.test.js asserts the "' OR 1=1 --" payload
        // returns zero rows.
        const needle = `%${req.query.q.trim()}%`;
        parts.push(`(r.student_name_snapshot LIKE ? OR r.case_title_snapshot LIKE ? OR r.dominant_emotion LIKE ? OR u.username LIKE ?)`);
        params.push(needle, needle, needle, needle);
    }

    const minConf = Number(req.query.min_confidence);
    if (Number.isFinite(minConf)) {
        parts.push('r.confidence >= ?');
        params.push(minConf);
    }
    const maxMissing = Number(req.query.max_missing_face_ratio);
    if (Number.isFinite(maxMissing)) {
        parts.push('r.missing_face_ratio <= ?');
        params.push(maxMissing);
    }

    return { whereSql: parts.join(' AND '), params };
}

function parseDominantList(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(s => ALLOWED_DOMINANT.has(s));
}

function pickFilterFields(req) {
    return {
        from: req.query.from || null,
        to: req.query.to || null,
        q: req.query.q || null,
        dominant: req.query.dominant || null,
        role: req.query.role || null,
        min_confidence: req.query.min_confidence || null,
        max_missing_face_ratio: req.query.max_missing_face_ratio || null,
    };
}

function deriveRecordId(tenant, sessionId, windowStart, windowEnd) {
    return crypto
        .createHash('sha1')
        .update(`${String(tenant)}|${String(sessionId)}|${String(windowStart)}|${String(windowEnd)}`)
        .digest('hex')
        .slice(0, 40);
}

function firstValue(events, key) {
    for (const event of events) {
        if (event?.[key] != null) return event[key];
    }
    return null;
}

function limit(raw, fallback) {
    const n = Number(raw);
    if (!Number.isInteger(n)) return fallback;
    return Math.min(Math.max(n, 1), 500);
}

function offsetParam(raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return 0;
    return Math.min(n, 100000);
}

function boolToInt(value) {
    return value === true || value === 1 || value === '1' ? 1 : 0;
}

function nullablePositiveInteger(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function shortText(value, maxLength) {
    if (value == null) return null;
    return String(value).slice(0, maxLength);
}

function finiteNumberOrNull(value) {
    return Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
    return Number.isInteger(value) ? value : null;
}

function jsonTextOrNull(value) {
    if (value == null) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

function parseJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

// Oyon-scoped error handler. Catches anything an Oyon route handler throws
// (Express 5 auto-propagates async throws). Translates "no such table" sqlite
// errors into 503 so a missing migration looks like a normal "service not
// ready" instead of a crash. Everything else is a typed 500. The rest of
// Rohy's request loop is unaffected because this handler never re-throws.
router.use((err, req, res, _next) => {
    const message = err?.message || 'Oyon error';
    const isMissingTable = /no such table|no such column/i.test(message);
    oyonLog.warn(isMissingTable ? 'oyon storage missing' : 'oyon route error', {
        path: req.path,
        method: req.method,
        error: message,
        stack: err?.stack ? String(err.stack).split('\n').slice(0, 4) : undefined,
    });
    if (res.headersSent) return;
    if (isMissingTable) {
        return res.status(503).json({ error: 'Oyon storage not initialized', code: 'oyon_unavailable' });
    }
    res.status(500).json({ error: 'Oyon error', code: 'oyon_error' });
});

export default router;
