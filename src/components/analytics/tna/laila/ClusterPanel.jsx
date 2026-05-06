import { useMemo } from "react";
import { useTranslation } from "./i18nShim";
import { colorPalette } from "./colorFix";
const ClusterPanel = ({ clusters, sequences, colorMap }) => {
  const { t } = useTranslation(["admin"]);
  const k = clusters.sizes.length;
  const clusterColors = colorPalette(k, "vivid");
  const clusterDetails = useMemo(() => {
    return clusters.sizes.map((size, cIdx) => {
      const clusterNum = cIdx + 1;
      const indices = clusters.assignments.map((a, i) => a === clusterNum ? i : -1).filter((i) => i >= 0);
      const stateCounts = {};
      for (const idx of indices) {
        for (const val of sequences[idx]) {
          if (val) stateCounts[val] = (stateCounts[val] ?? 0) + 1;
        }
      }
      const topStates = Object.entries(stateCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const avgLen = indices.length > 0 ? indices.reduce((sum, idx) => sum + sequences[idx].filter((v) => v !== null).length, 0) / indices.length : 0;
      return { clusterNum, size, topStates, avgLen, pct: size / clusters.assignments.length * 100 };
    });
  }, [clusters, sequences]);
  const silQuality = clusters.silhouette > 0.5 ? t("cluster_good") : clusters.silhouette > 0.25 ? t("cluster_fair") : t("cluster_weak");
  return <div>
      <div className="flex items-center gap-4 mb-4">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-800 dark:text-gray-200">{k}</span> {t("clusters_found")}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {t("silhouette_score")}: <span className="font-medium text-gray-800 dark:text-gray-200">
            {clusters.silhouette.toFixed(3)}
          </span>
          <span className="ml-1 text-xs">({silQuality})</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {clusterDetails.map((detail) => <div
    key={detail.clusterNum}
    className="rounded-lg border border-gray-200 dark:border-gray-700 p-4"
    style={{ borderLeftColor: clusterColors[detail.clusterNum - 1], borderLeftWidth: 4 }}
  >
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-gray-800 dark:text-gray-200">
                {t("cluster")} {detail.clusterNum}
              </h4>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {detail.size} ({detail.pct.toFixed(0)}%)
              </span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              {t("avg_sequence_length")}: {detail.avgLen.toFixed(1)}
            </div>
            <div className="space-y-1">
              {detail.topStates.map(([state, count]) => {
    const maxCount = detail.topStates[0][1];
    const pct = count / maxCount * 100;
    return <div key={state} className="flex items-center gap-2 text-xs">
                    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: colorMap[state] ?? "#888" }}
    />
                    <span className="text-gray-700 dark:text-gray-300 w-20 truncate">{state}</span>
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
      className="h-full rounded-full"
      style={{
        width: `${pct}%`,
        backgroundColor: colorMap[state] ?? "#888",
        opacity: 0.7
      }}
    />
                    </div>
                    <span className="text-gray-500 dark:text-gray-400 tabular-nums w-8 text-right">
                      {count}
                    </span>
                  </div>;
  })}
            </div>
          </div>)}
      </div>
    </div>;
};
export {
  ClusterPanel
};
