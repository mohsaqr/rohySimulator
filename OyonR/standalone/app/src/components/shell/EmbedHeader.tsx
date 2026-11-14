import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Settings, Crosshair, Loader2, X } from 'lucide-react';
import { GazeCalibrationPanel } from 'oyon/react/gaze-calibration';
import type {
  GazeCalibrationCompleteDetail,
  GazeCalibrationPanelHandle,
} from 'oyon/react/gaze-calibration';
import { Brand } from './Brand';
import { FilterControls } from './FilterBar';
import { analyzeTabsFor } from '@/lib/analyzeTabs';
import { recordKindsOf } from 'oyon';
import { useRuntime } from '@/lib/RuntimeProvider';
import { useBridge } from '@/lib/hostBridge';
import { useSessionContext } from '@/lib/sessionContext';
import { cn } from '@/lib/cn';

/*
 * EmbedHeader — the ONE unified header for the embedded Oyon (chrome="none" and
 * chrome="capture-analytics"). Replaces the three stacked levels the standalone
 * app shows (brand+Analyze/Settings nav row, the FilterBar row, and the
 * AnalyzeLayout "Workflow · Step 4 / Analyze / description" PageHeader block) —
 * none of which earn their vertical space inside a host that already has its own
 * chrome. Standalone keeps all of those (AnalyzeLayout renders its PageHeader +
 * subtabs only when NOT embedded).
 *
 * One row:  [◐ Oyon] [Calibrate]  Affect · Affect dynamics · …   Sessions▾   ⚙ Settings
 *
 * The Calibrate button sits right beside the logo and only appears when capture
 * is live (runtime constructed) AND gaze is not yet calibrated — a clear,
 * labeled call-to-action instead of a buried crosshair icon. It opens the
 * full-screen gaze calibration overlay. Route-aware: on /analyze* it shows the
 * domain tabs + the inline filter; on /settings it swaps the tabs for a
 * back-to-Analyze link. The gear is the persistent Analyze↔Settings toggle.
 */
/** The dashboard's front page: people and sessions in scope, every signal. */
const OVERVIEW_TAB = { to: '/overview', label: 'Overview' };

