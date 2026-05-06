import { useState, useMemo } from "react";
import { useTranslation } from "./i18nShim";
const PatternTable = ({ patterns, colorMap }) => {
  const { t } = useTranslation(["admin"]);
  const [sortBy, setSortBy] = useState("frequency");
  const [sortAsc, setSortAsc] = useState(false);
  const [maxRows, setMaxRows] = useState(20);
  const sorted = useMemo(() => {
    return [...patterns].sort((a, b) => {
      const diff = a[sortBy] - b[sortBy];
      return sortAsc ? diff : -diff;
    });
  }, [patterns, sortBy, sortAsc]);
  const handleSort = (key) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else {
      setSortBy(key);
      setSortAsc(false);
    }
  };
  const displayed = sorted.slice(0, maxRows);
  const columns = [
    { key: "frequency", label: t("pattern_frequency"), format: (v) => String(v) },
    { key: "support", label: t("pattern_support"), format: (v) => v.toFixed(3) },
    { key: "lift", label: t("pattern_lift"), format: (v) => v.toFixed(2) },
    { key: "proportion", label: t("pattern_proportion"), format: (v) => (v * 100).toFixed(1) + "%" }
  ];
  return <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-700">
              <th className="text-left py-2 px-3 font-medium text-neutral-300">
                {t("pattern")}
              </th>
              {columns.map((col) => <th
    key={col.key}
    className="text-right py-2 px-3 font-medium text-neutral-300 cursor-pointer hover:text-gray-900 dark:hover:text-white select-none whitespace-nowrap"
    onClick={() => handleSort(col.key)}
  >
                  {col.label}
                  {sortBy === col.key && <span className="ml-1">{sortAsc ? "\u25B2" : "\u25BC"}</span>}
                </th>)}
            </tr>
          </thead>
          <tbody>
            {displayed.map((p, idx) => {
    const states = p.pattern.split("->");
    return <tr
      key={idx}
      className="border-b border-neutral-800 hover:bg-neutral-800/50"
    >
                  <td className="py-1.5 px-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      {states.map((state, si) => <span key={si} className="flex items-center gap-1">
                          {si > 0 && <span className="text-gray-400 text-xs">&rarr;</span>}
                          <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white"
      style={{ backgroundColor: colorMap[state] ?? "#888" }}
    >
                            {state}
                          </span>
                        </span>)}
                    </div>
                  </td>
                  {columns.map((col) => <td key={col.key} className="text-right py-1.5 px-3 tabular-nums text-neutral-400">
                      {col.format(p[col.key])}
                    </td>)}
                </tr>;
  })}
          </tbody>
        </table>
      </div>
      {sorted.length > maxRows && <button
    onClick={() => setMaxRows((prev) => prev + 20)}
    className="mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
  >
          {t("show_more")} ({sorted.length - maxRows} {t("remaining")})
        </button>}
    </div>;
};
export {
  PatternTable
};
