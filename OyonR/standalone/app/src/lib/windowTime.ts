import type { EmotionWindow } from 'oyon';

type WindowLike = Record<string, unknown>;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseTimeMs(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric != null) return numeric;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function windowEndMs(window: EmotionWindow | WindowLike): number | null {
  return parseTimeMs(window.window_end_ms ?? window.window_end);
}

export function windowStartMs(window: EmotionWindow | WindowLike): number | null {
  return parseTimeMs(window.window_start_ms ?? window.window_start) ?? windowEndMs(window);
}

export function isEmotionWindowLike(value: unknown): value is EmotionWindow {
  if (!value || typeof value !== 'object') return false;
  return windowEndMs(value as WindowLike) != null;
}

export function normalizeEmotionWindow(window: EmotionWindow): EmotionWindow {
  const endMs = windowEndMs(window);
  const startMs = windowStartMs(window);
  if (
    endMs == null ||
    (window.window_end_ms === endMs && window.window_start_ms === startMs)
  ) {
    return window;
  }
  return {
    ...window,
    window_start_ms: startMs ?? endMs,
    window_end_ms: endMs,
  };
}

export function normalizeEmotionWindows(windows: EmotionWindow[]): EmotionWindow[] {
  return windows.filter(isEmotionWindowLike).map(normalizeEmotionWindow);
}
