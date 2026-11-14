import type { DashboardView, MatrixCell } from '@/lib/groupDashboard';
import { PAL, fmtNum, fmtPct } from './groupChart';

/*
 * Pairwise matrix: n × n, session value of the selected measure per pair
 * (ladyna pairwiseSynchrony / jointAttention, scope 'session'). Each cell
 * shows the value as text, a lead arrow from the ROW member's point of view
 * (→ the row member leads, ← the column member leads, · no lead), and — once
 * a null was computed — its z as text with a tint (blue above the null,
 * vermillion below). The tint never carries information the text does not.
 */

function tint(z: number | null) {
  if (z === null || !Number.isFinite(z)) return undefined;
  const alpha = Math.min(Math.abs(z) / 4, 1) * 0.55;
  const hex = z >= 0 ? PAL.blue : PAL.vermillion;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function arrow(cell: MatrixCell) {
  if (cell.lead === 'row') return '→';
  if (cell.lead === 'col') return '←';
  return '·';
}

function cellTitle(row: string, col: string, cell: MatrixCell, measure: string | null) {
  const lead = cell.lead === 'row' ? `${row} leads ${col}` : cell.lead === 'col' ? `${col} leads ${row}` : 'no lead';
  const source = cell.lead_source === null ? 'this measure estimates no lag'
    : `lag ${fmtNum(Math.abs(cell.lag_s ?? NaN), 1)} s, ${cell.lead_source}`;
  return `${cell.pair} · ${measure} ${fmtNum(cell.value)} · ${lead} (${source}) · overlap ${fmtPct(cell.overlap)}`
    + (cell.z !== null ? ` · z ${fmtNum(cell.z)}, p_null ${fmtNum(cell.p_null, 3)}` : '');
}

function leadNote(view: DashboardView) {
  const source = view.pairs.find((p) => p.lead_source !== null)?.lead_source ?? null;
  if (source) return ` (ladyna's leader, from the estimated lag: ${source})`;
  return ' (this measure estimates no lag, so no one leads)';
}

export function PairMatrix({ view }: { view: DashboardView }) {
  const { members, cells } = view.matrix;
  if (members.length < 2) return <p className="m-0 text-xs text-ink-3">A matrix needs at least two members.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs tabular-nums">
        <thead>
          <tr>
            <th className="p-1" />
            {members.map((m) => <th key={m} className="p-1 text-center font-medium text-ink-2">{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {members.map((row, i) => (
            <tr key={row}>
              <th className="p-1 pr-2 text-right font-medium text-ink-2">{row}</th>
              {members.map((col, j) => {
                const cell = cells[i][j];
                if (i === j) return <td key={col} className="h-14 w-20 border border-line bg-surface-2 text-center text-ink-3">—</td>;
                if (!cell) return <td key={col} className="h-14 w-20 border border-line text-center text-ink-3">n/a</td>;
                return (
                  <td
                    key={col}
                    className="h-14 w-20 border border-line text-center align-middle text-ink-0"
                    style={{ backgroundColor: tint(cell.z) }}
                    title={cellTitle(row, col, cell, view.measure)}
                  >
                    <div className="text-sm font-semibold">{fmtNum(cell.value)}</div>
                    <div className="text-ink-1">
                      <span aria-hidden="true">{arrow(cell)}</span>
                      <span className="sr-only">{cell.lead === 'row' ? 'row leads' : cell.lead === 'col' ? 'column leads' : 'no lead'}</span>
                      {cell.z !== null ? <span className="ml-1">z {fmtNum(cell.z, 1)}</span> : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How to read the matrix, for the "?" beside its title. */
export function PairMatrixInfo({ view }: { view: DashboardView }) {
  const hasNull = view.matrix.cells.some((row) => row.some((c) => c && c.z !== null));
  return (
    <p>
      {view.measure ?? '–'} over the whole span, per pair. → the row member leads, ← the column member leads
      {leadNote(view)}; · no lead.
      {hasNull ? ' Tint and z: blue above the null mean, vermillion below.' : ' Compute the null to add z and tint.'}
    </p>
  );
}
