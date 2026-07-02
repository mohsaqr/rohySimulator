import { useEffect, useRef } from 'react';
import type { EmotionWindow } from 'oyon';

/*
 * AffectPad — 2-D canvas of the valence/arousal plane.
 *
 *                       arousal +1
 *                            │
 *               anxious     ─┼─    excited
 *                            │
 *   valence -1 ─────────────●───────────── valence +1
 *                            │
 *               depressed   ─┼─    serene
 *                            │
 *                       arousal -1
 *
 * The current window's (valence, arousal) is plotted as the largest dot.
 * The previous N windows fade into a trail so a researcher reading the
 * page sees motion, not just a single point. All values are read directly
 * from the EmotionAggregator output (window.valence / window.arousal).
 *
 * Rendering choice: <canvas> not SVG, because the trail re-paints every
 * window and SVG would churn DOM nodes. The canvas is sized to its CSS
 * box and re-painted as a unit.
 */

export interface AffectPadProps {
  recentWindows: EmotionWindow[];
  size?: number;
}

function valenceOf(w: EmotionWindow): number | null {
  const v = (w as unknown as { valence?: number | null }).valence;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function arousalOf(w: EmotionWindow): number | null {
  const v = (w as unknown as { arousal?: number | null }).arousal;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim() || fallback;
}

export function AffectPad({ recentWindows, size = 280 }: AffectPadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Theme-aware colors.
    const ink2 = readCssVar('--ink-2', '#525252');
    const ink3 = readCssVar('--ink-3', '#737373');
    const line = readCssVar('--line', 'rgba(0,0,0,0.10)');
    const accent = readCssVar('--status-info', '#2563eb');
    const accentStrong = readCssVar('--status-ok-strong', 'rgba(22,163,74,0.45)');

    // Background.
    ctx.clearRect(0, 0, size, size);

    // Grid: cross + outer square.
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();

    // Quadrant labels.
    ctx.fillStyle = ink3;
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('high arousal', size / 2, 12);
    ctx.fillText('low arousal', size / 2, size - 4);
    ctx.save();
    ctx.translate(10, size / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('valence →', 0, 0);
    ctx.restore();
    ctx.fillStyle = ink2;
    ctx.textAlign = 'right';
    ctx.fillText('positive', size - 4, size / 2 - 4);
    ctx.textAlign = 'left';
    ctx.fillText('negative', 4, size / 2 - 4);

    // Plot the trail.
    const pts = recentWindows
      .map((w) => ({ v: valenceOf(w), a: arousalOf(w) }))
      .filter((p): p is { v: number; a: number } => p.v != null && p.a != null);

    if (pts.length === 0) return;

    // Map valence ∈ [-1, +1] → x ∈ [0, size], arousal ∈ [-1, +1] → y inverted.
    const toX = (v: number) => ((v + 1) / 2) * size;
    const toY = (a: number) => ((1 - a) / 2) * size;

    // Trail lines.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = toX(p.v);
      const y = toY(p.a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.globalAlpha = 0.35;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Trail dots (older = smaller + dimmer).
    pts.forEach((p, i) => {
      const t = (i + 1) / pts.length;
      const r = 2 + t * 4;
      const alpha = 0.15 + t * 0.85;
      ctx.beginPath();
      ctx.fillStyle = accent;
      ctx.globalAlpha = alpha;
      ctx.arc(toX(p.v), toY(p.a), r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Latest dot with halo.
    const last = pts[pts.length - 1];
    if (last) {
      ctx.beginPath();
      ctx.fillStyle = accentStrong;
      ctx.arc(toX(last.v), toY(last.a), 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = accent;
      ctx.arc(toX(last.v), toY(last.a), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [recentWindows, size]);

  const hasData = recentWindows.some(
    (w) => valenceOf(w) != null && arousalOf(w) != null,
  );

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="rounded border border-line bg-surface-0"
        aria-label="Valence and arousal scatter plot"
      />
      {!hasData ? (
        <div className="text-xs text-ink-3">
          No valence/arousal samples yet — the current classifier may not emit
          V/A, or capture hasn't started.
        </div>
      ) : null}
    </div>
  );
}
