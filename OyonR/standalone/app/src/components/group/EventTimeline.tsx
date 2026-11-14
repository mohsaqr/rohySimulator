import type { DashboardEvent, EventKind } from '@/lib/groupDashboard';
import { GUTTER, HatchPattern, PAL, TimeAxis, fmtTime, makeX, useElementWidth, type TimeSpan } from './groupChart';

/*
 * Trigger-event timeline — the dashboard's primary object (plan §6: events
 * before scores). One lane per event kind on the shared time axis. Every mark
 * has a shape AND a text label (lane name, inline label where it fits, and a
 * <title>), so nothing is carried by colour alone.
 *
 *   ▲ shared arousal        ladyna arousalEvents → 'shared_arousal'
 *   ✕ out of sync           ladyna arousalEvents → 'out_of_sync'
 *   ◆ joint-attention break ladyna jointAttentionBreaks (window p_joint below chance)
 *   ▨ sparse                ladyna arousalEvents → 'sparse' (too few members with data)
 *   ▼ marker                host / hub sync markers
 */

interface Lane {
  kind: EventKind;
  label: string;
  glyph: string;
  color: string;
}

const LANES: Lane[] = [
  { kind: 'shared_arousal', label: 'Shared arousal', glyph: '▲', color: PAL.orange },
  { kind: 'out_of_sync', label: 'Out of sync', glyph: '✕', color: PAL.vermillion },
  { kind: 'attention_break', label: 'Joint-attn break', glyph: '◆', color: PAL.blue },
  { kind: 'sparse', label: 'Sparse data', glyph: '▨', color: PAL.grey },
  { kind: 'marker', label: 'Markers', glyph: '▼', color: PAL.black },
];

const LANE_H = 24;

function Shape({ kind, x, y, color }: { kind: EventKind; x: number; y: number; color: string }) {
  const s = 6;
  if (kind === 'shared_arousal') return <path d={`M${x},${y - s} L${x + s},${y + s} L${x - s},${y + s} Z`} fill={color} stroke={PAL.black} strokeWidth={0.6} />;
  if (kind === 'out_of_sync') {
    return (
      <g stroke={color} strokeWidth={2.4} strokeLinecap="round">
        <line x1={x - s} y1={y - s} x2={x + s} y2={y + s} />
        <line x1={x - s} y1={y + s} x2={x + s} y2={y - s} />
      </g>
    );
  }
  if (kind === 'attention_break') return <path d={`M${x},${y - s} L${x + s},${y} L${x},${y + s} L${x - s},${y} Z`} fill={color} stroke={PAL.black} strokeWidth={0.6} />;
  if (kind === 'marker') return <path d={`M${x - s},${y - s} L${x + s},${y - s} L${x},${y + s} Z`} fill={color} />;
  return <rect x={x - s} y={y - s} width={2 * s} height={2 * s} fill="url(#ev-hatch)" stroke={color} />;
}

/**
 * `kinds` narrows the lanes (and the events drawn) to those kinds — the Joint
 * attention page shows only the attention-break lane; Overview shows them all.
 */
export function EventTimeline({ events, span, kinds }: { events: DashboardEvent[]; span: TimeSpan; kinds?: EventKind[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const x = makeX(span, width);
  const lanes = kinds ? LANES.filter((lane) => kinds.includes(lane.kind)) : LANES;
  const height = lanes.length * LANE_H + 24;
  const placed = events.filter((e) => e.start_s !== null);
  const unplaced = events.filter((e) => e.start_s === null && (!kinds || kinds.includes(e.kind)));
  return (
    <div ref={ref} className="w-full">
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label="Trigger-event timeline">
          <HatchPattern id="ev-hatch" />
          {lanes.map((lane, i) => {
            const y = i * LANE_H + LANE_H / 2;
            const mine = placed.filter((e) => e.kind === lane.kind);
            return (
              <g key={lane.kind}>
                <text x={4} y={y + 4} fontSize={11} className="text-ink-1" fill="currentColor">
                  <tspan fill={lane.color}>{lane.glyph}</tspan> {lane.label} ({mine.length})
                </text>
                <line x1={GUTTER} x2={width - 12} y1={y} y2={y} stroke="currentColor" className="text-ink-3" strokeOpacity={0.25} />
                {mine.map((e, k) => {
                  const x0 = x(e.start_s as number);
                  const x1 = Math.max(x(e.end_s ?? (e.start_s as number)), x0 + 1);
                  return (
                    <g key={k}>
                      <title>{`${e.label} · ${fmtTime(e.start_s as number)}–${fmtTime(e.end_s ?? (e.start_s as number))} · ${e.detail}`}</title>
                      {e.kind === 'marker' ? (
                        <line x1={x0} x2={x0} y1={0} y2={lanes.length * LANE_H} stroke={lane.color} strokeDasharray="2 3" strokeOpacity={0.5} />
                      ) : (
                        <rect
                          x={x0}
                          y={y - 8}
                          width={x1 - x0}
                          height={16}
                          fill={e.kind === 'sparse' ? 'url(#ev-hatch)' : lane.color}
                          fillOpacity={e.kind === 'sparse' ? 1 : 0.18}
                          stroke={lane.color}
                          strokeOpacity={0.6}
                        />
                      )}
                      <Shape kind={e.kind} x={x0 + (e.kind === 'marker' ? 0 : 7)} y={y} color={lane.color} />
                      {x1 - x0 > 70 || e.kind === 'marker' ? (
                        <text x={x0 + 16} y={y + 4} fontSize={10} className="text-ink-1" fill="currentColor">
                          {e.kind === 'marker' ? e.label.replace(/^marker: /, '') : e.label}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            );
          })}
          <TimeAxis span={span} width={width} y={lanes.length * LANE_H + 2} />
        </svg>
      ) : null}
      {unplaced.length ? (
        <p className="m-0 mt-1 text-xs text-ink-3">
          {unplaced.length} marker(s) cannot be placed: the timeline carries no group clock (t_group_ms).
        </p>
      ) : null}
    </div>
  );
}

/** The events as a readable list (newest first) — the same marks in words. */
export function EventList({ events }: { events: DashboardEvent[] }) {
  const shown = events.filter((e) => e.kind !== 'sparse').slice().reverse();
  if (!shown.length) return <p className="m-0 text-xs text-ink-3">No shared events in this span.</p>;
  return (
    <div className="max-h-40 overflow-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-left text-ink-3">
          <tr>
            <th className="py-1 pr-2 font-medium">event</th>
            <th className="py-1 pr-2 font-medium">from</th>
            <th className="py-1 pr-2 font-medium">to</th>
            <th className="py-1 font-medium">detail</th>
          </tr>
        </thead>
        <tbody className="text-ink-1">
          {shown.map((e, i) => {
            const lane = LANES.find((l) => l.kind === e.kind);
            return (
              <tr key={i} className="border-t border-line">
                <td className="py-1 pr-2"><span style={{ color: lane?.color }}>{lane?.glyph}</span> {e.label}</td>
                <td className="py-1 pr-2">{e.start_s === null ? '–' : fmtTime(e.start_s)}</td>
                <td className="py-1 pr-2">{e.end_s === null ? '–' : fmtTime(e.end_s)}</td>
                <td className="py-1 text-ink-2">{e.detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
