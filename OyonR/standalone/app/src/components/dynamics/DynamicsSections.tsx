import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { InfoTip, Notice } from '@/components/ui/InfoTip';
import { Metric } from '@/components/ui/Metric';
import { Segmented } from '@/components/ui/Segmented';
import { InlineSelect } from '@/components/group/InlineSelect';
import { Figures } from '@/components/group/NetworkFigure';
import { RowsTable } from '@/components/patterns/RowsTable';
import { sequenceSummary, type Sequences } from '@/lib/patternViews';
import {
  COMMUNITY_METHODS,
  DISSIMILARITIES,
  DYNAMICS_SECTIONS,
  POSITION_CUTS,
  clusterViews,
  lagViews,
  networkViews,
  reliabilityViews,
  sequenceDescViews,
  stateColors,
  transferViews,
  type CommunityMethod,
  type Dissimilarity,
  type DynamicsSection,
  type PositionCut,
} from '@/lib/dynamicsViews';

/*
 * The Dynamics sections over one set of state sequences (a person's
 * sessions on /analyze/sequence). The page supplies the sequences, what
 * one state is, and `lead` (its own controls, e.g. the channel picker), which
 * opens the one toolbar row; every number and picture comes from
 * lib/dynamicsViews.js (ladyna verbs, ladyna painters).
 *
 * The page shows the analysis. How to read it, the method, counts and the
 * calls sit behind the "?" at the end of the toolbar and beside each figure
 * and table; only what a decision rests on (an unstable CS, a cluster of one,
 * a fit few starts reach) is said on the page, in one line.
 *
 * Only the open section is computed. Transfer entropy runs a surrogate test
 * per ordered pair of states (seconds, not milliseconds), so it waits for
 * the Run button. Sections are keyed on the identity of `sequences`: pass a
 * memoised array.
 */

