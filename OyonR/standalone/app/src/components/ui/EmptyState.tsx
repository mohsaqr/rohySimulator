import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/*
 * <EmptyState> — every "no data yet" surface in the app. Per the Tier-7
 * acceptance criteria, every empty state must suggest one next action; the
 * `action` slot is required by convention (not by the type system, so research
 * stubs can still render an empty empty-state).
 */

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded border border-dashed border-line bg-surface-1 p-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="text-ink-3" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <div className="text-sm font-medium text-ink-1">{title}</div>
        {description ? (
          <div className="text-xs text-ink-3 max-w-md">{description}</div>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
