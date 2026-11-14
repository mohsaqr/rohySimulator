import { useMemo, type CSSProperties } from 'react';
import { extent } from '@/lib/extent';

/*
 * Small dependency-free SVG charts for the sensing analytics screens (Position
 * and Heart rate). Themed with the app's CSS variables; responsive via viewBox
 * (width 100%). Deliberately minimal — no chart lib.
 *
 * Primitives:
 *   LineChart  — multi-series time series
 *   BarChart   — horizontal bars (e.g. mean action units)
 *   OrientationDensity — binned yaw × pitch occupancy with a compact summary
 *                        of typical yaw, pitch, roll and screen-facing coverage.
 *   Heatstrip  — feature x window matrix; keeps the temporal structure that a
 *                "session mean" bar chart throws away.
 *   Histogram  — value distribution (e.g. BPM spread).
 */

export interface Series {
  name: string;
  color: string;
  values: Array<number | null>;
}

interface LineChartProps {
  series: Series[];
  height?: number;
  /** Force a y-domain; otherwise derived from the data with a little padding. */
  yDomain?: [number, number];
  /** Draw a reference line (e.g. 0 for signed angles). */
  zeroLine?: boolean;
  formatY?: (v: number) => string;
  unit?: string;
}

const PAD = { top: 10, right: 12, bottom: 18, left: 40 };
const W = 720; // internal coordinate width; scales to container

function niceDomain(series: Series[], forced?: [number, number]): [number, number] {
  if (forced) return forced;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (const v of s.values) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

export function LineChart({ series, height = 220, yDomain, zeroLine, formatY, unit }: LineChartProps) {
  const H = height;
  const n = Math.max(1, ...series.map((s) => s.values.length));
  const [lo, hi] = useMemo(() => niceDomain(series, yDomain), [series, yDomain]);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  const ticks = useMemo(() => {
    const out: number[] = [];
    const steps = 4;
    for (let k = 0; k <= steps; k += 1) out.push(lo + ((hi - lo) * k) / steps);
    return out;
  }, [lo, hi]);

  const fmt = formatY ?? ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)));

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
        {/* gridlines + y labels */}
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} opacity={0.5} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">{fmt(t)}</text>
          </g>
        ))}
        {zeroLine && lo < 0 && hi > 0 && (
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        )}
        {/* series polylines (nulls break the line) */}
        {series.map((s) => {
          const segs: string[] = [];
          let cur: string[] = [];
          s.values.forEach((v, i) => {
            if (typeof v === 'number' && Number.isFinite(v)) {
              cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
            } else if (cur.length) { segs.push(cur.join(' ')); cur = []; }
          });
          if (cur.length) segs.push(cur.join(' '));
          return segs.map((pts, si) => (
            <polyline key={`${s.name}-${si}`} points={pts} fill="none" stroke={s.color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          ));
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
        {series.map((s) => (
          <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-2)' }}>
            <span style={{ width: 10, height: 3, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.name}
          </span>
        ))}
        {unit && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 'auto' }}>{unit}</span>}
      </div>
    </div>
  );
}

interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarDatum[];
  /** Upper bound of the value axis (bars are value/max wide). Default = data max. */
  max?: number;
  formatValue?: (v: number) => string;
  color?: string;
}

interface OrientationDensityProps {
  yaw: Array<number | null>;
  pitch: Array<number | null>;
  roll: Array<number | null>;
  /** Maximum rendered width in CSS pixels. */
  maxWidth?: number;
  /** Half-width of the dashed yaw/pitch pose zone, in degrees. */
  facingYawDeg?: number;
  facingPitchDeg?: number;
}

/** A "nice" symmetric axis maximum ≥ v. */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const k = v / mag;
  const step = k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10;
  return step * mag;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function directedDegrees(value: number | null, negative: string, positive: string): string {
  if (value == null) return '—';
  if (Math.abs(value) < 0.05) return '0.0° centred';
  return `${Math.abs(value).toFixed(1)}° ${value < 0 ? negative : positive}`;
}

