import { useEffect, useRef } from 'react';
import type { FaceSampleSnapshot } from '@/lib/runtime';

/*
 * FaceOverlay — transparent canvas absolute-positioned over the camera
 * <video>. Draws the most recent face bbox (normalized [0,1] from
 * MediaPipe) plus a small status corner-tag.
 *
 * The canvas re-paints when `lastFace` changes; useStandaloneRuntime
 * already throttles those updates to ~10 Hz so the canvas paints at a
 * comfortable rate without driving React re-renders harder than needed.
 */

export interface FaceOverlayProps {
  lastFace: FaceSampleSnapshot | null;
  /** Mirror the canvas horizontally because the <video> uses
   *  `transform: scaleX(-1)` (most webcam previews do). */
  mirror?: boolean;
}

export function FaceOverlay({ lastFace, mirror = false }: FaceOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!lastFace?.bbox || !lastFace.facePresent) {
      // Subtle hint when no face — small dashed crosshair at center.
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cssW / 2 - 12, cssH / 2);
      ctx.lineTo(cssW / 2 + 12, cssH / 2);
      ctx.moveTo(cssW / 2, cssH / 2 - 12);
      ctx.lineTo(cssW / 2, cssH / 2 + 12);
      ctx.stroke();
      return;
    }

    const { x, y, width, height } = lastFace.bbox;
    let px = x * cssW;
    const py = y * cssH;
    const pw = width * cssW;
    const ph = height * cssH;
    if (mirror) px = cssW - px - pw;

    // Bounding box.
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(px, py, pw, ph);

    // Corner ticks.
    const t = Math.min(14, pw * 0.18);
    ctx.lineWidth = 3;
    ctx.beginPath();
    // top-left
    ctx.moveTo(px, py + t);
    ctx.lineTo(px, py);
    ctx.lineTo(px + t, py);
    // top-right
    ctx.moveTo(px + pw - t, py);
    ctx.lineTo(px + pw, py);
    ctx.lineTo(px + pw, py + t);
    // bottom-right
    ctx.moveTo(px + pw, py + ph - t);
    ctx.lineTo(px + pw, py + ph);
    ctx.lineTo(px + pw - t, py + ph);
    // bottom-left
    ctx.moveTo(px + t, py + ph);
    ctx.lineTo(px, py + ph);
    ctx.lineTo(px, py + ph - t);
    ctx.stroke();
  }, [lastFace, mirror]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
    />
  );
}
