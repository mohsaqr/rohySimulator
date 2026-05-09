const DEFAULT_MAX_EVENTS = 1000;
const FORBIDDEN_DETAIL_KEYS = ['frame', 'frames', 'image', 'images', 'video', 'blob', 'base64', 'pixels', 'landmarks'];

export class OyonLogger {
  constructor(options = {}) {
    this.options = {
      source: 'oyon',
      maxEvents: DEFAULT_MAX_EVENTS,
      clock: () => new Date(),
      contextProvider: () => ({}),
      transports: [],
      ...options,
    };
    this.events = [];
  }

  debug(eventName, details = {}, context = {}) {
    return this.log('debug', eventName, details, context);
  }

  info(eventName, details = {}, context = {}) {
    return this.log('info', eventName, details, context);
  }

  warn(eventName, details = {}, context = {}) {
    return this.log('warn', eventName, details, context);
  }

  error(eventName, errorOrDetails = {}, context = {}) {
    const details = errorOrDetails instanceof Error
      ? { error_name: errorOrDetails.name, error_message: errorOrDetails.message }
      : errorOrDetails;
    return this.log('error', eventName, details, context);
  }

  log(level, eventName, details = {}, context = {}) {
    const baseContext = this.options.contextProvider?.() || {};
    const event = createLogEvent({
      level,
      event_name: eventName,
      source: this.options.source,
      timestamp: this.options.clock().toISOString(),
      context: { ...baseContext, ...context },
      details,
    });
    this.events.push(event);
    if (this.events.length > this.options.maxEvents) {
      this.events.splice(0, this.events.length - this.options.maxEvents);
    }
    for (const transport of this.options.transports || []) {
      try {
        const result = transport.sendLogs?.([event], event.context);
        result?.catch?.(() => {});
      } catch {
        // Logging must not break capture.
      }
    }
    return event;
  }

  read() {
    return this.events.slice();
  }

  clear() {
    this.events = [];
  }
}

export class LocalLogTransport {
  constructor(options = {}) {
    this.options = {
      storageKey: 'oyon-runtime-events',
      maxEvents: DEFAULT_MAX_EVENTS,
      storage: typeof localStorage !== 'undefined' ? localStorage : null,
      ...options,
    };
    this.memoryEvents = [];
  }

  sendLogs(events) {
    if (!Array.isArray(events) || events.length === 0) return;
    const next = this.read().concat(events).slice(-this.options.maxEvents);
    this.write(next);
  }

  read() {
    if (!this.options.storage) return this.memoryEvents.slice();
    try {
      const parsed = JSON.parse(this.options.storage.getItem(this.options.storageKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  clear() {
    this.memoryEvents = [];
    this.options.storage?.removeItem(this.options.storageKey);
  }

  write(events) {
    this.memoryEvents = events.slice();
    this.options.storage?.setItem(this.options.storageKey, JSON.stringify(this.memoryEvents));
  }
}

export class HttpLogTransport {
  constructor(options = {}) {
    this.options = {
      endpoint: '/api/oyon/logs',
      tokenProvider: () => null,
      fetchImpl: (...args) => fetch(...args),
      ...options,
    };
  }

  async sendLogs(events) {
    if (!Array.isArray(events) || events.length === 0) return;
    const headers = { 'Content-Type': 'application/json' };
    const token = this.options.tokenProvider?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.options.fetchImpl(this.options.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events }),
    });
    if (!response.ok) {
      throw new Error(`Oyon log transport failed: ${response.status}`);
    }
  }
}

export function createLogEvent({ level, event_name, source, timestamp, context = {}, details = {} }) {
  return {
    schema_version: 'oyon-log-v1',
    timestamp,
    level: normalizeLevel(level),
    source,
    event_name,
    context: sanitizeObject(context),
    details: sanitizeObject(details),
  };
}

function normalizeLevel(level) {
  return ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
}

function sanitizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_DETAIL_KEYS.includes(key)) {
      out[key] = '[forbidden]';
    } else if (item instanceof Error) {
      out[key] = { name: item.name, message: item.message };
    } else if (item && typeof item === 'object') {
      out[key] = sanitizeObject(item);
    } else if (typeof item !== 'function' && typeof item !== 'symbol') {
      out[key] = item;
    }
  }
  return out;
}
