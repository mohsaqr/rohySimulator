import type { TypingMetrics as TypingMetricsBase } from 'oyon';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
// One wording for a pause bucket on every page: the library's, in seconds.
import { pauseBucketLabel } from '@/lib/typingAnalytics';
import { EmptyState } from '@/components/ui/EmptyState';

/*
 * TypingStatsPanel — purely presentational metric cards for ONE typing block
 * (the `typing` object of a typing-v3 episode window from
 * TypingAggregator.finalize()). Used by the Live page's typing test modal and
 * by the Analyze screens.
 *
 * Null discipline (per the aggregator's contract): several typing-v3 fields
 * are deliberately `null` — not 0 — when the measurement was never made
 * (word counts absent → words_per_min: null; no revisions occurred →
 * revision_distance_mean: null; boundary context never supplied →
 * pause_location_counts: null). Those render as `—` via <Metric value={null}>.
 * Coercing null to 0 would assert a measurement that was not made; nothing
 * in this file does that.
 */

/**
 * The typing-v3 metrics block. The library's hand-written
 * `types/typing.d.ts` still describes typing-v1/v2 only, so the v3 fields
 * are added here as OPTIONAL members: a value typed with the library's base
 * interface (e.g. `TypingWindow['typing']` from a `finalize()` call) still
 * assigns to this type without casts. Field semantics are documented on
 * `src/aggregation/TypingAggregator.js` and docs/TYPING.md.
 */
export interface TypingMetrics extends TypingMetricsBase {
  // typing-v2 (missing from the stale .d.ts)
  correction_count?: number;
  // typing-v3 — fluency
  chars_per_min?: number;
  chars_per_min_active?: number;
  words_per_min?: number | null;
  words_per_min_active?: number | null;
  // typing-v3 — process vs product
  produced_graphemes?: number;
  product_ratio?: number | null;
  // typing-v3 — P-burst / R-burst
  p_burst_count?: number;
  r_burst_count?: number;
  p_burst_mean_graphemes?: number;
  r_burst_mean_graphemes?: number;
  mean_burst_graphemes?: number;
  mean_burst_words?: number | null;
  // typing-v3 — revision distance
  revision_distance_mean?: number | null;
  revision_distance_median?: number | null;
  leading_edge_revision_ratio?: number | null;
  // typing-v3 — pause location
  pause_location_counts?: Record<string, number> | null;
  // typing-v3 — absolute anchors / adaptive mode (not rendered here)
  edit_timestamps_ms?: number[];
  adaptive_burst_count?: number;
  adaptive_active_input_ms?: number;
}

/** `undefined` (field absent on an older window) and non-finite → null; 0 stays 0. */
function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}


const PAUSE_LOCATION_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['mid_word', 'Mid-word'],
  ['word_boundary', 'Word boundary'],
  ['sentence_boundary', 'Sentence boundary'],
  ['paragraph_boundary', 'Paragraph boundary'],
];

