import express from 'express';
import { validateEmotionBatch } from 'oyon/validation';

export function createEmotionRoutes(deps) {
  const {
    dbAdapter,
    authenticateToken,
    tenantId,
    hasRoleAtLeast,
    ROLE_RANKS,
  } = deps;

  const router = express.Router();

  router.post('/sessions/:sessionId/emotions/batch', authenticateToken, async (req, res) => {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ error: 'Invalid session id' });
    }

    const validation = validateEmotionBatch(req.body, { maxBatchEvents: 64 });
    if (!validation.ok) {
      return res.status(400).json({ error: 'Invalid emotion batch', details: validation.errors });
    }

    const session = await dbGet(
      dbAdapter,
      `SELECT id, user_id, case_id, tenant_id, start_time, end_time
       FROM sessions
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [sessionId, tenantId(req)],
    );

    if (!session) return res.status(404).json({ error: 'Session not found' });

    const educatorOrAbove = hasRoleAtLeast(req.user, ROLE_RANKS.educator);
    if (!educatorOrAbove && session.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Session is not owned by user' });
    }

    const events = req.body.events;
    const stmt = dbAdapter.prepare(`
      INSERT INTO emotion_windows (
        session_id, user_id, case_id, dominant_emotion,
        probabilities, valence, arousal, confidence, entropy,
        window_start, window_end, valid_frames, missing_face_ratio,
        quality, model_name, model_version, capture_mode, consent_version,
        tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    try {
      for (const event of events) {
        const serverErrors = validateServerEvent(event);
        if (serverErrors.length) {
          throw new Error(serverErrors.join('; '));
        }

        if (!timestampWithinSession(event.window_start, event.window_end, session)) {
          throw new Error('Emotion event timestamp is outside session bounds');
        }

        stmt.run([
          sessionId,
          req.user.id,
          session.case_id,
          event.dominant_emotion || null,
          event.probabilities ? JSON.stringify(event.probabilities) : null,
          nullable(event.valence),
          nullable(event.arousal),
          event.confidence,
          nullable(event.entropy),
          event.window_start,
          event.window_end,
          event.valid_frames,
          event.missing_face_ratio,
          event.quality ? JSON.stringify(event.quality) : null,
          event.model_name || null,
          event.model_version || null,
          event.capture_mode || null,
          event.consent_version || null,
          tenantId(req),
        ]);
        inserted += 1;
      }
    } catch (error) {
      return res.status(400).json({ error: error.message });
    } finally {
      stmt.finalize();
    }

    res.json({ ok: true, inserted });
  });

  router.get('/sessions/:sessionId/emotions', authenticateToken, async (req, res) => {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ error: 'Invalid session id' });
    }

    const session = await dbGet(
      dbAdapter,
      `SELECT id, user_id, tenant_id
       FROM sessions
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      [sessionId, tenantId(req)],
    );
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const educatorOrAbove = hasRoleAtLeast(req.user, ROLE_RANKS.educator);
    if (!educatorOrAbove && session.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Session is not owned by user' });
    }

    const rows = await dbAll(
      dbAdapter,
      `SELECT id, session_id, user_id, case_id, dominant_emotion,
              probabilities, valence, arousal, confidence, entropy,
              window_start, window_end, valid_frames, missing_face_ratio,
              quality, model_name, model_version, capture_mode, consent_version,
              created_at
       FROM emotion_windows
       WHERE session_id = ? AND tenant_id = ?
       ORDER BY window_start ASC, created_at ASC`,
      [sessionId, tenantId(req)],
    );

    res.json({
      emotions: rows.map(row => ({
        ...row,
        probabilities: parseJson(row.probabilities),
        quality: parseJson(row.quality),
      })),
    });
  });

  return router;
}

function dbGet(dbAdapter, sql, params) {
  return new Promise((resolve, reject) => {
    dbAdapter.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function dbAll(dbAdapter, sql, params) {
  return new Promise((resolve, reject) => {
    dbAdapter.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

function nullable(value) {
  return value === undefined ? null : value;
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Server-side mirror of Oyon's client deny-list. See
// src/validation/validateEmotionPayload.js — these keys must never appear in a
// posted batch and the server fails closed if they do, even if the client
// validator is bypassed.
const FORBIDDEN_EVENT_KEYS = [
  'iris_landmarks_raw',
  'gaze_points_raw',
  'pupil_diameter_px',
];

function rejectForbiddenKeys(obj, prefix, errors) {
  if (!obj || typeof obj !== 'object') return;
  for (const key of FORBIDDEN_EVENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      errors.push(`${prefix}.${key} is forbidden`);
    }
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith('eye_image_')) {
      errors.push(`${prefix}.${key} is forbidden (eye image fields)`);
    }
  }
}

function validateServerEvent(event) {
  const errors = [];
  if (JSON.stringify(event).length > 4096) {
    errors.push('Emotion event is too large');
  }
  if (event.capture_mode !== 'local-browser') {
    errors.push('capture_mode must be local-browser');
  }
  if (!event.consent_version) {
    errors.push('consent_version is required');
  }
  // Mirror Oyon's client deny-list. Reject raw eye-tracking fields at the
  // top level and inside the optional engagement sub-object.
  rejectForbiddenKeys(event, 'event', errors);
  if (event && typeof event.engagement === 'object' && event.engagement !== null) {
    rejectForbiddenKeys(event.engagement, 'event.engagement', errors);
  }
  return errors;
}

function timestampWithinSession(start, end, session) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const sessionStart = Date.parse(session.start_time);
  const sessionEnd = session.end_time ? Date.parse(session.end_time) + 60_000 : Date.now() + 60_000;
  return Number.isFinite(startMs)
    && Number.isFinite(endMs)
    && startMs <= endMs
    && startMs >= sessionStart - 60_000
    && endMs <= sessionEnd;
}
