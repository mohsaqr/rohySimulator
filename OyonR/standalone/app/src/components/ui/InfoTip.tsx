import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

/*
 * <InfoTip> — a small "?" beside a title that opens a panel with the detail
 * behind it: how to read the figure, the method and its citation, the calls,
 * counts, timings, excluded data, raw warnings. The page itself shows the
 * analysis; what a reader needs only when asking "what is this?" lives here.
 * Anything a decision rests on (a failed fit, a cluster of one) stays on the
 * page as a <Notice>, not in here.
 *
 * The panel is portalled with fixed positioning, so an overflow-hidden card
 * never clips it: to <body> in the standalone app, and inside the embed's own
 * shadow root (its `.oyon-app-host`, where the app's stylesheet applies) when
 * the app runs as <oyon-app> — a panel in <body> would lose every style. It
 * opens on click, closes on a click outside (read through composedPath(), so
 * a click inside a shadow root is not mistaken for one outside), Escape, or
 * the button again, and gives focus back to the button.
 */

/**
 * Where the panel goes, and the box its fixed position is measured from.
 * In a shadow root the host is a fixed-position containing block
 * (`contain: layout` in element.css), so offsets are taken from its corner.
 */
export function overlayTarget(anchor: Element | null): { container: Element; origin: { top: number; left: number } } {
  const root = anchor?.getRootNode();
  if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
    const container = root.querySelector('.oyon-app-host') ?? root.firstElementChild ?? document.body;
    const r = root.host.getBoundingClientRect();
    return { container, origin: { top: r.top, left: r.left } };
  }
  return { container: document.body, origin: { top: 0, left: 0 } };
}

/** Whether an event's path passes through any of `nodes` (shadow-safe). */
export function eventWithin(event: Event, nodes: Array<Node | null | undefined>): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  if (path.length) return nodes.some((n) => n != null && path.includes(n));
  const t = event.target as Node | null;
  return nodes.some((n) => n != null && t != null && n.contains(t));
}
export function InfoTip({ label, children, className }: {
  /** What the panel is about, for the button's accessible name ("About <label>"). */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number; container: Element } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const { container, origin } = overlayTarget(button.current);
    const width = Math.min(448, window.innerWidth - 32);
    // Placed in viewport terms, then shifted into the containing block's.
    const left = Math.max(16, Math.min(b.left, window.innerWidth - width - 16));
    const top = b.bottom + 6;
    setPos({ top: top - origin.top, left: left - origin.left, width, maxHeight: window.innerHeight - top - 16, container });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e: PointerEvent) => {
      if (!eventWithin(e, [panel.current, button.current])) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); button.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] font-semibold leading-none',
          open ? 'bg-surface-3 text-ink-0' : 'bg-surface-0 text-ink-2 hover:bg-surface-2 hover:text-ink-0',
          className,
        )}
      >
        ?
      </button>
      {open && pos ? createPortal(
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={`About ${label}`}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: Math.max(120, pos.maxHeight) }}
          className="z-50 overflow-auto rounded border border-line bg-surface-0 p-3 text-xs leading-relaxed text-ink-1 shadow-lg [&_p]:m-0 [&_p+p]:mt-2 [&_code]:break-words [&_code]:text-[11px] [&_code]:text-ink-2"
        >
          {children}
        </div>,
        pos.container,
      ) : null}
    </>
  );
}

/**
 * A one-line notice a reader acts on: a fit that failed, a cluster of one, a
 * test with too little data. Short; the detail goes in the InfoTip.
 */
export function Notice({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <p className={cn('m-0 text-xs', tone === 'bad' ? 'text-status-bad' : 'text-status-warn')}>{children}</p>
  );
}