/** Defensive read of `quality.thresholds` for the footnote — `quality` is untyped. */
function thresholdNote(quality: unknown): string | null {
  if (!quality || typeof quality !== 'object') return null;
  const thresholds = (quality as { thresholds?: Record<string, unknown> }).thresholds;
  if (!thresholds || typeof thresholds !== 'object') return null;
  const parts: string[] = [];
  if (typeof thresholds.burst_threshold_ms === 'number') {
    parts.push(`pause/burst threshold ${thresholds.burst_threshold_ms} ms`);
  }
  if (typeof thresholds.pause_threshold_mode === 'string') {
    parts.push(`${thresholds.pause_threshold_mode} mode`);
  }
  if (typeof thresholds.adaptive_burst_threshold_ms === 'number') {
    parts.push(`adaptive threshold ${Math.round(thresholds.adaptive_burst_threshold_ms)} ms`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

const GROUP_GRID = 'grid grid-cols-2 gap-2 sm:grid-cols-3';

export function TypingStatsPanel({ typing, quality }: { typing: TypingMetrics | null; quality?: unknown }): JSX.Element {
  if (!typing) {
    return (
      <EmptyState
        title="No typing metrics yet"
        description="Metrics appear once the aggregator has an episode to summarize — start typing."
      />
    );
  }

  const histogram = typing.pause_histogram ?? {};
  const locations = typing.pause_location_counts ?? null;
  const note = thresholdNote(quality);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Production</CardTitle>
        </CardHeader>
        <CardContent className={GROUP_GRID}>
          <Metric label="Chars / min" value={num(typing.chars_per_min)} format={(v) => v.toFixed(1)} />
          <Metric
            label="Words / min"
            value={num(typing.words_per_min)}
            format={(v) => v.toFixed(1)}
            hint={typing.words_per_min == null ? 'word counts not measured' : undefined}
          />
          <Metric label="Chars / min (active)" value={num(typing.chars_per_min_active)} format={(v) => v.toFixed(1)} />
          <Metric
            label="Words / min (active)"
            value={num(typing.words_per_min_active)}
            format={(v) => v.toFixed(1)}
            hint={typing.words_per_min_active == null ? 'word counts not measured' : undefined}
          />
          <Metric label="Text length" value={num(typing.committed_graphemes)} unit="graphemes" hint="the whole text at episode end, including what was there before" />
          <Metric label="Produced" value={num(typing.produced_graphemes)} unit="graphemes" hint="everything typed" />
          <Metric
            label="Product ratio"
            value={num(typing.product_ratio)}
            format={(v) => v.toFixed(3)}
            hint={typing.product_ratio == null ? 'nothing produced' : 'share of typed text that survived'}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bursts</CardTitle>
        </CardHeader>
        <CardContent className={GROUP_GRID}>
          <Metric label="P-bursts" value={num(typing.p_burst_count)} hint="pause-terminated" />
          <Metric label="R-bursts" value={num(typing.r_burst_count)} hint="revision-terminated" />
          <Metric
            label="Mean P-burst"
            value={num(typing.p_burst_mean_graphemes)}
            unit="graphemes"
            format={(v) => v.toFixed(1)}
          />
          <Metric
            label="Mean R-burst"
            value={num(typing.r_burst_mean_graphemes)}
            unit="graphemes"
            format={(v) => v.toFixed(1)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pausing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={GROUP_GRID}>
            {Object.entries(histogram).map(([key, count]) => (
              <Metric key={key} label={pauseBucketLabel(key)} value={num(count)} />
            ))}
            {PAUSE_LOCATION_LABELS.map(([key, label]) => (
              <Metric
                key={key}
                label={`Pause: ${label.toLowerCase()}`}
                value={locations ? num(locations[key]) : null}
                hint={locations ? undefined : 'boundary context not measured'}
              />
            ))}
          </div>
          {note ? <p className="m-0 mt-3 text-mini text-ink-3">{note}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revision</CardTitle>
        </CardHeader>
        <CardContent className={GROUP_GRID}>
          <Metric
            label="Revision ratio"
            value={num(typing.revision_ratio)}
            format={(v) => v.toFixed(3)}
            hint="deleted / inserted"
          />
          <Metric
            label="Revision distance"
            value={num(typing.revision_distance_mean)}
            unit="graphemes"
            format={(v) => v.toFixed(2)}
            hint={typing.revision_distance_mean == null ? 'no revisions occurred' : 'mean, from document end'}
          />
          <Metric
            label="Leading-edge ratio"
            value={num(typing.leading_edge_revision_ratio)}
            format={(v) => v.toFixed(2)}
            hint={typing.leading_edge_revision_ratio == null ? 'no revisions occurred' : 'share of revisions at the edge'}
          />
          <Metric label="Corrections" value={num(typing.correction_count)} hint="accepted autocorrect / spellcheck" />
        </CardContent>
      </Card>
    </div>
  );
}
