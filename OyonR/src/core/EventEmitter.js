export class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(type, handler) {
    const list = this.listeners.get(type) || new Set();
    list.add(handler);
    this.listeners.set(type, list);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type, payload = null) {
    const list = this.listeners.get(type);
    if (!list) return;
    for (const handler of list) {
      try {
        handler(payload);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }
}
