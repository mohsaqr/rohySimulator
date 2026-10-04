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
//                                      whether acceptance is required, and the
//                                      per-language translations.
//
// LANGUAGE. The stored title/body/version are the MASTER (English). A
// translation (`terms_translations` = {lang: {title, body, version}}) is shown
// for `?lang=` only while its `version` equals the master's: a translation of
// an older version is never shown as if it were the current one — the reader
// gets the master and `is_fallback: true`. While the master is the shipped
// default, the shipped machine translations (shared/termsTranslations.js)
// stand in for languages an administrator has not translated. Title and body
// always come from the same document; they are never mixed. Acceptance stays
// keyed on (user, version), so accepting in any language accepts that version,
// and the snapshot records the language read (migration 0066).
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
import { DEFAULT_TERMS_TRANSLATIONS } from '../shared/termsTranslations.js';
import { DEFAULT_LANGUAGE, isKnownLanguage } from '../shared/languages.js';

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
          WHERE setting_key IN ('terms_required', 'terms_title', 'terms_body', 'terms_version', 'terms_translations')`,
    );
    const byKey = Object.fromEntries((rows || []).map((r) => [r.setting_key, r.setting_value]));
    return {
        translations: parseTranslations(byKey.terms_translations),
        // Not required until an administrator turns it on: the default text is a
        // draft awaiting legal, data-protection and ethics review.
        required: byKey.terms_required === '1',
        title: byKey.terms_title ?? '',
        body: byKey.terms_body ?? '',
        version: byKey.terms_version ?? '',
    };
}

/** Stored translations, or {} (a malformed value is logged, not fatal). */
function parseTranslations(raw) {
    if (!raw) return {};
    try {
        const value = JSON.parse(raw);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (err) {
        termsLog.warn('terms_translations is not valid JSON; ignored', { error: err.message });
    }
    return {};
}

/** The language a request asks for: a known code other than the master's, or null. */
function requestedLanguage(value) {
    const code = String(value ?? '').trim().toLowerCase().split(/[-_]/)[0];
    return code && code !== DEFAULT_LANGUAGE && isKnownLanguage(code) ? code : null;
}

/**
 * The agreement as shown in `lang`: the translation when it renders the current
 * version, else the master. `lang` is the language actually shown and
 * `is_fallback` says the reader asked for another.
 */
async function readDocIn(lang) {
    const draft = await readDraft();
    const master = masterOf(draft);
    const wanted = requestedLanguage(lang);
    if (!wanted) return { ...master, lang: DEFAULT_LANGUAGE, is_fallback: false };
    const stored = draft.translations[wanted];
    const usable = (entry) => entry && typeof entry.title === 'string' && entry.title.trim()
        && typeof entry.body === 'string' && entry.body.trim();
    if (usable(stored) && normalizeTermsVersion(stored.version) === master.version) {
        return { ...master, title: stored.title.trim(), body: stored.body, lang: wanted, is_fallback: false };
    }
    const shipped = DEFAULT_TERMS_TRANSLATIONS[wanted];
    if (master.is_default && master.version === DEFAULT_TERMS_VERSION && usable(shipped)) {
        return { ...master, title: shipped.title, body: shipped.body, lang: wanted, is_fallback: false };
    }
    return { ...master, lang: DEFAULT_LANGUAGE, is_fallback: true };
}

/** The master agreement as shown: a blank title, body or version falls back to the default. */
async function readDoc() {
    return masterOf(await readDraft());
}

function masterOf(draft) {
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
        res.json({ terms: await readDocIn(req.query.lang) });
    } catch (err) {
        termsLog.error('terms read failed', { error: err.message });
        res.status(500).json({ error: 'Could not read the terms of use' });
    }
});

router.get('/terms/status', authenticateToken, async (req, res) => {
    try {
        const doc = await readDocIn(req.query.lang);
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

        // Re-resolve the document in the language the browser showed, so the
        // snapshot is the text this person actually read.
        const doc = await readDocIn(req.body?.lang);
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
            `INSERT INTO terms_acceptances (tenant_id, user_id, version, title, body, language, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, version) DO NOTHING`,
            [tenantId(req), req.user.id, doc.version, doc.title, doc.body, doc.lang, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 500) || null],
        );
        if (result?.changes === 1) {
            auditSuccess(req, {
                action: 'terms.accept',
                resourceType: 'terms',
                resourceId: doc.version,
                newValue: { version: doc.version, title: doc.title, language: doc.lang },
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
            defaults: { title: DEFAULT_TERMS_TITLE, body: DEFAULT_TERMS_BODY, version: DEFAULT_TERMS_VERSION, translations: DEFAULT_TERMS_TRANSLATIONS },
            translation_status: translationStatus(draft, doc),
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
        const before = await readDraft();
        if (body.translations !== undefined) {
            const merged = mergeTranslations(before.translations, body.translations);
            if (merged.error) return res.status(400).json({ error: merged.error, code: 'invalid_translation' });
            updates.terms_translations = JSON.stringify(merged.value);
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

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
        const summary = (d) => ({
            required: d.required, title: d.title, version: d.version, body_chars: d.body.length,
            translations: Object.fromEntries(Object.entries(d.translations).map(([lang, t]) => [lang, { version: t.version, body_chars: String(t.body ?? '').length }])),
        });
        auditSuccess(req, {
            action: 'terms.update',
            resourceType: 'terms',
            resourceId: after.version || DEFAULT_TERMS_VERSION,
            oldValue: summary(before),
            newValue: summary(after),
        });
        const doc = await readDoc();
        res.json({ draft: after, terms: doc, translation_status: translationStatus(after, doc), adoption: await adoption(req, doc.version) });
    } catch (err) {
        req.log.error('terms settings update failed', { error: err.message });
        res.status(500).json({ error: 'Could not save the terms of use' });
    }
});

/**
 * Per language: what a reader of that language is shown today — the stored
 * translation, the shipped one, or the master because the translation renders
 * an older version (`stale`) or does not exist.
 */
function translationStatus(draft, master) {
    return Object.fromEntries(Object.keys(DEFAULT_TERMS_TRANSLATIONS).map((lang) => {
        const stored = draft.translations[lang];
        if (stored) {
            const version = normalizeTermsVersion(stored.version);
            return [lang, { source: version === master.version ? 'stored' : 'stale', version }];
        }
        const shipped = master.is_default && master.version === DEFAULT_TERMS_VERSION;
        return [lang, { source: shipped ? 'shipped' : 'master', version: shipped ? DEFAULT_TERMS_VERSION : null }];
    }));
}

/**
 * Apply a translations patch: `{lang: {title, body, version}}` sets one,
 * `{lang: null}` removes it. Every entry is validated like the master.
 */
function mergeTranslations(current, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'translations must be an object' };
    const value = { ...current };
    for (const [rawLang, entry] of Object.entries(patch)) {
        const lang = String(rawLang).toLowerCase();
        if (lang === DEFAULT_LANGUAGE || !isKnownLanguage(lang)) return { error: `"${rawLang}" is not a translation language` };
        if (entry === null) { delete value[lang]; continue; }
        if (!entry || typeof entry !== 'object') return { error: `translation "${lang}" must be an object or null` };
        const { title, body, version } = entry;
        if (typeof title !== 'string' || !title.trim() || title.length > TERMS_TITLE_MAX) {
            return { error: `translation "${lang}": title must be text of 1 to ${TERMS_TITLE_MAX} characters` };
        }
        if (typeof body !== 'string' || !body.trim() || body.length > TERMS_BODY_MAX) {
            return { error: `translation "${lang}": body must be text of 1 to ${TERMS_BODY_MAX} characters` };
        }
        const problem = termsVersionError(version);
        if (problem) return { error: `translation "${lang}": ${problem}` };
        value[lang] = { title, body, version: normalizeTermsVersion(version) };
    }
    return { value };
}

export default router;
