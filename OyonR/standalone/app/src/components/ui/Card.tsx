import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/*
 * <Card> replaces the duplicated .card / .panel classes found across
 * standalone/index.html and standalone/logs.html. Composition order:
 *   <Card>
 *     <CardHeader>
 *       <CardTitle>… <CardMeta>…</CardMeta>
 *       <CardActions>…</CardActions>
 *     </CardHeader>
 *     <CardContent>…</CardContent>
 *   </Card>
 *
 * CardActions sits on the right side of the header — that is where every
 * existing card has its toolbar / refresh / export buttons today.
 */

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-lg border border-line bg-surface-1 shadow-card',
          className,
        )}
        {...props}
      />
    );
  },
);

export function CardHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-2.5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'm-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2',
        className,
      )}
      {...props}
    />
  );
}

export function CardMeta({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('text-xs text-ink-3 tabular-nums', className)}
      {...props}
    />
  );
}

export function CardActions({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>{children}</div>
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 border-t border-line px-4 py-2.5',
        className,
      )}
      {...props}
    />
  );
}
