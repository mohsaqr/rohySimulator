import { useMemo } from 'react';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { EmptyState } from '@/components/ui/EmptyState';
import { NoSignalWindows } from '@/components/sensing/NoSignalWindows';
import { LineChart, Histogram, type Series } from '@/components/sensing/SensingCharts';
import { useSensingWindows, num, get, mean, fmt, pct } from '@/lib/sensingWindows';

/*
 * Heart rate (rPPG) — its own tab, separate from Position. Research-grade
 * trend, never a clinical measurement (see docs/HEART_RATE.md).
 *
 * The chart that matters is `bpm_tracked` (cross-window, plausibility-gated)
 * plotted against the raw `bpm_mean`: the gap between the two lines IS the
 * anomaly filtering, so showing both makes the correction auditable instead of
 * asking the reader to trust a single smoothed number. Nothing is hidden —
 * per the project data policy every field the aggregator emits stays visible.
 */

const COL = {
  tracked: '#f85149',
  robust: '#f0883e',
  raw: '#8b949e',
  conf: '#2ea043',
  corrected: '#d29922',
  resp: '#58a6ff',
};

/* Clinical normal resting band — the same prior the tracker uses to decide
 * whether a value may be adopted immediately (heart_rate_plausible_*_bpm). */
const PLAUSIBLE_MIN = 60;
const PLAUSIBLE_MAX = 100;

