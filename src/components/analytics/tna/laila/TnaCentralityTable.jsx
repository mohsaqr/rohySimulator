import { useState, useMemo } from "react";
import { useTranslation } from "./i18nShim";
const MEASURE_I18N = {
  Degree: "sna.m_degree",
  InDegree: "sna.m_in_degree",
  OutDegree: "sna.m_out_degree",
  InStrength: "sna.m_in_strength",
  OutStrength: "sna.m_out_strength",
  Betweenness: "sna.m_betweenness",
  Closeness: "sna.m_closeness"
};
const TnaCentralityTable = ({ centralityData, colorMap }) => {
  const { t } = useTranslation(["courses", "admin"]);
  const measureKeys = useMemo(() => Object.keys(centralityData.measures).filter((k) => centralityData.measures[k]?.length > 0), [centralityData]);
  const [sortBy, setSortBy] = useState(() => measureKeys[0] ?? "InStrength");
  const [sortAsc, setSortAsc] = useState(false);
  const availableMeasures = useMemo(() => {
    return measureKeys.map((key) => ({ key, i18nKey: MEASURE_I18N[key] }));
  }, [measureKeys]);
  const rows = useMemo(() => {
    const { labels, measures } = centralityData;
    return labels.map((label, i) => {
      const values = {};
      for (const { key } of availableMeasures) {
        values[key] = measures[key]?.[i] ?? 0;
      }
      return { label, values };
    });
  }, [centralityData, availableMeasures]);
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const diff = (a.values[sortBy] ?? 0) - (b.values[sortBy] ?? 0);
      return sortAsc ? diff : -diff;
    });
  }, [rows, sortBy, sortAsc]);
  const handleSort = (measure) => {
    if (sortBy === measure) setSortAsc(!sortAsc);
    else {
      setSortBy(measure);
      setSortAsc(false);
    }
  };
  return <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-300">
              {t("verb")}
            </th>
            {availableMeasures.map(({ key, i18nKey }) => <th
    key={key}
    className="text-right py-2 px-3 font-medium text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-white select-none"
    onClick={() => handleSort(key)}
  >
                {i18nKey ? t(`courses:${i18nKey}`) : key}
                {sortBy === key && <span className="ml-1">{sortAsc ? "\u25B2" : "\u25BC"}</span>}
              </th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ label, values }) => <tr key={label} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <td className="py-1.5 px-3 flex items-center gap-2 text-gray-800 dark:text-gray-200">
                <span
    className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
    style={{ backgroundColor: colorMap[label] ?? "#888" }}
  />
                {label}
              </td>
              {availableMeasures.map(({ key }) => <td key={key} className="text-right py-1.5 px-3 tabular-nums text-gray-600 dark:text-gray-400">
                  {(values[key] ?? 0).toFixed(3)}
                </td>)}
            </tr>)}
        </tbody>
      </table>
    </div>;
};
export {
  TnaCentralityTable
};
