/*
 * Centrality measures for the transition network, and the maths for sizing
 * nodes by one.
 *
 * The measures themselves come from ladyna (`centralities(model)`); this
 * module turns that raw output into something a table and a renderer can both
 * consume, so the two can never disagree about ranking or scale.
 */

export const CENTRALITY_MEASURES = [
  {
    key: 'InStrength',
    label: 'In-strength',
    hint: 'summed weight of transitions INTO this state — how often affect lands here',
  },
  {
    key: 'OutStrength',
    label: 'Out-strength',
    hint: 'summed weight of transitions OUT of this state — how readily affect leaves',
  },
  {
    key: 'Closeness',
    label: 'Closeness',
    hint: 'how few steps reach every other state from here',
  },
  {
    key: 'Betweenness',
    label: 'Betweenness',
    hint: 'how often this state lies on the path between two others — a bridge',
  },
] as const;

export type CentralityKey = (typeof CENTRALITY_MEASURES)[number]['key'];
/** 'none' is the default: nodes keep one size unless sizing is asked for. */
export type NodeSizeKey = CentralityKey | 'none';

export interface CentralityResult {
  labels: string[];
  measures: Partial<Record<CentralityKey, number[]>>;
}

export interface CentralityRow {
  label: string;
  index: number;
  values: Record<CentralityKey, number>;
}

/** Tidy one row per state, in the model's node order. */
export function centralityRows(centrality: CentralityResult | null): CentralityRow[] {
  if (!centrality?.labels?.length) return [];
  return centrality.labels.map((label, index) => ({
    label,
    index,
    values: CENTRALITY_MEASURES.reduce(
      (acc, m) => {
        const v = centrality.measures?.[m.key]?.[index];
        acc[m.key] = Number.isFinite(v) ? (v as number) : 0;
        return acc;
      },
      {} as Record<CentralityKey, number>,
    ),
  }));
}

export const BASE_NODE_RADIUS = 25;
const MIN_RADIUS = 13;
const MAX_RADIUS = 34;

/**
 * Per-node radii for a chosen measure, in model order. Returns null for
 * 'none' so the renderer keeps its single radius.
 *
 * Area — not radius — is proportional to the value. A circle's area grows with
 * r², so mapping the value straight onto the radius makes a state with twice
 * the centrality look four times as important. Taking the square root is what
 * makes the picture agree with the number beside it in the table.
 *
 * Scaling is relative to the largest node in THIS network, not an absolute
 * scale: centrality units are not comparable across models, so the only honest
 * reading is "bigger than its neighbours here".
 */
export function nodeRadiiFor(
  rows: CentralityRow[],
  key: NodeSizeKey,
): number[] | null {
  if (key === 'none' || rows.length === 0) return null;

  const values = rows.map((r) => Math.max(0, r.values[key] ?? 0));
  const max = Math.max(...values);
  // Every node identical (or all zero) carries no information to encode —
  // scaling it anyway would invent a hierarchy out of floating-point noise.
  const min = Math.min(...values);
  if (!(max > 0) || max - min < 1e-9) return null;

  return values.map((v) => {
    const frac = Math.sqrt(v / max); // sqrt => AREA is proportional
    return MIN_RADIUS + frac * (MAX_RADIUS - MIN_RADIUS);
  });
}

/** Rows sorted by a measure, descending — the table's reading order. */
export function rankBy(rows: CentralityRow[], key: NodeSizeKey): CentralityRow[] {
  const sortKey: CentralityKey = key === 'none' ? 'InStrength' : key;
  return rows.slice().sort((a, b) => b.values[sortKey] - a.values[sortKey]);
}
