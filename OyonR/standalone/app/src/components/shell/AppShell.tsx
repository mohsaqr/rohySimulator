import { useState, useEffect } from 'react';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { TopBar } from './TopBar';
import { TopMenu } from './TopMenu';
import { FilterBar } from './FilterBar';
import { EmbedHeader } from './EmbedHeader';
import { MiniCamera } from './MiniCamera';
import { LiveGazeDot } from './LiveGazeDot';
import { RuntimeProvider } from '@/lib/RuntimeProvider';
import { useBridge } from '@/lib/hostBridge';
import { CapturePill } from '@/components/capture/CapturePill';

/*
 * AppShell layout:
 *
 *   ┌────────────────────────────────────────────────┐
 *   │ TopBar (session context strip)                 │
 *   ├────────────────────────────────────────────────┤
 *   │ TopMenu (workflow nav)                         │
 *   ├──────────────┬─────────────────────────────────┤
 *   │ Camera dock  │  Main content                   │
 *   │ (left col)   │                                 │
 *   │              │                                 │
 *   └──────────────┴─────────────────────────────────┘
 */

const DOCK_VISIBLE_KEY = 'oyon-mini-camera-visible';

function useDockVisible(): [boolean, (next: boolean) => void] {
  const [visible, setVisible] = useState(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(DOCK_VISIBLE_KEY) !== 'false';
  });
  useEffect(() => {
    function onChange(e: StorageEvent) {
      if (e.key === DOCK_VISIBLE_KEY) {
        setVisible(e.newValue !== 'false');
      }
    }
    function onLocal(e: Event) {
      const detail = (e as CustomEvent<{ visible: boolean }>).detail;
      if (detail) setVisible(detail.visible);
    }
    window.addEventListener('storage', onChange);
    window.addEventListener('oyon:dock-visible', onLocal as EventListener);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('oyon:dock-visible', onLocal as EventListener);
    };
  }, []);
  function update(next: boolean) {
    setVisible(next);
    localStorage.setItem(DOCK_VISIBLE_KEY, next ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('oyon:dock-visible', { detail: { visible: next } }));
  }
  return [visible, update];
}

export function AppShell() {
  const [dockVisible, setDockVisible] = useDockVisible();
  // FilterBar scopes the stored-window dashboards only; /live is the
  // realtime view (current capture by definition) and /settings, /help
  // don't render windows.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const showFilterBar = pathname.startsWith('/analyze') || pathname.startsWith('/sessions');
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
          <main className="flex-1 overflow-auto px-6 py-5" role="main" tabIndex={-1}>
            <Outlet />
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
          <main className="flex-1 overflow-auto px-6 py-5" role="main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </RuntimeProvider>
    );
  }

  return (
    <RuntimeProvider>
      <div className="flex h-full min-h-screen flex-col bg-surface-0 text-ink-0">
        <TopBar />
        <TopMenu />
        {showFilterBar ? <FilterBar /> : null}
        <div className="flex flex-1 overflow-hidden">
          {dockVisible ? (
            <aside
              className="flex shrink-0 w-72 md:w-80 xl:w-96 border-r border-line bg-surface-1 flex-col overflow-y-auto"
              aria-label="Camera dock"
            >
              <MiniCamera onHide={() => setDockVisible(false)} />
            </aside>
          ) : null}
          <main
            className="flex-1 overflow-auto px-6 py-5"
            role="main"
            tabIndex={-1}
          >
            <Outlet />
          </main>
        </div>
        {!dockVisible ? <MiniCamera onShow={() => setDockVisible(true)} collapsedPill /> : null}
        <LiveGazeDot />
      </div>
    </RuntimeProvider>
  );
}
