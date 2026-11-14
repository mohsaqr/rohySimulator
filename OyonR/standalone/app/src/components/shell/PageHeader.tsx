import { type ReactNode } from 'react';

/*
 * <PageHeader> — one compact line per routed view.
 *
 * This used to be a three-line block (eyebrow / 2xl title / description
 * paragraph) stacked under two navigation bars, which put the first pixel of
 * real content 319 px down a 960 px viewport — a third of the screen spent
 * before anything is shown. It was also the only band in that stack that was
 * purely decorative: the nav, the scope bar and the domain tabs are all
 * interactive; this was a label.
 *
 * So: title and description share one row, the eyebrow is gone (the primary
 * nav already highlights which section you are in — repeating it as an H1 with
 * a "Workflow · Step 4" kicker above told the reader nothing new), and the
 * description truncates instead of wrapping to a second line.
 *
 * The H1 stays an H1. It is visually quiet now, but it is still the document
 * heading a screen reader jumps to; demoting it to a <div> would break
 * heading-order navigation to save nothing.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    /*
     * Wraps below `md`. The action cluster on Live is 261 px of buttons ("Test
     * typing", "Test voice", a status pill) which, beside even a short title,
     * exceeds a 390 px phone — and being `shrink-0` it could neither shrink nor
     * wrap, so it simply ran off the right edge.
     */
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="m-0 shrink-0 text-base font-semibold tracking-tight text-ink-0">
          {title}
        </h1>
        {description ? (
          // Hidden on narrow screens rather than wrapped: on a phone the
          // description is the first thing worth losing, and a wrapped one
          // would reintroduce the second line this change exists to remove.
          <p
            className="m-0 hidden truncate text-xs text-ink-3 md:block"
            title={description}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        // `shrink-0` only from `md`: on a phone the cluster wraps within
        // itself, so a third action adds a line instead of an overflow.
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
