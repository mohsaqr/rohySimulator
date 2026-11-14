import { useEffect, useRef, useState, type RefObject } from 'react';
import { OKABE_ITO } from '@/lib/groupDashboard';
import { stateColourMap } from '@/lib/stateColours';

/*
 * Shared plumbing for the group dashboard's SVG panels: one time axis for
 * every panel (same gutter, same span), the hatch pattern for low-quality
 * spans, and number formatting. Rendering only — no statistics.
 */

/** Left gutter for lane labels; every time-axis panel uses it so marks line up. */
export const GUTTER = 136;
export const PAD_R = 12;

export const PAL = OKABE_ITO;

/** Width of an element, tracked with a ResizeObserver (0 before layout). */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export interface TimeSpan {
  start_s: number;
  end_s: number;
}

/** Seconds → x pixel on the shared axis. */
export function makeX(span: TimeSpan, width: number) {
  const range = Math.max(span.end_s - span.start_s, 1e-9);
  const plot = Math.max(width - GUTTER - PAD_R, 10);
  return (t: number) => GUTTER + ((t - span.start_s) / range) * plot;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

function niceStep(range: number, maxTicks: number) {
  return STEPS.find((s) => range / s <= maxTicks) ?? STEPS[STEPS.length - 1];
}

/** 75 → "1:15"; under a minute stays "45 s". */
export function fmtTime(s: number) {
  if (!Number.isFinite(s)) return '–';
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  if (a < 59.95) return `${sign}${Math.round(a * 10) / 10} s`;
  // Round the total first: 599.8 s is 10:00, not 9:60.
  const total = Math.round(a);
  const m = Math.floor(total / 60);
  const r = total - m * 60;
  return `${sign}${m}:${String(r).padStart(2, '0')}`;
}

export function fmtNum(x: number | null | undefined, digits = 2) {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(digits) : '–';
}

export function fmtPct(x: number | null | undefined) {
  return typeof x === 'number' && Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–';
}

/** Tick marks + labels along the bottom of a panel. */
export function TimeAxis({ span, width, y }: { span: TimeSpan; width: number; y: number }) {
  const x = makeX(span, width);
  const step = niceStep(span.end_s - span.start_s, Math.max(2, Math.floor((width - GUTTER) / 80)));
  const first = Math.ceil(span.start_s / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= span.end_s + 1e-9 && ticks.length < 40; t += step) ticks.push(t);
  return (
    <g className="text-ink-3" fontSize={10}>
      <line x1={GUTTER} x2={width - PAD_R} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.4} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={y} y2={y + 4} stroke="currentColor" strokeOpacity={0.6} />
          <text x={x(t)} y={y + 14} textAnchor="middle" fill="currentColor">{fmtTime(t)}</text>
        </g>
      ))}
    </g>
  );
}

/** Diagonal hatch used for low-quality / sparse spans (flagged, never hidden). */
export function HatchPattern({ id, color = PAL.grey }: { id: string; color?: string }) {
  return (
    <defs>
      <pattern id={id} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={6} height={6} fill={color} fillOpacity={0.12} />
        <line x1={0} y1={0} x2={0} y2={6} stroke={color} strokeWidth={2} strokeOpacity={0.7} />
      </pattern>
    </defs>
  );
}

/** A small categorical palette (Okabe-Ito order) for states, always shown with their text label. */

export function stateColorMap(states: Array<string | null | undefined>): Map<string, string> {
  // The app-wide state colours (lib/stateColours.js), so ribbons match every network.
  return new Map(Object.entries(stateColourMap(states)));
}

/** Panel-level error list: a ladyna verb that refused its input, with its code. */
export function PanelErrors({ errors, panels }: { errors: Array<{ panel: string; code: string; message: string }>; panels: string[] }) {
  const mine = errors.filter((e) => panels.includes(e.panel));
  if (!mine.length) return null;
  return (
    <ul className="m-0 mt-2 list-none space-y-1 p-0 text-xs text-status-bad">
      {mine.map((e, i) => (
        <li key={i}>
          <code>{e.code}</code> — {e.message}
        </li>
      ))}
    </ul>
  );
}
