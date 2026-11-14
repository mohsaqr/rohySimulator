import type { VoiceMetrics, VoiceQuality } from '../../../../../types/voice';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { StateDistributionBars } from '@/components/charts/StateDistributionBars';
import { voicePauseBucketLabel } from '@/lib/voiceAnalytics';
import type { VadEngine } from './useVoiceTest';

/*
 * VoiceStatsPanel — purely presentational metric cards for ONE `voice-v1`
 * block (the `voice` object of an episode window from
 * VoiceTurnAggregator.finalize()). Used by the Live page's voice test modal
 * and by /analyze/voice.
 *
 * Null discipline (the aggregator's most important convention): a statistic
 * that could not be measured is `null`, never 0 — every pitch figure below
 * the voiced-frame floor, spectral means on a silent turn, every ratio
 * whose denominator was 0. Those render as `—` via <Metric value={null}>
 * with a hint naming WHY; nothing here coerces null to 0. A turn with no
 * detectable pitch is not a turn at 0 Hz.
 *
 * Uncertainty is louder than measurement: when `insufficient_data` is true
 * the banner leads the panel with the machine-readable reasons spelled out —
 * low-quality input must not read as confident measurement. When
 * `quality.loudness_contaminated` is true the ABSOLUTE loudness figure
 * (rms_mean) is explicitly marked as a gain-controller artifact; the
 * within-turn relative measures stay unmarked because they remain valid
 * under AGC.
 */

export interface VoiceStatsPanelProps {
  voice: VoiceMetrics | null;
  quality?: VoiceQuality | null;
  /** Which VAD produced the speech decisions (silero | energy fallback). */
  vadEngine?: VadEngine | null;
}

/** `undefined`/non-finite → null; 0 stays 0 (a measured zero is a value). */
function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Tri-state boolean display: measured on/off, or `—` when unknown. */
function onOff(value: boolean | null | undefined): string | null {
  return typeof value === 'boolean' ? (value ? 'on' : 'off') : null;
}

