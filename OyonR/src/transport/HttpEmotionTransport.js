import { validateEmotionBatch } from '../validation/validateEmotionPayload.js';

export class HttpEmotionTransport {
  constructor(options = {}) {
    this.options = {
      baseUrl: '',
      endpointForSession: sessionId => `/api/sessions/${encodeURIComponent(sessionId)}/emotions/batch`,
      tokenProvider: () => null,
      fetchImpl: (...args) => fetch(...args),
      validate: true,
      validationOptions: {},
      ...options,
    };
  }

  async send(events, context = {}) {
    if (!events.length) return;
    if (!context.session_id) throw new Error('session_id is required to send emotion events.');

    if (this.options.validate !== false) {
      const validation = validateEmotionBatch({ events }, this.options.validationOptions);
      if (!validation.ok) {
        throw new Error(`Invalid emotion telemetry: ${validation.errors.join('; ')}`);
      }
    }

    const token = await this.options.tokenProvider?.();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await this.options.fetchImpl(`${this.options.baseUrl}${this.options.endpointForSession(context.session_id)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Emotion telemetry failed: ${response.status} ${text}`);
    }
  }
}