export function HeartRateView() {
  // Breathing lives here too because it is the low band of the same ROI colour
  // signal. Lighting quality belongs to Sensor diagnostics instead.
  const { windows, isLoading } = useSensingWindows(['heart_rate', 'respiration']);

  const data = useMemo(() => {
    const tracked: Array<number | null> = [];
    const robust: Array<number | null> = [];
    const raw: Array<number | null> = [];
    const conf: Array<number | null> = [];
    const corrected: Array<number | null> = [];
    const snr: Array<number | null> = [];
    const brpm: Array<number | null> = [];
    const brpmConf: Array<number | null> = [];
    let clamped = 0;
    let settling = 0;
    let outOfBand = 0;

    for (const w of windows) {
      const t = num(get(w, 'heart_rate', 'bpm_tracked'));
      const r = num(get(w, 'heart_rate', 'bpm_robust'));
      tracked.push(t);
      robust.push(r);
      raw.push(num(get(w, 'heart_rate', 'bpm_mean')));
      conf.push(num(get(w, 'heart_rate', 'confidence_mean')));
      snr.push(num(get(w, 'heart_rate', 'snr_mean')));
      corrected.push(num(get(w, 'heart_rate', 'anomaly', 'corrected_fraction')));
      if (get(w, 'heart_rate', 'slew_clamped') === true) clamped += 1;
      if (t == null && r != null) settling += 1;
      if (t != null && (t < PLAUSIBLE_MIN || t > PLAUSIBLE_MAX)) outOfBand += 1;
      brpm.push(num(get(w, 'respiration', 'brpm_mean')));
      brpmConf.push(num(get(w, 'respiration', 'confidence_mean')));
    }
    return {
      tracked, robust, raw, conf, corrected, snr, clamped, settling, outOfBand,
      brpm, brpmConf,
    };
  }, [windows]);

  if (isLoading) return <EmptyState title="Loading…" />;
  if (windows.length === 0) {
    return (
      <NoSignalWindows
        title="No heart rate windows yet"
        description="Enable Heart rate (rPPG) in Settings and capture a session — or load synthetic demo data."
      />
    );
  }

  const trackedValues = data.tracked.filter((x): x is number => x != null);
  const meanTracked = mean(data.tracked);
  const meanConf = mean(data.conf);
  const readable = windows.length - data.settling;
  const readableBreathing = data.brpm.filter((value) => value != null).length;

  const bpmSeries: Series[] = [
    { name: 'raw mean', color: COL.raw, values: data.raw },
    { name: 'robust (in-window)', color: COL.robust, values: data.robust },
    { name: 'tracked (display)', color: COL.tracked, values: data.tracked },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Section id="hr-kpis" title="Summary">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="HR windows" value={windows.length} />
          <Metric
            label="Mean BPM"
            value={fmt(meanTracked, 0)}
            hint={trackedValues.length ? `${fmt(Math.min(...trackedValues), 0)}–${fmt(Math.max(...trackedValues), 0)}` : undefined}
          />
          {/* An SNR-derived quality index that saturates at SNR 10 — not a
              probability that the reading is correct. */}
          <Metric label="Signal quality" value={pct(meanConf)} hint="SNR index, saturates at 10" tone={meanConf != null && meanConf < 0.5 ? 'warn' : 'info'} />
          <Metric label="Corrected" value={pct(mean(data.corrected), 1)} hint="estimates folded or dropped" />
          <Metric label="Slew-clamped" value={data.clamped} hint="impossible jumps rejected" tone={data.clamped > 0 ? 'warn' : 'info'} />
          <Metric label="Settling" value={data.settling} hint="withheld, awaiting corroboration" />
          <Metric label="Mean breathing" value={fmt(mean(data.brpm), 1)} unit="br/min" hint={`signal quality ${pct(mean(data.brpmConf))}`} />
          <Metric label="Breathing readable" value={`${readableBreathing} / ${windows.length}`} />
        </div>
      </Section>

      <Section
        id="hr-trend"
        title="Heart rate over time"
        description="Raw window mean, the in-window robust value, and the cross-window tracked value. The distance between them is exactly how much anomaly filtering was applied."
      >
        <Card>
          <CardHeader><CardTitle>BPM — raw vs robust vs tracked</CardTitle></CardHeader>
          <CardContent>
            <LineChart series={bpmSeries} yDomain={[40, 130]} unit="bpm" />
          </CardContent>
        </Card>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Distribution of tracked BPM</CardTitle></CardHeader>
            <CardContent>
              <Histogram
                values={data.tracked}
                color={COL.tracked}
                formatX={(v) => `${v.toFixed(0)} bpm`}
                marker={meanTracked != null ? { value: meanTracked, label: `mean ${meanTracked.toFixed(0)}` } : null}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Signal quality</CardTitle></CardHeader>
            <CardContent>
              <LineChart
                series={[
                  { name: 'signal quality', color: COL.conf, values: data.conf },
                  { name: 'corrected fraction', color: COL.corrected, values: data.corrected },
                ]}
                yDomain={[0, 1]}
                formatY={(v) => `${Math.round(v * 100)}%`}
              />
            </CardContent>
          </Card>
        </div>
      </Section>

      {data.brpm.some((v) => v != null) && (
        <Section
          id="hr-respiration"
          title="Breathing"
          description="Breaths per minute from the 0.1–0.5 Hz band of the same ROI colour signal. A learning-analytics trend, not a diagnostic measurement — each value integrates ~45 s, because frequency resolution is 1/T."
        >
          <Card>
            <CardHeader><CardTitle>Breathing rate over time</CardTitle></CardHeader>
            <CardContent>
              <LineChart
                series={[{ name: 'breaths/min', color: COL.resp, values: data.brpm }]}
                yDomain={[6, 30]}
                unit="br/min"
              />
            </CardContent>
          </Card>
        </Section>
      )}

      <Section
        id="hr-quality"
        title="Reliability"
        description="rPPG is dominated by motion, lighting and compression artifacts. These counters say how much of the session produced a value worth reading."
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Readable windows" value={`${readable} / ${windows.length}`} tone={readable < windows.length / 2 ? 'warn' : 'ok'} />
          <Metric label="Mean SNR" value={fmt(mean(data.snr), 2)} hint="peak ÷ in-band power" />
          <Metric
            label={`Outside ${PLAUSIBLE_MIN}–${PLAUSIBLE_MAX}`}
            value={data.outOfBand}
            hint="adopted only after corroboration"
            tone={data.outOfBand > 0 ? 'warn' : 'info'}
          />
          <Metric label="Low quality" value={data.conf.filter((c) => c != null && c < 0.5).length} hint="< 50% index" />
        </div>
      </Section>
    </div>
  );
}
