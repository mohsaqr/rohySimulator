import type { EmotionWindow } from 'oyon';
import { windowEndMs } from './windowTime';

export function sessionIdOf(window: EmotionWindow): string {
  const context = (window as unknown as { context?: { session_id?: unknown } }).context;
  return String(window.session_id ?? context?.session_id ?? '__default__');
}

export function stateOf(window: EmotionWindow): string {
  return typeof window.dominant_emotion === 'string' && window.dominant_emotion.trim()
    ? window.dominant_emotion.trim().toLowerCase()
    : 'insufficient';
}

export function sortByWindowTime(windows: EmotionWindow[]): EmotionWindow[] {
  return [...windows].sort((a, b) => (windowEndMs(a) ?? 0) - (windowEndMs(b) ?? 0));
}

export function groupWindowsBySession(windows: EmotionWindow[]): Map<string, EmotionWindow[]> {
  const bySession = new Map<string, EmotionWindow[]>();
  for (const w of sortByWindowTime(windows)) {
    const id = sessionIdOf(w);
    if (!bySession.has(id)) bySession.set(id, []);
    bySession.get(id)!.push(w);
  }
  return bySession;
}

export function buildStateSequences(windows: EmotionWindow[]): Map<string, string[]> {
  const sequences = new Map<string, string[]>();
  for (const [id, ws] of groupWindowsBySession(windows)) {
    sequences.set(id, ws.map(stateOf));
  }
  return sequences;
}

export function topSessionIds(windows: EmotionWindow[], limit = 3): string[] {
  return [...groupWindowsBySession(windows).entries()]
    .sort((a, b) => {
      const bEnd = windowEndMs(b[1][b[1].length - 1]!) ?? 0;
      const aEnd = windowEndMs(a[1][a[1].length - 1]!) ?? 0;
      return bEnd - aEnd;
    })
    .slice(0, limit)
    .map(([id]) => id);
}

export function shannonEntropy(proportions: number[]): number {
  let h = 0;
  for (const p of proportions) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}
