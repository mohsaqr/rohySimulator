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
        tenant_id, group_id, member_id, seat, clock_offset_ms, clock_rtt_ms,
        window_anchor_ms, raw_streams,
        modality, raw_reason, raw_part_id, raw_part_index, raw_part_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          nullable(event.confidence),
          nullable(event.entropy),
          event.window_start,
          event.window_end,
          // Raw-only envelopes and modality windows have no frame counts.
          event.valid_frames ?? 0,
          event.missing_face_ratio ?? 0,
          event.quality ? JSON.stringify(event.quality) : null,
          event.model_name || null,
          event.model_version || null,
          event.capture_mode || null,
          event.consent_version || null,
          tenantId(req),
          event.group_id || null,
          event.member_id || null,
          event.seat || null,
          nullable(event.clock_offset_ms),
          nullable(event.clock_rtt_ms),
          nullable(event.window_anchor_ms),
          // Per-sample series (0012_group_alignment.sql). Stored whole: the
          // group layer (oyon/group groupTimeline) reads them back as-is.
          event.raw_streams ? JSON.stringify(event.raw_streams) : null,
          // 0013_raw_parts.sql: every part of a split window is its own row,
          // joined back on read with joinRawParts() (docs/ROHY_INTEGRATION.md §4.3a).
          event.modality || null,
          event.raw_reason || null,
          event.raw_part?.id || null,
          Number.isInteger(event.raw_part?.index) ? event.raw_part.index : null,
          Number.isInteger(event.raw_part?.count) ? event.raw_part.count : null,
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
  // Size bound on the window scalars only; raw_streams carry the per-sample
  // series and get their own (larger) transport bound — a size check, not a
  // gate on which signals may be stored (Oyon data policy).
  const { raw_streams: rawStreams, ...scalars } = event || {};
  if (JSON.stringify(scalars).length > 65536) {
    errors.push('Emotion event is too large');
  }
  if (rawStreams !== undefined && rawStreams !== null) {
    if (typeof rawStreams !== 'object' || Array.isArray(rawStreams)) {
      errors.push('raw_streams must be an object of { fields, rows } streams');
    } else if (JSON.stringify(rawStreams).length > 1_000_000) {
      errors.push('raw_streams is too large');
    } else {
      for (const [name, block] of Object.entries(rawStreams)) {
        if (!block || !Array.isArray(block.fields) || !Array.isArray(block.rows) || block.fields[0] !== 'ts_ms') {
          errors.push(`raw_streams.${name} must be { fields: ['ts_ms', ...], rows: [[...]] }`);
        }
      }
    }
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
