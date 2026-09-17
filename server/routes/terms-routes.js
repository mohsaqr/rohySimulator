// Terms of use: the agreement a person accepts once, per version, before using
// Rohy. Modelled on chatoyon+'s licence agreement (src/app/api/license).
//
//   GET  /api/terms                  — PUBLIC. The agreement, readable before
//                                      signing in: terms you must agree to in
//                                      order to use an account should not need
//                                      an account to read.
//   GET  /api/terms/status           — the agreement plus whether THIS account
//                                      has accepted the current version, and
//                                      whether the app must stop for it.
//   POST /api/terms/accept           — accept the version the browser showed.
//   GET  /api/platform-settings/terms — admin: the stored draft and adoption.
//   PUT  /api/platform-settings/terms — admin: edit title, body, version and
//                                      whether acceptance is required.
//
// The agreement is platform-wide (like the registration policy) and stored in
// platform_settings; acceptances are per person, tenant-scoped, and snapshot the
// exact text accepted (migration 0060).

import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { auditSuccess, dbAll, dbGet, dbRun, tenantId } from './_helpers.js';
import { logger } from '../logger.js';
import {
    DEFAULT_TERMS_BODY, DEFAULT_TERMS_TITLE, DEFAULT_TERMS_VERSION,
    TERMS_BODY_MAX, TERMS_TITLE_MAX, normalizeTermsVersion, termsVersionError,
} from '../shared/terms.js';

const router = express.Router();
const termsLog = logger('terms');

// Public and hit by the login screen, so bounded like the registration probe.
const publicLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.ROHY_DISABLE_AUTH_RATE_LIMIT === '1' ? 100_000 : 60,
    message: { error: 'Too many requests. Please try again shortly.' },
    standardHeaders: true,
    legacyHeaders: false,
});

/** The raw stored settings — what an administrator is editing, blanks intact. */
async function readDraft() {
    const rows = await dbAll(
        `SELECT setting_key, setting_value FROM platform_settings
          WHERE setting_key IN ('terms_required', 'terms_title', 'terms_body', 'terms_version')`,
    );
    const byKey = Object.fromEntries((rows || []).map((r) => [r.setting_key, r.setting_value]));
    return {
        // Not required until an administrator turns it on: the default text is a
        // draft awaiting legal, data-protection and ethics review.
        required: byKey.terms_required === '1',
        title: byKey.terms_title ?? '',
        body: byKey.terms_body ?? '',
        version: byKey.terms_version ?? '',
    };
}

/** The agreement as shown: a blank title, body or version falls back to the default. */
async function readDoc() {
    const draft = await readDraft();
    const title = draft.title.trim() || DEFAULT_TERMS_TITLE;
    const body = draft.body.trim() ? draft.body : DEFAULT_TERMS_BODY;
    return {
        required: draft.required,
        title,
        body,
        version: normalizeTermsVersion(draft.version) || DEFAULT_TERMS_VERSION,
        is_default: !draft.body.trim(),
    };
}

async function acceptanceFor(req, version) {
    return dbGet(
        'SELECT accepted_at FROM terms_acceptances WHERE user_id = ? AND tenant_id = ? AND version = ?',
        [req.user.id, tenantId(req), version],
    );
}

async function adoption(req, version) {
    const [accepted, eligible] = await Promise.all([
        dbGet('SELECT COUNT(DISTINCT user_id) AS n FROM terms_acceptances WHERE tenant_id = ? AND version = ?', [tenantId(req), version]),
        dbGet("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND status = 'active'", [tenantId(req)]),
    ]);
    return { accepted: Number(accepted?.n) || 0, eligible: Number(eligible?.n) || 0 };
}

router.get('/terms', publicLimiter, async (req, res) => {
    try {
        res.json({ terms: await readDoc() });
    } catch (err) {
        termsLog.error('terms read failed', { error: err.message });
        res.status(500).json({ error: 'Could not read the terms of use' });
    }
});

router.get('/terms/status', authenticateToken, async (req, res) => {
    try {
        const doc = await readDoc();
        const row = await acceptanceFor(req, doc.version);
        res.json({
            terms: {
                ...doc,
                accepted: Boolean(row),
                accepted_at: row?.accepted_at ?? null,
                pending: doc.required && !row,
            },
        });
    } catch (err) {
        req.log.error('terms status failed', { error: err.message });
        res.status(500).json({ error: 'Could not read the terms of use' });
    }
});

