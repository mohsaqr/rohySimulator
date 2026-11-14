import { EventEmitter } from './EventEmitter.js';
import { CameraController } from '../capture/CameraController.js';
import { MediaPipeFaceTracker } from '../inference/MediaPipeFaceTracker.js';
import { OnnxEmotionClassifier } from '../inference/OnnxEmotionClassifier.js';
import { EmotionAggregator } from '../aggregation/EmotionAggregator.js';
import { RawStreamRecorder, affectRow, headRow, rawOnlyEnvelope } from '../aggregation/RawStreamRecorder.js';
import { FaceTrackAssigner } from '../capture/FaceTrackAssigner.js';
import { headPoseFromMatrix } from '../inference/FacialSignalExtractor.js';
import { HttpEmotionTransport } from '../transport/HttpEmotionTransport.js';
import { createOyonSettings, settingsSnapshot } from '../settings/OyonSettings.js';
import { GroupSessionClock, httpClockSource } from './GroupSessionClock.js';

/**
 * MultiFaceCapture — one camera, several people (docs/MULTI_PERSON_RESEARCH.md).
 *
 * An orchestrator beside EmotionRuntime (which stays single-face): the face
 * tracker returns every face (`analyzeAll`), FaceTrackAssigner keeps
 * session-scoped tracks, and each CONFIRMED track gets its own lazily created
 * aggregator + raw-stream recorder. Windows leave per track with
 * `member_id = track_id` (or the researcher's mapping), `track_id` and `seat`,
 * on the same group clock and anchored grid as laptop-per-person capture, so
 * `oyon/group` groupTimeline() reads both setups the same way.
 *
 * Every confirmed track is classified every tick (a 1 Hz tick with ≤ 4 faces
 * is 4 small inferences a second). A confirmed track that is coasting
 * (temporarily unmatched) records a missing sample, so its windows stay
 * honest about the gap.
 *
 * Tracks, not people: nothing here identifies anyone. Map tracks to members
 * with `memberMap` (seating plan) or after the fact.
 */
export class MultiFaceCapture {
  /**
   * @param {object} [options]
   * @param {object} [options.settings] Oyon settings (multi_face_*, aggregate_window_ms, window_anchor_ms, group_clock_url, …)
   * @param {object} [options.camera] / faceTracker / classifier / transport  injectable collaborators
   * @param {object} [options.groupClock]
   * @param {() => object} [options.contextProvider] host context (group_id, session_id, …) — member_id/seat are set per track
   * @param {object|((trackId:string)=>string)} [options.memberMap] track_id → member_id
   */
  constructor(options = {}) {
    this.settings = createOyonSettings(options.settings || {});
    const s = this.settings;
    this.events = new EventEmitter();
    this.camera = options.camera || new CameraController({ ...options.cameraOptions });
    this.faceTracker = options.faceTracker || new MediaPipeFaceTracker({ ...options.mediaPipe, numFaces: s.multi_face_max_faces });
    this.classifier = options.classifier || new OnnxEmotionClassifier(options.onnx);
    this.transport = options.transport || new HttpEmotionTransport({
      maxPostBytes: s.transport_max_post_bytes,
      ...options.transportOptions,
    });
    this.contextProvider = options.contextProvider || (() => ({}));
    this.memberMap = options.memberMap || null;
    this.assigner = options.assigner || new FaceTrackAssigner({
      maxFaces: s.multi_face_max_faces,
      iouGate: s.multi_face_iou_gate,
      confirmHits: s.multi_face_confirm_hits,
      coastMs: s.multi_face_coast_ms,
    });
    this.groupClock = options.groupClock || (s.group_clock_url
      ? new GroupSessionClock({ getServerTime: httpClockSource(s.group_clock_url), resyncMs: s.group_clock_resync_ms, onError: e => this.events.emit('error', e) })
      : null);
    this.pipelines = new Map(); // track_id → { aggregator, raw, seat, lastQuality }
    this.running = false;
    this.timer = null;
  }

  on(type, handler) {
    return this.events.on(type, handler);
  }

  async init() {
    await this.faceTracker.init();
    await this.classifier.init();
  }

