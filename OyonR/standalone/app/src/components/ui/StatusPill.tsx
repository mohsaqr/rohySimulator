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

const pill = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap tabular-nums',
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
        sm: 'h-5 px-1.5 text-[10px]',
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
      <span>{children}</span>
      {tone === 'null' && reason ? (
        <span className="text-status-null/80">· {reason}</span>
      ) : null}
    </span>
  );
}
