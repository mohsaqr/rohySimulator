import { validateEmotionBatch } from '../validation/validateEmotionPayload.js';
import { OYON_WINDOW_BATCH_SCHEMA_VERSION } from '../version.js';
import { chunkWindowBatch, DEFAULT_MAX_POST_BYTES } from './chunkWindowBatch.js';

/**
 * POSTs window batches to the host. A batch is split into POST bodies of at
 * most `maxPostBytes` (settings.transport_max_post_bytes; default 240 KiB) and
 * sent in order — losslessly: an oversized window's raw rows continue in
 * raw-only parts (src/transport/chunkWindowBatch.js). If a POST fails, the
 * error says how many of the batch's POSTs had already been accepted
 * (`error.sentBatches` / `error.totalBatches`), so a retry is at-least-once.
 */

export class HttpEmotionTransport {
  constructor(options = {}) {
    this.options = {
      baseUrl: '',
      endpointForSession: sessionId => `/api/sessions/${encodeURIComponent(sessionId)}/emotions/batch`,
      tokenProvider: () => null,
      fetchImpl: (...args) => fetch(...args),
      validate: true,
      validationOptions: {},
      maxPostBytes: DEFAULT_MAX_POST_BYTES,
      ...options,
    };
  }

  async send(events, context = {}) {
    if (!events.length) return;
    if (!context.session_id) throw new Error('session_id is required to send emotion events.');

    const batches = chunkWindowBatch(events, {
      maxBytes: this.options.maxPostBytes,
      schemaVersion: OYON_WINDOW_BATCH_SCHEMA_VERSION,
      maxEvents: this.options.validationOptions?.maxBatchEvents,
      maxRawStreamBytes: this.options.validationOptions?.maxRawStreamBytes,
    });

    if (this.options.validate !== false) {
      const errors = batches.flatMap((batch) => validateEmotionBatch({
        schema_version: OYON_WINDOW_BATCH_SCHEMA_VERSION,
        events: batch,
      }, this.options.validationOptions).errors);
      if (errors.length) {
        throw new Error(`Invalid emotion telemetry: ${errors.join('; ')}`);
      }
    }

    const token = await this.options.tokenProvider?.();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = `${this.options.baseUrl}${this.options.endpointForSession(context.session_id)}`;

    for (let i = 0; i < batches.length; i += 1) {
      const response = await this.options.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          schema_version: OYON_WINDOW_BATCH_SCHEMA_VERSION,
          events: batches[i],
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error(`Emotion telemetry failed: ${response.status} ${text}`);
        error.sentBatches = i;
        error.totalBatches = batches.length;
        throw error;
      }
    }
    return { batches: batches.length };
  }
}
