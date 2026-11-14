import { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { coefficientK } from 'oyon/analytics/gaze-dynamics';
import { gazeEntropy } from '@/lib/gazeEntropy';

/*
 * Attention mode and scanpath predictability.
 *
 * Two measures that sit either side of the same question — how is this person
 * looking, rather than where.
 *
 *   Coefficient K   ambient scanning vs focal inspection, per window
 *   Redundancy      how predictable the next AOI is, pooled over the session
 *
 * Both are deliberately NOT per-window entropy scalars. A 3-second window
 * holds too few transitions to estimate a conditional distribution — measured
 * against a stationary null the per-window estimate had a 95% interval
 * containing zero — so the entropy is computed once over the pooled transition
 * matrix, by tnaj, which owns that algorithm.
 */

interface Props {
  windows: unknown[];
  /**
   * Configured AOI ids, when the caller knows them. Passing them keeps a
   * never-visited AOI in the count matrix; it is still pruned before the
   * entropy call (an absorbing state has no unique stationary distribution)
   * but it shows up in `droppedStates` instead of vanishing.
   */
  aoiIds?: string[];
}

export function GazeDynamicsPanel({ windows, aoiIds }: Props) {
  const k = useMemo(() => coefficientK(windows), [windows]);
  const entropy = useMemo(() => gazeEntropy(windows, aoiIds), [windows, aoiIds]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Attention mode (coefficient K)</CardTitle>
        </CardHeader>
        <CardContent>
          <KStrip result={k} />
        </CardContent>
      </Card>

      <Card className="h-full">
        <CardHeader>
          <CardTitle>Scanpath predictability</CardTitle>
        </CardHeader>
        <CardContent>
          <EntropyReadout result={entropy} />
        </CardContent>
      </Card>
    </div>
  );
}

type KResult = ReturnType<typeof coefficientK>;

function KStrip({ result }: { result: KResult }) {
  const points = result.windows;
  if (points.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface-1 px-4 py-6 text-sm text-ink-2">
        Coefficient K needs windows with both fixations and saccades, and some variation in
        each across the session. Longer capture, or a scanpath that actually moves.
      </p>
    );
  }

  const focal = points.filter((p) => p.k > 0.1).length;
  const ambient = points.filter((p) => p.k < -0.1).length;
  const bound = Math.max(...points.map((p) => Math.abs(p.k))) || 1;

  return (
    <div className="flex flex-col gap-space-3">
      {/*
        A diverging strip, not a line. K has a meaningful zero — the two sides
        are different modes of looking, not more or less of one thing — so the
        baseline has to read as a boundary rather than a low value.
      */}
      <div className="flex h-24 items-center gap-px overflow-x-auto" aria-hidden="true">
        {points.map((point, index) => {
          const share = Math.min(1, Math.abs(point.k) / bound);
          return (
            <div
              key={`${point.window_start ?? index}`}
              className="flex h-full min-w-[3px] flex-1 flex-col justify-center"
              title={`K ${point.k.toFixed(2)}`}
            >
              <div className="flex h-1/2 items-end">
                <div
                  className="w-full rounded-t-sm bg-status-warn"
                  style={{ height: point.k > 0 ? `${share * 100}%` : 0 }}
                />
              </div>
              <div className="h-px w-full bg-line-strong" />
              <div className="flex h-1/2 items-start">
                <div
                  className="w-full rounded-b-sm bg-status-info"
                  style={{ height: point.k < 0 ? `${share * 100}%` : 0 }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-mini text-ink-3">
        <span>
          <span className="text-status-warn">▲</span> focal — long looks, short moves
        </span>
        <span>
          <span className="text-status-info">▼</span> ambient — short looks, long moves
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Focal windows"
          value={focal}
          hint={`of ${points.length}`}
        />
        <Metric
          label="Ambient windows"
          value={ambient}
          hint={`of ${points.length}`}
        />
      </div>
      {/*
        No session-level K figure is shown, deliberately. K is a contrast of
        z-scores taken over the session, so pooled across every fixation it is
        zero by construction — a single number would say nothing while looking
        like a result.
      */}
      <p className="text-xs text-ink-3">
        Each bar is one window, scored against this session&apos;s own fixation and saccade
        distributions. K has no meaningful session total — read the shape over time.
      </p>
    </div>
  );
}

function EntropyReadout({ result }: { result: ReturnType<typeof gazeEntropy> }) {
  if (result.error !== null) {
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface-1 px-4 py-6 text-sm text-ink-2">
        {result.error}.
      </p>
    );
  }

  const relative = result.redundancyNorm;
  return (
    <div className="flex flex-col gap-space-3">
      <Metric
        label="Redundancy"
        value={relative === null ? null : Math.round(relative * 100)}
        unit="%"
        tone={result.adequate ? undefined : 'warn'}
        hint={
          relative === null
            ? undefined
            : relative > 0.6
              ? 'highly predictable — the current AOI largely determines the next'
              : relative > 0.25
                ? 'partly predictable — some routine in the scanpath'
                : 'close to memoryless — the next AOI is near-independent'
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Entropy rate h(P)"
          value={result.entropyRate}
          unit="bits"
          format={(v) => v.toFixed(2)}
          hint="uncertainty about the next AOI"
        />
        <Metric
          label="Stationary H(π)"
          value={result.stationaryEntropy}
          unit="bits"
          format={(v) => v.toFixed(2)}
          hint="spread of time across AOIs"
        />
      </div>

      {/*
        Adequacy and pruning are shown, never assumed. Plug-in entropy is
        biased downward on sparse counts, and the normalized figures divide by
        log(states) — so a reader who cannot see the transition count or which
        AOIs were dropped cannot tell which quantity they are looking at.
      */}
      <div className="flex flex-col gap-1 border-t border-line pt-space-2 text-xs text-ink-3">
        <span>
          Pooled over <b className="tabular-nums text-ink-1">{result.nTransitions}</b> transitions
          from {result.windows} windows, across {result.labels.length} AOIs.
        </span>
        {!result.adequate ? (
          <span className="text-status-warn">
            Too few transitions for a stable estimate — treat these as provisional.
          </span>
        ) : null}
        {result.droppedStates.length > 0 ? (
          <span>
            Excluded (no outgoing transitions): {result.droppedStates.join(', ')}.
          </span>
        ) : null}
      </div>
    </div>
  );
}
