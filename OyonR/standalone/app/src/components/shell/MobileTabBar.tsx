import { useEffect, useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { MoreHorizontal, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useConsent } from '@/lib/consentStore';
import { ITEMS, PHONE_PRIMARY, isNavActive } from './TopMenu';

/*
 * MobileTabBar — primary navigation on a phone.
 *
 * The desktop bar cannot simply shrink into this role. Its labels are
 * `sr-only` until `xl` (1280 px), so at phone width it renders as eight
 * visually identical unlabelled icons inside a horizontal scroller with no
 * scroll affordance — the map is present in the DOM and absent from the
 * screen. This bar shows FOUR labelled destinations instead, in the bottom
 * third of the display where a thumb actually reaches.
 *
 * Both lists come from ITEMS/PHONE_PRIMARY in TopMenu, so the phone and
 * desktop bars cannot drift about what the app's destinations are. Nothing
 * here restates a route.
 *
 * It is a normal flex child of the shell column, NOT `position: fixed`. A
 * fixed bar would need main to carry a matching bottom padding, and the two
 * numbers then have to be kept equal by hand forever — every "content hidden
 * behind the tab bar" bug is that pair drifting. In flow, the bar reserves its
 * own height by existing.
 */

export function MobileTabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const primary = ITEMS.filter((item) => PHONE_PRIMARY.includes(item.to));
  const overflow = ITEMS.filter((item) => !PHONE_PRIMARY.includes(item.to));
  // "More" is the current section whenever what you are looking at lives
  // inside it — otherwise Diagnostics would show no active tab anywhere.
  const overflowActive = overflow.some((item) => isNavActive(pathname, item.to));

  // Navigating from inside the sheet dismisses it. Without this the sheet
  // stays open over the destination it just sent you to.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMoreOpen(false);
      // Focus would otherwise be orphaned on the removed sheet and the next
      // Tab would restart from the top of the document.
      moreButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [moreOpen]);

  return (
    <>
      {moreOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-overlay bg-black/40 md:hidden"
            aria-label="Close more menu"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="fixed inset-x-0 bottom-0 z-modal border-t border-line bg-surface-1 p-2 pb-safe shadow-popover md:hidden"
            role="dialog"
            aria-label="More destinations"
          >
            {overflow.map((item) => {
              const Icon = item.icon;
              const active = isNavActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'touch-target flex items-center gap-3 rounded-md px-3 py-2.5 text-sm',
                    active
                      ? 'bg-status-info-dim font-medium text-status-info'
                      : 'text-ink-1 active:bg-surface-2',
                  )}
                  activeProps={{ 'aria-current': 'page' }}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
            {/*
             * Consent is a nav entry but not a route — it opens the agreement
             * over whatever you are looking at, so a participant asking "what
             * is this recording?" does not lose their place.
             */}
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                useConsent.getState().requestGate();
              }}
              className="touch-target flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-ink-1 active:bg-surface-2"
            >
              <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
              Consent
            </button>
          </div>
        </>
      ) : null}

      <nav
        aria-label="Primary"
        className="z-dock shrink-0 border-t border-line bg-surface-1 pb-safe md:hidden"
      >
        <div className="flex items-stretch">
          {primary.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(pathname, item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-micro font-medium transition-colors',
                  active ? 'text-status-info' : 'text-ink-2 active:bg-surface-2',
                )}
                activeProps={{ 'aria-current': 'page' }}
              >
                <Icon className="size-5" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            className={cn(
              'flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-micro font-medium transition-colors',
              moreOpen || overflowActive
                ? 'text-status-info'
                : 'text-ink-2 active:bg-surface-2',
            )}
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
