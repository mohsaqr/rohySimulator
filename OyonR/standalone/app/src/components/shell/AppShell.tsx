import { useEffect, useState } from 'react';
import { Outlet } from '@tanstack/react-router';
import { TopMenu } from './TopMenu';
import { SubNav } from './SubNav';
import { EmbedHeader } from './EmbedHeader';
import { ScopeGate } from './ScopeGate';
import { MiniCamera } from './MiniCamera';
import { MobileTabBar } from './MobileTabBar';
import { LiveGazeDot } from './LiveGazeDot';
import { RuntimeProvider } from '@/lib/RuntimeProvider';
import { useBridge } from '@/lib/hostBridge';
import { CapturePill } from '@/components/capture/CapturePill';
import { CameraDockProvider } from '@/lib/CameraDockContext';
import { ConsentGate } from './ConsentGate';
import { useIsPhone, PHONE_QUERY } from '@/lib/useMediaQuery';
import { cn } from '@/lib/cn';

/*
 * AppShell layout:
 *
 *   ┌────────────────────────────────────────────────┐
 *   │ TopMenu — nav + Scope/Session popovers          │
 *   ├────────────────────────────────────────────────┤
 *   │ SubNav  — the current section's destinations,   │
 *   │           horizontal. Only inside Analytics,    │
 *   │           Group and Settings; absent elsewhere. │
 *   ├──────────────┬─────────────────────────────────┤
 *   │ Camera dock  │  Main content                   │
 *   │ (left col)   │                                 │
 *   │              │                                 │
 *   └──────────────┴─────────────────────────────────┘
 *
 * Below `md` (768 px) the same regions rearrange, because a phone cannot
 * afford a permanent 288 px column beside anything:
 *
 *   ┌────────────────────────┐
 *   │ TopMenu — brand,       │   nav links drop out; <MobileTabBar> owns
 *   │   scope, camera, session│  navigation in the thumb zone instead
 *   ├────────────────────────┤
 *   │ SubNav — scrolls       │   one row, swipeable, instead of wrapping
 *   │   horizontally         │   to three stacked rows
 *   ├────────────────────────┤
 *   │                        │
 *   │  Main content — full   │   the camera dock becomes an overlay SHEET,
 *   │  width                 │   closed by default, over this
 *   │                        │
 *   ├────────────────────────┤
 *   │ MobileTabBar           │
 *   └────────────────────────┘
 */

