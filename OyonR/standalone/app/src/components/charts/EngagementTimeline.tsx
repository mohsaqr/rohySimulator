import { useEffect, useRef } from 'react';
import type { EmotionWindow } from 'oyon';

/*
 * EngagementTimeline — per-window line chart of focus_score and
 * eye_openness_mean (both already 0..1, so they share one axis). Windows
 * with no engagement block are drawn as gaps, not zeros — same
 * research-honesty stance as EmotionTimeline (don't invent samples).
 *
 * Colors come from the design tokens (focus = status-ok, openness =
 * status-info) so the chart themes with the rest of the app.
 */

export interface EngagementTimelineProps {
  recentWindows: EmotionWindow[];
  height?: number;
}

interface EngagementLike {
  focus_score?: number | null;
  eye_openness_mean?: number | null;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim() || fallback;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function EngagementTimeline({
  recentWindows,
  height = 200,
}: EngagementTimelineProps) {
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
    const focusColor = readCssVar('--status-ok', '#16a34a');
    const opennessColor = readCssVar('--status-info', '#2563eb');

    ctx.fillStyle = surface0;
    ctx.fillRect(0, 0, width, height);

    const padL = 28;
    const padR = 10;
    const padT = 18;
    const padB = 22;
    const plotW = Math.max(1, width - padL - padR);
    const plotH = Math.max(1, height - padT - padB);
    const yOf = (v: number) => padT + (1 - v) * plotH;

    // Gridlines + y labels at 0, 0.5, 1.
    ctx.strokeStyle = line;
    ctx.fillStyle = ink3;
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    for (const g of [0, 0.5, 1]) {
      const y = yOf(g);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
      ctx.fillText(g.toFixed(1), padL - 4, y + 3);
    }

    const series = recentWindows.map((w) => {
      const e = ((w as unknown as { engagement?: EngagementLike }).engagement ??
        null) as EngagementLike | null;
      return {
        focus: e ? num(e.focus_score) : null,
        openness: e ? num(e.eye_openness_mean) : null,
      };
    });
    const withEngagement = series.filter((s) => s.focus != null || s.openness != null);

    if (withEngagement.length === 0) {
      ctx.fillStyle = ink3;
      ctx.font = '11px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        'no engagement data in these windows',
        width / 2,
        height / 2,
      );
      return;
    }

    const n = series.length;
    const xOf = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);

    function drawLine(key: 'focus' | 'openness', color: string) {
      ctx!.strokeStyle = color;
      ctx!.lineWidth = 1.75;
      ctx!.beginPath();
      let pen = false;
      series.forEach((s, i) => {
        const v = s[key];
        if (v == null) {
          pen = false;
          return;
        }
        const x = xOf(i);
        const y = yOf(Math.max(0, Math.min(1, v)));
        if (!pen) {
          ctx!.moveTo(x, y);
          pen = true;
        } else {
          ctx!.lineTo(x, y);
        }
      });
      ctx!.stroke();
    }

    drawLine('focus', focusColor);
    drawLine('openness', opennessColor);

    // Legend.
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = focusColor;
    ctx.fillRect(padL, height - 12, 10, 3);
    ctx.fillStyle = ink3;
    ctx.fillText('focus', padL + 14, height - 8);
    ctx.fillStyle = opennessColor;
    ctx.fillRect(padL + 60, height - 12, 10, 3);
    ctx.fillStyle = ink3;
    ctx.fillText('openness', padL + 74, height - 8);
    ctx.textAlign = 'right';
    ctx.fillText(
      `${withEngagement.length}/${n} windows with engagement`,
      width - padR,
      height - 8,
    );
  }, [recentWindows, height]);

  return (
    <div ref={wrapperRef} className="w-full">
      <canvas ref={canvasRef} aria-label="Engagement timeline" />
    </div>
  );
}
