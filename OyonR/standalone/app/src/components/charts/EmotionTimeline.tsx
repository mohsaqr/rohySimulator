import { useEffect, useRef } from 'react';
import type { EmotionWindow } from 'oyon';
import { emotionColor } from '@/lib/emotionColors';
import { stateOf } from '@/lib/analyzeWindows';

/*
 * EmotionTimeline — horizontal strip plot of the last N windows.
 * Each bar = one window. Color = dominant emotion. Height = dominant
 * probability. Width = uniform. Newest window is on the right.
 *
 * The timeline does not interpolate between windows; that would invent
 * data. Gaps in time appear as gaps in the strip — research-grade honesty
 * about sampling rate is more important than visual smoothness.
 */

export interface EmotionTimelineProps {
  recentWindows: EmotionWindow[];
  /** Height of the strip in CSS pixels. */
  height?: number;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim() || fallback;
}

function dominantProbability(w: EmotionWindow): number {
  const probs = w.probabilities ?? {};
  const values = Object.values(probs).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return values.length ? Math.max(...values) : 0;
}

export function EmotionTimeline({
  recentWindows,
  height = 96,
}: EmotionTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrapper.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const surface0 = readCssVar('--surface-0', '#ffffff');
    const ink3 = readCssVar('--ink-3', '#737373');
    const line = readCssVar('--line', 'rgba(0,0,0,0.10)');

    ctx.fillStyle = surface0;
    ctx.fillRect(0, 0, width, height);

    // Baseline.
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 0.5);
    ctx.lineTo(width, height - 0.5);
    ctx.stroke();

    if (recentWindows.length === 0) {
      // Empty-state hint inside the canvas so the layout doesn't reflow.
      ctx.fillStyle = ink3;
      ctx.font = '11px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        'no windows yet — bars appear as capture emits them',
        width / 2,
        height / 2,
      );
      return;
    }

    const padding = 6;
    const usable = width - padding * 2;
    const gap = 2;
    const cap = Math.min(recentWindows.length, 60);
    const slice = recentWindows.slice(recentWindows.length - cap);
    const barWidth = Math.max(2, (usable - gap * (cap - 1)) / cap);

    slice.forEach((w, i) => {
      const conf = dominantProbability(w);
      const barHeight = Math.max(4, conf * (height - 18));
      const x = padding + i * (barWidth + gap);
      const y = height - 4 - barHeight;
      ctx.fillStyle = emotionColor(stateOf(w));
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y, barWidth, barHeight);
    });
    ctx.globalAlpha = 1;

    // Newest label.
    const last = slice[slice.length - 1];
    if (last) {
      ctx.fillStyle = ink3;
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(
        `latest: ${stateOf(last)} · ${(dominantProbability(last) * 100).toFixed(0)}%`,
        width - 6,
        12,
      );
      ctx.textAlign = 'left';
      ctx.fillText(`${cap} window${cap === 1 ? '' : 's'}`, 6, 12);
    }
  }, [recentWindows, height]);

  return (
    <div ref={wrapperRef} className="w-full">
      <canvas ref={canvasRef} aria-label="Emotion timeline" />
    </div>
  );
}
