import { type ReactNode } from 'react';

/*
 * <PageHeader> — every routed view starts with one of these. The breadcrumb
 * slot is filled by nested routes (e.g. Analyze · Affect).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="space-y-1">
        {eyebrow ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-ink-0">
          {title}
        </h1>
        {description ? (
          <p className="m-0 max-w-2xl text-sm text-ink-2">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
