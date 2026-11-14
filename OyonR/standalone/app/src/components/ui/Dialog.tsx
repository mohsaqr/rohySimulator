import { useEffect, useRef, type ReactNode } from 'react';

/*
 * Dialog — a modal rendered at shell level.
 *
 * Deliberately NOT nested inside a popover. SessionContextPanel carries the
 * scar: participant identity used to live behind a pill that opened a second
 * layer on top of the first, and a popover inside a popover is a focus trap
 * nobody can escape with the keyboard. Mount this from AppShell, never from
 * inside another overlay.
 *
 * Focus contract:
 *   - focus moves to the panel on open
 *   - Tab and Shift+Tab cycle within the panel while open
 *   - Escape closes (callers treat that as "dismiss", not "accept")
 *   - focus returns to whatever had it before opening
 *
 * `dismissable` exists because a consent gate must not be escapable by
 * pressing Escape or clicking the backdrop — declining has to be a deliberate
 * choice, not an accident.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface DialogProps {
  open: boolean;
  /** Accessible name; rendered by the caller and referenced by id. */
  labelledBy: string;
  children: ReactNode;
  /** Escape and backdrop clicks close. Off for gates that require an answer. */
  dismissable?: boolean;
  onDismiss?: () => void;
  /** Widen for long agreement text. */
  size?: 'sm' | 'md';
}

export function Dialog({
  open,
  labelledBy,
  children,
  dismissable = true,
  onDismiss,
  size = 'sm',
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Remember the trigger, move focus in, and put it back on close.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [open]);

  // Trap Tab inside the panel; handle Escape when dismissable.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissable) {
        event.preventDefault();
        onDismiss?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const targets = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (targets.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, dismissable, onDismiss]);

  // While a modal is up the page behind it must not scroll.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (dismissable && event.target === event.currentTarget) onDismiss?.();
      }}
    >
      <div className="absolute inset-0 bg-ink-0/40" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={[
          'relative flex max-h-[85vh] w-full flex-col gap-space-4 overflow-y-auto',
          'rounded-lg border border-line-strong bg-surface-0 p-space-5 shadow-popover',
          'outline-none',
          size === 'md' ? 'max-w-2xl' : 'max-w-lg',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );
}
