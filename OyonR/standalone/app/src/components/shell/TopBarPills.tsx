import { Eye, ShieldCheck, Target } from 'lucide-react';
import { StatusPill } from '@/components/ui/StatusPill';
import { useSessionContext } from '@/lib/sessionContext';
import { useRuntime } from '@/lib/RuntimeProvider';
import { useSettings } from '@/lib/settingsStore';
import { cn } from '@/lib/cn';

/*
 * Tiny presentational pills used by the TopBar. Each is a click target;
 * Phase B will attach drill-in dialogs. The point right now is that the
 * surface area is *named* — every research-grade context dimension has a
 * dedicated slot, not a buried setting.
 */

export function ContextPill({
  label,
  value,
  onClick,
  className,
}: {
  label: string;
  value: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-0 px-2.5 py-1 text-xs leading-none text-ink-1 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info',
        className,
      )}
    >
      <span className="text-[10px] uppercase tracking-wider text-ink-3">
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </button>
  );
}

export function CalibrationPill() {
  const calibration = useSessionContext((s) => s.calibration);
  const gazeEnabled = useSettings((s) => s.gaze_tracking_enabled);
  const calibrationRequired = useSettings((s) => s.gaze_calibration_required);

  if (!gazeEnabled) {
    return (
      <StatusPill tone="null" reason="gaze disabled" icon={<Target className="size-3" />}>
        Calibration
      </StatusPill>
    );
  }

  if (calibration.status === 'never') {
    if (!calibrationRequired) {
      return (
        <StatusPill tone="info" icon={<Target className="size-3" />}>
          Calib · optional
        </StatusPill>
      );
    }
    return (
      <StatusPill tone="null" reason="not calibrated" icon={<Target className="size-3" />}>
        Calibration
      </StatusPill>
    );
  }
  if (calibration.status === 'stale') {
    return (
      <StatusPill tone="warn" icon={<Target className="size-3" />}>
        Calib · stale
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="ok" icon={<Target className="size-3" />}>
      Calib · q {calibration.quality.toFixed(2)}
    </StatusPill>
  );
}

export function ConsentPill() {
  const consent = useSessionContext((s) => s.consent);
  const runtime = useRuntime();
  const hasCaptureConsent =
    consent === 'granted' ||
    Boolean(runtime.cameraStream) ||
    runtime.status === 'running' ||
    runtime.status === 'paused' ||
    runtime.status === 'starting-camera' ||
    runtime.windowCount > 0;

  if (hasCaptureConsent)
    return (
      <StatusPill tone="ok" icon={<ShieldCheck className="size-3" />}>
        Consent
      </StatusPill>
    );
  if (consent === 'denied' || consent === 'expired')
    return (
      <StatusPill tone="bad" icon={<ShieldCheck className="size-3" />}>
        Consent · {consent}
      </StatusPill>
    );
  return (
    <StatusPill tone="null" reason="not given" icon={<ShieldCheck className="size-3" />}>
      Consent
    </StatusPill>
  );
}

export function PrivacyPill() {
  // The privacy inspector opens in Phase D — for now this is a quiet info pill
  // that signals the validator deny-list is enforced.
  return (
    <StatusPill tone="info" icon={<Eye className="size-3" />}>
      Privacy: aggregate only
    </StatusPill>
  );
}