export function EmbedHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The dashboard pages: the Overview front page and the Analyze domains.
  const onAnalyze = pathname.startsWith('/analyze') || pathname === '/overview';
  const onSettings = pathname.startsWith('/settings');

  // Calibration affordance. Show it in any REAL-runtime embed (not the
  // chrome="none" viewer stub) whenever gaze is not yet calibrated — even
  // BEFORE capture has started, because the dashboard embed (capture-analytics)
  // doesn't auto-start. Clicking it starts capture if needed (calibration needs
  // the live camera), then opens the overlay. `calibration.status === 'ok'`
  // mirrors the gaze KPI's "Not calibrated".
  const { runtime, start } = useRuntime();
  const chromeMode = useBridge((s) => s.chromeMode);
  // Host-fed viewer (el.setWindows): a read-only lens over the host's server
  // pool. Capture-session affordances (the Settings page is runtime/capture
  // config) don't apply — hide the gear.
  const hostFed = useBridge((s) => s.hostWindows != null || s.hostRecords != null);
  // Optional close control (the `closable` attribute). Oyon only reports the
  // press; the host decides what closing means.
  const hostRecordsFed = useBridge((s) => s.hostRecords != null || s.scope !== 'session');
  // Only the pages the fed records can fill: a host with no camera is not
  // offered eight empty tabs (lib/analyzeTabs.ts).
  const fedRecords = useBridge((s) => s.hostRecords);
  const tabs = useMemo(() => analyzeTabsFor(fedRecords ? recordKindsOf(fedRecords) : null), [fedRecords]);
  const closable = useBridge((s) => s.closable);
  const emitHostEvent = useBridge((s) => s.emitHostEvent);
  const calibration = useSessionContext((s) => s.calibration);
  const setSessionContext = useSessionContext((s) => s.setContext);
  const gazeCalibrated = calibration.status === 'ok';
  const panelRef = useRef<GazeCalibrationPanelHandle>(null);
  const [calibrating, setCalibrating] = useState(false);
  // Set when the user clicked Calibrate before a runtime existed: the effect
  // below fires the overlay the moment capture's runtime comes up.
  const [pendingCalibrate, setPendingCalibrate] = useState(false);
  const showCalibrate = chromeMode !== 'none' && !gazeCalibrated;

  useEffect(() => {
    if (!pendingCalibrate || !runtime || !panelRef.current) return;
    setPendingCalibrate(false);
    setCalibrating(true);
    void panelRef.current.start(runtime).finally(() => setCalibrating(false));
  }, [pendingCalibrate, runtime]);

  async function handleCalibrate() {
    if (gazeCalibrated) return;
    if (runtime && panelRef.current) {
      setCalibrating(true);
      try {
        await panelRef.current.start(runtime);
      } finally {
        setCalibrating(false);
      }
      return;
    }
    // No runtime yet (dashboard embed not capturing): start capture, then the
    // effect above launches calibration once the runtime is live.
    setPendingCalibrate(true);
    try {
      await start();
    } catch {
      setPendingCalibrate(false);
    }
  }
  function handleCalibrationComplete(detail: GazeCalibrationCompleteDetail) {
    if (!detail.ok) return;
    const quality = typeof detail.quality === 'number' ? detail.quality : null;
    setSessionContext({
      calibration:
        quality != null ? { status: 'ok', quality, ageMs: 0 } : { status: 'never' },
    });
  }

  return (
    <header
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface-1 px-4 py-2"
      aria-label="Oyon"
    >
      <Brand compact />

      {showCalibrate ? (
        <button
          type="button"
          onClick={handleCalibrate}
          disabled={calibrating || pendingCalibrate}
          title="Calibrate gaze tracking — starts the camera, then look at the dot as it moves"
          /* Status tokens, not raw amber. `bg-amber-50` + `text-amber-700` is
             a light-mode-only pairing: it pins a near-white ground and dark
             amber ink regardless of theme, so in dark mode this button became
             a bright slab on a near-black bar. The dim/solid token pair
             re-derives both sides per theme. */
          className="inline-flex items-center gap-1.5 rounded-md border border-status-warn/50 bg-status-warn-dim px-2.5 py-1 text-sm font-medium text-status-warn transition-colors hover:brightness-110 disabled:opacity-50"
        >
          {calibrating || pendingCalibrate ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Crosshair className="size-4" aria-hidden="true" />
          )}
          Calibrate
        </button>
      ) : null}

      {onAnalyze ? (
        <nav
          role="tablist"
          aria-label="Analyze domains"
          className={cn(
            'flex flex-wrap items-center gap-0.5',
            // With host-fed records the first row is the level drop-downs;
            // the tabs take the row below, full width.
            hostRecordsFed && 'order-last basis-full',
          )}
        >
          {[OVERVIEW_TAB, ...tabs].map((tab) => {
            const active = pathname === tab.to;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                role="tab"
                aria-selected={active}
                className={cn(
                  'rounded px-2.5 py-1 text-sm transition-colors',
                  active
                    ? 'bg-status-info-dim font-medium text-status-info'
                    : 'text-ink-2 hover:bg-surface-2 hover:text-ink-0',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : (
        <Link
          to="/overview"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-0"
        >
          ← Dashboard
        </Link>
      )}

      <div className={cn('flex flex-wrap items-center gap-2', hostRecordsFed ? 'min-w-0 flex-1' : 'ml-auto')}>
        {onAnalyze ? <FilterControls compact /> : null}
        {hostFed ? null : (
          <Link
            to="/settings"
            aria-label="Settings"
            aria-current={onSettings ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm transition-colors',
              onSettings
                ? 'bg-status-info-dim font-medium text-status-info'
                : 'text-ink-2 hover:bg-surface-2 hover:text-ink-0',
            )}
          >
            <Settings className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Settings</span>
          </Link>
        )}
        {closable ? (
          <button
            type="button"
            onClick={() => emitHostEvent?.('oyon:close', {})}
            aria-label="Close"
            title="Close"
            className="inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink-0"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Close</span>
          </button>
        ) : null}
      </div>

      {/* Full-screen calibration overlay — mounted always so the imperative ref
          is ready the moment Calibrate is pressed. Inert until started. */}
      <GazeCalibrationPanel
        ref={panelRef}
        runtime={runtime}
        onComplete={handleCalibrationComplete}
      />
    </header>
  );
}
