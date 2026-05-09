export class FallbackEmotionTransport {
  constructor(options = {}) {
    if (!options.transport || typeof options.transport.send !== 'function') {
      throw new Error('FallbackEmotionTransport requires a transport with send(events, context).');
    }

    this.transport = options.transport;
    this.maxFailures = Number.isInteger(options.maxFailures) ? options.maxFailures : 3;
    this.retryOnce = options.retryOnce === true;
    this.onDrop = typeof options.onDrop === 'function' ? options.onDrop : () => {};
    this.onDisabled = typeof options.onDisabled === 'function' ? options.onDisabled : () => {};
    this.onRecovered = typeof options.onRecovered === 'function' ? options.onRecovered : () => {};

    this.failureCount = 0;
    this.disabled = options.disabled === true;
    this.lastError = null;
  }

  async send(events, context = {}) {
    if (!Array.isArray(events) || events.length === 0) {
      return { ok: true, sent: 0, dropped: 0 };
    }

    if (this.disabled) {
      this.drop(events, context, this.lastError || new Error('Oyon transport disabled'));
      return { ok: false, sent: 0, dropped: events.length, disabled: true };
    }

    const first = await this.trySend(events, context);
    if (first.ok) return first;

    if (this.retryOnce && !this.disabled) {
      const second = await this.trySend(events, context);
      if (second.ok) return second;
    }

    this.drop(events, context, first.error);
    return { ok: false, sent: 0, dropped: events.length, error: first.error, disabled: this.disabled };
  }

  reset() {
    const hadFailures = this.failureCount > 0 || this.disabled;
    this.failureCount = 0;
    this.disabled = false;
    this.lastError = null;
    if (hadFailures) this.onRecovered();
  }

  disable(error = new Error('Oyon transport disabled')) {
    this.disabled = true;
    this.lastError = error;
    this.onDisabled({ error, failureCount: this.failureCount });
  }

  async trySend(events, context) {
    try {
      await this.transport.send(events, context);
      if (this.failureCount > 0 || this.disabled) {
        this.failureCount = 0;
        this.disabled = false;
        this.lastError = null;
        this.onRecovered();
      }
      return { ok: true, sent: events.length, dropped: 0 };
    } catch (error) {
      this.failureCount += 1;
      this.lastError = error;
      if (this.maxFailures >= 0 && this.failureCount >= this.maxFailures) {
        this.disabled = true;
        this.onDisabled({ error, failureCount: this.failureCount });
      }
      return { ok: false, error };
    }
  }

  drop(events, context, error) {
    this.onDrop({
      events,
      context,
      error,
      failureCount: this.failureCount,
      disabled: this.disabled,
    });
  }
}
