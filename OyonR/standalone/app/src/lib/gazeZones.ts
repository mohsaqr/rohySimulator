/*
 * Gaze zone helpers — ported from standalone/logs-dashboard.js so the new
 * Analyze · Gaze view computes coordinates identically to the legacy
 * dashboard. Keep the math byte-for-byte the same; layout changes go in
 * the rendering layer, not here.
 */

import type { EmotionWindow } from 'oyon';

export const NAMED_3x3_ZONES = [
  'top_left',
  'top_center',
  'top_right',
  'middle_left',
  'middle_center',
  'middle_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
] as const;

export type ZoneKey = string;

/** Map a zone key to its center in normalized [-0.5, 0.5] coordinates. */
export function zoneKeyToCenter(
  key: string,
  gridN: number,
): { x: number; y: number } | null {
  const namedIdx = (NAMED_3x3_ZONES as readonly string[]).indexOf(key);
  if (namedIdx >= 0) {
    const row = Math.floor(namedIdx / 3);
    const col = namedIdx % 3;
    return { x: (col + 0.5) / 3 - 0.5, y: (row + 0.5) / 3 - 0.5 };
  }
  const m = /^r(\d+)c(\d+)$/.exec(key);
  if (!m) return null;
  const row = Number(m[1]);
  const col = Number(m[2]);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { x: (col + 0.5) / gridN - 0.5, y: (row + 0.5) / gridN - 0.5 };
}

/** Inverse: bin a centroid back to a zone key. */
export function centroidToZoneKey(
  centroid: { x: number; y: number },
  gridN: number,
): ZoneKey {
  const cx = Math.max(0, Math.min(0.999, centroid.x + 0.5));
  const cy = Math.max(0, Math.min(0.999, centroid.y + 0.5));
  const col = Math.floor(cx * gridN);
  const row = Math.floor(cy * gridN);
  if (gridN === 3) {
    return NAMED_3x3_ZONES[row * 3 + col] ?? `r${row}c${col}`;
  }
  return `r${row}c${col}`;
}

/** Enumerate all zone keys for an N×N grid in row-major order. */
export function enumerateZoneKeys(gridN: number): ZoneKey[] {
  if (gridN === 3) return [...NAMED_3x3_ZONES];
  const out: ZoneKey[] = [];
  for (let r = 0; r < gridN; r += 1)
    for (let c = 0; c < gridN; c += 1) out.push(`r${r}c${c}`);
  return out;
}

/** Infer the grid size used by a set of windows from observed zone keys. */
export function detectGridN(windows: EmotionWindow[]): number {
  let gridN = 3;
  for (const w of windows) {
    const zp = (w.gaze as { zone_proportions?: Record<string, number> } | null)
      ?.zone_proportions;
    if (!zp) continue;
    for (const key of Object.keys(zp)) {
      const m = /^r(\d+)c(\d+)$/.exec(key);
      if (m) gridN = Math.max(gridN, Math.max(Number(m[1]), Number(m[2])) + 1);
    }
  }
  return gridN;
}

/** Filter windows to those that have an aggregate `gaze` block. */
export function windowsWithGaze(windows: EmotionWindow[]): EmotionWindow[] {
  return windows.filter((w) => w.gaze != null && typeof w.gaze === 'object');
}

/** A viridis-like color ramp normalized to t ∈ [0, 1]. */
export function viridisLike(t: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [11, 18, 32]],
    [0.18, [40, 27, 87]],
    [0.4, [33, 145, 140]],
    [0.65, [94, 201, 98]],
    [0.85, [253, 231, 37]],
    [1.0, [255, 240, 200]],
  ];
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i += 1) {
    const stop = stops[i];
    if (!stop) continue;
    if (clamped <= stop[0]) {
      const prev = stops[i - 1];
      if (!prev) break;
      const [t0, c0] = prev;
      const [t1, c1] = stop;
      const u = (clamped - t0) / Math.max(1e-9, t1 - t0);
      const r = Math.round(c0[0] + u * (c1[0] - c0[0]));
      const g = Math.round(c0[1] + u * (c1[1] - c0[1]));
      const b = Math.round(c0[2] + u * (c1[2] - c0[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  const last = stops[stops.length - 1]?.[1];
  return last ? `rgb(${last[0]},${last[1]},${last[2]})` : '#fff';
}
