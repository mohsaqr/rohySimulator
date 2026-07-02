import { type ReactNode } from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { StatusPill } from './StatusPill';

/*
 * <Metric> — KPI tile. Replaces the .kpi / .stat / .live-stat patterns
 * scattered through standalone/index.html and standalone/logs.html.
 *
 * Renders honest absences:
 *   - value === null  → big neutral "—" with optional reason
 *   - tone === 'null' → status pill stays neutral
 */

export type MetricTone = 'ok' | 'warn' | 'bad' | 'info' | 'null';

export interface MetricProps {
  label: string;
  /** The headline number. Pass `null` when not measurable. */
  value: number | string | null;
  /** Unit label rendered after the value (e.g. "Hz", "ms", "/min"). */
  unit?: string;
  /** Optional sub-label rendered under the value. */
  hint?: string;
  /** Optional status pill rendered in the top-right corner. */
  tone?: MetricTone;
  /** Optional reason string shown when tone === 'null'. */
  reason?: string;
  /** Trend direction relative to a previous window. */
  trend?: 'up' | 'down' | 'flat';
  /** Optional formatter for numeric values. */
  format?: (v: number) => string;
  /** Optional slot for a tiny sparkline / icon on the right. */
  adornment?: ReactNode;
  className?: string;
}

const trendIcon = {
  up: <TrendingUp className="size-3.5" aria-hidden="true" />,
  down: <TrendingDown className="size-3.5" aria-hidden="true" />,
  flat: <Minus className="size-3.5" aria-hidden="true" />,
} as const;

export function Metric({
  label,
  value,
  unit,
  hint,
  tone,
  reason,
  trend,
  format,
  adornment,
  className,
}: MetricProps) {
  const isNull = value === null || value === undefined;
  const displayValue = isNull
    ? '—'
    : typeof value === 'number' && format
      ? format(value)
      : String(value);

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded border border-line bg-surface-0 p-3',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3">
          {label}
        </div>
        {tone ? (
          <StatusPill tone={tone} size="sm" reason={isNull ? reason : undefined}>
            {tone === 'null' ? 'n/a' : tone}
          </StatusPill>
        ) : null}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'text-2xl font-semibold tabular-nums leading-tight',
            isNull ? 'text-ink-3' : 'text-ink-0',
          )}
        >
          {displayValue}
        </span>
        {unit && !isNull ? (
          <span className="text-xs text-ink-2">{unit}</span>
        ) : null}
        {trend ? (
          <span className="ml-auto inline-flex items-center text-ink-3">
            {trendIcon[trend]}
          </span>
        ) : null}
        {adornment ? <span className="ml-auto">{adornment}</span> : null}
      </div>
      {hint ? <div className="text-xs text-ink-3">{hint}</div> : null}
    </div>
  );
}
