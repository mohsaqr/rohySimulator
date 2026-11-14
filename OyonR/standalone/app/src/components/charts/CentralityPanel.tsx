import { emotionColor } from '@/lib/emotionColors';
import {
  CENTRALITY_MEASURES,
  rankBy,
  type CentralityKey,
  type CentralityRow,
  type NodeSizeKey,
} from '@/lib/centrality';

/*
 * Ranked centrality bars beside the transition network.
 *
 * The node-size control also chooses the primary measure here: rows sort by
 * it and the horizontal bars encode it. The remaining measures stay available
 * through that control instead of appearing as unrelated readings beneath a
 * bar that does not encode them. With uniform nodes, In-strength supplies the
 * default bar ranking while node radius carries no data.
 */

export interface CentralityPanelProps {
  rows: CentralityRow[];
  sizeBy: NodeSizeKey;
  onSizeBy: (key: NodeSizeKey) => void;
  /** Set when sizing was requested but the values carry no differences. */
  sizingInert?: boolean;
}

export function CentralityPanel({
  rows,
  sizeBy,
  onSizeBy,
  sizingInert,
}: CentralityPanelProps) {
  const displayKey: CentralityKey = sizeBy === 'none' ? 'InStrength' : sizeBy;
  const displayMeasure = CENTRALITY_MEASURES.find((m) => m.key === displayKey)!;
  const ranked = rankBy(rows, displayKey);
  const maxValue = Math.max(0, ...ranked.map((row) => row.values[displayKey]));

  if (rows.length === 0) {
    return (
      <p className="m-0 p-4 text-sm text-ink-3">
        No centralities — the network needs at least one transition.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <label
          htmlFor="centrality-size-by"
          className="label-eyebrow shrink-0"
        >
          Node size
        </label>
        <select
          id="centrality-size-by"
          value={sizeBy}
          onChange={(e) => onSizeBy(e.target.value as NodeSizeKey)}
          className="min-w-0 flex-1 rounded border border-line bg-surface-0 px-2 py-1 text-xs text-ink-0"
        >
          <option value="none">Uniform</option>
          {CENTRALITY_MEASURES.map((measure) => (
            <option key={measure.key} value={measure.key}>
              {measure.label}
            </option>
          ))}
        </select>
      </div>

      <p className="m-0 text-xs leading-snug text-ink-3">
        {sizeBy === 'none'
          ? `Bars rank by ${displayMeasure.label}; network nodes stay uniform.`
          : displayMeasure.hint}
      </p>

      {sizingInert ? (
        <p className="m-0 text-xs text-status-warn">
          Every state scores the same on this measure — nodes are left uniform
          rather than magnifying rounding noise.
        </p>
      ) : null}

      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
        <span className="label-eyebrow text-ink-2">
          {displayMeasure.label}
        </span>
        <span className="text-micro text-ink-3">relative to max</span>
      </div>

      <div
        className="max-h-[28rem] space-y-2 overflow-y-auto pr-1"
        role="list"
        aria-label={`${displayMeasure.label} centrality ranking`}
      >
        {ranked.map((row) => {
          const value = row.values[displayKey];
          const width = maxValue > 0 ? (Math.max(0, value) / maxValue) * 100 : 0;
          return (
            <div key={row.label} className="space-y-1" role="listitem">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-medium capitalize text-ink-1">
                  {row.label}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-ink-1">
                  {value.toFixed(3)}
                </span>
              </div>

              <div
                className="h-2.5 overflow-hidden rounded-full bg-surface-2"
                role="img"
                aria-label={`${row.label}: ${displayMeasure.label} ${value.toFixed(3)}`}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${width}%`,
                    background: emotionColor(row.label),
                  }}
                />
              </div>

            </div>
          );
        })}
      </div>

      <p className="m-0 text-mini leading-snug text-ink-3">
        Selecting a measure ranks the bars and makes network node{' '}
        <strong>area</strong> proportional to the same values. Scores are
        relative to this network and are not comparable between models.
      </p>
    </div>
  );
}
