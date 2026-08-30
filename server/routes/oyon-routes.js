import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEmotionBatch, isModalityOnlyEvent } from 'oyon/validation';
import { OYON_MODALITIES, OYON_WINDOW_KINDS } from 'oyon/version';
import { authenticateToken, hasRoleAtLeast, requireAdmin, ROLE_RANKS } from '../middleware/auth.js';
import { dbAll, dbGet, dbRun, logAuditAsync, redactRow, tenantId } from './_helpers.js';
import { logger } from '../logger.js';
import { rejectionMiddleware, getStats as getRejectionStats } from './oyon-rejection-counter.js';
import { DEFAULT_RUNTIME, ensureSettings } from '../lib/oyonSettings.js';
import { SQL_NOW } from '../shared/time.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const oyonLog = logger('oyon-addon');
const router = express.Router();
const ASSET_ROOT = path.resolve(__dirname, '../../OyonR/standalone');
const DEFAULT_CONSENT_VERSION = 'oyon-consent-v2';
// The contract that covered camera-derived affect only. Kept as a named
// constant because it is still a valid accepted version — it simply does not
// extend to the host-driven modalities below.
const CONSENT_VERSION_CAMERA_ONLY = 'oyon-consent-v1';

/*
 * Modalities that need consent v2 (migration 0041).
 *
 * These are new CATEGORIES of personal data, not more camera-derived affect:
 * keystroke timing, page-wide pointer/scroll telemetry, message-text analysis,
 * and AI-assistance cycles. `oyon-consent-v1` describes none of them, so a
 * learner who accepted v1 has not agreed to them.
 *
 * Enforced on INGEST rather than only at the client prompt: a stale or
 * hand-rolled client cannot deposit these rows for a learner who never accepted
 * v2. Camera modalities are absent from this set and keep working under v1.
 */
const CONSENT_V2_MODALITIES = new Set([
    'typing', 'interaction', 'discourse', 'ai_assist', 'voice',
]);

/** Ordered consent contracts, oldest first — index doubles as the version rank. */
const CONSENT_VERSION_ORDER = Object.freeze(['oyon-consent-v1', 'oyon-consent-v2']);

/**
 * Whether the consent actually accepted for this session covers `modality`.
 *
 * A consent row written before 0041 has no `accepted_version`; it is read as v1,
 * the only contract that existed when it was written. Never as "whatever the
 * tenant advertises now" — that would silently re-label an old consent as
 * covering data the learner was never asked about.
 */
function acceptedConsentVersion(value) {
    return CONSENT_VERSION_ORDER.includes(value) ? value : CONSENT_VERSION_CAMERA_ONLY;
}

function consentCoversModality(consent, modality) {
    if (!CONSENT_V2_MODALITIES.has(modality)) return true;
    const accepted = consent?.accepted_version || CONSENT_VERSION_CAMERA_ONLY;
    return CONSENT_VERSION_ORDER.indexOf(accepted) >= CONSENT_VERSION_ORDER.indexOf('oyon-consent-v2');
}
const MAX_EMOTION_EVENT_JSON_LENGTH = 20_000;
const POST_SESSION_CAPTURE_GRACE_MS = 24 * 60 * 60 * 1000;

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