export function AppShell() {
  const isPhone = useIsPhone();

  /*
   * Closing the preview is session-local. A reload always restores it, and
   * the top bar plus the collapsed handle can reopen it immediately.
   *
   * The initial value is width-dependent because the dock means something
   * different at each size. On a laptop it is a COLUMN: open, it costs space
   * it repays with a live preview. On a phone it is an overlay SHEET: open, it
   * covers the content you navigated to. So it starts closed there.
   *
   * Read from matchMedia in the initialiser rather than from `isPhone` in an
   * effect, so the first paint is already correct — the effect version shows
   * one frame of a dock covering the screen on every load.
   */
  const [dockVisible, setDockVisible] = useState(
    () => !window.matchMedia(PHONE_QUERY).matches,
  );

  /*
   * Crossing INTO phone width closes the dock: a column that was merely taking
   * space becomes a sheet covering content, and leaving it open would obscure
   * whatever the user is reading the moment they rotate the device.
   *
   * Crossing back out deliberately does NOT reopen it — a restored dock the
   * user had closed is a surprise, and the top bar's camera button (highlighted
   * whenever the dock is hidden) reopens it in one tap.
   */
  useEffect(() => {
    if (isPhone) setDockVisible(false);
  }, [isPhone]);

  const chromeMode = useBridge((s) => s.chromeMode);
  const chromeless = chromeMode === 'none';

  // chrome="capture" (NEW): render ONLY the compact capture pill — no TopBar,
  // no TopMenu, no camera dock, no analytics, no gaze dot. RuntimeProvider
  // stays mounted with the REAL runtime (chromeMode==='capture' is NOT
  // chromeless, so useStandaloneRuntime returns the real engine, not the
  // viewer stub), and keeps the off-screen gaze <video>. The wrapper is
  // inline-block / fit-content so the element sizes to the pill and a host
  // can drop <oyon-app chrome="capture"> into its own top bar.
  //
  // chromeMode is fixed at element mount and stable for the instance, so
  // taking this branch (vs. the chromeless / full branches) is stable across
  // renders — no rules-of-hooks violation (each branch's component subtree
  // calls its own fixed set of hooks).
  if (chromeMode === 'capture') {
    return (
      <RuntimeProvider>
        <div className="inline-block w-fit bg-transparent text-ink-0">
          <CapturePill />
        </div>
      </RuntimeProvider>
    );
  }

  // chrome="capture-analytics" (NEW): the self-contained embed — the SAME
  // compact CapturePill as a header strip, ABOVE the SAME Analyze dashboards
  // the full app renders, both on the REAL runtime. The pill captures; the
  // dashboards (FilterBar + Outlet) render the windows it produces. No TopBar /
  // MiniCamera dock — the pill IS the capture control. A host drops ONE element
  // and gets live capture and analytics together. Like capture mode this is NOT
  // chromeless (real engine, off-screen gaze <video> kept), and like the full /
  // none branches it owns its own fixed set of hooks, so the branch is stable
  // for the element instance (chromeMode never flips) → no rules-of-hooks issue.
  if (chromeMode === 'capture-analytics') {
    return (
      <RuntimeProvider>
        <div className="flex h-full min-h-screen flex-col bg-surface-0 text-ink-0">
          <div className="flex items-center border-b border-line bg-surface-1 px-4 py-2">
            <CapturePill />
          </div>
          <EmbedHeader />
          <main className="flex-1 overflow-auto px-6 py-4" role="main" tabIndex={-1}>
            <ScopeGate>
              <Outlet />
            </ScopeGate>
          </main>
        </div>
      </RuntimeProvider>
    );
  }

  // chrome="none" (viewer-only embed): drop the capture-oriented chrome
  // (TopBar status strip, capture dock, Live/Sessions nav, gaze dot) and
  // keep a minimal Analyze + Settings nav. RuntimeProvider stays mounted —
  // /analyze/comparison and /settings call useRuntime() — but it never
  // inits the camera here (start() is a no-op in this mode). Default path
  // (chromeless === false) is the full chrome below, untouched.
  if (chromeless) {
    return (
      <RuntimeProvider>
        <div className="flex h-full min-h-screen flex-col bg-surface-0 text-ink-0">
          <EmbedHeader />
          <main className="flex-1 overflow-auto px-6 py-4" role="main" tabIndex={-1}>
            <ScopeGate>
              <Outlet />
            </ScopeGate>
          </main>
        </div>
      </RuntimeProvider>
    );
  }

  return (
    <RuntimeProvider>
      <CameraDockProvider visible={dockVisible} setVisible={setDockVisible}>
        <div className="flex h-full min-h-screen flex-col bg-surface-0 text-ink-0">
          <TopMenu />
          <SubNav />
          <div className="flex flex-1 overflow-hidden">
            {dockVisible ? (
              <aside
                className={cn(
                  'flex flex-col border-line bg-surface-1',
                  isPhone
                    ? /*
                       * A small FLOATING thumbnail, not a full-height sheet.
                       *
                       * The first attempt was a 78svh bottom sheet, which is
                       * the right shape for a panel you interact with and the
                       * wrong one for a preview you glance at: it covered the
                       * readouts you started the capture to watch, and needed
                       * a modal backdrop, so checking your framing meant
                       * dismissing the app. At 11rem it sits above the tab bar
                       * and leaves the page usable underneath — no backdrop,
                       * nothing to dismiss.
                       */
                      'above-tab-bar fixed right-3 z-modal w-44 overflow-hidden rounded-lg border shadow-popover'
                    : 'w-72 shrink-0 overflow-y-auto border-r md:w-80 xl:w-96',
                )}
                aria-label="Camera dock"
              >
                <MiniCamera onHide={() => setDockVisible(false)} compact={isPhone} />
              </aside>
            ) : null}
            {/*
             * Tighter gutters on a phone: `px-6` spends 48 of 390 px on
             * whitespace, which is where the cramped one-word-per-line
             * columns came from.
             */}
            <main
              className="flex-1 overflow-auto px-3 py-3 md:px-6 md:py-4"
              role="main"
              tabIndex={-1}
            >
              <Outlet />
            </main>
          </div>
          {/*
           * The collapsed pill restores the dock on desktop. On a phone it is
           * redundant — the top bar's camera button is permanently visible and
           * highlights itself while the dock is hidden — and it would sit on
           * top of the tab bar, so it is not rendered there.
           */}
          {!dockVisible && !isPhone ? (
            <MiniCamera onShow={() => setDockVisible(true)} collapsedPill />
          ) : null}
          <MobileTabBar />
          <LiveGazeDot />
          {/* Shell level, never inside a popover — see Dialog's focus contract.
              Renders nothing unless the operator enabled the gate, and never
              when embedded (the host owns consent). */}
          <ConsentGate />
        </div>
      </CameraDockProvider>
    </RuntimeProvider>
  );
}
