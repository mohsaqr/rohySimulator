import { type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/*
 * Semantic status pill — five states.
 *   ok    : measured-good (green)
 *   warn  : measured-degraded (orange)
 *   bad   : measured-failed (red)
 *   info  : measured-neutral (blue)
 *   null  : NOT MEASURED / UNKNOWN (neutral gray)
 *
 * The `null` state is load-bearing: per the project's honest-confidence rule
 * (memory: feedback_honest_confidence), we must not fabricate a number when
 * we cannot measure. A null pill renders distinctly so a reader cannot mistake
 * "unknown" for "ok".
 */

/*
 * `shrink-0 max-w-full overflow-hidden` pairs with the `whitespace-nowrap`
 * below, and the three have to be read together.
 *
 * Nowrap is right — "n/a · capture not started" breaking mid-phrase inside a
 * rounded pill looks broken. But nowrap alone makes the pill unshrinkable, and
 * a 157 px pill inside a 157 px KPI tile pushed the whole Live dashboard 54 px
 * wider than a phone.
 *
 * `max-w-full` is what fixes that: the pill may never exceed its container, so
 * the reason ellipsizes instead of overflowing. The full text stays in the DOM
 * for screen readers and in the `title` tooltip.
 *
 * `shrink-0` decides WHEN that clamp bites. Without it the pill is an ordinary
 * shrinkable flex item, so flexbox shaves a fraction of a pixel off it
 * whenever a sibling label wants room — and a 1 px deficit is enough to
 * trigger the ellipsis and swallow four characters of a reason that had space.
 * With it, the pill gives way only when it genuinely cannot fit its container,
 * which is the case the clamp is for.
 */
const pill = cva(
  'inline-flex max-w-full shrink-0 items-center gap-1.5 overflow-hidden rounded-full border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap tabular-nums',
  {
    variants: {
      tone: {
        ok: 'border-status-ok-strong bg-status-ok-dim text-status-ok',
        warn: 'border-status-warn/40 bg-status-warn-dim text-status-warn',
        bad: 'border-status-bad/40 bg-status-bad-dim text-status-bad',
        info: 'border-status-info/40 bg-status-info-dim text-status-info',
        null: 'border-status-null/30 bg-status-null-dim text-status-null italic',
      },
      size: {
        sm: 'h-5 px-1.5 text-micro',
        md: 'h-6',
        lg: 'h-7 px-3 text-sm',
      },
    },
    defaultVariants: { tone: 'info', size: 'md' },
  },
);

type PillBaseProps = ComponentPropsWithoutRef<'span'> & VariantProps<typeof pill>;

export interface StatusPillProps extends PillBaseProps {
  /** Optional leading icon (any ReactNode — typically a lucide-react icon). */
  icon?: ReactNode;
  /** When `tone === 'null'`, render this short reason after the label.
   *  Example: "not calibrated", "sensor offline". */
  reason?: string;
}

export function StatusPill({
  tone,
  size,
  icon,
  reason,
  className,
  children,
  ...rest
}: StatusPillProps) {
  return (
    <span className={cn(pill({ tone, size }), className)} {...rest}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {/* The state itself never truncates — it is the whole point of the pill.
          Only the supplementary reason gives way when space runs out. */}
      <span className="shrink-0">{children}</span>
      {tone === 'null' && reason ? (
        <span className="min-w-0 truncate text-status-null/80" title={reason}>
          · {reason}
        </span>
      ) : null}
    </span>
  );
}
