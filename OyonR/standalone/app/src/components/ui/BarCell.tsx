import { cn } from '@/lib/cn';

/*
 * <BarCell> — a table value with a thin bar under it, so a column of numbers
 * reads at a glance. Display only: the value is drawn as given.
 *
 *   plain       bar from `min` to the value, on a [min, max] track
 *   diverging   bar from the centre (0 by default) toward the value's side,
 *               the centre marked
 *   ref         a thin tick at a reference value (e.g. chance)
 *   range       a [lo, hi] band (e.g. a confidence interval) with the value as a dot
 */
export function BarCell({
  value, text, min = 0, max = 1, diverging = false, centre = 0, refValue, range, colour = '#0072B2', title, className,
}: {
  value: number | null | undefined;
  /** What to print (default: the value with 2 decimals). */
  text?: string;
  min?: number;
  max?: number;
  diverging?: boolean;
  centre?: number;
  /** A reference tick, e.g. chance. */
  refValue?: number | null;
  /** A band behind the value, e.g. a CI. */
  range?: [number, number] | null;
  colour?: string;
  title?: string;
  className?: string;
}) {
  const finite = typeof value === 'number' && Number.isFinite(value);
  const span = max - min || 1;
  const pos = (v: number) => `${(Math.max(0, Math.min(1, (v - min) / span)) * 100).toFixed(2)}%`;
  const label = text ?? (finite ? value.toFixed(2) : '–');
  let bar: { left: string; width: string } | null = null;
  if (finite) {
    if (diverging) {
      const a = Math.min(value, centre);
      const b = Math.max(value, centre);
      bar = { left: pos(a), width: `calc(${pos(b)} - ${pos(a)})` };
    } else if (!range) {
      bar = { left: pos(min), width: pos(value) };
    }
  }
  return (
    <div className={cn('flex min-w-24 flex-col gap-1', className)} title={title}>
      <span className="tabular-nums text-ink-0">{label}</span>
      <div className="relative h-1.5 w-full rounded-full bg-surface-2">
        {range ? (
          <div className="absolute inset-y-0 rounded-full opacity-35" style={{ left: pos(range[0]), width: `calc(${pos(range[1])} - ${pos(range[0])})`, backgroundColor: colour }} />
        ) : null}
        {bar ? <div className="absolute inset-y-0 rounded-full" style={{ ...bar, backgroundColor: colour }} /> : null}
        {finite && range ? (
          <div className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: pos(value), backgroundColor: colour }} />
        ) : null}
        {diverging ? <div className="absolute -inset-y-0.5 w-px bg-ink-3" style={{ left: pos(centre) }} /> : null}
        {typeof refValue === 'number' && Number.isFinite(refValue) ? (
          <div className="absolute -inset-y-1 w-0.5 rounded bg-ink-0" style={{ left: pos(refValue) }} title={`reference ${refValue.toFixed(2)}`} />
        ) : null}
      </div>
    </div>
  );
}
