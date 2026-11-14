import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '@/lib/RuntimeProvider';

/*
 * LiveGazeHeatmap — live attention density, rendered in-tab.
 *
 * ON BY DEFAULT. Per the project data policy (CLAUDE.md, "Data policy —
 * research-grade"), derived signal ships by default and is never gated behind
 * an opt-in toggle; consent is handled outside the app. This is also
 * display-only: raw points accumulate into an in-memory density grid for the
 * lifetime of the component and are cleared on unmount. The egress contract
 * (validateEmotionPayload + the transport payload) is untouched and still
 * aggregate-only — display is not egress.
 *
 * Rendering: samples splat into a coarse density grid, which is then drawn
 * through an offscreen bitmap with bilinear upscaling plus a blur pass. The
 * previous version filled one hard-edged rect per grid cell, so the output was
 * visibly a 64x36 checkerboard. Density fields have no cell boundaries in
 * reality; drawing them as blocks reads as low-resolution rather than as the
 * smooth field the data actually describes.
 *
 * Consumes the same useRuntime().lastGaze stream the cursor uses, so the real
 * adapter and the synthetic mock stream behave identically.
 */

export interface LiveGazeHeatmapProps {
  /** When false the component holds no buffer and renders an idle surface. */
  active?: boolean;
  className?: string;
}

// Accumulation grid (16:9). Coarse on purpose — this is where attention
// pooled, not a per-pixel reconstruction — but fine enough that the blur pass
// resolves structure rather than smearing four big cells together.
const GRID_W = 96;
const GRID_H = 54;
// Per-frame multiplicative decay so the map shows *recent* attention and never
// saturates to a solid blob over a long session.
const DECAY = 0.985;
// Gaussian splat radius in grid cells.
const SPLAT_R = 6;
// Blur applied at draw time, in output pixels. Enough to remove cell edges,
// small enough to keep two nearby fixations distinguishable.
const BLUR_PX = 10;

