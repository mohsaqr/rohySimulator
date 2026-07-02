/*
 * Emotion → color map — the SINGLE in-app source of emotion hues.
 *
 * The React shell previously carried two palettes: this one (mirroring
 * standalone/standalone-demo.js) and a separate, darker table inside
 * legacy/dashboard.js (mirroring the frozen standalone/logs-dashboard.js).
 * They were unified onto this map deliberately — see the plan's Stage 1.
 * Consequence: the /analyze legacy-ported charts no longer color-match the
 * frozen :5173 logs.html page; that parity drift was an accepted trade for
 * one consistent palette across /live, /sessions, and /analyze.
 *
 * `insufficient` is kept distinct (carried over from the legacy renderers)
 * so "no usable data" never reads as a real emotion.
 */
export const EMOTION_COLORS: Record<string, string> = {
  neutral: '#94a3b8',
  happy: '#34d399',
  happiness: '#34d399',
  joy: '#34d399',
  surprise: '#fbbf24',
  sad: '#60a5fa',
  sadness: '#60a5fa',
  anger: '#f87171',
  angry: '#f87171',
  fear: '#a78bfa',
  disgust: '#84cc16',
  contempt: '#f472b6',
  insufficient: '#9ca3af',
};

const DEFAULT_COLOR = '#94a3b8';

export function emotionColor(label: string | null | undefined): string {
  if (!label) return DEFAULT_COLOR;
  return EMOTION_COLORS[label.toLowerCase()] ?? DEFAULT_COLOR;
}
