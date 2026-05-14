export class LocalEmotionTransport {
  constructor(options = {}) {
    this.options = {
      storageKey: 'rohy-fer-local-events',
      maxEvents: 2000,
      storage: typeof localStorage !== 'undefined' ? localStorage : null,
      ...options,
    };
    this.memoryEvents = [];
  }

  async send(events) {
    if (!Array.isArray(events) || events.length === 0) return;
    const current = this.read();
    const next = current.concat(events).slice(-this.options.maxEvents);
    this.write(next);
  }

  read() {
    if (!this.options.storage) return this.memoryEvents.slice();
    const raw = this.options.storage.getItem(this.options.storageKey);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
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