router.post('/terms/accept', authenticateToken, async (req, res) => {
    try {
        const shown = normalizeTermsVersion(req.body?.version);
        if (!shown) return res.status(400).json({ error: 'version is required' });

        const doc = await readDoc();
        // The administrator published a new version between this page rendering
        // and the click. Recording it would file an acceptance for text this
        // person never read, so refuse and let the client load the current one.
        if (shown !== doc.version) {
            return res.status(409).json({
                error: 'The terms of use have been updated. Please read the new version.',
                code: 'terms_version_changed',
                version: doc.version,
            });
        }

        const result = await dbRun(
            `INSERT INTO terms_acceptances (tenant_id, user_id, version, title, body, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, version) DO NOTHING`,
            [tenantId(req), req.user.id, doc.version, doc.title, doc.body, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 500) || null],
        );
        if (result?.changes === 1) {
            auditSuccess(req, {
                action: 'terms.accept',
                resourceType: 'terms',
                resourceId: doc.version,
                newValue: { version: doc.version, title: doc.title },
            });
            req.log.info('terms accepted', { version: doc.version });
        }
        const row = await acceptanceFor(req, doc.version);
        res.json({ terms: { ...doc, accepted: true, accepted_at: row?.accepted_at ?? null, pending: false } });
    } catch (err) {
        req.log.error('terms accept failed', { error: err.message });
        res.status(500).json({ error: 'Could not record your acceptance' });
    }
});

router.get('/platform-settings/terms', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [draft, doc] = await Promise.all([readDraft(), readDoc()]);
        res.json({
            draft,
            terms: doc,
            defaults: { title: DEFAULT_TERMS_TITLE, body: DEFAULT_TERMS_BODY, version: DEFAULT_TERMS_VERSION },
            adoption: await adoption(req, doc.version),
        });
    } catch (err) {
        req.log.error('terms settings read failed', { error: err.message });
        res.status(500).json({ error: 'Could not read the terms of use settings' });
    }
});

router.put('/platform-settings/terms', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        const updates = {};
        if (body.required !== undefined) {
            if (typeof body.required !== 'boolean') return res.status(400).json({ error: 'required must be true or false' });
            updates.terms_required = body.required ? '1' : '0';
        }
        if (body.title !== undefined) {
            if (typeof body.title !== 'string' || body.title.length > TERMS_TITLE_MAX) {
                return res.status(400).json({ error: `title must be text of at most ${TERMS_TITLE_MAX} characters` });
            }
            updates.terms_title = body.title;
        }
        if (body.body !== undefined) {
            if (typeof body.body !== 'string' || body.body.length > TERMS_BODY_MAX) {
                return res.status(400).json({ error: `body must be text of at most ${TERMS_BODY_MAX} characters` });
            }
            updates.terms_body = body.body;
        }
        if (body.version !== undefined) {
            const problem = termsVersionError(body.version);
            if (problem) return res.status(400).json({ error: problem });
            updates.terms_version = normalizeTermsVersion(body.version);
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        const before = await readDraft();
        for (const [key, value] of Object.entries(updates)) {
            await dbRun(
                `INSERT INTO platform_settings (setting_key, setting_value, updated_by, updated_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value,
                    updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
                [key, value, req.user.id],
            );
        }
        const after = await readDraft();
        // Audited without the text itself: what matters is that the terms
        // changed, to which version, and by whom. The accepted text is already
        // snapshotted on every acceptance row.
        const summary = (d) => ({ required: d.required, title: d.title, version: d.version, body_chars: d.body.length });
        auditSuccess(req, {
            action: 'terms.update',
            resourceType: 'terms',
            resourceId: after.version || DEFAULT_TERMS_VERSION,
            oldValue: summary(before),
            newValue: summary(after),
        });
        const doc = await readDoc();
        res.json({ draft: after, terms: doc, adoption: await adoption(req, doc.version) });
    } catch (err) {
        req.log.error('terms settings update failed', { error: err.message });
        res.status(500).json({ error: 'Could not save the terms of use' });
    }
});

export default router;
