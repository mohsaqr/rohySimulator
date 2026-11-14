import { useMemo } from 'react';
import { emotionColor } from '@/lib/emotionColors';

/*
 * AttentionMonitor — ChatOyon's per-window gaze-centroid map, with Oyon's
 * shared emotion palette replacing ChatOyon's single teal hue.
 *
 * Oyon gaze coordinates are centered screen coordinates: [-0.5, 0.5] on
 * both axes, origin at screen center, +x right, +y down. Each mark is an
 * aggregate window, never a raw gaze point:
 *
 *   position  gaze centroid for that window
 *   size      sqrt(n_points), or heart rate in the companion view
 *   colour    dominant emotion for the same window
 *
 * The thirds grid is the same 3x3 reference used by zone_proportions, so the
 * centroid map and the existing gaze panels speak one spatial language.
 */

export interface MonitorPoint {
  /** Centered gaze centroid, -0.5..0.5 in both axes. */
  x: number;
  y: number;
  emotion: string;
  /** Aggregate gaze samples represented by this window. */
  n: number;
  /** Preferred per-window heart rate (tracked, then robust/raw fallback). */
  bpm?: number | null;
  /** ISO window end, used in the tooltip. */
  at: string;
  index: number;
}

export interface AttentionMonitorProps {
  points: MonitorPoint[];
  sizeBy?: 'gazeSamples' | 'heartRate';
}

const WIDTH = 320;
const HEIGHT = 200;
const DOT_MIN = 2;
const DOT_RANGE = 5;
const HR_REFERENCE_BPM = 72;
const HR_REFERENCE_RADIUS = 3.25;
const HR_DOT_MAX = 8;
const HEART_PATH = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

