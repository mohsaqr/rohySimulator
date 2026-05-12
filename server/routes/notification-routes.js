import express from 'express';
import dbAdapter from '../dbAdapter.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
    authenticateToken,
} from '../middleware/auth.js';




import { logger } from '../logger.js';
import {
    auditSuccess,
    parseAuditJson
} from './_helpers.js';

const radiologyLog = logger('radiology');
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

router.get('/notification-prefs', authenticateToken, (req, res) => {
    const userId = req.user.id;
    dbAdapter.get(
        `SELECT notification_settings FROM user_preferences WHERE user_id = ?`,
        [userId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            let prefs = {};
            if (row && row.notification_settings) {
                try { prefs = JSON.parse(row.notification_settings); } catch { prefs = {}; }
            }
            res.json({ prefs });
        }
    );
});

// Whitelist of pref keys the client is allowed to write. Mirrors
// src/notifications/defaults.js DEFAULT_PREFS plus the nested audioFrequencies.
// Anything else gets dropped silently — keeps a malicious client from
// stuffing the column with arbitrary blobs.
const ALLOWED_PREF_KEYS = new Set([
    'dnd', 'pausedUntil', 'minSeverity',
    'mutedSources', 'audioMuted', 'bannerMuted', 'consoleMuted',
    'snoozeDuration',
    'toastDedupeWindowMs', 'toastMaxVisible',
    'telemetryBatchSize', 'telemetryFlushIntervalMs',
    'audioFrequencies', 'audioVolume',
]);
const NOTIFICATION_PREFS_MAX_BYTES = 10 * 1024;   // 10 KB hard cap

router.put('/notification-prefs', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { prefs } = req.body || {};
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
        return res.status(400).json({ error: 'prefs object required' });
    }

    // Strip unknown keys.
    const filtered = {};
    for (const [k, v] of Object.entries(prefs)) {
        if (ALLOWED_PREF_KEYS.has(k)) filtered[k] = v;
    }

    const json = JSON.stringify(filtered);
    if (json.length > NOTIFICATION_PREFS_MAX_BYTES) {
        return res.status(413).json({
            error: `prefs exceed ${NOTIFICATION_PREFS_MAX_BYTES} byte limit`
        });
    }

    dbAdapter.get(`SELECT notification_settings FROM user_preferences WHERE user_id = ?`, [userId], (readErr, oldPrefs) => {
        if (readErr) return res.status(500).json({ error: readErr.message });
        // Upsert. user_preferences has UNIQUE(user_id) so ON CONFLICT works.
        dbAdapter.run(
            `INSERT INTO user_preferences (user_id, notification_settings, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id) DO UPDATE SET
                 notification_settings = excluded.notification_settings,
                 updated_at = CURRENT_TIMESTAMP`,
            [userId, json],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                auditSuccess(req, {
                    action: 'update_notification_preferences',
                    resourceType: 'user_preferences',
                    resourceId: String(userId),
                    oldValue: { notification_settings: parseAuditJson(oldPrefs?.notification_settings) },
                    newValue: { notification_settings: filtered }
                });
                res.json({ ok: true });
            }
        );
    });
});

// --- INVESTIGATION ENDPOINTS ---

// GET /api/cases/:id/investigations - Get all investigations for a case

export default router;
