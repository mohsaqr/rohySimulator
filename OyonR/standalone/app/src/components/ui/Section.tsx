import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/*
 * <Section> is the page-level grouping primitive. It establishes the
 * "Summary → Trend → Structure → Drill-down → Export" rhythm we use on
 * every analytic page. Each Section has an id so an in-page TOC can link
 * to it on long Analyze pages.
 */

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  id: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function Section({
  id,
  title,
  description,
  actions,
  className,
  children,
  ...rest
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn('flex flex-col gap-3 scroll-mt-20', className)}
      aria-labelledby={`${id}-title`}
      {...rest}
    >
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2
            id={`${id}-title`}
            className="m-0 text-sm font-semibold tracking-tight text-ink-0"
          >
            {title}
          </h2>
          {description ? (
            <p className="m-0 text-xs text-ink-2">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