// Per-endpoint 4xx/5xx counter. Mounted before any route handler so it
// observes every Oyon response. Exposed via GET /admin/health below.
router.use(rejectionMiddleware);

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
        // Oyon 3 signal flags (migration 0040). Key-presence merge: an absent
        // field keeps its stored value, so a partial PUT from one settings
        // section cannot silently disable a signal another section owns.
        ...signalFlagsFromBody(req.body, previous),
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
             facial_signals_enabled = ?,
             heart_rate_enabled = ?,
             respiration_enabled = ?,
             illumination_enabled = ?,
             eye_tracking_enabled = ?,
             gaze_tracking_enabled = ?,
             enable_dynamics = ?,
             posture_tracking_enabled = ?,
             signal_window_share = ?,
             typing_enabled = ?,
             interaction_enabled = ?,
             discourse_enabled = ?,
             ai_assist_enabled = ?,
             updated_at = ${SQL_NOW}
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
            next.facial_signals_enabled,
            next.heart_rate_enabled,
            next.respiration_enabled,
            next.illumination_enabled,
            next.eye_tracking_enabled,
            next.gaze_tracking_enabled,
            next.enable_dynamics,
            next.posture_tracking_enabled,
            next.signal_window_share,
            next.typing_enabled,
            next.interaction_enabled,
            next.discourse_enabled,
            next.ai_assist_enabled,
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
            consent_granted, consent_version, accepted_version, source_page, user_agent
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            tenantId(req),
            String(req.user.id),
            String(session.user_id),
            String(session.id),
            session.case_id == null ? null : String(session.case_id),
            granted ? 1 : 0,
            settings.consent_version || DEFAULT_CONSENT_VERSION,
            // What the client actually SHOWED and the learner accepted — not
            // what the tenant currently advertises. A client that names no
            // version is a pre-0041 client, which can only have displayed the
            // v1 contract, so it records v1 and cannot grant itself v2. This is
            // the whole point of the column: consent means the contract the
            // learner saw, never the newest one on file.
            acceptedConsentVersion(req.body?.accepted_version),
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
        maxJsonStringLength: MAX_EMOTION_EVENT_JSON_LENGTH,
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
    let signalsInserted = 0;
    let signalsSkipped = 0;
    let consentBlocked = 0;
    for (const event of events) {
        const serverErrors = validateServerEvent(event, session);
        if (serverErrors.length) {
            return res.status(400).json({ error: 'Invalid emotion event', details: serverErrors });
        }
        // Oyon 3 (migration 0039): a window declaring a non-emotion `modality`
        // — or carrying a legacy `<x>_only` boolean — is NOT an emotion record.
        // It carries no emotion fields, so storing it in oyon_emotion_records
        // would add `dominant_emotion IS NULL` rows that silently shift every
        // existing count and distribution. Route it to oyon_signal_windows,
        // where legacy queries cannot see it.
        if (isModalityOnlyEvent(event)) {
            const modality = resolveModality(event);
            if (!modality) {
                oyonLog.warn('signal window rejected: unknown modality', {
                    session_id: session.id,
                    modality: event?.modality ?? null,
                });
                return res.status(400).json({
                    error: 'Unknown Oyon modality',
                    code: 'oyon_unknown_modality',
                });
            }
            // Consent gate (migration 0041). A modality the learner's accepted
            // contract doesn't cover is DROPPED, not rejected: a mixed batch
            // must still store the camera windows travelling with it, and a
            // learner who declined the newer contract should not see capture
            // fail — it should simply not record what they didn't agree to.
            if (!consentCoversModality(consent, modality)) {
                consentBlocked += 1;
                oyonLog.info('signal window dropped: consent version does not cover modality', {
                    session_id: session.id,
                    modality,
                    accepted_version: consent?.accepted_version || CONSENT_VERSION_CAMERA_ONLY,
                });
                continue;
            }
            const signalResult = await insertSignalWindow(req, session, settings, consent, event, modality);
            if (signalResult?.changes === 1) signalsInserted += 1;
            else signalsSkipped += 1;
            continue;
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

    oyonLog.info('emotion batch accepted', {
        session_id: session.id, inserted, skipped, signalsInserted, signalsSkipped, consentBlocked,
    });
    // `inserted`/`skipped` keep counting emotion records ONLY, so existing
    // clients and tests reading them are unaffected by the new modalities.
    res.json({
        ok: true,
        inserted,
        skipped,
        signals_inserted: signalsInserted,
        signals_skipped: signalsSkipped,
        // Reported rather than silent: a client seeing this knows its consent
        // prompt is stale, not that the network dropped the windows.
        signals_consent_blocked: consentBlocked,
    });
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

/*
 * Oyon 3 modality-scoped windows (migration 0039). Deliberately a SEPARATE
 * endpoint from /emotion-records rather than a `modality` query param on it:
 * every existing caller of /emotion-records keeps its exact response shape, so
 * no current dashboard can be perturbed by this addition.
 *
 * Same access policy as /emotion-records — assertOyonReadAccess (role + the
 * per-role tenant flag), per-row visibility column, tenant scoping, session
 * ownership, and redactRow on the way out.
 */
router.get('/signal-windows', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    if (!assertOyonReadAccess(req, res, settings)) return;

    const session = req.query.session_id ? await resolveSession(req, req.query.session_id) : null;
    if (req.query.session_id && !session) return res.status(404).json({ error: 'Session not found' });
    if (session && !canReadSession(req.user, session)) return res.status(403).json({ error: 'Access denied' });

    const requestedModality = req.query.modality ? String(req.query.modality) : null;
    if (requestedModality && !OYON_MODALITIES.includes(requestedModality)) {
        return res.status(400).json({
            error: 'Unknown Oyon modality',
            code: 'oyon_unknown_modality',
        });
    }

    const { whereSql, params: whereParams } = buildSignalWindowsWhere(req, {
        session,
        modality: requestedModality,
    });

    const countRow = await dbGet(
        `SELECT COUNT(*) AS total FROM oyon_signal_windows r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE ${whereSql}`,
        whereParams
    );
    const total = Number(countRow?.total) || 0;

    const pageParams = [...whereParams, limit(req.query.limit, 200), offsetParam(req.query.offset)];
    const rows = await dbAll(
        `SELECT r.*, u.username, u.role AS user_role
         FROM oyon_signal_windows r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE ${whereSql}
         ORDER BY r.window_start DESC, r.id DESC
         LIMIT ? OFFSET ?`,
        pageParams
    );

    // Which modalities actually have data for this filter — lets a dashboard
    // render only the tabs a cohort really produced instead of empty shells.
    const modalityRows = await dbAll(
        `SELECT r.modality, COUNT(*) AS count
         FROM oyon_signal_windows r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE ${whereSql}
         GROUP BY r.modality
         ORDER BY count DESC`,
        whereParams
    );

    oyonLog.debug('signal windows read', {
        user_id: req.user.id,
        role: req.user.role,
        session_id: session?.id,
        modality: requestedModality,
        scope: session ? 'session' : 'tenant',
        returned: rows.length,
        total,
    });
    res.json({
        windows: rows.map(hydrateSignalWindow).map(r => redactRow(r)),
        total,
        modalities: modalityRows.map(r => ({ modality: r.modality, count: Number(r.count) || 0 })),
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
                -- Honour row-level visibility for the caller's role; otherwise
                -- the "top emotion" could be computed from records the caller
                -- isn't permitted to see in the main query.
                AND ${rowVisibilityColumn(req.user) ? rowVisibilityColumn(req.user).replace(/^r\./, 'r2.') + ' = 1' : '1 = 0'}
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
    const visCol = rowVisibilityColumn(req.user);
    if (!visCol) {
        return res.json({
            session: {
                id: session.id,
                user_id: session.user_id,
                case_id: session.case_id,
                start_time: session.start_time,
                end_time: session.end_time,
                student_name: session.student_name,
                case_title: session.live_case_name,
            },
            oyon_windows: [],
        });
    }
    const windows = await dbAll(
        `SELECT r.*, u.username, u.role AS user_role
         FROM oyon_emotion_records r
         LEFT JOIN users u ON CAST(r.user_id AS INTEGER) = u.id AND u.tenant_id = r.tenant_id
         WHERE r.tenant_id = ? AND r.session_id = ? AND ${visCol} = 1
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

router.get('/admin/health', authenticateToken, async (req, res) => {
    // Operator dashboard for "is the Oyon write path healthy right now?"
    // Returns per-endpoint rejection counts (4xx + 5xx) for the last 5min
    // and last hour. Empty `endpoints` means no rejections in the last
    // hour — the happy state. A spike on POST /emotion-records is the
    // signature of label-set drift, validator changes, or session-bounds
    // bugs. Operator view: same gate as /admin/live.
    const settings = await ensureSettings(tenantId(req));
    if (!assertOyonReadAccess(req, res, settings)) return;
    const endpoints = getRejectionStats();
    const total_5m = Object.values(endpoints).reduce((acc, e) => acc + e.count_5m, 0);
    const total_1h = Object.values(endpoints).reduce((acc, e) => acc + e.count_1h, 0);
    res.json({
        endpoints,
        total_5m,
        total_1h,
        generated_at: new Date().toISOString(),
    });
});

router.get('/admin/live', authenticateToken, async (req, res) => {
    const settings = await ensureSettings(tenantId(req));
    if (!assertOyonReadAccess(req, res, settings)) return;

    // Honour the per-row visibility flag for the caller's role. The
    // previous `(admin_can_view = 1 OR educator_can_view = 1)` let an
    // educator see admin-only rows (and vice versa) — that OR was the
    // bug. assertOyonReadAccess upstream guarantees educator/admin only.
    const visCol = rowVisibilityColumn(req.user);
    if (!visCol) return res.json({ records: [] });
    const visColBare = visCol.replace(/^r\./, '');

    const rows = await dbAll(
        `SELECT r.*
         FROM oyon_emotion_records r
         JOIN (
           SELECT session_id, MAX(window_start) AS latest_window
           FROM oyon_emotion_records
           WHERE tenant_id = ? AND ${visColBare} = 1
           GROUP BY session_id
         ) latest
           ON latest.session_id = r.session_id AND latest.latest_window = r.window_start
         WHERE r.tenant_id = ? AND ${visCol} = 1
         ORDER BY r.window_start DESC, r.id DESC
         LIMIT ?`,
        [tenantId(req), tenantId(req), limit(req.query.limit, 100)]
    );
    oyonLog.debug('admin live read', { user_id: req.user.id, returned: rows.length });
    res.json({ records: rows.map(hydrateRecord) });
});

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
    if (JSON.stringify(event).length > MAX_EMOTION_EVENT_JSON_LENGTH) errors.push('Emotion event is too large');
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
        'gaze_json', 'engagement_json', 'room',
        'facial_json', 'posture_json', 'heart_rate_json', 'respiration_json',
        'illumination_json', 'capture_quality_json',
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
        // Oyon v2 window blocks (migration 0028). Aggregates only — the gaze
        // block carries zone shares / AOI dwell / centroid stats, never a raw
        // point stream (validateGazeBlock upstream enforces the same).
        jsonTextOrNull(event.gaze),
        jsonTextOrNull(event.engagement),
        shortText(event.room, 100),
        // Oyon 3 window-shared blocks (migration 0039). Present whenever the
        // matching modality is enabled with `*_window_share` (the default);
        // dropped on the floor before 0039 for want of a column.
        jsonTextOrNull(event.facial),
        jsonTextOrNull(event.posture),
        jsonTextOrNull(event.heart_rate),
        jsonTextOrNull(event.respiration),
        jsonTextOrNull(event.illumination),
        jsonTextOrNull(event.capture_quality),
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

/*
 * Oyon 3 modality-scoped windows (migration 0039).
 *
 * `isModalityOnlyEvent` is Oyon's own seam: true for any event declaring a
 * non-emotion `modality`, and for the legacy `<x>_only` booleans the v3
 * contract still emits. Everything it returns false for is an emotion window
 * and keeps its existing path into `oyon_emotion_records` untouched.
 */

/** Legacy `<x>_only` boolean → modality name, for pre-v4 shaped events. */
const MODALITY_ONLY_FLAG_NAMES = Object.freeze({
    engagement_only: 'engagement',
    facial_only: 'facial',
    gaze_only: 'gaze',
    heart_rate_only: 'heart_rate',
    posture_only: 'posture',
});

/** Envelope keys that are never part of a modality's own payload block. */
const SIGNAL_ENVELOPE_KEYS = new Set([
    'modality', 'window_kind', 'window_start', 'window_end', 'duration_ms',
    'session_id', 'sessionId', 'user_id', 'username', 'student_id', 'case_id',
    'record_id', 'window_id', 'capture_id', 'course_id', 'cohort_id',
    'course_title', 'cohort_title', 'session_type', 'attempt_number',
    'started_from_page', 'room', 'capture_mode', 'capture_status',
    'consent_version', 'settings_snapshot', 'settings_hash', 'model_profile',
    'dynamics', 'oyonVersion', 'contractVersion', 'schema_version',
    ...Object.keys(MODALITY_ONLY_FLAG_NAMES),
]);

/**
 * The modality a non-emotion window declares, or null if it isn't one we can
 * name. Validated against Oyon's own exported list rather than a local copy so
 * a vendor bump that adds a modality needs no change here — and so an unknown
 * value is rejected rather than silently stored (the table has no CHECK
 * constraint by design; see migration 0039).
 */
function resolveModality(event) {
    const declared = typeof event?.modality === 'string' ? event.modality : null;
    const fromFlag = Object.keys(MODALITY_ONLY_FLAG_NAMES)
        .find(flag => event?.[flag] === true);
    const modality = declared || (fromFlag ? MODALITY_ONLY_FLAG_NAMES[fromFlag] : null);
    if (!modality || modality === 'emotion') return null;
    return OYON_MODALITIES.includes(modality) ? modality : null;
}

/**
 * The modality's aggregate block. Camera modality-only windows nest it under
 * the modality name (`{facial_only: true, facial: {…}}`); SignalCapture
 * episodes ARE the window, so fall back to the event minus the envelope.
 */
function resolveSignalPayload(event, modality) {
    const nested = event?.[modality];
    if (nested && typeof nested === 'object') return nested;
    const rest = {};
    for (const [key, value] of Object.entries(event || {})) {
        if (!SIGNAL_ENVELOPE_KEYS.has(key)) rest[key] = value;
    }
    return Object.keys(rest).length ? rest : null;
}

async function insertSignalWindow(req, session, settings, consent, event, modality) {
    const snapshot = parseJson(session.case_snapshot) || {};
    const liveConfig = parseJson(session.live_case_config) || {};
    const config = snapshot.config || liveConfig || {};
    const demographics = config.demographics || {};
    const caseTitle = snapshot.name || session.live_case_name || null;
    const studentName = session.student_name || req.user.username || session.username || null;
    // Prefer SignalCapture's own `window_id` — episode windows have no fixed
    // cadence, so (start, end) is not their identity. Fall back to the camera
    // hash, with modality mixed in: a facial_only window shares its bounds with
    // the sibling emotion window, so without it the two would collide.
    const recordId = event.window_id != null
        ? String(event.window_id)
        : (event.record_id != null
            ? String(event.record_id)
            : deriveRecordId(tenantId(req), `${session.id}|${modality}`, event.window_start, event.window_end));
    const windowKind = OYON_WINDOW_KINDS.includes(event.window_kind)
        ? event.window_kind
        : 'interval';
    const columns = [
        'tenant_id', 'user_id', 'student_id', 'session_id', 'case_id', 'record_id',
        'course_id', 'cohort_id', 'student_name_snapshot', 'student_role_snapshot',
        'case_title_snapshot', 'case_category_snapshot', 'course_title_snapshot',
        'cohort_title_snapshot', 'session_type', 'attempt_number', 'started_from_page',
        'room', 'modality', 'window_kind', 'window_start', 'window_end', 'duration_ms',
        'payload_json', 'dynamics_json', 'model_profile', 'settings_hash',
        'settings_snapshot_json', 'capture_mode', 'capture_status',
        'student_consent_enabled', 'student_can_view', 'admin_can_view',
        'educator_can_view', 'consent_version', 'consent_recorded_at',
        'oyon_version', 'contract_version', 'schema_version',
    ];
    const values = [
        String(tenantId(req)),
        String(req.user.id),
        String(session.user_id),
        String(session.id),
        session.case_id == null ? null : String(session.case_id),
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
        shortText(event.room, 100),
        modality,
        windowKind,
        event.window_start,
        event.window_end,
        integerOrNull(event.duration_ms),
        jsonTextOrNull(resolveSignalPayload(event, modality)),
        jsonTextOrNull(event.dynamics),
        shortText(event.model_profile || event.settings_snapshot?.model_profile, 200),
        shortText(event.settings_hash || event.settings_snapshot?.settings_hash, 100),
        jsonTextOrNull(event.settings_snapshot),
        event.capture_mode || 'local-browser',
        'captured',
        consent.consent_granted ? 1 : 0,
        settings.student_emotion_view_enabled ? 1 : 0,
        settings.admin_emotion_view_enabled ? 1 : 0,
        settings.educator_emotion_view_enabled ? 1 : 0,
        // Server-authoritative, exactly as for emotion records.
        consent.consent_version || settings.consent_version || DEFAULT_CONSENT_VERSION,
        consent.created_at || null,
        shortText(event.oyonVersion, 40),
        shortText(event.contractVersion, 40),
        shortText(event.schema_version, 60),
    ];

    return dbRun(
        `INSERT INTO oyon_signal_windows (${columns.join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})
         ON CONFLICT(tenant_id, session_id, modality, record_id) WHERE record_id IS NOT NULL DO NOTHING`,
        values
    );
}

function hydrateSignalWindow(row) {
    return {
        ...row,
        payload: parseJson(row.payload_json),
        dynamics: parseJson(row.dynamics_json),
        settings_snapshot: parseJson(row.settings_snapshot_json),
    };
}

function hydrateRecord(row) {
    return {
        ...row,
        probabilities: parseJson(row.emotion_probabilities_json),
        quality: parseJson(row.quality_json),
        settings_snapshot: parseJson(row.settings_snapshot_json),
        dynamics: parseJson(row.dynamics_json),
        gaze: parseJson(row.gaze_json),
        engagement: parseJson(row.engagement_json),
        // Oyon 3 window-shared blocks (migration 0039).
        facial: parseJson(row.facial_json),
        posture: parseJson(row.posture_json),
        heart_rate: parseJson(row.heart_rate_json),
        respiration: parseJson(row.respiration_json),
        illumination: parseJson(row.illumination_json),
        capture_quality: parseJson(row.capture_quality_json),
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
        // The single tenant switch behind runtime's per-modality
        // `*_window_share` fan-out, so the admin form round-trips one control
        // rather than seven derived ones.
        signal_window_share: boolFrom(settings.signal_window_share, SIGNAL_SETTING_DEFAULTS.signal_window_share),
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
        ...signalFlagsFromSettings(settings),
    };
}

/*
 * Oyon 3 signal flags (migration 0040) → the element's `settings` attribute.
 *
 * These are AUTHORITY over signals that already run: the element's own
 * DEFAULT_SETTINGS turns gaze/eye/facial/posture/respiration/heart-rate on, and
 * before 0040 Rohy forwarded no booleans at all, so a tenant could not switch
 * any of them off. Forwarding them explicitly — rather than omitting a key and
 * letting the element decide — is the point: an omitted key leaves the element's
 * persisted store in charge, which is per-browser and invisible to the admin.
 */
function signalFlagsFromSettings(settings) {
    const flag = (key) => boolFrom(settings?.[key], SIGNAL_SETTING_DEFAULTS[key]);
    const share = flag('signal_window_share');
    return {
        facial_signals_enabled: flag('facial_signals_enabled'),
        heart_rate_enabled: flag('heart_rate_enabled'),
        respiration_enabled: flag('respiration_enabled'),
        illumination_enabled: flag('illumination_enabled'),
        eye_tracking_enabled: flag('eye_tracking_enabled'),
        gaze_tracking_enabled: flag('gaze_tracking_enabled'),
        enable_dynamics: flag('enable_dynamics'),
        posture_tracking_enabled: flag('posture_tracking_enabled'),
        typing_enabled: flag('typing_enabled'),
        interaction_enabled: flag('interaction_enabled'),
        discourse_enabled: flag('discourse_enabled'),
        ai_assist_enabled: flag('ai_assist_enabled'),
        // One tenant switch drives every modality's window_share, so signals
        // cannot end up split across shapes for reasons an admin can't see.
        facial_signals_window_share: share,
        posture_window_share: share,
        heart_rate_window_share: share,
        respiration_window_share: share,
        illumination_window_share: share,
        engagement_window_share: share,
        gaze_window_share: share,
    };
}

function boolFrom(value, fallback) {
    if (value === null || value === undefined) return fallback;
    return Boolean(Number(value));
}

/*
 * The tenant-editable signal columns of migration 0040, with the SAME defaults
 * the migration writes. One map so the SQL defaults, the runtime projection and
 * the PUT merge can never disagree — a mismatch would show up as a signal that
 * silently flips state on an unrelated settings save.
 */
const SIGNAL_SETTING_DEFAULTS = Object.freeze({
    facial_signals_enabled: true,
    heart_rate_enabled: true,
    respiration_enabled: true,
    illumination_enabled: true,
    eye_tracking_enabled: true,
    gaze_tracking_enabled: true,
    enable_dynamics: true,
    // Off — the pose model cannot be served same-origin. See migration 0040.
    posture_tracking_enabled: false,
    signal_window_share: true,
    // Host-driven modalities (migration 0041). Enabled at tenant level so they
    // are ready the moment a learner accepts consent v2 — the ingest consent
    // gate, not these flags, is what keeps them dormant until then. `voice` is
    // absent on purpose: it gates microphone HARDWARE and Rohy's VoiceService
    // already owns the mic, so it is its own follow-up.
    typing_enabled: true,
    interaction_enabled: true,
    discourse_enabled: true,
    ai_assist_enabled: true,
});

/*
 * PUT /settings body → the signal columns, as a KEY-PRESENCE MERGE.
 *
 * Deliberately not a full replace. `PUT /addons/oyon/settings` is shared by
 * every Oyon settings section, and a full replace here would mean the capture-
 * engine form silently zeroing every signal flag it does not render — the exact
 * partial-update trap CLAUDE.md records for this endpoint's boolean flags. An
 * absent field keeps the STORED value, read from the settings row rather than
 * the runtime projection (which renames window_share per modality).
 */
function signalFlagsFromBody(body, previousSettings) {
    const out = {};
    for (const [key, fallback] of Object.entries(SIGNAL_SETTING_DEFAULTS)) {
        const supplied = body != null && Object.prototype.hasOwnProperty.call(body, key);
        out[key] = supplied
            ? (boolToInt(body[key]) ? 1 : 0)
            : (boolFrom(previousSettings?.[key], fallback) ? 1 : 0);
    }
    return out;
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
    const rawSessionEnd = session.end_time ? Date.parse(session.end_time) : null;
    const sessionEnd = Number.isFinite(rawSessionEnd)
        ? rawSessionEnd + POST_SESSION_CAPTURE_GRACE_MS
        : Date.now() + 60_000;
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
// Row-level visibility column for a given caller. Records carry frozen
// per-role visibility flags at insert time (student_can_view /
// educator_can_view / admin_can_view). Reads must honour the *row's*
// flag for the caller's role — otherwise a record captured while a role
// was disallowed becomes visible the moment that role's tenant toggle
// flips back on. assertOyonReadAccess upstream guarantees the caller is
// educator or admin; anything else is a defensive default that yields
// no rows.
function rowVisibilityColumn(user) {
    if (hasRoleAtLeast(user, ROLE_RANKS.admin)) return 'r.admin_can_view';
    if (hasRoleAtLeast(user, ROLE_RANKS.educator)) return 'r.educator_can_view';
    return null;
}

/*
 * Filter builder for oyon_signal_windows. Mirrors buildEmotionRecordsWhere's
 * tenant / per-row visibility / session / case / user / date semantics (same
 * bare-date upper-bound handling), minus the emotion-specific predicates
 * (dominant emotion, free-text search over emotion labels) and plus `modality`.
 *
 * Kept as its own function rather than parameterising the emotion builder: that
 * builder is on the hot path of every existing dashboard, and the whole point of
 * this change is that none of them shift.
 */
function buildSignalWindowsWhere(req, { session = null, modality = null } = {}) {
    const params = [tenantId(req)];
    const parts = ['r.tenant_id = ?'];

    const visCol = rowVisibilityColumn(req.user);
    if (visCol) {
        parts.push(`${visCol} = 1`);
    } else {
        parts.push('1 = 0');
    }

    if (modality) {
        parts.push('r.modality = ?');
        params.push(modality);
    }

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

    return { whereSql: parts.join(' AND '), params };
}

function buildEmotionRecordsWhere(req, { session = null } = {}) {
    const params = [tenantId(req)];
    const parts = ['r.tenant_id = ?'];

    const visCol = rowVisibilityColumn(req.user);
    if (visCol) {
        parts.push(`${visCol} = 1`);
    } else {
        // No role match → no rows. Encoded as an always-false predicate so
        // the parameterised SQL still binds cleanly.
        parts.push('1 = 0');
    }

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
