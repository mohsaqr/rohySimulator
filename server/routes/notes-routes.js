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
    verifySessionOwnership
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

router.get('/sessions/:sessionId/discussion-notes', authenticateToken, async (req, res) => {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (!Number.isInteger(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id' });
    }
    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;
    dbAdapter.get(
        `SELECT note_text, updated_at FROM session_notes WHERE session_id = ? AND user_id = ?`,
        [sessionId, req.user.id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ note_text: row?.note_text || '', updated_at: row?.updated_at || null });
        }
    );
});

// PUT /sessions/:sessionId/discussion-notes — upsert current user's note
router.put('/sessions/:sessionId/discussion-notes', authenticateToken, async (req, res) => {
    const sessionId = parseInt(req.params.sessionId, 10);
    if (!Number.isInteger(sessionId)) {
        return res.status(400).json({ error: 'Invalid session id' });
    }
    if (!await verifySessionOwnership(sessionId, req.user, res, { requireSession: true })) return;
    const noteText = typeof req.body?.note_text === 'string' ? req.body.note_text : '';
    dbAdapter.run(
        `INSERT INTO session_notes (session_id, user_id, note_text, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(session_id, user_id) DO UPDATE SET
            note_text = excluded.note_text,
            updated_at = CURRENT_TIMESTAMP`,
        [sessionId, req.user.id, noteText],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ ok: true, note_text: noteText });
        }
    );
});



export default router;
