import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { EmotionWindow } from 'oyon';
import { cn } from '@/lib/cn';
import { deriveFrameQuality } from '@/lib/frameQuality';

/*
 * QualityBanner — surfaces a soft warning when the most recent window's
 * signal quality is below thresholds documented in docs/EYE_TRACKING.md.
 *
 * The banner is quiet (info pill) when signal is good; loud (warn) when
 * valid-frame ratio drops below 0.5; alarming (bad) below 0.3. It never
 * fabricates a state — when there is no window yet, it renders an
 * "awaiting first window" line so the user knows the surface is alive.
 */

export interface QualityBannerProps {
  lastWindow: EmotionWindow | null;
}

interface QualityVerdict {
  tone: 'ok' | 'warn' | 'bad' | 'info';
  icon: typeof Info;
  title: string;
  detail: string;
}

function verdictFor(w: EmotionWindow | null): QualityVerdict {
  if (!w) {
    return {
      tone: 'info',
      icon: Info,
      title: 'Awaiting first window',
      detail:
        'Quality flags appear once the first aggregate window emits (≈10s after Start).',
    };
  }

  const { validFrames, totalFrames, ratio } = deriveFrameQuality(w);

  if (ratio == null) {
    return {
      tone: 'info',
      icon: Info,
      title: 'Frame budget unavailable',
      detail:
        'The last window did not include enough quality metadata to compute a valid-frame ratio.',
    };
  }

  if (ratio < 0.3) {
    return {
      tone: 'bad',
      icon: AlertTriangle,
      title: `Low signal: ${(ratio * 100).toFixed(0)}% valid frames`,
      detail:
        'Most frames in the last window were rejected. Check lighting, face position, and that the camera is unobstructed.',
    };
  }

  if (ratio < 0.6) {
    return {
      tone: 'warn',
      icon: AlertTriangle,
      title: `Marginal signal: ${(ratio * 100).toFixed(0)}% valid frames`,
      detail:
        'Some frames missed the quality bar. Brighter, more frontal lighting usually fixes this.',
    };
  }

  return {
    tone: 'ok',
    icon: CheckCircle2,
    title: `Good signal: ${(ratio * 100).toFixed(0)}% valid frames`,
    detail: `Last window emitted ${validFrames} valid of ${totalFrames} sampled frames.`,
  };
}

const toneClasses = {
  ok: 'border-status-ok-strong bg-status-ok-dim text-status-ok',
  warn: 'border-status-warn/40 bg-status-warn-dim text-status-warn',
  bad: 'border-status-bad/40 bg-status-bad-dim text-status-bad',
  info: 'border-status-info/40 bg-status-info-dim text-status-info',
} as const;

export function QualityBanner({ lastWindow }: QualityBannerProps) {
  const v = verdictFor(lastWindow);
  const Icon = v.icon;
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded border px-3 py-2 text-sm',
        toneClasses[v.tone],
      )}
      role="status"
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-medium">{v.title}</div>
        <div className="text-xs opacity-80">{v.detail}</div>
      </div>
    </div>
  );
}
