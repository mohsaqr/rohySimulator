import { useEffect, useRef } from 'react';
import { useRuntime } from '@/lib/RuntimeProvider';

/*
 * LiveGazeHeatmap — opt-in, in-tab-only attention heatmap.
 *
 * PRIVACY: this is purely local visualization. Raw gaze points are
 * accumulated into an in-memory density grid that lives for the lifetime
 * of this component and is cleared on unmount / toggle-off. Nothing here
 * is persisted to storage or sent anywhere — the egress contract
 * (validateEmotionPayload + the transport payload) is unchanged and still
 * aggregate-only. WebGazer-demo-style live heatmap WITHOUT relaxing the
 * privacy boundary, because display ≠ egress.
 *
 * Consumes the same useRuntime().lastGaze stream the cursor uses, so it
 * works with the real adapter and the synthetic mock stream identically.
 */

export interface LiveGazeHeatmapProps {
  /** When false the component renders nothing and holds no buffer. */
  active: boolean;
  width?: number;
  height?: number;
}

// Coarse accumulation grid (16:9). Coarse on purpose: a heatmap of where
// attention pooled, not a per-pixel reconstruction.
const GRID_W = 64;
const GRID_H = 36;
// Per-frame multiplicative decay so the map shows *recent* attention and
// never saturates to a solid blob over a long session.
const DECAY = 0.985;
// Gaussian splat radius in grid cells.
const SPLAT_R = 4;

// Compact viridis-ish ramp (navy → purple → teal → green → yellow).
// Perceptually ordered + colorblind-safe; deliberately not a theme token
// because this is a data colormap, not UI chrome.
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

export function LiveGazeHeatmap({
  active,
  width = 320,
  height = 180,
}: LiveGazeHeatmapProps) {
  const { lastGaze } = useRuntime();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<Float32Array>(new Float32Array(GRID_W * GRID_H));
  const lastTsRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

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
    for (let dy = -SPLAT_R; dy <= SPLAT_R; dy += 1) {
      for (let dx = -SPLAT_R; dx <= SPLAT_R; dx += 1) {
        const cx = Math.round(gx) + dx;
        const cy = Math.round(gy) + dy;
        if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) continue;
        const d2 = dx * dx + dy * dy;
        grid[cy * GRID_W + cx] += weight * Math.exp(-d2 / (2 * (SPLAT_R / 2) ** 2));
      }
    }
  }, [active, lastGaze]);

  // Render + decay loop. Stops (and frees the buffer) when inactive.
  useEffect(() => {
    if (!active) {
      gridRef.current.fill(0);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cellW = width / GRID_W;
    const cellH = height / GRID_H;

    const tick = () => {
      const grid = gridRef.current;
      let max = 0;
      for (let i = 0; i < grid.length; i += 1) {
        grid[i] *= DECAY;
        if (grid[i] > max) max = grid[i];
      }
      ctx.clearRect(0, 0, width, height);
      if (max > 1e-3) {
        for (let gy = 0; gy < GRID_H; gy += 1) {
          for (let gx = 0; gx < GRID_W; gx += 1) {
            const v = grid[gy * GRID_W + gx] / max;
            if (v < 0.04) continue;
            const [r, g, b] = ramp(v);
            ctx.fillStyle = `rgba(${r},${g},${b},${0.18 + 0.62 * v})`;
            ctx.fillRect(gx * cellW, gy * cellH, cellW + 1, cellH + 1);
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      // Drop the accumulated points on teardown — nothing survives.
      gridRef.current.fill(0);
    };
  }, [active, width, height]);

  if (!active) return null;

  return (
    <div
      className="relative overflow-hidden rounded-sm border border-line bg-surface-3"
      style={{ width, height }}
      aria-label="Live attention heatmap (in-tab only)"
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-line/40" />
        <div className="absolute top-1/2 left-0 right-0 h-px bg-line/40" />
      </div>
    </div>
  );
}