const ORIENTATION_W = 1120;
const ORIENTATION_H = 470;
const ORIENTATION_PLOT = { x: 66, y: 34, width: 770, height: 360 } as const;
const ORIENTATION_BINS_X = 18;
const ORIENTATION_BINS_Y = 12;

/**
 * OrientationDensity — a readable answer to "where did the head point?"
 *
 * Every usable window contributes to a yaw × pitch bin. Density is encoded by
 * cell darkness, avoiding the overplotting and false temporal continuity of a
 * point cloud or path. Roll is summarized beside the field because it is a
 * third rotation, not a meaningful colour or per-point glyph at this density.
 * Medians describe the typical pose without letting tracking failures pull the
 * marker away from the session's real centre.
 */
export function OrientationDensity({
  yaw,
  pitch,
  roll,
  maxWidth = 1280,
  facingYawDeg = 15,
  facingPitchDeg = 12,
}: OrientationDensityProps) {
  const pts = useMemo(() => {
    const out: Array<{ yaw: number; pitch: number; roll: number | null }> = [];
    const n = Math.max(yaw.length, pitch.length, 1);
    for (let i = 0; i < n; i += 1) {
      const a = yaw[i];
      const b = pitch[i];
      if (typeof a !== 'number' || !Number.isFinite(a)) continue;
      if (typeof b !== 'number' || !Number.isFinite(b)) continue;
      const r = roll[i];
      out.push({ yaw: a, pitch: b, roll: typeof r === 'number' && Number.isFinite(r) ? r : null });
    }
    return out;
  }, [yaw, pitch, roll]);

  const summary = useMemo(() => {
    // Straight ahead remains the fixed origin. The central 95% supplies a
    // useful zoom while excluded tracking extremes are explicitly reported.
    const deviations = pts
      .flatMap((p) => [Math.abs(p.yaw), Math.abs(p.pitch)])
      .sort((a, b) => a - b);
    const index = Math.min(
      Math.max(0, deviations.length - 1),
      Math.floor((deviations.length - 1) * 0.95),
    );
    const span = deviations.length === 0
      ? 5
      : niceCeil(Math.max(5, deviations[index] * 1.1));

    const bins = Array.from(
      { length: ORIENTATION_BINS_X * ORIENTATION_BINS_Y },
      (_, i) => ({ x: i % ORIENTATION_BINS_X, y: Math.floor(i / ORIENTATION_BINS_X), count: 0 }),
    );
    let excluded = 0;
    for (const point of pts) {
      if (Math.abs(point.yaw) > span || Math.abs(point.pitch) > span) {
        excluded += 1;
        continue;
      }
      const bx = Math.min(
        ORIENTATION_BINS_X - 1,
        Math.floor(((point.yaw + span) / (span * 2)) * ORIENTATION_BINS_X),
      );
      // SVG rows run top-to-bottom; pitch degrees run bottom-to-top.
      const by = Math.min(
        ORIENTATION_BINS_Y - 1,
        Math.floor(((span - point.pitch) / (span * 2)) * ORIENTATION_BINS_Y),
      );
      bins[by * ORIENTATION_BINS_X + bx].count += 1;
    }

    const facing = pts.filter((point) => (
      Math.abs(point.yaw) <= facingYawDeg && Math.abs(point.pitch) <= facingPitchDeg
    )).length;

    return {
      span,
      bins,
      maxBin: Math.max(1, ...bins.map((bin) => bin.count)),
      excluded,
      typicalYaw: median(pts.map((point) => point.yaw)),
      typicalPitch: median(pts.map((point) => point.pitch)),
      typicalRoll: median(pts.flatMap((point) => point.roll == null ? [] : [point.roll])),
      facingPct: pts.length ? (facing / pts.length) * 100 : null,
    };
  }, [pts, facingYawDeg, facingPitchDeg]);

  const { span } = summary;
  const px = (deg: number) => (
    ORIENTATION_PLOT.x + ((deg + span) / (span * 2)) * ORIENTATION_PLOT.width
  );
  const py = (deg: number) => (
    ORIENTATION_PLOT.y + ORIENTATION_PLOT.height
      - ((deg + span) / (span * 2)) * ORIENTATION_PLOT.height
  );
  const cellW = ORIENTATION_PLOT.width / ORIENTATION_BINS_X;
  const cellH = ORIENTATION_PLOT.height / ORIENTATION_BINS_Y;
  const axisTicks = [-span, -span / 2, 0, span / 2, span];
  const typicalVisible = summary.typicalYaw != null && summary.typicalPitch != null
    && Math.abs(summary.typicalYaw) <= span && Math.abs(summary.typicalPitch) <= span;
  const facingLeft = px(Math.max(-span, -facingYawDeg));
  const facingRight = px(Math.min(span, facingYawDeg));
  const facingTop = py(Math.min(span, facingPitchDeg));
  const facingBottom = py(Math.max(-span, -facingPitchDeg));
  const sideX = 875;

  return (
    <div style={{ width: '100%', maxWidth, margin: '0 auto' }}>
      <svg
        viewBox={`0 0 ${ORIENTATION_W} ${ORIENTATION_H}`}
        width="100%"
        role="img"
        aria-label={`Head orientation density for ${pts.length} windows; horizontal is yaw and vertical is pitch`}
        style={{ display: 'block' }}
      >
        {/*
          * Cells are clipped to the plot instead of each carrying a corner
          * radius. A density field must read as one continuous surface, so
          * the rounding belongs to the FIELD, not to every bin inside it.
          */}
        <defs>
          <clipPath id="orientation-plot-clip">
            <rect
              x={ORIENTATION_PLOT.x}
              y={ORIENTATION_PLOT.y}
              width={ORIENTATION_PLOT.width}
              height={ORIENTATION_PLOT.height}
              rx={6}
            />
          </clipPath>
        </defs>

        {/*
          * surface-1, not surface-2. The empty field must sit BELOW the
          * faintest occupied cell or it advances in front of the data — at
          * surface-2 the unvisited region read as darker than a one-window
          * bin, inverting the whole encoding.
          */}
        <rect
          x={ORIENTATION_PLOT.x}
          y={ORIENTATION_PLOT.y}
          width={ORIENTATION_PLOT.width}
          height={ORIENTATION_PLOT.height}
          rx={6}
          fill="var(--surface-1)"
        />

        {/* A yaw/pitch tolerance region with a practical meaning, not a decoration. */}
        <rect
          x={facingLeft}
          y={facingTop}
          width={Math.max(0, facingRight - facingLeft)}
          height={Math.max(0, facingBottom - facingTop)}
          fill="var(--status-ok)"
          fillOpacity={0.06}
        />

        {/* Grid UNDER the density, axis labels outside it. */}
        {axisTicks.map((tick) => (
          <g key={`grid-${tick}`}>
            <line
              x1={px(tick)} x2={px(tick)}
              y1={ORIENTATION_PLOT.y} y2={ORIENTATION_PLOT.y + ORIENTATION_PLOT.height}
              stroke="var(--line)" strokeWidth={1} opacity={tick === 0 ? 0.9 : 0.5}
            />
            <line
              x1={ORIENTATION_PLOT.x} x2={ORIENTATION_PLOT.x + ORIENTATION_PLOT.width}
              y1={py(tick)} y2={py(tick)}
              stroke="var(--line)" strokeWidth={1} opacity={tick === 0 ? 0.9 : 0.5}
            />
            <text x={px(tick)} y={ORIENTATION_PLOT.y + ORIENTATION_PLOT.height + 22} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
              {tick > 0 ? '+' : ''}{tick.toFixed(0)}°
            </text>
            <text x={ORIENTATION_PLOT.x - 12} y={py(tick) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)">
              {tick > 0 ? '+' : ''}{tick.toFixed(0)}°
            </text>
          </g>
        ))}

        {/*
          * Contiguous cells — no inset, no per-cell radius. Adjacent bins
          * must fuse into one gradient; the 1px gutter they used to carry
          * broke the field into ~60 floating lozenges and let the background
          * grid show through every seam.
          *
          * A half-pixel overdraw closes the hairline seams that appear when
          * a fractional cell width lands between device pixels.
          *
          * Square-root opacity keeps low-frequency areas visible beside peaks.
          */}
        <g clipPath="url(#orientation-plot-clip)">
          {summary.bins.filter((bin) => bin.count > 0).map((bin) => (
            <rect
              key={`${bin.x}-${bin.y}`}
              x={ORIENTATION_PLOT.x + bin.x * cellW}
              y={ORIENTATION_PLOT.y + bin.y * cellH}
              width={cellW + 0.5}
              height={cellH + 0.5}
              fill="var(--status-info)"
              fillOpacity={0.10 + 0.85 * Math.sqrt(bin.count / summary.maxBin)}
            />
          ))}
        </g>

        <rect
          x={facingLeft}
          y={facingTop}
          width={Math.max(0, facingRight - facingLeft)}
          height={Math.max(0, facingBottom - facingTop)}
          rx={3}
          fill="none"
          stroke="var(--status-ok)"
          strokeOpacity={0.65}
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />

        {/* The robust typical pose is the sole foreground mark. */}
        {typicalVisible && summary.typicalYaw != null && summary.typicalPitch != null && (
          <g transform={`translate(${px(summary.typicalYaw)},${py(summary.typicalPitch)})`}>
            <circle r={10} fill="var(--surface-1)" stroke="var(--ink-0)" strokeWidth={2} />
            <line x1={-16} x2={16} y1={0} y2={0} stroke="var(--ink-0)" strokeWidth={1.5} />
            <line x1={0} x2={0} y1={-16} y2={16} stroke="var(--ink-0)" strokeWidth={1.5} />
            <circle r={3} fill="var(--ink-0)" />
          </g>
        )}

        {/*
          * The pitch title reads UP the y-axis like a conventional axis
          * label, carrying its own direction words. Previously "PITCH" hung
          * detached above the corner while "up"/"down" sat stranded inside
          * the data field, where they read as stray data labels.
          */}
        <text
          transform={`translate(22,${ORIENTATION_PLOT.y + ORIENTATION_PLOT.height / 2}) rotate(-90)`}
          textAnchor="middle" fontSize={11} fontWeight={600} letterSpacing={0.8} fill="var(--ink-2)"
        >
          PITCH · down to up
        </text>
        <text x={ORIENTATION_PLOT.x + ORIENTATION_PLOT.width / 2} y={452} textAnchor="middle" fontSize={11} fontWeight={600} letterSpacing={0.8} fill="var(--ink-2)">YAW · left to right</text>

        <line x1={856} x2={856} y1={34} y2={414} stroke="var(--line)" strokeWidth={1} />
        <text x={sideX} y={57} fontSize={10} fontWeight={600} letterSpacing={0.8} fill="var(--ink-2)">TYPICAL ORIENTATION</text>

        {/*
          * A small head glyph makes roll immediately legible in the summary.
          *
          * The dashed rule is TRUE VERTICAL and deliberately sits outside the
          * rotating group, so the gap between it and the head's own axis IS
          * the roll angle. Without a datum the glyph only implied tilt; with
          * one it can be read. That is also why the smile and the eyebrows
          * went: a face invites you to read mood, and the only quantity here
          * is an angle.
          */}
        <line
          x1={sideX + 108} x2={sideX + 108} y1={70} y2={182}
          stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="3 4"
        />
        <g transform={`translate(${sideX + 108},126) rotate(${summary.typicalRoll ?? 0})`}>
          <path
            d="M-33,-4 C-33,-31 -17,-46 0,-46 C17,-46 33,-31 33,-4 L29,23 C20,40 9,48 0,48 C-9,48 -20,40 -29,23 Z"
            fill="var(--surface-1)" stroke="var(--ink-2)" strokeWidth={1.5} strokeLinejoin="round"
          />
          {/* The head's own axis — the line the datum is compared against. */}
          <line x1={0} x2={0} y1={-40} y2={42} stroke="var(--ink-2)" strokeWidth={1} strokeOpacity={0.35} />
          <circle cx={-12} cy={-6} r={2.5} fill="var(--ink-2)" />
          <circle cx={12} cy={-6} r={2.5} fill="var(--ink-2)" />
        </g>

        {/*
          * One row per rotation, values right-aligned on a shared edge so the
          * three magnitudes can be scanned as a column. They were previously
          * left-aligned at a fixed offset, which ragged the numbers against
          * their trailing direction words ("6.1° right" vs "2.0° left tilt").
          */}
        {([
          ['YAW', directedDegrees(summary.typicalYaw, 'left', 'right')],
          ['PITCH', directedDegrees(summary.typicalPitch, 'down', 'up')],
          ['ROLL', directedDegrees(summary.typicalRoll, 'left tilt', 'right tilt')],
        ] as const).map(([label, value], i) => (
          <g key={label}>
            <text x={sideX} y={205 + i * 34} fontSize={10} fontWeight={600} letterSpacing={0.8} fill="var(--ink-3)">{label}</text>
            <text x={sideX + 216} y={205 + i * 34} textAnchor="end" fontSize={16} fontWeight={600} fill="var(--ink-1)">{value}</text>
          </g>
        ))}

        <rect x={sideX} y={302} width={216} height={72} rx={6} fill="var(--status-ok)" fillOpacity={0.08} />
        <text x={sideX + 14} y={325} fontSize={10} fontWeight={600} letterSpacing={0.8} fill="var(--status-ok)">WITHIN POSE ZONE</text>
        <text x={sideX + 14} y={355} fontSize={24} fontWeight={700} fill="var(--ink-1)">
          {summary.facingPct == null ? '—' : `${summary.facingPct.toFixed(0)}%`}
        </text>
        <text x={sideX + 14} y={369} fontSize={10} fill="var(--ink-3)">yaw/pitch only · ±{facingYawDeg}° / ±{facingPitchDeg}°</text>

        <text x={sideX} y={407} fontSize={10} fill="var(--ink-3)">
          {pts.length} usable windows · central 95% display
        </text>
        <text x={sideX} y={425} fontSize={10} fill="var(--ink-3)">
          {summary.excluded > 0 ? `${summary.excluded} tracking extremes outside view` : 'No tracking extremes outside view'}
        </text>
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>
        <span><strong style={{ color: 'var(--ink-2)' }}>Darker cell</strong> = more windows</span>
        <span><strong style={{ color: 'var(--status-ok)' }}>Green box</strong> = yaw/pitch pose zone</span>
        <span><strong style={{ color: 'var(--ink-1)' }}>Crosshair</strong> = typical yaw and pitch</span>
      </div>
    </div>
  );
}

