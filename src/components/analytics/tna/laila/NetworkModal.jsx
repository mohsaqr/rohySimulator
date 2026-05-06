import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "./i18nShim";
import { X } from "lucide-react";
import { tna, ftna, ctna, atna, prune, centralities, layout as dynaLayout } from "dynajs";
import { TnaNetworkGraph } from "./TnaNetworkGraph";
import { createColorMap } from "./colorFix";
const MODEL_BUILDERS = {
  relative: tna,
  frequency: ftna,
  "co-occurrence": ctna,
  attention: atna
};
const NODE_SIZE_OPTIONS = [
  { value: "fixed", i18nKey: "fixed_size" },
  { value: "InStrength", i18nKey: "in_strength" }
];
const LAYOUT_OPTIONS = [
  { value: "circle", i18nKey: "sna.layout_circle" },
  { value: "fr", i18nKey: "sna.layout_force" },
  { value: "kamada-kawai", i18nKey: "sna.layout_kamada_kawai" },
  { value: "spectral", i18nKey: "sna.layout_spectral" },
  { value: "concentric", i18nKey: "sna.layout_concentric" },
  { value: "star", i18nKey: "sna.layout_star" },
  { value: "hierarchical", i18nKey: "sna.layout_hierarchical" },
  { value: "grid", i18nKey: "sna.layout_grid" },
  { value: "random", i18nKey: "sna.layout_random" }
];
const NetworkModal = ({
  open,
  onClose,
  sequences,
  labels,
  initialModelType = "relative",
  initialPruneThreshold = 0.05
}) => {
  const { t } = useTranslation(["admin"]);
  const [modelType, setModelType] = useState(initialModelType);
  const [pruneThreshold, setPruneThreshold] = useState(initialPruneThreshold);
  const [showSelfLoops, setShowSelfLoops] = useState(false);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [nodeRadius, setNodeRadius] = useState(30);
  const [nodeSizeMetric, setNodeSizeMetric] = useState("fixed");
  const [graphLayout, setGraphLayout] = useState("circle");
  useEffect(() => {
    if (open) {
      setModelType(initialModelType);
      setPruneThreshold(initialPruneThreshold);
    }
  }, [open, initialModelType, initialPruneThreshold]);
  useEscapeClose(open, onClose);
  const analysis = useMemo(() => {
    if (!sequences?.length) return null;
    try {
      const builder = MODEL_BUILDERS[modelType];
      const rawModel = builder(sequences, { labels });
      const prunedM = prune(rawModel, pruneThreshold);
      const colorMap = createColorMap(labels);
      let cent = null;
      try {
        const raw = centralities(rawModel);
        const measures = {};
        for (const [k, v] of Object.entries(raw.measures)) {
          measures[k] = Array.from(v);
        }
        cent = { labels: raw.labels, measures };
      } catch {
      }
      return { prunedModel: prunedM, colorMap, centralityData: cent };
    } catch {
      return null;
    }
  }, [sequences, labels, modelType, pruneThreshold]);
  const graphPositions = useMemo(() => {
    if (!analysis?.prunedModel) return void 0;
    const result = dynaLayout(analysis.prunedModel, { algorithm: graphLayout });
    const h = 540;
    const pad = nodeRadius + 5;
    return Array.from({ length: result.labels.length }, (_, i) => ({
      x: pad + result.x[i] * (h - 2 * pad),
      y: pad + result.y[i] * (h - 2 * pad)
    }));
  }, [analysis?.prunedModel, graphLayout, nodeRadius]);
  if (!open) return null;
  return <ModalShell title={t("network_title")} onClose={onClose}>
      {
    /* Controls */
  }
      <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex flex-wrap gap-x-6 gap-y-3 items-center text-sm">
          <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
            <span className="font-medium">{t("model_type")}:</span>
            <select
    value={modelType}
    onChange={(e) => setModelType(e.target.value)}
    className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm"
  >
              <option value="relative">{t("model_relative")}</option>
              <option value="frequency">{t("model_frequency")}</option>
              <option value="co-occurrence">{t("model_cooccurrence")}</option>
              <option value="attention">{t("model_attention")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
            <span className="font-medium">{t("prune_threshold")}:</span>
            <input
    type="range"
    min={0}
    max={0.5}
    step={0.01}
    value={pruneThreshold}
    onChange={(e) => setPruneThreshold(parseFloat(e.target.value))}
    className="w-28"
  />
            <span className="text-xs tabular-nums w-8">{pruneThreshold.toFixed(2)}</span>
          </label>
          <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
            <span className="font-medium">{t("node_radius")}:</span>
            <input
    type="range"
    min={15}
    max={50}
    value={nodeRadius}
    onChange={(e) => setNodeRadius(parseInt(e.target.value))}
    className="w-20"
  />
            <span className="text-xs tabular-nums w-5">{nodeRadius}</span>
          </label>
          <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
            <span className="font-medium">{t("node_size_by")}:</span>
            <select
    value={nodeSizeMetric}
    onChange={(e) => setNodeSizeMetric(e.target.value)}
    className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm"
  >
              {NODE_SIZE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{t(opt.i18nKey)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
            <span className="font-medium">{t("layout")}:</span>
            <select
    value={graphLayout}
    onChange={(e) => setGraphLayout(e.target.value)}
    className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm"
  >
              {LAYOUT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{t(opt.i18nKey)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
            <input
    type="checkbox"
    checked={showSelfLoops}
    onChange={(e) => setShowSelfLoops(e.target.checked)}
    className="rounded"
  />
            {t("show_self_loops")}
          </label>
          <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
            <input
    type="checkbox"
    checked={showEdgeLabels}
    onChange={(e) => setShowEdgeLabels(e.target.checked)}
    className="rounded"
  />
            {t("show_edge_labels")}
          </label>
        </div>
      </div>

      {
    /* Graph */
  }
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {analysis?.prunedModel ? <TnaNetworkGraph
    model={analysis.prunedModel}
    showSelfLoops={showSelfLoops}
    showEdgeLabels={showEdgeLabels}
    nodeRadius={nodeRadius}
    height={540}
    colorMap={analysis.colorMap}
    centralityData={analysis.centralityData ?? void 0}
    nodeSizeMetric={nodeSizeMetric}
    modelType={modelType}
    externalPositions={graphPositions}
  /> : <div className="text-gray-400 dark:text-gray-500 text-sm">{t("no_tna_data")}</div>}
      </div>
    </ModalShell>;
};
const ClusterNetworkModal = ({
  open,
  onClose,
  model,
  colorMap,
  title
}) => {
  const { t } = useTranslation(["admin"]);
  const [showSelfLoops, setShowSelfLoops] = useState(false);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [nodeRadius, setNodeRadius] = useState(30);
  useEscapeClose(open, onClose);
  if (!open) return null;
  return <ModalShell title={title ?? t("network_title")} onClose={onClose}>
      {
    /* Controls */
  }
      <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex flex-wrap gap-x-6 gap-y-3 items-center text-sm">
          <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
            <span className="font-medium">{t("node_radius")}:</span>
            <input
    type="range"
    min={15}
    max={50}
    value={nodeRadius}
    onChange={(e) => setNodeRadius(parseInt(e.target.value))}
    className="w-20"
  />
            <span className="text-xs tabular-nums w-5">{nodeRadius}</span>
          </label>
          <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
            <input
    type="checkbox"
    checked={showSelfLoops}
    onChange={(e) => setShowSelfLoops(e.target.checked)}
    className="rounded"
  />
            {t("show_self_loops")}
          </label>
          <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
            <input
    type="checkbox"
    checked={showEdgeLabels}
    onChange={(e) => setShowEdgeLabels(e.target.checked)}
    className="rounded"
  />
            {t("show_edge_labels")}
          </label>
        </div>
      </div>

      {
    /* Graph */
  }
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        <TnaNetworkGraph
    model={model}
    showSelfLoops={showSelfLoops}
    showEdgeLabels={showEdgeLabels}
    nodeRadius={nodeRadius}
    height={540}
    colorMap={colorMap}
  />
      </div>
    </ModalShell>;
};
function useEscapeClose(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);
}
const ModalShell = ({
  title,
  onClose,
  children
}) => <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
    <div className="relative z-10 w-[95vw] max-w-5xl max-h-[92vh] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
        <button
  onClick={onClose}
  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
>
          <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
        </button>
      </div>
      {children}
    </div>
  </div>;
export {
  ClusterNetworkModal,
  ModalShell,
  NetworkModal,
  useEscapeClose
};
