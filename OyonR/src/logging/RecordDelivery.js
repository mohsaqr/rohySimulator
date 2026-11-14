/**
 * RecordDelivery — hands log events / metrics to their transports without ever
 * losing one quietly, and without letting a failing sink break capture.
 *
 * Per transport it keeps a queue of records not yet written. A write that
 * throws or rejects puts its records back at the head of that queue; they are
 * retried, in order, with the next record (or an explicit `flush()`). One write
 * per transport is in flight at a time, so records reach a sink in the order
 * they were made and a retry never races a newer write.
 *
 * Failures are surfaced, not swallowed: `onError({ error, transport, pending,
 * failures })` is called on every failed write, `console.error` reports the
 * first failure of a run of failures (and `console.info` the recovery), and
 * `status()` gives each transport's pending count, failure count and last
 * error. If a sink stays down long enough for its queue to pass `maxPending`,
 * the oldest records are counted in `lost` and reported — memory is finite,
 * and saying so is better than an unbounded leak.
 */

const DEFAULT_MAX_PENDING = 100000;

export class RecordDelivery {
  /**
   * @param {object} options
   * @param {string} options.method        transport method: 'sendLogs' | 'sendMetrics'
   * @param {string} options.label         for messages: 'log' | 'metric'
   * @param {Array<object>} options.transports
   * @param {(info: object) => void} [options.onError]
   * @param {number} [options.maxPending=100000] records held per transport while it fails
   */
  constructor(options) {
    this.method = options.method;
    this.label = options.label;
    this.onError = typeof options.onError === 'function' ? options.onError : null;
    this.maxPending = Number.isInteger(options.maxPending) && options.maxPending > 0 ? options.maxPending : DEFAULT_MAX_PENDING;
    this.sinks = (options.transports || []).map(transport => ({
      transport, queue: [], inFlight: null, failures: 0, lost: 0, lastError: null, failing: false,
    }));
  }

  /** Queue `records` on every transport and write what can be written now. */
  deliver(records) {
    for (const sink of this.sinks) {
      sink.queue.push(...records);
      this.trim(sink);
      if (!sink.inFlight) this.write(sink);
    }
  }

  /** Retry everything pending; resolves when each transport's write settled. */
  async flush() {
    for (const sink of this.sinks) if (!sink.inFlight && sink.queue.length) this.write(sink);
    await Promise.all(this.sinks.map(sink => sink.inFlight).filter(Boolean));
  }

  /** Per transport: records waiting, failed writes so far, records lost to `maxPending`, last error. */
  status() {
    return this.sinks.map((sink, index) => ({
      index,
      transport: sink.transport?.constructor?.name || 'transport',
      pending: sink.queue.length,
      failures: sink.failures,
      lost: sink.lost,
      last_error: sink.lastError ? String(sink.lastError?.message || sink.lastError) : null,
    }));
  }

  get pending() {
    return this.sinks.reduce((n, sink) => n + sink.queue.length, 0);
  }

  write(sink) {
    if (!sink.queue.length) return;
    const fn = sink.transport?.[this.method];
    if (typeof fn !== 'function') { sink.queue = []; return; }
    const batch = sink.queue.splice(0);
    let result;
    try {
      result = fn.call(sink.transport, batch, batch[batch.length - 1]?.context);
    } catch (error) {
      this.failed(sink, batch, error);
      return;
    }
    if (!result || typeof result.then !== 'function') {
      this.succeeded(sink);
      return;
    }
    sink.inFlight = Promise.resolve(result).then(
      () => {
        sink.inFlight = null;
        this.succeeded(sink);
        // Records that arrived during the write go now.
        if (sink.queue.length) this.write(sink);
      },
      (error) => {
        sink.inFlight = null;
        this.failed(sink, batch, error);
      },
    );
  }

  succeeded(sink) {
    if (sink.failing) {
      sink.failing = false;
      if (typeof console !== 'undefined') console.info(`[oyon] ${this.label} transport recovered; pending records written`);
    }
  }

  failed(sink, batch, error) {
    sink.queue.unshift(...batch);
    this.trim(sink);
    sink.failures += 1;
    sink.lastError = error;
    if (!sink.failing) {
      sink.failing = true;
      if (typeof console !== 'undefined') {
        console.error(`[oyon] ${this.label} transport write failed; ${sink.queue.length} record(s) kept for retry`, error);
      }
    }
    if (this.onError) {
      try {
        this.onError({ error, transport: sink.transport, pending: sink.queue.length, failures: sink.failures, lost: sink.lost });
      } catch (handlerError) {
        if (typeof console !== 'undefined') console.error(`[oyon] ${this.label} onTransportError handler threw`, handlerError);
      }
    }
  }

  trim(sink) {
    const over = sink.queue.length - this.maxPending;
    if (over <= 0) return;
    sink.queue.splice(0, over);
    sink.lost += over;
    if (typeof console !== 'undefined') {
      console.error(`[oyon] ${this.label} transport has been failing; ${sink.lost} oldest record(s) no longer held (maxPending ${this.maxPending})`);
    }
  }
}