export function AttentionMonitor({
  points,
  sizeBy = 'gazeSamples',
}: AttentionMonitorProps) {
  const { marks, emotions, bpmRange } = useMemo(() => {
    const maxN = Math.max(1, ...points.map((p) => p.n));
    const bpms = points
      .map((p) => p.bpm)
      .filter((bpm): bpm is number => Number.isFinite(bpm));
    const mapped = points.map((p) => ({
      ...p,
      color: emotionColor(p.emotion),
      cx: (clampCentered(p.x) + 0.5) * WIDTH,
      cy: (clampCentered(p.y) + 0.5) * HEIGHT,
      r: sizeBy === 'heartRate'
        ? heartRateRadius(p.bpm)
        : DOT_MIN + DOT_RANGE * Math.sqrt(p.n / maxN),
      heartRateOpacity: heartRateOpacity(p.bpm),
    }));
    return {
      marks: mapped,
      emotions: Array.from(new Set(points.map((p) => p.emotion))).sort(),
      bpmRange: bpms.length > 0
        ? [Math.min(...bpms), Math.max(...bpms)] as const
        : null,
    };
  }, [points, sizeBy]);

  if (points.length === 0) {
    return (
      <p className="m-0 p-4 text-sm text-ink-3">
        {sizeBy === 'heartRate'
          ? 'No windows carry gaze, emotion, and a valid heart-rate estimate yet.'
          : 'No windows carry both a gaze centroid and a dominant emotion yet.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full rounded-md"
        role="img"
        aria-label={`Gaze centroid map: ${points.length} aggregate windows positioned on screen, coloured by emotion, and sized by ${sizeBy === 'heartRate' ? 'heart rate' : 'gaze samples'}`}
      >
        <rect
          x={0.5}
          y={0.5}
          width={WIDTH - 1}
          height={HEIGHT - 1}
          rx={8}
          fill="var(--surface-0)"
          stroke="var(--line)"
        />

        {[1, 2].map((i) => (
          <g key={i} stroke="var(--line)" strokeDasharray="3 3">
            <line x1={(WIDTH / 3) * i} y1={2} x2={(WIDTH / 3) * i} y2={HEIGHT - 2} />
            <line x1={2} y1={(HEIGHT / 3) * i} x2={WIDTH - 2} y2={(HEIGHT / 3) * i} />
          </g>
        ))}

        {marks.map((m) => {
          const title = `${m.emotion} · x ${m.x.toFixed(2)} · y ${m.y.toFixed(2)} · ${sizeBy === 'heartRate' ? `${m.bpm?.toFixed(1)} bpm (${heartRatePosition(m.bpm)})` : `${m.n} gaze points`} · ${formatTime(m.at)}`;
          return sizeBy === 'heartRate'
            ? (
                <path
                  key={`${m.at}-${m.index}`}
                  d={HEART_PATH}
                  transform={`translate(${m.cx} ${m.cy}) scale(${m.r / 10}) translate(-12 -12)`}
                  fill="none"
                  stroke={m.color}
                  strokeOpacity={m.heartRateOpacity}
                  strokeWidth={1.25}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{title}</title>
                </path>
              )
            : (
                <circle
                  key={`${m.at}-${m.index}`}
                  cx={m.cx}
                  cy={m.cy}
                  r={m.r}
                  fill={m.color}
                  fillOpacity={0.42}
                >
                  <title>{title}</title>
                </circle>
              );
        })}

        <text x={6} y={12} fontSize={8} fill="var(--ink-3)">screen top-left</text>
        <text x={WIDTH - 6} y={HEIGHT - 5} fontSize={8} textAnchor="end" fill="var(--ink-3)">
          bottom-right
        </text>
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-mini text-ink-3">
        <span>
          {sizeBy === 'heartRate' && bpmRange
            ? `heart size = BPM · 72 faint reference · ${bpmRange[0].toFixed(0)}–${bpmRange[1].toFixed(0)} observed`
            : 'dot size = sqrt(gaze points)'}
        </span>
        {emotions.map((emotion) => (
          <span key={emotion} className="inline-flex items-center gap-1 capitalize">
            {sizeBy === 'heartRate'
              ? (
                  <svg viewBox="0 0 24 24" className="size-2.5" aria-hidden="true">
                    <path
                      d={HEART_PATH}
                      fill="none"
                      stroke={emotionColor(emotion)}
                      strokeWidth={2}
                    />
                  </svg>
                )
              : (
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: emotionColor(emotion) }}
                    aria-hidden="true"
                  />
                )}
            {emotion}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Fixed 72-BPM anchor: area shrinks below the reference and grows above it.
 * The 40/140 bounds keep a single bad estimate from swallowing the screen.
 */
function heartRateRadius(bpm: number | null | undefined): number {
  if (!Number.isFinite(bpm)) return DOT_MIN;
  const value = Math.max(40, Math.min(140, bpm as number));
  if (value <= HR_REFERENCE_BPM) {
    const fraction = (value - 40) / (HR_REFERENCE_BPM - 40);
    return Math.sqrt(
      DOT_MIN ** 2 + fraction * (HR_REFERENCE_RADIUS ** 2 - DOT_MIN ** 2),
    );
  }
  const fraction = (value - HR_REFERENCE_BPM) / (140 - HR_REFERENCE_BPM);
  return Math.sqrt(
    HR_REFERENCE_RADIUS ** 2
      + fraction * (HR_DOT_MAX ** 2 - HR_REFERENCE_RADIUS ** 2),
  );
}

function heartRatePosition(bpm: number | null | undefined): string {
  if (!Number.isFinite(bpm)) return 'rate unavailable';
  const delta = (bpm as number) - HR_REFERENCE_BPM;
  if (Math.abs(delta) < 0.05) return '72 BPM reference';
  return `${Math.abs(delta).toFixed(1)} BPM ${delta < 0 ? 'below' : 'above'} reference`;
}

/** Near-reference rates recede; larger deviations become easier to see. */
function heartRateOpacity(bpm: number | null | undefined): number {
  if (!Number.isFinite(bpm)) return 0.2;
  const deviation = Math.min(1, Math.abs((bpm as number) - HR_REFERENCE_BPM) / 30);
  return 0.22 + deviation * 0.58;
}

function clampCentered(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-0.5, Math.min(0.5, v));
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : 'time unavailable';
}
