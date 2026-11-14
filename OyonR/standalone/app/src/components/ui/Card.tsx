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
          /*
           * `min-w-0` is load-bearing, not cosmetic.
           *
           * Grid and flex items default to `min-width: auto`, which floors
           * them at their content's min-content width — so a card holding
           * anything unbreakable (a wide table, a `whitespace-nowrap` row of
           * state chips) refuses to shrink and drags its whole track wider
           * than the viewport. On /analyze/patterns that made a 390 px phone
           * render a 533 px card and scroll the entire dashboard sideways.
           *
           * Setting it here rather than at each grid site fixes the class of
           * bug once: a Card should never be the reason its container
           * overflows. Content that genuinely cannot shrink is then free to
           * scroll INSIDE the card, which is what its own `overflow-x-auto`
           * wrappers already do.
           */
          'min-w-0 rounded-lg border border-line bg-surface-1 shadow-card',
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
    <h2 className={cn('label-eyebrow m-0 text-ink-2', className)} {...props} />
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
