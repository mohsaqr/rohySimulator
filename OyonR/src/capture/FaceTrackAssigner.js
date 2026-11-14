/**
 * FaceTrackAssigner — session-scoped face tracks for one camera seeing
 * several people (docs/MULTI_PERSON_RESEARCH.md §4–5).
 *
 * MediaPipe's `faceLandmarks[]` index is not a track id: indices reshuffle on
 * any re-detection (google/mediapipe#1634). Association is ours. Seated
 * faces overlap frame to frame at IoU > 0.8, so greedy IoU matching with a
 * gate (~0.3) is enough — no Kalman filter. Lifecycle follows the SORT
 * convention: a new track is `tentative`, becomes `confirmed` after
 * `confirmHits` consecutive matches, `coasts` while unmatched, and dies after
 * `coastMs` without a match. Track ids are never reused within a session.
 *
 * Tracks, not people: identity is the track. The researcher maps tracks to
 * members (seating plan or post-hoc labels); nothing here enrols anyone.
 * Seats for dyads/triads are derived from the track's mean x position.
 */

/** Intersection-over-union of two `{ x, y, width, height }` boxes (normalised units). */
export function iou(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export class FaceTrackAssigner {
  /**
   * @param {object} [options]
   * @param {number} [options.maxFaces=4]      faces kept per frame, largest first
   * @param {number} [options.iouGate=0.3]     minimum IoU to continue a track
   * @param {number} [options.confirmHits=3]   consecutive matches before a track is confirmed
   * @param {number} [options.coastMs=2000]    unmatched time before a track dies
   * @param {string} [options.prefix='t']      track id prefix
   */
  constructor(options = {}) {
    this.options = { maxFaces: 4, iouGate: 0.3, confirmHits: 3, coastMs: 2000, prefix: 't', ...options };
    this.tracks = [];
    this.nextId = 1;
    this.retired = [];
  }

  /**
   * Associate this frame's faces with tracks.
   *
   * @param {Array<{ bbox: {x,y,width,height} }>} faces  face results (any extra fields pass through)
   * @param {number} ts  frame time (ms)
   * @returns {Array<{ track_id:string, status:'tentative'|'confirmed', seat:string|null, face:object, iou:number|null }>}
   *          one entry per kept face, ordered by track id
   */
  update(faces, ts) {
    const kept = (Array.isArray(faces) ? faces : [])
      .filter(f => f && f.bbox && Number.isFinite(f.bbox.width) && Number.isFinite(f.bbox.height))
      // Largest first; equal sizes left to right, so track births never
      // depend on MediaPipe's (unordered) array index.
      .sort((a, b) => (b.bbox.width * b.bbox.height - a.bbox.width * a.bbox.height) || (a.bbox.x - b.bbox.x) || (a.bbox.y - b.bbox.y))
      .slice(0, this.options.maxFaces);

    // Greedy: highest-IoU (track, face) pairs first, each used once.
    const pairs = [];
    this.tracks.forEach((track, ti) => kept.forEach((face, fi) => {
      const v = iou(track.bbox, face.bbox);
      if (v >= this.options.iouGate) pairs.push({ ti, fi, v });
    }));
    pairs.sort((p, q) => q.v - p.v || p.ti - q.ti || p.fi - q.fi);
    const usedT = new Set(); const usedF = new Set(); const matches = [];
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedF.has(p.fi)) continue;
      usedT.add(p.ti); usedF.add(p.fi); matches.push(p);
    }

    const out = [];
    for (const { ti, fi, v } of matches) {
      const track = this.tracks[ti];
      const face = kept[fi];
      track.bbox = face.bbox;
      track.lastSeen = ts;
      track.hits += 1;
      track.sumX += face.bbox.x + face.bbox.width / 2;
      track.n += 1;
      if (track.status === 'tentative' && track.hits >= this.options.confirmHits) track.status = 'confirmed';
      out.push({ track, face, iou: v });
    }
    kept.forEach((face, fi) => {
      if (usedF.has(fi)) return;
      const track = {
        id: `${this.options.prefix}${this.nextId++}`,
        bbox: face.bbox, born: ts, lastSeen: ts, hits: 1, status: this.options.confirmHits <= 1 ? 'confirmed' : 'tentative',
        sumX: face.bbox.x + face.bbox.width / 2, n: 1,
      };
      this.tracks.push(track);
      out.push({ track, face, iou: null });
    });
    // Unmatched tracks: a tentative track that misses a frame is dropped (it
    // was never confirmed); a confirmed one coasts until coastMs, then dies.
    const matchedIds = new Set(out.map(o => o.track.id));
    this.tracks = this.tracks.filter((track) => {
      if (matchedIds.has(track.id)) return true;
      track.hits = 0;
      const dead = track.status === 'tentative' || ts - track.lastSeen > this.options.coastMs;
      if (dead) this.retired.push({ track_id: track.id, born_ms: track.born, last_seen_ms: track.lastSeen, confirmed: track.status === 'confirmed' });
      return !dead;
    });
    const seats = this.seats();
    return out
      .map(({ track, face, iou: v }) => ({ track_id: track.id, status: track.status, seat: seats[track.id] ?? null, face, iou: v }))
      .sort((a, b) => trackOrder(a.track_id, b.track_id));
  }

  /**
   * Seat labels by mean horizontal position of the confirmed tracks:
   * 2 → left/right, 3 → left/center/right, otherwise seat_1..seat_n left to right.
   * Camera-image left (mirror the labels yourself if the preview is mirrored).
   */
  seats() {
    const confirmed = this.tracks.filter(t => t.status === 'confirmed')
      .map(t => ({ id: t.id, x: t.sumX / t.n }))
      .sort((a, b) => a.x - b.x || trackOrder(a.id, b.id));
    const names = confirmed.length === 2 ? ['left', 'right']
      : confirmed.length === 3 ? ['left', 'center', 'right']
        : confirmed.map((_, i) => `seat_${i + 1}`);
    return Object.fromEntries(confirmed.map((t, i) => [t.id, names[i]]));
  }

  /** Live tracks as a tidy table (one row per track). */
  status() {
    const seats = this.seats();
    return this.tracks.map(t => ({
      track_id: t.id, status: t.status, seat: seats[t.id] ?? null, born_ms: t.born, last_seen_ms: t.lastSeen, frames: t.n,
    }));
  }
}

function trackOrder(a, b) {
  const na = Number(a.replace(/^\D+/, '')); const nb = Number(b.replace(/^\D+/, ''));
  return na - nb || (a < b ? -1 : a > b ? 1 : 0);
}