const opts = <T extends string>(xs: ReadonlyArray<T>, label: (x: T) => string = String) => xs.map((x) => ({ value: x, label: label(x) }));
const LAGS = ['1', '2', '3'] as const;
const ITERATIONS = ['99', '199', '499'] as const;
const KS = ['2', '3', '4', '5', '6'] as const;
// Distance (PAM) first and by default: fast, and k = 3; mixture Markov on request.
const CLUSTER_METHODS = [{ value: 'pam' as const, label: 'distance (PAM)' }, { value: 'mmm' as const, label: 'mixture Markov' }];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function DynamicsSections({ sequences, filePrefix, unit, lead }: {
  sequences: Sequences;
  /** Prefix for downloaded files. */
  filePrefix: string;
  /** What one state in a sequence is, e.g. "one emotion window". */
  unit: string;
  /** The page's own controls, first on the toolbar row. */
  lead?: ReactNode;
}) {
  const [section, setSection] = useState<DynamicsSection>('sequences');
  const [community, setCommunity] = useState<CommunityMethod>('walktrap');
  const [lag, setLag] = useState<(typeof LAGS)[number]>('1');
  const [teLag, setTeLag] = useState<(typeof LAGS)[number]>('1');
  const [iterations, setIterations] = useState<(typeof ITERATIONS)[number]>('199');
  const [clusterMethod, setClusterMethod] = useState<'mmm' | 'pam'>('pam');
  const [k, setK] = useState<(typeof KS)[number]>('3');
  const [dissimilarity, setDissimilarity] = useState<Dissimilarity>('lcs');
  const [positions, setPositions] = useState<PositionCut>('p75');

  const summary = useMemo(() => sequenceSummary(sequences), [sequences]);
  // k clusters need at least 2k sequences: the chosen k (3 by default) is capped at what the data allows.
  const kMax = Math.floor(summary.n_usable / 2);
  const kUsed = Math.max(2, Math.min(Number(k), kMax));
  // One colour per state for every figure on the page.
  const colorMap = useMemo(() => stateColors(sequences), [sequences]);

  const seqs = useMemo(() => (section === 'sequences' ? sequenceDescViews(sequences, { positions, colorMap }) : null), [sequences, section, positions, colorMap]);
  const network = useMemo(() => (section === 'network' ? networkViews(sequences, { community, colorMap }) : null), [sequences, section, community, colorMap]);
  const reliability = useMemo(() => (section === 'reliability' ? reliabilityViews(sequences, { colorMap }) : null), [sequences, section, colorMap]);
  const lagged = useMemo(() => (section === 'lag' ? lagViews(sequences, { lag: Number(lag) }) : null), [sequences, section, lag]);
  const clusters = useMemo(
    () => (section === 'clusters' ? clusterViews(sequences, { method: clusterMethod, k: kUsed, dissimilarity, colorMap, positions }) : null),
    [sequences, section, clusterMethod, kUsed, dissimilarity, colorMap, positions],
  );

  // Transfer entropy: run on request; a result belongs to the sequences and
  // options it was run with, and is dropped when either changes.
  const teKey = `${teLag}|${iterations}`;
  const [te, setTe] = useState<{ seqs: Sequences; key: string; result: ReturnType<typeof transferViews> } | null>(null);
  const [teRunning, setTeRunning] = useState(false);
  useEffect(() => {
    if (!teRunning) return undefined;
    // Let "Computing…" paint before the synchronous run blocks the thread.
    const id = window.setTimeout(() => {
      setTe({ seqs: sequences, key: teKey, result: transferViews(sequences, { lag: Number(teLag), iterations: Number(iterations), colorMap }) });
      setTeRunning(false);
    }, 30);
    return () => window.clearTimeout(id);
  }, [teRunning, sequences, teKey, teLag, iterations, colorMap]);
  const teResult = te && te.seqs === sequences && te.key === teKey ? te.result : null;

  const counts = (
    <p>
      {plural(summary.n_usable, 'sequence')} · {summary.n_states} states · {summary.alphabet.length} distinct · one state = {unit}.
    </p>
  );

  // ── decisions: said on the page, one line each ──────────────────────────
  const notices: string[] = [];
  if (section === 'clusters' && kMax >= 2 && kUsed < Number(k)) {
    notices.push(`k = ${kUsed}: ${summary.n_usable} sequences allow at most ${kMax} clusters.`);
  }
  if (reliability) {
    const unstable = reliability.cs.filter((r) => r.reading === 'unstable').map((r) => r.measure);
    if (unstable.length) notices.push(`${unstable.join(', ')}: CS below 0.25 — the ranking does not survive dropping cases.`);
  }
  if (clusters?.sizes.length) {
    const small = clusters.sizes.filter((s) => s.sequences < 3);
    if (small.length) {
      const which = small.map((s) => `${s.cluster.replace(/^c/, 'C')} holds ${plural(s.sequences, 'sequence')}`).join('; ');
      notices.push(kUsed > 2 ? `${which} — try a smaller k.` : `${which} — too few to describe a type; these sessions may not split into clusters.`);
    }
    const fit = clusters.chosen;
    if (fit) {
      if (!fit.converged) notices.push(`EM did not converge for k = ${kUsed}.`);
      else if (fit.n_starts > 1 && fit.starts_at_best < 2) notices.push(`Only ${fit.starts_at_best} of ${fit.n_starts} EM starts reached this fit — it is not a stable solution.`);
    }
  }

  // ── what the "?" says, per section ──────────────────────────────────────
  let info: ReactNode = null;
  if (seqs) {
    info = (
      <>
        {counts}
        {seqs.positions ? (
          <p>
            {seqs.positions.note
              ? <>Index plot, distribution and entropy profile: {seqs.positions.note} (the longest has {seqs.positions.longest}). Mean times and the indices table use the whole sequences.</>
              : <>All {seqs.positions.shown} positions are shown.</>}
          </p>
        ) : null}
        <p>Index plot: one row per sequence, one cell per state. State distribution: the share of sequences in each state at each position (TraMineR seqdplot). Entropy profile: how mixed the states are across sequences at each position, 0 when all agree. Mean time: the mean number of positions a sequence spends in each state, ± SD (TraMineR seqmtplot).</p>
        <p>Indices (codyna, TraMineR parity): length, distinct states, longitudinal entropy, mean spell, complexity (Gabadinho et al. 2010).</p>
      </>
    );
  } else if (network) {
    info = (
      <>
        {counts}
        <p>Transition network (TNA, Saqr et al. 2025): the probability of moving from one state to the next, pooled over sequences; the arc on a node is its self-loop.</p>
        <p>Centralities: in-strength (how much probability flows into a state), out-strength, betweenness (how often a state lies on the shortest paths). Communities ({community}{network.n_communities !== null ? `, ${plural(network.n_communities, 'community', 'communities')}` : ''}): states that pass to each other more than to the rest; the table lists every method.</p>
        {network.method_errors && Object.keys(network.method_errors).length ? (
          <p>Methods that failed: {Object.entries(network.method_errors).map(([m, e]) => `${m} (${e.message})`).join('; ')}.</p>
        ) : null}
      </>
    );
  } else if (reliability) {
    info = (
      <>
        {counts}
        {reliability.counts ? (
          <p>Bootstrap ({reliability.counts.iter} resamples of the sequences, seed {reliability.counts.seed}): {reliability.counts.stable} of {reliability.counts.edges} observed transitions keep their weight within the stability range.</p>
        ) : null}
        <p>
          Case-dropping stability (CS): the largest share of sequences that can be dropped while the centrality ranking still correlates ≥ 0.7 with the full data in 95 % of draws; ≥ 0.5 preferred, ≥ 0.25 at least (Epskamp et al. 2018). Over three seeds:{' '}
          {reliability.cs.map((r, i) => <span key={r.measure}>{i ? '; ' : ''}{r.measure} {String(r.cs)} ({r.reading}, {String(r.cs_min)}–{String(r.cs_max)})</span>)}.
        </p>
        {summary.n_usable < 10 ? <p>With {plural(summary.n_usable, 'sequence')}, both rest on resampling very few cases.</p> : null}
      </>
    );
  } else if (lagged) {
    info = (
      <>
        {counts}
        {lagged.counts ? (
          <p>Lag-sequential analysis (Bakeman &amp; Quera 2011), lag {lagged.counts.lag}: of {lagged.counts.cells} transitions, {lagged.counts.above} occur more often and {lagged.counts.below} less often than if the next state did not depend on the current one ({lagged.counts.adjust}-adjusted, α = {lagged.counts.alpha}).</p>
        ) : null}
        <p>Heatmap and network: adjusted residuals, positive where a transition is more frequent than chance. Rose: petal height is the count of each transition, its colour the probability.</p>
      </>
    );
  } else if (section === 'transfer') {
    info = (
      <>
        {counts}
        <p>Transfer entropy (Schreiber 2000): whether being in one state tells you about the next state beyond what the sequence's own history does. Each ordered pair is tested against shuffled surrogates; the smallest attainable p is 1 / (surrogates + 1).</p>
        {teResult?.counts ? (
          <p>Lag {teResult.counts.lag}, history {teResult.counts.history}: {teResult.counts.significant} of {teResult.counts.pairs} ordered pairs significant ({teResult.counts.adjust}-adjusted p &lt; {teResult.counts.alpha}; {teResult.counts.iterations} surrogates; {(teResult.elapsed_ms / 1000).toFixed(1)} s).</p>
        ) : null}
      </>
    );
  } else if (clusters) {
    info = (
      <>
        {counts}
        {clusters.sizes.length ? <p>Sizes: {clusters.sizes.map((s) => `${s.cluster} ${s.sequences}`).join(' · ')} sequences.</p> : null}
        {clusterMethod === 'mmm'
          ? <p>Mixture Markov model: each cluster is its own transition matrix; EM from 10 seeded starts per k, keeping the best. Lower BIC / ICL is better; avepp is the mean posterior of the assigned cluster (≥ 0.7 is clear); starts_at_best says how many starts reached the best fit.</p>
          : <p>PAM on the {dissimilarity} distance between sequences; higher silhouette is better (≥ 0.5 clear, &lt; 0.25 no structure).</p>}
        {summary.n_usable < 20 ? <p>With {plural(summary.n_usable, 'sequence')} each cluster rests on a handful of sessions: read it as a description of these sessions, not as types.</p> : null}
      </>
    );
  }

  if (!summary.n_usable) {
    return (
      <div className="flex flex-col gap-3">
        {lead ? <div className="flex flex-wrap items-center gap-2">{lead}</div> : null}
        <p className="m-0 text-xs text-ink-3">No sequence with two or more states here; pick another channel or span.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {lead}
        <Segmented label="Dynamics view" value={section} options={DYNAMICS_SECTIONS} onChange={setSection} />
        {section === 'sequences' || section === 'clusters' ? (
          <InlineSelect label="positions" value={positions} options={POSITION_CUTS.map((c) => ({ value: c.id, label: c.label }))} onChange={setPositions}
            title="How far the index plot, state distribution and entropy profile run. Mean times and the table use whole sequences." />
        ) : null}
        {section === 'network' ? (
          <InlineSelect label="communities" value={community} options={opts(COMMUNITY_METHODS)} onChange={setCommunity}
            title="Community method drawn; the table lists every method." />
        ) : null}
        {section === 'lag' ? <InlineSelect label="lag" value={lag} options={opts(LAGS)} onChange={setLag} /> : null}
        {section === 'transfer' ? (
          <>
            <InlineSelect label="lag" value={teLag} options={opts(LAGS)} onChange={setTeLag} />
            <InlineSelect label="surrogates" value={iterations} options={opts(ITERATIONS)} onChange={setIterations}
              title="Shuffles per pair for the surrogate test; the smallest attainable p is 1 / (surrogates + 1)." />
            <Button size="sm" variant="primary" disabled={teRunning} onClick={() => setTeRunning(true)}>
              <Play className="size-3.5" aria-hidden="true" /> {teRunning ? 'Computing…' : teResult ? 'Run again' : 'Run'}
            </Button>
          </>
        ) : null}
        {section === 'clusters' ? (
          <>
            <InlineSelect label="method" value={clusterMethod} options={CLUSTER_METHODS} onChange={setClusterMethod} />
            <InlineSelect label="k" value={String(kUsed) as (typeof KS)[number]} onChange={setK}
              options={KS.map((x) => ({ value: x, label: x, disabled: Number(x) > kMax }))} />
            {clusterMethod === 'pam' ? <InlineSelect label="distance" value={dissimilarity} options={opts(DISSIMILARITIES)} onChange={setDissimilarity} /> : null}
          </>
        ) : null}
        {info ? <InfoTip label={DYNAMICS_SECTIONS.find((s) => s.id === section)?.label ?? section}>{info}</InfoTip> : null}
      </div>

      {/* The counts at a glance (ladyna describeSequences), whatever section is open. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Metric label="Sequences" value={summary.n_usable} />
        <Metric label="States" value={summary.n_states} hint={unit} />
        <Metric label="Mean length" value={summary.mean_length} format={(v) => v.toFixed(1)} hint="states per sequence" />
        <Metric label="Distinct states" value={summary.alphabet.length} />
        <Metric label="Transitions" value={summary.n_transitions} hint="adjacent state pairs" />
        <Metric label="State entropy" value={summary.state_entropy} format={(v) => v.toFixed(2)} hint="normalised 0–1" />
      </div>

      {notices.map((n) => <Notice key={n}>{n}</Notice>)}

      {seqs ? (
        <>
          <Figures views={seqs.views} prefix={filePrefix} />
          <RowsTable rows={seqs.rows} shade={['entropy', 'complexity', 'transition_rate']} title="Sequence indices (one row per sequence)" fileName={`${filePrefix}-sequence-indices.csv`} />
        </>
      ) : null}

      {network ? (
        <>
          {/* Centralities are small multiples (one panel per measure): full width. */}
          <Figures views={network.views.filter((v) => v.id !== 'network-centralities')} prefix={filePrefix} />
          <Figures views={network.views.filter((v) => v.id === 'network-centralities')} prefix={filePrefix} columns={1} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RowsTable rows={network.centralities} shade={Object.keys(network.centralities[0] ?? {}).filter((k) => k !== 'state')} title="Centralities" fileName={`${filePrefix}-centralities.csv`} />
            <RowsTable rows={network.communities} title="Community per state, every method" fileName={`${filePrefix}-communities.csv`} />
          </div>
        </>
      ) : null}

      {reliability ? (
        <>
          <Figures views={reliability.views} prefix={filePrefix} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RowsTable rows={reliability.edges} shade={['weight']} title="Bootstrapped transitions" fileName={`${filePrefix}-bootstrap.csv`} />
            <RowsTable rows={reliability.cs} shade={['cs']} title="CS coefficient over three seeds" fileName={`${filePrefix}-cs.csv`} />
          </div>
        </>
      ) : null}

      {lagged ? (
        <>
          <Figures views={lagged.views} prefix={filePrefix} />
          <RowsTable rows={lagged.rows} shade={['adj_res', 'yules_q']} title="Transitions, by |adjusted residual|" fileName={`${filePrefix}-lsa-lag${lagged.counts?.lag ?? lag}.csv`} />
        </>
      ) : null}

      {section === 'transfer' ? (
        teResult ? (
          <>
            <Figures views={teResult.views} prefix={filePrefix} columns={1} />
            <RowsTable rows={teResult.rows} shade={['te', 'te_effective']} title="Transfer entropy per pair" fileName={`${filePrefix}-transfer-entropy.csv`} />
          </>
        ) : (
          <p className="m-0 text-xs text-ink-3">
            {teRunning ? 'Computing the surrogate tests…' : `Press Run to test the ${summary.alphabet.length * (summary.alphabet.length - 1)} ordered state pairs.`}
          </p>
        )
      ) : null}

      {clusters ? (
        <>
          {/* The per-cluster grid holds one network per cluster: full width. */}
          <Figures views={clusters.views.slice(0, 1)} prefix={filePrefix} columns={1} />
          <Figures views={clusters.views.slice(1)} prefix={filePrefix} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RowsTable rows={clusters.fits} title="Fit by k" fileName={`${filePrefix}-cluster-fits.csv`}
              info={clusterMethod === 'mmm'
                ? <p>Lower BIC / ICL is better. avepp: mean posterior of the assigned cluster (≥ 0.7 clear). class_error: share expected misassigned. starts_at_best: how many of the EM starts reached the best log-likelihood.</p>
                : <p>Higher silhouette is better (≥ 0.5 clear, &lt; 0.25 no structure). sizes: sequences per cluster.</p>} />
            <RowsTable rows={clusters.assignments} shade={['posterior']} title="Cluster per sequence" fileName={`${filePrefix}-cluster-assignments.csv`}
              info={clusterMethod === 'mmm' ? <p>posterior: the model&apos;s probability that the sequence belongs to its assigned cluster.</p> : undefined} />
          </div>
        </>
      ) : null}
    </div>
  );
}
