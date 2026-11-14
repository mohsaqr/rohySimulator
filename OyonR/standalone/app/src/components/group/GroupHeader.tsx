import type { DashboardView } from '@/lib/groupDashboard';
import { cn } from '@/lib/cn';
import { fmtPct, fmtTime } from './groupChart';

/*
 * Header: who is in the group, how good each member's data is on the selected
 * channel (share of ticks with quality ≥ 0.5), the group clock per member
 * (offset ± round trip, from the windows), where the data comes from, and the
 * channel's evidence level from listGroupChannels(). Tone is never the only
 * cue: every chip says good / fair / poor in words.
 */

/** Tone for ladyna's quality reading (qualitySummary: good ≥ 0.8, fair ≥ 0.5 of ticks usable). */
const QUALITY_TONE: Record<string, string> = {
  good: 'border-status-ok text-status-ok',
  fair: 'border-status-warn text-status-warn',
  poor: 'border-status-bad text-status-bad',
  'no data': 'border-line text-ink-3',
};

function clockText(m: DashboardView['members'][number]) {
  if (m.clock_offset_ms === null) return 'no group clock';
  const off = `${m.clock_offset_ms >= 0 ? '+' : ''}${Math.round(m.clock_offset_ms)} ms`;
  // The handshake's error is at most RTT / 2 (docs/GROUP_SYNCHRONY.md §2).
  const rtt = m.clock_rtt_ms === null ? '' : ` ± ${Math.round(m.clock_rtt_ms / 2)} ms (RTT ${Math.round(m.clock_rtt_ms)} ms)`;
  return `clock ${off}${rtt}${m.clock_source ? `, ${m.clock_source}` : ''}`;
}

export function GroupHeader({ view, source }: { view: DashboardView; source: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-1 p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-ink-0">Group {view.group_id}</span>
        <span className="text-ink-2">{view.members.length} members</span>
        <span className="text-ink-2">source: <b className="text-ink-1">{source}</b></span>
        <span className="text-ink-2">
          span {fmtTime(view.span.start_s)} – {fmtTime(view.span.end_s)}
          {view.span.start_s > view.span.min_s || view.span.end_s < view.span.max_s ? ' (brushed)' : ''}
        </span>
        <span className="text-ink-2">
          channel <b className="text-ink-1">{view.channel}</b>
        </span>
        <span
          className={cn(
            'rounded border px-1.5 py-0.5 text-xs',
            view.evidence === 'experimental' ? 'border-status-warn text-status-warn' : 'border-line text-ink-2',
          )}
          title="Synchrony evidence level of this channel (oyon/group listGroupChannels)"
        >
          evidence: {view.evidence ?? 'not catalogued'}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {view.members.map((m) => {
          const q = { word: m.quality_reading, tone: QUALITY_TONE[m.quality_reading] ?? QUALITY_TONE['no data'] };
          return (
            <li
              key={m.member_id}
              className={cn('rounded border px-2 py-1 text-xs tabular-nums', q.tone)}
              title={`${m.n_ticks} ticks on ${view.channel}; quality ≥ 0.5 on ${fmtPct(m.quality_share)}`}
            >
              <b>{m.member_id}</b>
              {m.seat ? <span className="text-ink-3"> ({m.seat})</span> : null}
              {' · '}
              {fmtPct(m.quality_share)} usable ({q.word})
              {' · '}
              <span className="text-ink-2">{clockText(m)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
