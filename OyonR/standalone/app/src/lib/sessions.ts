import type { EmotionWindow } from 'oyon';
import { deriveFrameQuality } from './frameQuality';
import { sessionIdOf, stateOf } from './analyzeWindows';
import { windowEndMs, windowStartMs } from './windowTime';

/*
 * Session grouping — operates on the flat array of stored windows and
 * returns one row per session_id. Used by /sessions and (Phase D) by
 * comparison mode.
 */

export interface SessionSummary {
  sessionId: string;
  windowCount: number;
  windowStart: number;
  windowEnd: number;
  dominantEmotion: string | null;
  dominantShare: number | null;
  meanConfidence: number | null;
  meanValidFrameRatio: number | null;
  meanFocus: number | null;
  hasGaze: boolean;
  meanCalibrationQuality: number | null;
}

function meanOf(
  windows: EmotionWindow[],
  read: (w: EmotionWindow) => number | null | undefined,
): number | null {
  let sum = 0;
  let n = 0;
  for (const w of windows) {
    const v = read(w);
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n ? sum / n : null;
}

function dominantOf(windows: EmotionWindow[]): { label: string | null; share: number | null } {
  const counts = new Map<string, number>();
  for (const w of windows) {
    const label = stateOf(w);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top
    ? { label: top[0], share: top[1] / windows.length }
    : { label: null, share: null };
}

// Memoized on array identity: the FilterBar and the sessions route both
// summarize on every render, and the grouping pass over a large archive is
// not free. react-query's structural sharing keeps array identity stable
// until the data actually changes.
const summaryCache = new WeakMap<EmotionWindow[], SessionSummary[]>();

export function summarizeSessions(windows: EmotionWindow[]): SessionSummary[] {
  const cached = summaryCache.get(windows);
  if (cached) return cached;
  const result = computeSessionSummaries(windows);
  summaryCache.set(windows, result);
  return result;
}

function computeSessionSummaries(windows: EmotionWindow[]): SessionSummary[] {
  const byId = new Map<string, EmotionWindow[]>();
  for (const w of windows) {
    const id = sessionIdOf(w);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push(w);
  }

  const out: SessionSummary[] = [];
  for (const [id, ws] of byId) {
    const ends = ws.map((w) => windowEndMs(w) ?? 0);
    const starts = ws.map((w) => windowStartMs(w) ?? windowEndMs(w) ?? 0);
    const dom = dominantOf(ws);
    const meanConf = meanOf(ws, (w) => {
      const probs = w.probabilities ?? {};
      const values = Object.values(probs).filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v),
      );
      return values.length ? Math.max(...values) : null;
    });
    const meanValid = meanOf(ws, (w) => deriveFrameQuality(w).ratio);
    const meanFocus = meanOf(ws, (w) => {
      const e = w.engagement as { focus_score?: number | null } | null;
      return e?.focus_score ?? null;
    });
    const hasGaze = ws.some((w) => w.gaze != null);
    const meanCalQ = meanOf(ws, (w) => {
      const g = w.gaze as { calibration_quality?: number | null } | null;
      return g?.calibration_quality ?? null;
    });
    out.push({
      sessionId: id,
      windowCount: ws.length,
      windowStart: Math.min(...starts),
      windowEnd: Math.max(...ends),
      dominantEmotion: dom.label,
      dominantShare: dom.share,
      meanConfidence: meanConf,
      meanValidFrameRatio: meanValid,
      meanFocus,
      hasGaze,
      meanCalibrationQuality: meanCalQ,
    });
  }
  // Newest first.
  return out.sort((a, b) => b.windowEnd - a.windowEnd);
}