function seconds(ms: number | null): string {
  return ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`;
}

const INSUFFICIENT_REASON_COPY: Record<string, string> = {
  turn_too_short: 'turn too short',
  insufficient_analyzable_speech: 'not enough clip-free speech',
  excessive_clipping: 'excessive clipping',
  poor_vad_coverage: 'poor VAD coverage',
};

const GROUP_GRID = 'grid grid-cols-2 gap-2 sm:grid-cols-3';

const PITCH_FLOOR_HINT = 'below voiced-frame floor — no reliable pitch';

export function VoiceStatsPanel({ voice, quality, vadEngine }: VoiceStatsPanelProps): JSX.Element {
  if (!voice) {
    return (
      <EmptyState
        title="No voice metrics yet"
        description="Metrics appear once a turn has been recorded and finalized — start a turn and speak."
      />
    );
  }

  const contaminated = quality?.loudness_contaminated === true;
  const thresholds = quality?.thresholds ?? null;
  const histogram = voice.pause_histogram ?? {};

  return (
    <div className="flex flex-col gap-3">
      {voice.insufficient_data ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded border border-status-warn bg-surface-1 p-3 text-sm text-ink-0"
        >
          <StatusPill tone="warn" size="sm">insufficient data</StatusPill>
          <span>
            This turn does not support confident measurement —{' '}
            {voice.insufficient_reasons
              .map((reason) => INSUFFICIENT_REASON_COPY[reason] ?? reason)
              .join(', ')}
            . The figures below are still the measured values; treat them as descriptive, not
            comparable.
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Structure</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={GROUP_GRID}>
              <Metric label="Turn duration" value={seconds(num(voice.turn_duration_ms))} />
              <Metric label="Speech time" value={seconds(num(voice.speech_duration_ms))} />
              <Metric
                label="Speech ratio"
                value={num(voice.speech_ratio)}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                hint={voice.speech_ratio == null ? 'zero-length turn' : undefined}
              />
              <Metric label="Initial silence" value={seconds(num(voice.initial_silence_ms))} />
              <Metric label="Trailing silence" value={seconds(num(voice.trailing_silence_ms))} />
              <Metric label="Internal pauses" value={num(voice.internal_pause_count)} />
              <Metric label="Pause total" value={seconds(num(voice.internal_pause_total_ms))} />
              <Metric label="Speech segments" value={num(voice.speech_segment_count)} />
              <Metric
                label="Mean segment"
                value={num(voice.segment_duration_mean_ms)}
                format={(v) => `${(v / 1000).toFixed(1)}s`}
                hint={voice.segment_duration_mean_ms == null ? 'no speech segments' : undefined}
              />
              <Metric
                label="AI playback (excluded)"
                value={seconds(num(voice.excluded_playback_ms))}
                hint="never counted as learner speech"
              />
              <Metric label="Muted" value={seconds(num(voice.muted_ms))} />
            </div>
            {/* A histogram is a SHAPE. Rendered as tiles it was a row of
                unordered counts the reader had to re-sort mentally; as bars
                the skew is the point and is visible at a glance. Same
                treatment the typing page gives the identical data shape. */}
            {Object.keys(histogram).length > 0 ? (
              <div className="mt-3">
                <p className="label-eyebrow m-0 mb-1.5">
                  Internal pause lengths
                </p>
                <StateDistributionBars
                  frequencies={Object.fromEntries(
                    Object.entries(histogram).map(([key, count]) => [
                      voicePauseBucketLabel(key),
                      count,
                    ]),
                  )}
                  order="given"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pitch</CardTitle>
          </CardHeader>
          <CardContent className={GROUP_GRID}>
            <Metric
              label="Median F0"
              value={num(voice.pitch_median_hz)}
              unit="Hz"
              format={(v) => v.toFixed(1)}
              hint={voice.pitch_median_hz == null ? PITCH_FLOOR_HINT : undefined}
            />
            <Metric
              label="F0 IQR"
              value={num(voice.pitch_iqr_hz)}
              unit="Hz"
              format={(v) => v.toFixed(1)}
              hint={voice.pitch_iqr_hz == null ? PITCH_FLOOR_HINT : 'spread — monotone reads low'}
            />
            <Metric
              label="F0 slope"
              value={num(voice.pitch_slope_hz_per_s)}
              unit="Hz/s"
              format={(v) => v.toFixed(2)}
              hint={voice.pitch_slope_hz_per_s == null ? PITCH_FLOOR_HINT : 'rising > 0 > falling'}
            />
            <Metric
              label="Pitch confidence"
              value={num(voice.pitch_confidence_mean)}
              format={(v) => v.toFixed(2)}
              hint={voice.pitch_confidence_mean == null ? PITCH_FLOOR_HINT : 'mean NSDF of kept frames'}
            />
            <Metric
              label="Voiced ratio"
              value={num(voice.voiced_frame_ratio)}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              hint={voice.voiced_frame_ratio == null ? 'no analyzable frames' : 'of analyzable frames'}
            />
            <Metric
              label="Excluded voiced"
              value={num(voice.pitch_frames_excluded_ratio)}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              hint={
                voice.pitch_frames_excluded_ratio == null
                  ? 'no voiced candidates'
                  : 'dropped for low confidence'
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Loudness</CardTitle>
            {contaminated ? (
              <StatusPill tone="warn" size="sm">AGC-contaminated</StatusPill>
            ) : null}
          </CardHeader>
          <CardContent>
            {contaminated ? (
              <p className="m-0 mb-2 text-xs text-status-warn">
                Auto gain control was active (or unknowable on a host stream): the absolute
                loudness figure is an artifact of the gain controller, not the speaker. Relative
                measures (variability, peak-to-average, near-silence) remain usable.
              </p>
            ) : null}
            <div className={GROUP_GRID}>
              <Metric
                label="RMS mean"
                value={num(voice.rms_mean)}
                format={(v) => v.toFixed(4)}
                tone={contaminated ? 'warn' : undefined}
                hint={
                  voice.rms_mean == null
                    ? 'no speech frames'
                    : contaminated
                      ? 'AGC artifact — not comparable'
                      : 'speech frames only'
                }
              />
              <Metric
                label="RMS variability"
                value={num(voice.rms_variability)}
                format={(v) => v.toFixed(4)}
                hint={voice.rms_variability == null ? 'no speech frames' : 'relative — valid under AGC'}
              />
              <Metric
                label="Peak / average"
                value={num(voice.peak_to_average_ratio)}
                format={(v) => v.toFixed(2)}
                hint={voice.peak_to_average_ratio == null ? 'no speech frames' : undefined}
              />
              <Metric
                label="Clipping"
                value={num(voice.clipping_ratio)}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                hint={voice.clipping_ratio == null ? 'no analyzable frames' : 'of analyzable frames'}
              />
              <Metric
                label="Near-silence"
                value={num(voice.near_silence_ratio)}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                hint={voice.near_silence_ratio == null ? 'no analyzable frames' : undefined}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spectrum</CardTitle>
          </CardHeader>
          <CardContent className={GROUP_GRID}>
            <Metric
              label="Centroid"
              value={num(voice.spectral_centroid_mean_hz)}
              unit="Hz"
              format={(v) => v.toFixed(0)}
              hint={voice.spectral_centroid_mean_hz == null ? 'silent turn — no spectrum' : 'brightness'}
            />
            <Metric
              label="Roll-off (85%)"
              value={num(voice.spectral_rolloff_mean_hz)}
              unit="Hz"
              format={(v) => v.toFixed(0)}
              hint={voice.spectral_rolloff_mean_hz == null ? 'silent turn — no spectrum' : undefined}
            />
          </CardContent>
        </Card>

        {/* Coverage is ANALYTICAL — it says how much of the turn each
            measurement actually saw, and therefore how much weight the
            figures above carry. It stays a first-class card. Device settings
            below it are reference metadata: needed to reproduce a capture,
            never read while interpreting one, so they fold away. Mixing the
            two in one 12-tile grid was what made this panel a wall. */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Measurement coverage</CardTitle>
            {vadEngine ? (
              <StatusPill tone={vadEngine === 'silero' ? 'ok' : 'warn'} size="sm">
                {vadEngine === 'silero' ? 'VAD: Silero (neural)' : 'VAD: energy fallback'}
              </StatusPill>
            ) : null}
          </CardHeader>
          <CardContent>
            <p className="m-0 mb-2 text-xs text-ink-3">
              How much of the turn each measurement actually saw. Low coverage does not make the
              figures above wrong — it makes them narrow, and this is where that shows.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <Metric
                label="VAD coverage"
                value={num(voice.vad_coverage)}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                hint={voice.vad_coverage == null ? 'no frames' : 'frames with a VAD decision'}
              />
              <Metric
                label="Pitch coverage"
                value={num(voice.pitch_coverage)}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                hint={voice.pitch_coverage == null ? 'no speech frames' : 'confident F0 / speech frames'}
              />
              <Metric
                label="Clipped coverage"
                value={num(voice.clipped_coverage)}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                hint={voice.clipped_coverage == null ? 'no frames' : undefined}
              />
              <Metric
                label="Muted coverage"
                value={num(voice.muted_coverage)}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                hint={voice.muted_coverage == null ? 'no frames' : undefined}
              />
              <Metric
                label="Contaminated"
                value={num(voice.contaminated_coverage)}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                hint={
                  voice.contaminated_coverage == null
                    ? 'no frames'
                    : 'VAD speech during AI playback'
                }
              />
              <Metric
                label="Analyzable speech"
                value={seconds(num(voice.analyzable_speech_ms))}
                hint="clip-free speech time"
              />
            </div>

            <details className="mt-3 border-t border-line pt-3">
              <summary className="cursor-pointer text-xs font-medium text-ink-2">
                Capture conditions &amp; thresholds
                {voice.auto_gain_control === true ? (
                  <span className="ml-2 text-status-warn">· AGC on</span>
                ) : null}
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <Metric
                  label="Sample rate"
                  value={num(voice.sample_rate)}
                  unit="Hz"
                  format={(v) => v.toFixed(0)}
                  hint={voice.sample_rate == null ? 'capture conditions unknown' : undefined}
                />
                <Metric
                  label="Channels"
                  value={num(voice.channel_count)}
                  hint={voice.channel_count == null ? 'capture conditions unknown' : undefined}
                />
                <Metric
                  label="Echo cancellation"
                  value={onOff(voice.echo_cancellation)}
                  hint={voice.echo_cancellation == null ? 'unknown' : undefined}
                />
                <Metric
                  label="Noise suppression"
                  value={onOff(voice.noise_suppression)}
                  hint={voice.noise_suppression == null ? 'unknown' : undefined}
                />
                <Metric
                  label="Auto gain control"
                  value={onOff(voice.auto_gain_control)}
                  tone={voice.auto_gain_control === true ? 'warn' : undefined}
                  hint={
                    voice.auto_gain_control == null
                      ? 'unknown'
                      : voice.auto_gain_control
                        ? 'contaminates absolute loudness'
                        : undefined
                  }
                />
                <Metric
                  label="Stream owner"
                  value={voice.stream_owner ?? null}
                  hint={voice.stream_owner == null ? 'unknown' : undefined}
                />
              </div>
              {thresholds ? (
                <p className="m-0 mt-3 text-mini text-ink-3">
                  Frame {thresholds.frame_ms} ms · VAD threshold {thresholds.vad_threshold} · pause
                  ≥ {thresholds.pause_threshold_ms} ms · pitch floor{' '}
                  {thresholds.min_voiced_frames_for_pitch} frames at confidence ≥{' '}
                  {thresholds.min_pitch_confidence} · insufficient below {thresholds.min_turn_ms} ms
                  turn / {thresholds.min_analyzable_ms} ms analyzable speech / VAD coverage{' '}
                  {thresholds.min_vad_coverage}
                </p>
              ) : null}
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
