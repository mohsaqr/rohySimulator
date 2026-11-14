import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/*
 * MenuPopover — a trigger button plus an anchored panel.
 *
 * This is what lets the app have ONE bar. The chrome used to be five stacked
 * bands (session pills / nav / scope filters / page title / domain tabs),
 * ~194 px of permanent furniture before any content. Everything except the nav
 * itself was information you need occasionally and look at rarely, so it is
 * now behind triggers on the single bar: present, one click away, costing no
 * vertical space until asked for.
 *
 * The panel is NOT a `role="menu"`. That role carries real obligations — every
 * child must be a menuitem, arrow keys must cycle, Tab must exit — and these
 * panels hold checkboxes, a search field and multi-select lists, none of which
 * are menuitems. Claiming the role and then failing its contract is worse for
 * a screen-reader user than an honest group of controls, so the trigger simply
 * expands a labelled region.
 */

export interface MenuPopoverProps {
  label: ReactNode;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
  icon?: ReactNode;
  /** Visually marks the trigger as the current section. */
  active?: boolean;
  /** Right-align the panel — use for triggers near the end of the bar. */
  align?: 'left' | 'right';
  className?: string;
  panelClassName?: string;
  /** Receives `close` so an item can dismiss the panel after acting. */
  children: (close: () => void) => ReactNode;
}

export function MenuPopover({
  label,
  ariaLabel,
  icon,
  active,
  align = 'left',
  className,
  panelClassName,
  children,
}: MenuPopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      // composedPath, not `contains(e.target)`: inside the <oyon-app> shadow
      // root a document listener sees the event retargeted to the host
      // element, so `contains` is false for a click INSIDE the panel and the
      // panel would close before the click landed.
      const root = rootRef.current;
      if (!root || !e.composedPath().includes(root)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // Return focus to the trigger, or focus is orphaned on a removed node
      // and the next Tab restarts from the top of the document.
      triggerRef.current?.focus();
    };
    // pointerdown, not click: a click listener fires after the target's own
    // handler, so clicking another trigger would close this panel and then
    // immediately reopen it.
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
          active || open
            ? 'bg-status-info-dim text-status-info font-medium'
            : 'text-ink-1 hover:bg-surface-2',
        )}
      >
        {icon}
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown
          className={cn('size-3 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          id={panelId}
          className={cn(
            'absolute top-full z-50 mt-1 min-w-56 rounded-lg border border-line bg-surface-1 p-1.5 shadow-popover',
            /*
             * Panels declare a comfortable intrinsic width (the Scope panel
             * asks for 26rem = 416 px), which is wider than a phone. Clamping
             * here rather than at each call site means a new panel cannot
             * reintroduce the overflow by forgetting to.
             *
             * `max-h` + scroll for the same reason on the other axis: the
             * Session panel is taller than a landscape phone, and an
             * unscrollable overflowing panel simply loses its Apply button.
             *
             * Ordered BEFORE panelClassName so a call site can still opt out.
             */
            'max-w-[calc(100vw-1rem)] max-h-[min(70svh,32rem)] overflow-y-auto overscroll-contain',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
