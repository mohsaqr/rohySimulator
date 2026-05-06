import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "./i18nShim";
import { Expand } from "lucide-react";
import { clusterData, tna, prune, centralities, stateFrequencies } from "dynajs";
import { Loading } from "./Loading";
import { TnaNetworkGraph } from "./TnaNetworkGraph";
import { TnaDistributionPlot } from "./TnaDistributionPlot";
import { ClusterNetworkModal } from "./NetworkModal";
import { createColorMap } from "./colorFix";
const ClustersTab = ({
  sequences,
  labels,
  k,
  onKChange,
  nodeRadius: clusterNodeRadius = 16,
  pruneThreshold: clusterPruneThreshold = 0.05,
  showSelfLoops: clusterShowSelfLoops = false,
  showEdgeLabels: clusterShowEdgeLabels = true,
  palette,
  dissimilarity = "hamming",
  clusterMethod = "pam"
}) => {
  const { t } = useTranslation(["admin"]);
  const colorMap = useMemo(() => createColorMap(labels, palette), [labels, palette]);
  const [result, setResult] = useState(null);
  const computeIdRef = useRef(0);
  useEffect(() => {
    if (!sequences?.length) {
      setResult(null);
      return;
    }
    const id = ++computeIdRef.current;
    setResult(null);
    const timer = setTimeout(() => {
      if (id !== computeIdRef.current) return;
      try {
        let seqsForClustering = sequences;
        const MAX = 1e3;
        if (sequences.length > MAX) {
          const step = sequences.length / MAX;
          seqsForClustering = [];
          for (let i = 0; i < MAX; i++) seqsForClustering.push(sequences[Math.floor(i * step)]);
        }
        const clusters = clusterData(seqsForClustering, k, { dissimilarity, method: clusterMethod });
        const totalSeqs = clusters.assignments.length;
        const details = clusters.sizes.map((size, cIdx) => {
          const clusterNum = cIdx + 1;
          const indices = clusters.assignments.map((a, i) => a === clusterNum ? i : -1).filter((i) => i >= 0);
          const clusterSeqs = indices.map((i) => seqsForClustering[i]);
          const freqs = stateFrequencies(clusterSeqs);
          const sortedFreqs = Object.entries(freqs).sort((a, b) => b[1] - a[1]);
          const avgLen = indices.length > 0 ? indices.reduce(
            (sum, idx) => sum + seqsForClustering[idx].filter((v) => v != null).length,
            0
          ) / indices.length : 0;
          let clusterModel = null;
          let instrength = null;
          try {
            if (clusterSeqs.length >= 1) {
              const raw = tna(clusterSeqs, { labels });
              clusterModel = prune(raw, clusterPruneThreshold);
              try {
                const cent = centralities(raw);
                const vals = Array.from(cent.measures.InStrength);
                instrength = cent.labels.map((l, i) => ({ label: l, value: vals[i] })).sort((a, b) => b.value - a.value);
              } catch {
              }
            }
          } catch {
          }
          return { clusterNum, size, pct: size / totalSeqs * 100, avgLen, sortedFreqs, clusterSeqs, clusterModel, instrength };
        });
        if (id === computeIdRef.current) setResult({ clusters, details });
      } catch {
        if (id === computeIdRef.current) setResult(null);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [sequences, labels, k, clusterPruneThreshold, dissimilarity, clusterMethod]);
  if (!result) {
    return <div className="py-16"><Loading text={t("computing_clusters")} /></div>;
  }
  const silQuality = result.clusters.silhouette > 0.5 ? t("cluster_good") : result.clusters.silhouette > 0.25 ? t("cluster_fair") : t("cluster_weak");
  return <div>
      {
    /* Header row */
  }
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
          <span>
            <span className="font-semibold text-gray-800 dark:text-gray-200">{result.details.length}</span>{" "}
            {t("clusters_found")}
          </span>
          <span>
            {t("silhouette_score")}:{" "}
            <span className="font-semibold text-gray-800 dark:text-gray-200">
              {result.clusters.silhouette.toFixed(3)}
            </span>{" "}
            <span className="text-xs">({silQuality})</span>
          </span>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span className="font-medium">{t("cluster_count")}:</span>
          <input
    type="number"
    min={2}
    max={10}
    value={k}
    onChange={(e) => {
      const val = parseInt(e.target.value);
      if (val >= 2 && val <= 10) onKChange(val);
    }}
    className="w-16 px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-center"
  />
        </label>
      </div>

      {
    /* Cluster columns */
  }
      <div
    className="grid gap-6"
    style={{
      gridTemplateColumns: `repeat(${Math.min(result.details.length, 4)}, minmax(0, 1fr))`
    }}
  >
        {result.details.map((detail) => <ClusterColumn
    key={detail.clusterNum}
    detail={detail}
    labels={labels}
    colorMap={colorMap}
    nodeRadius={clusterNodeRadius}
    showSelfLoops={clusterShowSelfLoops}
    showEdgeLabels={clusterShowEdgeLabels}
  />)}
      </div>
    </div>;
};
const ClusterColumn = ({
  detail,
  labels,
  colorMap,
  nodeRadius,
  showSelfLoops,
  showEdgeLabels
}) => {
  const { t } = useTranslation(["admin"]);
  const [modalOpen, setModalOpen] = useState(false);
  const topFreqs = detail.sortedFreqs.slice(0, 6);
  const topMaxFreq = topFreqs[0]?.[1] ?? 1;
  return <div className="flex flex-col gap-4">
      {
    /* Cluster header with top frequencies */
  }
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            {t("cluster")} {detail.clusterNum}
          </h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {detail.size} ({detail.pct.toFixed(0)}%)
          </span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t("avg_sequence_length")}: {detail.avgLen.toFixed(1)}
        </div>
        <div className="space-y-1.5">
          {topFreqs.map(([state, count]) => <div key={state} className="flex items-center gap-2 text-xs">
              <span
    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
    style={{ backgroundColor: colorMap[state] ?? "#888" }}
  />
              <span className="text-gray-700 dark:text-gray-300 w-20 truncate">{state}</span>
              <div className="flex-1 h-3.5 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                <div
    className="h-full rounded"
    style={{ width: `${count / topMaxFreq * 100}%`, backgroundColor: colorMap[state] ?? "#888", opacity: 0.75 }}
  />
              </div>
              <span className="text-gray-500 dark:text-gray-400 tabular-nums w-10 text-right">{count}</span>
            </div>)}
        </div>
      </div>

      {
    /* Network graph */
  }
      {detail.clusterModel && <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-2 relative">
          <button
    onClick={() => setModalOpen(true)}
    className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-white/80 dark:bg-gray-700/80 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
    title={t("network_title")}
  >
            <Expand className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
          </button>
          <TnaNetworkGraph
    model={detail.clusterModel}
    showSelfLoops={showSelfLoops}
    showEdgeLabels={showEdgeLabels}
    nodeRadius={nodeRadius}
    height={280}
    colorMap={colorMap}
  />
          <ClusterNetworkModal
    open={modalOpen}
    onClose={() => setModalOpen(false)}
    model={detail.clusterModel}
    colorMap={colorMap}
    title={`${t("cluster")} ${detail.clusterNum} \u2014 ${t("network_title")}`}
  />
        </div>}

      {
    /* Distribution sequence plot */
  }
      {detail.clusterSeqs.length > 0 && <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <TnaDistributionPlot sequences={detail.clusterSeqs} labels={labels} colorMap={colorMap} />
        </div>}

      {
    /* InStrength centrality */
  }
      {detail.instrength && <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">{t("in_strength")}</h4>
          <div className="space-y-1">
            {detail.instrength.map(({ label, value }) => {
    const maxVal = detail.instrength[0].value || 1;
    return <div key={label} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-700 dark:text-gray-300 w-20 truncate text-right">{label}</span>
                  <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                    <div
      className="h-full rounded"
      style={{ width: `${value / maxVal * 100}%`, backgroundColor: "rgba(74, 144, 217, 0.8)" }}
    />
                  </div>
                  <span className="text-gray-500 dark:text-gray-400 tabular-nums w-12 text-right">{value.toFixed(3)}</span>
                </div>;
  })}
          </div>
        </div>}
    </div>;
};
export {
  ClustersTab
};
