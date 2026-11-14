import { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { InfoTip } from '@/components/ui/InfoTip';
import { seriesDynamics, SERIES_CHARACTER_THRESHOLDS, type SeriesDynamics } from 'ladyna/stats';

/*
 * The affect-dynamics triad, over the whole filtered window series.
 *
 *   variability   within-person SD        how far affect ranges from its mean
 *   instability   RMSSD                   how large the window-to-window jumps are
 *   inertia       lag-1 autocorrelation   how strongly affect predicts itself
 *
 * All of it — the triad, the instability ÷ variability ratio and its reading —
 * is ladyna's seriesDynamics (R-checked). This panel only lifts each window's
 * time and value out of the records and shows the result.
 */

/** A window's time in ms: window_start_ms, else window_start / window_end parsed. */
function windowTime(w: Record<string, unknown>): number | null {
  for (const field of ['window_start_ms', 'window_start', 'window_end']) {
    const v = w[field];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}

/** A reading only when it is genuinely numeric (null is "not measured", never 0). */
function reading(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

interface Props {
  windows: unknown[];
}

export function AffectDynamicsPanel({ windows }: Props) {
  const result = useMemo(() => {
    const recs = windows.filter((w): w is Record<string, unknown> => !!w && typeof w === 'object');
    const times = recs.map(windowTime);
    const of = (field: string) => seriesDynamics(recs.map((w) => reading(w[field])), { times });
    return { channels: { valence: of('valence'), arousal: of('arousal') } as Record<string, SeriesDynamics> };
  }, [windows]);
  const channels: Array<['valence' | 'arousal', string]> = [
    ['valence', 'Valence'],
    ['arousal', 'Arousal'],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {channels.map(([key, label]) => (
        <Card key={key} className="h-full">
          <CardHeader>
            <span className="inline-flex items-center gap-1.5">
              <CardTitle>{label} dynamics</CardTitle>
              <InfoTip label={`${label} dynamics`}>
                <DynamicsDetail channel={result.channels[key]} />
              </InfoTip>
            </span>
          </CardHeader>
          <CardContent>
            <ChannelReadout channel={result.channels[key]} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

type Channel = SeriesDynamics;

function ChannelReadout({ channel }: { channel: Channel | undefined }) {
  if (!channel || channel.n < 3) {
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface-1 px-4 py-6 text-sm text-ink-2">
        Needs at least three windows carrying this signal.
      </p>
    );
  }

  const { ratio, character } = channel;

  return (
    <div className="flex flex-col gap-space-3">
      <Metric
        label="Character"
        value={ratio === null ? null : ratio.toFixed(2)}
        hint={character ?? undefined}
      />
      <div className="grid grid-cols-3 gap-3">
        <Metric
          label="Variability"
          value={channel.sd}
          format={(v) => v.toFixed(3)}
          hint="SD"
        />
        <Metric
          label="Instability"
          value={channel.rmssd}
          format={(v) => v.toFixed(3)}
          hint="RMSSD"
        />
        <Metric
          label="Inertia"
          value={channel.inertia}
          format={(v) => v.toFixed(2)}
          hint="lag-1"
          reason={channel.inertia === null ? 'flat series' : undefined}
          tone={channel.inertia === null ? 'null' : undefined}
        />
      </div>
    </div>
  );
}

/*
 * What the "?" beside each card says. Dropped pairs are disclosed here:
 * RMSSD and lag-1 assume evenly spaced observations; a paused session breaks
 * that, and the gap guard silently reduces coverage unless it is shown.
 */
function DynamicsDetail({ channel }: { channel: Channel | undefined }) {
  const spacingMs = channel?.spacing ?? null;
  return (
    <>
      {channel && channel.n >= 3 ? (
        <p>
          {channel.n} windows, {channel.nPairs} adjacent pairs{spacingMs ? ` at ~${Math.round(spacingMs / 100) / 10} s spacing` : ''}.
          {channel.pairsDropped > 0 ? ` ${channel.pairsDropped} pair${channel.pairsDropped === 1 ? '' : 's'} excluded as non-adjacent in time — the session was interrupted there.` : ''}
        </p>
      ) : null}
      <p>Variability: the within-person SD, how far the signal ranges from its mean. Instability: RMSSD, how large the window-to-window jumps are. Inertia: the lag-1 autocorrelation, how strongly the signal predicts itself.</p>
      <p>Read the three together, never singly: at equal variability, instability and inertia move in opposite directions, so either one alone is ambiguous.</p>
      <p>
        Character: instability ÷ variability (ladyna seriesDynamics). Near √2 ({SERIES_CHARACTER_THRESHOLDS.noise.toFixed(2)}) for independent noise; below {SERIES_CHARACTER_THRESHOLDS.drift} a slow drift (sustained movement, not moment-to-moment churn); above {SERIES_CHARACTER_THRESHOLDS.alternating} alternating faster than chance.
        Calibrated on 400 simulated white-noise sessions: 1.415, 95 % interval [1.21, 1.59].
      </p>
    </>
  );
}
