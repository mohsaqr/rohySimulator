import { OKABE_ITO, type DashboardView } from '@/lib/groupDashboard';
import { BarCell } from '@/components/ui/BarCell';
import { fmtNum, fmtPct } from './groupChart';

/*
 * Compact tables: joint attention per pair (ladyna jointAttention, session
 * rows) and member indices (ladyna groupSynchrony cluster phase: each
 * member's coupling to the group, ρ, and mean relative phase).
 */

const TH = 'px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-ink-3';
const TD = 'px-2 py-2 align-top';

export function JointAttentionTable({ view }: { view: DashboardView }) {
  if (!view.attention_channel) return <p className="m-0 text-xs text-ink-3">No gaze zone / AOI channel in this data.</p>;
  if (!view.joint_attention.length) return <p className="m-0 text-xs text-ink-3">No joint-attention rows for {view.attention_channel}.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className={TH}>pair</th>
            <th className={TH} title="share of attending ticks where the partner was on the same target within ±2 s; the tick is zero-lag chance">together · chance</th>
            <th className={TH} title="cosine of the two members' state-count vectors, mean over windows">JVA cos</th>
            <th className={TH} title="(init_a − init_b) / (init_a + init_b): who starts the joint episodes">who starts</th>
            <th className={TH}>overlap</th>
          </tr>
        </thead>
        <tbody className="text-ink-1">
          {view.joint_attention.map((p) => (
            <tr key={p.pair} className="odd:bg-surface-1">
              <td className={`${TD} font-medium text-ink-0`}>{p.pair}</td>
              <td className={TD}>
                <BarCell value={p.p_joint} refValue={p.p_joint_expected}
                  text={`${fmtNum(p.p_joint)} · chance ${fmtNum(p.p_joint_expected)}`} />
              </td>
              <td className={TD}><BarCell value={p.jva_cosine} text={fmtNum(p.jva_cosine)} colour={OKABE_ITO.green} /></td>
              <td className={TD}>
                <BarCell value={p.initiation_balance} min={-1} max={1} diverging colour={OKABE_ITO.orange}
                  text={p.initiation_balance === null ? '–'
                    : p.initiation_balance === 0 ? 'even'
                      : `${p.initiation_balance > 0 ? p.member_a : p.member_b} · ${fmtNum(Math.abs(p.initiation_balance))}`} />
              </td>
              <td className={TD}><BarCell value={p.overlap} text={fmtPct(p.overlap)} colour={OKABE_ITO.grey} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MemberIndicesTable({ view }: { view: DashboardView }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className={TH}>member</th>
            <th className={`${TH} normal-case`} title="cluster-phase coupling of the member to the group (0–1)">ρ TO GROUP</th>
            <th className={TH} title="mean phase relative to the group, radians (−π…π); the line is in phase">rel. phase</th>
            <th className={TH}>usable ticks</th>
          </tr>
        </thead>
        <tbody className="text-ink-1">
          {view.member_indices.map((m) => {
            const usable = view.members.find((x) => x.member_id === m.member_id)?.quality_share ?? null;
            return (
              <tr key={m.member_id} className="odd:bg-surface-1">
                <td className={`${TD} font-medium text-ink-0`}>{m.member_id}</td>
                <td className={TD}><BarCell value={m.member_rho} text={fmtNum(m.member_rho)} /></td>
                <td className={TD}><BarCell value={m.mean_rel_phase} min={-Math.PI} max={Math.PI} diverging colour={OKABE_ITO.purple} text={fmtNum(m.mean_rel_phase)} /></td>
                <td className={TD}><BarCell value={usable} text={fmtPct(usable)} colour={OKABE_ITO.grey} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** For the "?" beside the joint-attention title. */
export function JointAttentionInfo({ view }: { view: DashboardView }) {
  return (
    <>
      <p>ladyna jointAttention on {view.attention_channel ?? '–'}, per pair. p_joint: the share of attending ticks where the partner was on the same target within ±2 s. chance: the zero-lag chance from the two members&apos; marginals. JVA cos: cosine of the two members&apos; state-count vectors, mean over windows. initiation: (init_a − init_b) / (init_a + init_b), positive when the first member starts more joint episodes.</p>
      <p>Chance ignores the ±2 s tolerance; use a surrogate null for inference.</p>
    </>
  );
}

/** For the "?" beside the member-indices title. */
export function MemberIndicesInfo({ view }: { view: DashboardView }) {
  return (
    <p>
      Cluster phase (Richardson et al. 2012) on {view.channel_kind === 'continuous' ? view.channel : view.events_channel ?? '–'}: ρ to group is each member&apos;s phase coupling to the group (0–1), rel. phase their mean phase relative to it, in radians. Group ρ {fmtNum(view.rho_group)}.
    </p>
  );
}