// Viridis-ish ramp (navy → blue → teal → green → yellow). Perceptually
// ordered and colorblind-safe; deliberately not a theme token because this is
// a data colormap, not UI chrome.
const RAMP: Array<[number, number, number]> = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[Math.min(RAMP.length - 1, i + 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function LiveGazeHeatmap({ active = true, className }: LiveGazeHeatmapProps) {
  const { lastGaze } = useRuntime();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<Float32Array>(new Float32Array(GRID_W * GRID_H));
  const lastTsRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const countRef = useRef(0);
  const [sampleCount, setSampleCount] = useState(0);

  // Splat each NEW sample into the accumulation grid. Keyed on ts so a
  // re-render without a new sample doesn't double-count.
  useEffect(() => {
    if (!active || !lastGaze) return;
    if (lastGaze.ts === lastTsRef.current) return;
    lastTsRef.current = lastGaze.ts;
    // Normalized [-0.5, 0.5] → grid cell.
    const gx = (0.5 + lastGaze.x) * (GRID_W - 1);
    const gy = (0.5 + lastGaze.y) * (GRID_H - 1);
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return;
    const weight = 0.4 + 0.6 * Math.max(0, Math.min(1, lastGaze.quality));
    const grid = gridRef.current;
    const sigma2 = 2 * (SPLAT_R / 2) ** 2;
    for (let dy = -SPLAT_R; dy <= SPLAT_R; dy += 1) {
      for (let dx = -SPLAT_R; dx <= SPLAT_R; dx += 1) {
        const cx = Math.round(gx) + dx;
        const cy = Math.round(gy) + dy;
        if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) continue;
        grid[cy * GRID_W + cx] += weight * Math.exp(-(dx * dx + dy * dy) / sigma2);
      }
    }
    countRef.current += 1;
  }, [active, lastGaze]);

  // Surface the running count at a human rate — the sample stream is ~30 Hz
  // and re-rendering the label that often is pure waste.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setSampleCount(countRef.current), 400);
    return () => window.clearInterval(id);
  }, [active]);

  // Render + decay loop. Stops (and frees the buffer) when inactive.
  useEffect(() => {
    if (!active) {
      gridRef.current.fill(0);
      countRef.current = 0;
      setSampleCount(0);
      return;
    }
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // The density field is rasterised once at grid resolution, then scaled up
    // by the GPU with bilinear filtering — far smoother (and cheaper) than
    // painting GRID_W*GRID_H rects every frame.
    const off = document.createElement('canvas');
    off.width = GRID_W;
    off.height = GRID_H;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    const image = offCtx.createImageData(GRID_W, GRID_H);

    let cssW = 0;
    let cssH = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cssW = wrapper.clientWidth;
      cssH = wrapper.clientHeight;
      if (cssW <= 0 || cssH <= 0) return;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper);

    const tick = () => {
      const grid = gridRef.current;
      let max = 0;
      for (let i = 0; i < grid.length; i += 1) {
        grid[i] *= DECAY;
        if (grid[i] > max) max = grid[i];
      }

      if (cssW > 0 && cssH > 0) {
        ctx.clearRect(0, 0, cssW, cssH);
        if (max > 1e-3) {
          const data = image.data;
          for (let i = 0; i < grid.length; i += 1) {
            const v = grid[i] / max;
            const p = i * 4;
            if (v < 0.03) {
              data[p + 3] = 0;
              continue;
            }
            const [r, g, b] = ramp(v);
            data[p] = r;
            data[p + 1] = g;
            data[p + 2] = b;
            // Ease the alpha so faint tails fade out instead of ending on a
            // hard threshold edge.
            data[p + 3] = Math.round(255 * Math.min(1, 0.15 + 0.85 * v * v));
          }
          offCtx.putImageData(image, 0, 0);
          ctx.save();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.filter = `blur(${BLUR_PX}px)`;
          ctx.drawImage(off, 0, 0, cssW, cssH);
          ctx.restore();
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      // Drop the accumulated points on teardown — nothing survives.
      gridRef.current.fill(0);
    };
  }, [active]);

  return (
    <div className={className}>
      <div
        ref={wrapperRef}
        className="relative h-full w-full overflow-hidden rounded-md border border-line bg-[#0d1117]"
        aria-label="Live attention heatmap (in-tab only)"
      >
        <canvas ref={canvasRef} className="absolute inset-0 block" />

        {/* Rule-of-thirds guides: a reference frame for "where on screen",
            which a bare rectangle does not give you. */}
        <div className="pointer-events-none absolute inset-0">
          {[1 / 3, 2 / 3].map((f) => (
            <div key={`v${f}`} className="absolute top-0 bottom-0 w-px bg-white/[0.06]" style={{ left: `${f * 100}%` }} />
          ))}
          {[1 / 3, 2 / 3].map((f) => (
            <div key={`h${f}`} className="absolute left-0 right-0 h-px bg-white/[0.06]" style={{ top: `${f * 100}%` }} />
          ))}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/[0.10]" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-white/[0.10]" />
        </div>

        {/* Legend + live count */}
        <div className="pointer-events-none absolute inset-x-3 bottom-2.5 flex items-center gap-2">
          <span className="label-eyebrow text-white/45">low</span>
          <span
            className="h-1.5 w-24 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${RAMP.map(
                ([r, g, b], i) => `rgb(${r},${g},${b}) ${(i / (RAMP.length - 1)) * 100}%`,
              ).join(', ')})`,
            }}
          />
          <span className="label-eyebrow text-white/45">high</span>
          <span className="ml-auto text-micro tabular-nums text-white/45">
            {sampleCount.toLocaleString()} pts · recent-weighted
          </span>
        </div>

        {sampleCount === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-xs leading-relaxed text-white/45">
            Waiting for gaze samples — start the camera, or use “Demo gaze
            stream” in the Live gaze card.
          </div>
        )}
      </div>
    </div>
  );
}