interface HeatstripProps {
  /** One row per feature; values aligned to the same window index. */
  rows: Array<{ label: string; values: Array<number | null>; color?: string }>;
  /** Upper bound of the intensity scale. Default = max across all rows. */
  max?: number;
  rowHeight?: number;
  /** Prevent a wide card from magnifying labels and row heights. */
  maxWidth?: number | 'none';
}

/**
 * Heatstrip — a feature x window matrix. For action units this is the chart
 * that matters: a session-mean bar says "smile 0.21", while the strip shows
 * whether that 0.21 was a steady low smile or two bright bursts, and whether
 * brow_furrow lit up in the same windows.
 */
export function Heatstrip({ rows, max, rowHeight = 18, maxWidth = 1000 }: HeatstripProps) {
  const hi = useMemo(() => {
    if (max != null) return max;
    let m = 1e-6;
    for (const r of rows) for (const v of r.values) if (typeof v === 'number' && Number.isFinite(v)) m = Math.max(m, v);
    return m;
  }, [rows, max]);
  const n = Math.max(1, ...rows.map((r) => r.values.length));
  const labelW = 92;
  const gap = 2;
  const H = rows.length * (rowHeight + gap);
  const cellW = (W - labelW) / n;

  return (
    <div style={{ width: '100%', maxWidth: maxWidth === 'none' ? undefined : maxWidth, margin: '0 auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
        {rows.map((r, ri) => {
          const y = ri * (rowHeight + gap);
          const base = r.color ?? 'var(--status-info)';
          return (
            <g key={r.label}>
              <text x={labelW - 8} y={y + rowHeight / 2 + 4} textAnchor="end" fontSize={11} fill="var(--ink-2)">
                {r.label.replace(/_/g, ' ')}
              </text>
              <rect x={labelW} y={y} width={W - labelW} height={rowHeight} fill="var(--surface-2)" rx={2} />
              {r.values.map((v, i) => {
                if (typeof v !== 'number' || !Number.isFinite(v)) return null;
                return (
                  <rect
                    key={i}
                    x={labelW + i * cellW} y={y}
                    width={Math.max(1, cellW - 0.5)} height={rowHeight}
                    fill={base} fillOpacity={Math.max(0, Math.min(1, v / hi))}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>
        <span>windows →</span>
        <span style={{ marginLeft: 'auto' }}>0</span>
        <span style={{ width: 60, height: 8, borderRadius: 2, display: 'inline-block', background: 'linear-gradient(90deg, var(--surface-2), var(--status-info))' }} />
        <span>{hi.toFixed(2)}</span>
      </div>
    </div>
  );
}

interface HistogramProps {
  values: Array<number | null>;
  bins?: number;
  color?: string;
  height?: number;
  formatX?: (v: number) => string;
  /** Draw a labelled reference line (e.g. the tracked mean). */
  marker?: { value: number; label: string } | null;
}

/** Histogram — how spread out a measure is, not just its average. */
export function Histogram({ values, bins = 18, color = 'var(--status-info)', height = 180, formatX, marker }: HistogramProps) {
  const v = useMemo(() => values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)), [values]);
  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { lo, hi, counts } = useMemo(() => {
    if (v.length === 0) return { lo: 0, hi: 1, counts: [] as number[] };
    // One pass; no spread into Math.min/max (argument limit on long series).
    const range = extent(v)!;
    let a = range.min;
    let b = range.max;
    if (a === b) { a -= 1; b += 1; }
    const c = new Array(bins).fill(0);
    for (const x of v) {
      const k = Math.min(bins - 1, Math.floor(((x - a) / (b - a)) * bins));
      c[k] += 1;
    }
    return { lo: a, hi: b, counts: c };
  }, [v, bins]);

  const peak = Math.max(1, ...counts);
  const barW = plotW / Math.max(1, counts.length);
  const fmt = formatX ?? ((x: number) => x.toFixed(0));
  const mx = marker ? PAD.left + ((marker.value - lo) / (hi - lo || 1)) * plotW : null;

  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block' }}>
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--line)" strokeWidth={1} />
        {counts.map((c, i) => {
          const h = (c / peak) * plotH;
          return (
            <rect
              key={i}
              x={PAD.left + i * barW + 0.5} y={PAD.top + plotH - h}
              width={Math.max(1, barW - 1)} height={h}
              fill={color} fillOpacity={0.75} rx={1}
            />
          );
        })}
        {mx != null && (
          <g>
            <line x1={mx} x2={mx} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--ink-1)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={mx + 4} y={PAD.top + 10} fontSize={10} fill="var(--ink-1)">{marker!.label}</text>
          </g>
        )}
        <text x={PAD.left} y={H - 4} fontSize={10} fill="var(--ink-3)">{fmt(lo)}</text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize={10} fill="var(--ink-3)">{fmt(hi)}</text>
      </svg>
    </div>
  );
}

export function BarChart({ data, max, formatValue, color = 'var(--status-info)' }: BarChartProps) {
  const hi = max ?? Math.max(1e-6, ...data.map((d) => d.value));
  const fmt = formatValue ?? ((v: number) => v.toFixed(2));
  const rowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '92px 1fr 44px', alignItems: 'center', gap: 8 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.map((d) => (
        <div key={d.label} style={rowStyle}>
          <span style={{ fontSize: 12, color: 'var(--ink-2)', textAlign: 'right', textTransform: 'capitalize' }}>
            {d.label.replace(/_/g, ' ')}
          </span>
          <span style={{ height: 8, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, (d.value / hi) * 100))}%`, background: d.color ?? color, borderRadius: 4 }} />
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-1)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {fmt(d.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