  async start() {
    if (this.running) return;
    await this.init();
    await this.camera.start();
    this.running = true;
    if (this.groupClock && typeof this.groupClock.start === 'function') {
      Promise.resolve(this.groupClock.start()).catch(err => this.events.emit('error', err));
    }
    this.events.emit('status', { state: 'running' });
    this._schedule(0);
  }

  async stop() {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.groupClock && typeof this.groupClock.stop === 'function') this.groupClock.stop();
    const finals = [];
    for (const [trackId, p] of this.pipelines) {
      const w = p.aggregator.flush();
      if (w) finals.push(this._decorate(trackId, p, w, { drainAll: true }));
      // Rows no final window carried leave in a raw-only envelope.
      const rest = this._rawOnly(trackId, p, p.raw.drain(), 'stop');
      if (rest) finals.push(rest);
    }
    if (finals.length) await this._send(finals);
    if (typeof this.camera.stop === 'function') this.camera.stop();
    this.events.emit('status', { state: 'stopped' });
  }

  _schedule(delay = this.settings.sample_interval_ms) {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      try { await this.sampleOnce(); } catch (err) { this.events.emit('error', err); }
      this._schedule();
    }, delay);
  }

  /** One tick: detect all faces, associate, classify confirmed tracks, aggregate. */
  async sampleOnce() {
    const now = Date.now();
    const video = this.camera.video;
    const faces = video && video.readyState >= 2 ? await this.faceTracker.analyzeAll(video, now) : [];
    const assigned = this.assigner.update(faces.filter(f => f && f.facePresent !== false), now);
    const seen = new Set();
    const completed = [];
    for (const a of assigned) {
      if (a.status !== 'confirmed') continue;
      seen.add(a.track_id);
      const p = this._pipeline(a.track_id);
      p.seat = a.seat;
      const prediction = await this.classifier.classify(video, { bbox: a.face.bbox, landmarks: a.face.landmarks });
      p.raw.record('affect', now, affectRow(prediction));
      const pose = headPoseFromMatrix(a.face.transformationMatrix);
      if (pose) p.raw.record('head', now, headRow(pose));
      p.raw.record('track', now, {
        x: a.face.bbox.x, y: a.face.bbox.y, width: a.face.bbox.width, height: a.face.bbox.height, iou: a.iou,
      });
      const w = p.aggregator.addSample({
        timestamp: now,
        facePresent: true,
        probabilities: prediction.probabilities,
        valence: prediction.valence,
        arousal: prediction.arousal,
        confidence: prediction.confidence,
        entropy: prediction.entropy,
        quality: a.face.quality,
        model: prediction.model,
      });
      if (w) completed.push(this._decorate(a.track_id, p, w));
    }
    // Confirmed tracks that are coasting this tick: an honest missing sample.
    for (const t of this.assigner.status()) {
      if (t.status !== 'confirmed' || seen.has(t.track_id)) continue;
      const p = this._pipeline(t.track_id);
      p.raw.record('affect', now, affectRow(null));
      const w = p.aggregator.addSample({ timestamp: now, facePresent: false, quality: { reason: 'track-coasting' } });
      if (w) completed.push(this._decorate(t.track_id, p, w));
    }
    // Tracks that died: flush what they had.
    const live = new Set(this.assigner.status().map(t => t.track_id));
    for (const [trackId, p] of this.pipelines) {
      if (live.has(trackId)) continue;
      const w = p.aggregator.flush(now);
      if (w) completed.push(this._decorate(trackId, p, w, { drainAll: true }));
      const rest = this._rawOnly(trackId, p, p.raw.drain(), 'track_ended');
      if (rest) completed.push(rest);
      this.pipelines.delete(trackId);
    }
    this.events.emit('tracks', { ts_ms: now, ts_group_ms: this._groupTime(now), tracks: this.assigner.status() });
    if (completed.length) await this._send(completed);
  }

  _pipeline(trackId) {
    let p = this.pipelines.get(trackId);
    if (!p) {
      const aggregator = new EmotionAggregator({
        windowMs: this.settings.aggregate_window_ms,
        minValidFrames: this.settings.min_valid_frames,
        sampleIntervalMs: this.settings.sample_interval_ms,
        windowAnchorMs: Number.isFinite(this.settings.window_anchor_ms) ? () => this._anchorLocal() : undefined,
      });
      // Lossless: a stream at the row bound is sent early, raw-only.
      const raw = new RawStreamRecorder({ clock: this.groupClock, onFull: () => this._spill(trackId) });
      p = { aggregator, raw, seat: null };
      this.pipelines.set(trackId, p);
    }
    return p;
  }

  _memberId(trackId) {
    if (typeof this.memberMap === 'function') return this.memberMap(trackId) || trackId;
    if (this.memberMap && typeof this.memberMap === 'object' && this.memberMap[trackId]) return this.memberMap[trackId];
    return trackId;
  }

  /** Rows before the window's end (all of them on stop / track end); later rows wait for the next window. */
  _drainFor(p, window, drainAll) {
    const end = Date.parse(window?.window_end);
    if (drainAll || !Number.isFinite(end)) return p.raw.drain();
    return p.raw.drain({ before: end, inclusive: !Number.isFinite(this.settings.window_anchor_ms) });
  }

  /** A raw-only envelope for a track's leftover rows, decorated like its windows (null when none). */
  _rawOnly(trackId, p, raw, reason) {
    const envelope = rawOnlyEnvelope(raw, reason);
    if (!envelope) return null;
    const { raw_streams: streams, ...bounds } = envelope;
    return { ...this._decorate(trackId, p, bounds, { raw: streams }) };
  }

  _spill(trackId) {
    const p = this.pipelines.get(trackId);
    if (!p || p.spilling) return;
    p.spilling = true;
    Promise.resolve()
      .then(() => {
        const event = this._rawOnly(trackId, p, p.raw.drain(), 'row_bound');
        return event ? this._send([event]) : null;
      })
      .catch(err => this.events.emit('error', err))
      .finally(() => { p.spilling = false; });
  }

  _decorate(trackId, p, window, options = {}) {
    const raw = options.raw !== undefined ? options.raw : this._drainFor(p, window, options.drainAll === true);
    const snap = this.groupClock && typeof this.groupClock.snapshot === 'function' ? this.groupClock.snapshot() : {};
    const offset = Number.isFinite(snap.clock_offset_ms) ? snap.clock_offset_ms : null;
    return {
      ...window,
      track_id: trackId,
      member_id: this._memberId(trackId),
      seat: p.seat,
      capture_setup: 'one_camera_multi_face',
      ...(raw ? { raw_streams: raw } : {}),
      clock_offset_ms: offset,
      clock_rtt_ms: Number.isFinite(snap.clock_rtt_ms) ? snap.clock_rtt_ms : null,
      clock_source: snap.clock_source ?? null,
      window_anchor_ms: Number.isFinite(this.settings.window_anchor_ms) ? this.settings.window_anchor_ms : null,
      window_start_group_ms: offset === null ? null : Date.parse(window.window_start) + offset,
      window_end_group_ms: offset === null ? null : Date.parse(window.window_end) + offset,
    };
  }

  async _send(windows) {
    const context = this.contextProvider() || {};
    const snapshot = settingsSnapshot(this.settings);
    // Host context first, per-track identity after, so a host-wide member_id
    // can never overwrite the track's.
    const events = windows.map(w => ({
      ...context,
      ...w,
      settings_snapshot: snapshot,
      settings_hash: snapshot.settings_hash,
      capture_mode: 'local-browser',
      consent_version: context.consent_version || 'fer-consent-v1',
    }));
    this.events.emit('window', events);
    await this.transport.send(events, context);
  }

  _groupTime(localMs) {
    return this.groupClock && typeof this.groupClock.toGroupTime === 'function' ? this.groupClock.toGroupTime(localMs) : null;
  }

  _anchorLocal() {
    const anchor = this.settings.window_anchor_ms;
    const local = this.groupClock && typeof this.groupClock.toLocalTime === 'function' ? this.groupClock.toLocalTime(anchor) : null;
    return Number.isFinite(local) ? local : anchor;
  }
}
