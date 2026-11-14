/**
 * GroupSessionClock — puts n members' laptops on one time axis.
 *
 * Each laptop's `Date.now()` drifts by seconds, which is larger than the
 * 1–5 s lags physiological coupling is measured at. The clock runs the
 * ordinary NTP-style handshake against whoever hosts the group session:
 * send at local `t0`, receive the server's `ts`, note local `t1`; the offset
 * estimate is `ts − (t0 + t1) / 2` and the estimate with the smallest round
 * trip wins, because its error is bounded by RTT / 2.
 *
 * The local timestamp is never rewritten. Consumers stamp `ts_group_ms =
 * ts_ms + offset` BESIDE it and persist `clock_offset_ms` / `clock_rtt_ms`
 * so an analyst can see how good the alignment was.
 *
 * Fallback when there is no server: a facilitator-triggered sync marker —
 * one broadcast event carrying the group time; each client records local
 * receipt (`markSync`). Both paths produce the same offset field, with
 * `clock_source` saying which one was used.
 *
 * Injectable like every other runtime collaborator: pass it as
 * `new EmotionRuntime({ groupClock })`, or set `group_clock_url` in the
 * settings and the runtime builds one with `httpClockSource()`.
 */

/**
 * Best offset from handshake samples: the one with the smallest round trip.
 *
 * @param {Array<{t0:number, ts:number, t1:number}>} samples local send, server time, local receipt (ms)
 * @returns {{ offset_ms:number, rtt_ms:number, n:number } | null}
 */
export function estimateClockOffset(samples) {
  if (!Array.isArray(samples)) return null;
  let best = null;
  let n = 0;
  for (const s of samples) {
    if (!s || !Number.isFinite(s.t0) || !Number.isFinite(s.ts) || !Number.isFinite(s.t1)) continue;
    const rtt = s.t1 - s.t0;
    if (rtt < 0) continue;
    n += 1;
    if (!best || rtt < best.rtt_ms) best = { offset_ms: s.ts - (s.t0 + s.t1) / 2, rtt_ms: rtt };
  }
  return best ? { ...best, n } : null;
}

/**
 * A server-time source over HTTP: GET `url` must answer JSON `{ ts_ms }`
 * (the group hub's `/clock` endpoint does).
 *
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @returns {() => Promise<number>}
 */
export function httpClockSource(url, fetchImpl = globalThis.fetch) {
  if (typeof url !== 'string' || !url) throw new TypeError('httpClockSource: url must be a non-empty string');
  if (typeof fetchImpl !== 'function') throw new TypeError('httpClockSource: no fetch implementation available');
  return async () => {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`clock endpoint answered ${res.status}`);
    const body = await res.json();
    if (!Number.isFinite(body?.ts_ms)) throw new Error('clock endpoint returned no numeric ts_ms');
    return body.ts_ms;
  };
}

export class GroupSessionClock {
  /**
   * @param {object} [options]
   * @param {() => Promise<number>} [options.getServerTime] resolves the server's epoch ms
   * @param {number} [options.resyncMs=60000] re-run the handshake this often while started
   * @param {number} [options.probes=5]       handshakes per sync; the minimum-RTT one wins
   * @param {() => number} [options.now]      local clock (Date.now)
   * @param {{setInterval:Function, clearInterval:Function}} [options.timers]
   * @param {(event:object) => void} [options.onSync] called after each successful sync or marker
   * @param {(error:Error) => void} [options.onError]  called when a sync fails (the old offset is kept)
   */
  constructor(options = {}) {
    this.getServerTime = options.getServerTime || null;
    this.resyncMs = Number.isFinite(options.resyncMs) && options.resyncMs > 0 ? options.resyncMs : 60000;
    this.probes = Number.isInteger(options.probes) && options.probes > 0 ? options.probes : 5;
    this.now = options.now || (() => Date.now());
    this.timers = options.timers || { setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis) };
    this.onSync = options.onSync || null;
    this.onError = options.onError || null;
    this.offsetMs = null;
    this.rttMs = null;
    this.source = null;
    this.syncedAt = null;
    this.syncCount = 0;
    this.failureCount = 0;
    this.lastError = null;
    this._timer = null;
  }

  /**
   * Run `probes` handshakes and adopt the minimum-RTT estimate. A failed
   * sync keeps the previous offset and is reported, not swallowed: it bumps
   * `failureCount`, stores `lastError`, calls `onError`, and resolves to the
   * unchanged snapshot.
   */
  async sync() {
    if (typeof this.getServerTime !== 'function') {
      throw new Error('GroupSessionClock.sync(): no getServerTime source; use markSync() for marker-based alignment');
    }
    const samples = [];
    try {
      for (let i = 0; i < this.probes; i += 1) {
        const t0 = this.now();
        const ts = await this.getServerTime();
        const t1 = this.now();
        samples.push({ t0, ts, t1 });
      }
    } catch (error) {
      this.failureCount += 1;
      this.lastError = error?.message || String(error);
      if (this.onError) this.onError(error);
      return this.snapshot();
    }
    const best = estimateClockOffset(samples);
    if (best) {
      this.offsetMs = best.offset_ms;
      this.rttMs = best.rtt_ms;
      this.source = 'handshake';
      this.syncedAt = this.now();
      this.syncCount += 1;
      if (this.onSync) this.onSync(this.snapshot());
    }
    return this.snapshot();
  }

  /**
   * Marker fallback: the facilitator broadcasts one event carrying the group
   * time; this client records when it arrived locally.
   *
   * @param {{ group_ms:number, local_ms?:number }} marker
   */
  markSync({ group_ms: groupMs, local_ms: localMs = this.now() } = {}) {
    if (!Number.isFinite(groupMs) || !Number.isFinite(localMs)) {
      throw new TypeError('markSync: group_ms and local_ms must be finite numbers');
    }
    this.offsetMs = groupMs - localMs;
    this.rttMs = null;
    this.source = 'marker';
    this.syncedAt = localMs;
    this.syncCount += 1;
    if (this.onSync) this.onSync(this.snapshot());
    return this.snapshot();
  }

  /** Sync now, then every `resyncMs` until stop(). Idempotent. */
  start() {
    if (this._timer || typeof this.getServerTime !== 'function') return Promise.resolve(this.snapshot());
    const first = this.sync();
    this._timer = this.timers.setInterval(() => { this.sync(); }, this.resyncMs);
    return first;
  }

  stop() {
    if (this._timer) this.timers.clearInterval(this._timer);
    this._timer = null;
  }

  /** True once an offset exists (handshake or marker). */
  get synced() {
    return Number.isFinite(this.offsetMs);
  }

  /** Group time for a local epoch ms; null before the first sync. */
  toGroupTime(localMs) {
    return this.synced && Number.isFinite(localMs) ? localMs + this.offsetMs : null;
  }

  /** Local epoch ms for a group time; null before the first sync. */
  toLocalTime(groupMs) {
    return this.synced && Number.isFinite(groupMs) ? groupMs - this.offsetMs : null;
  }

  /** The alignment fields persisted on every window. */
  snapshot() {
    return {
      clock_offset_ms: this.synced ? this.offsetMs : null,
      clock_rtt_ms: Number.isFinite(this.rttMs) ? this.rttMs : null,
      clock_source: this.source,
      clock_synced_at_ms: this.syncedAt,
      clock_sync_failures: this.failureCount,
    };
  }
}
