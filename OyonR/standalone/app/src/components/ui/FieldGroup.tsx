import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/*
 * <FieldGroup> — a labelled band of related controls inside a <Section>.
 *
 * Heart rate has three distinct concerns (what to measure, quality gates,
 * cross-window tracker) and had grown its own sub-headers as bare <p> tags
 * with hand-tuned `mt-4` / `mt-2` margins. That works exactly once: the next
 * section to need sub-headers copies the markup and the two drift. This is
 * that pattern, named, so the spacing is decided in one place.
 */

export interface FieldGroupProps {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function FieldGroup({ label, hint, children, className }: FieldGroupProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div>
        <div className="label-eyebrow text-ink-2">{label}</div>
        {hint ? <div className="text-xs text-ink-3">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}
