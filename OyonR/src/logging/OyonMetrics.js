import { RecordDelivery } from './RecordDelivery.js';

const DEFAULT_MAX_METRICS = 2000;

export class OyonMetricRecorder {
  constructor(options = {}) {
    this.options = {
      source: 'oyon',
      maxMetrics: DEFAULT_MAX_METRICS,
      clock: () => new Date(),
      contextProvider: () => ({}),
      transports: [],
      ...options,
    };
    this.metrics = [];
    // Same delivery contract as OyonLogger: failures reported, unwritten
    // metrics retried, capture never interrupted.
    this.delivery = new RecordDelivery({
      method: 'sendMetrics',
      label: 'metric',
      transports: this.options.transports || [],
      onError: this.options.onTransportError,
      maxPending: this.options.maxPending,
    });
  }

  record(metricName, metricValue, options = {}) {
    if (!Number.isFinite(metricValue)) return null;
    const metric = {
      schema_version: 'oyon-metric-v1',
      timestamp: this.options.clock().toISOString(),
      source: this.options.source,
      metric_name: metricName,
      metric_value: metricValue,
      metric_unit: options.unit || null,
      context: { ...(this.options.contextProvider?.() || {}), ...(options.context || {}) },
      tags: options.tags || {},
    };
    this.metrics.push(metric);
    if (this.metrics.length > this.options.maxMetrics) {
      this.metrics.splice(0, this.metrics.length - this.options.maxMetrics);
    }
    this.delivery.deliver([metric]);
    return metric;
  }

  /** Retry every metric a transport has not written yet; resolves when the writes settle. */
  flush() {
    return this.delivery.flush();
  }

  /** Per transport: metrics waiting to be written, failed writes, metrics lost, last error. */
  deliveryStatus() {
    return this.delivery.status();
  }

  read() {
    return this.metrics.slice();
  }

  clear() {
    this.metrics = [];
  }
}

export class LocalMetricTransport {
  constructor(options = {}) {
    this.options = {
      storageKey: 'oyon-metrics',
      maxMetrics: DEFAULT_MAX_METRICS,
      storage: typeof localStorage !== 'undefined' ? localStorage : null,
      ...options,
    };
    this.memoryMetrics = [];
  }

  sendMetrics(metrics) {
    if (!Array.isArray(metrics) || metrics.length === 0) return;
    const next = this.read().concat(metrics).slice(-this.options.maxMetrics);
    this.write(next);
  }

  read() {
    if (!this.options.storage) return this.memoryMetrics.slice();
    try {
      const parsed = JSON.parse(this.options.storage.getItem(this.options.storageKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  clear() {
    this.memoryMetrics = [];
    this.options.storage?.removeItem(this.options.storageKey);
  }

  write(metrics) {
    this.memoryMetrics = metrics.slice();
    this.options.storage?.setItem(this.options.storageKey, JSON.stringify(this.memoryMetrics));
  }
}

export class HttpMetricTransport {
  constructor(options = {}) {
    this.options = {
      endpoint: '/api/oyon/metrics',
      tokenProvider: () => null,
      fetchImpl: (...args) => fetch(...args),
      ...options,
    };
  }

  async sendMetrics(metrics) {
    if (!Array.isArray(metrics) || metrics.length === 0) return;
    const headers = { 'Content-Type': 'application/json' };
    const token = this.options.tokenProvider?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.options.fetchImpl(this.options.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ metrics }),
    });
    if (!response.ok) {
      throw new Error(`Oyon metric transport failed: ${response.status}`);
    }
  }
}
