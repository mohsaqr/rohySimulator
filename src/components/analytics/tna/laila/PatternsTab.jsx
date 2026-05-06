import { useState, useEffect, useRef } from "react";
import { useTranslation } from "./i18nShim";
import { discoverPatterns } from "dynajs";
import { Loading } from "./Loading";
import { PatternTable } from "./PatternTable";
const SHORT_LENGTHS = [2, 3];
const LONG_LENGTHS = [4, 5, 6, 7];
const MAX_SEQS = 1e3;
function capSequences(seqs) {
  if (seqs.length <= MAX_SEQS) return seqs;
  const step = seqs.length / MAX_SEQS;
  const sampled = [];
  for (let i = 0; i < MAX_SEQS; i++) sampled.push(seqs[Math.floor(i * step)]);
  return sampled;
}
function adaptiveSupport(n) {
  if (n <= 100) return 0.01;
  return Math.max(1e-3, 2 / n);
}
const PatternsTab = ({ sequences, colorMap, shortEnabled, onShortEnabledChange: setShortEnabled, longEnabled, onLongEnabledChange: setLongEnabled }) => {
  const { t } = useTranslation(["admin"]);
  const [result, setResult] = useState(null);
  const computeIdRef = useRef(0);
  useEffect(() => {
    if (!sequences?.length) {
      setResult({ short: [], long: [] });
      return;
    }
    const id = ++computeIdRef.current;
    setResult(null);
    const timer = setTimeout(() => {
      if (id !== computeIdRef.current) return;
      const capped = capSequences(sequences);
      const minSupport = adaptiveSupport(capped.length);
      let sp = [];
      let lp = [];
      const shortLens = SHORT_LENGTHS.filter((l) => shortEnabled[l]);
      if (shortLens.length > 0) {
        try {
          sp = discoverPatterns(capped, { len: shortLens, minSupport, minFreq: 1 }).patterns;
        } catch {
        }
      }
      const longLens = LONG_LENGTHS.filter((l) => longEnabled[l]);
      if (longLens.length > 0) {
        try {
          lp = discoverPatterns(capped, { len: longLens, minSupport, minFreq: 1 }).patterns;
        } catch {
        }
      }
      if (id === computeIdRef.current) {
        setResult({ short: sp, long: lp });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [sequences, shortEnabled, longEnabled]);
  if (!result) {
    return <div className="py-16"><Loading text={t("computing_patterns")} /></div>;
  }
  const shortPatterns = result.short;
  const longPatterns = result.long;
  const total = shortPatterns.length + longPatterns.length;
  return <div>
      {
    /* Summary */
  }
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-4">
        <span className="font-semibold text-gray-800 dark:text-gray-200">{total}</span>{" "}
        {t("patterns_found")}
      </div>

      {
    /* Two cards side by side */
  }
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {
    /* Short patterns */
  }
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                {t("pattern_lengths")} 2–3
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {shortPatterns.length} {t("patterns_found")}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {SHORT_LENGTHS.map((len) => <button
    key={len}
    onClick={() => setShortEnabled({ ...shortEnabled, [len]: !shortEnabled[len] })}
    className={`w-7 h-7 rounded text-xs font-medium transition-colors ${shortEnabled[len] ? "bg-primary-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
  >
                  {len}
                </button>)}
            </div>
          </div>
          {shortPatterns.length > 0 ? <PatternTable patterns={shortPatterns} colorMap={colorMap} /> : <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">{t("no_data")}</div>}
        </div>

        {
    /* Long patterns */
  }
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                {t("pattern_lengths")} 4–7
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {longPatterns.length} {t("patterns_found")}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {LONG_LENGTHS.map((len) => <button
    key={len}
    onClick={() => setLongEnabled({ ...longEnabled, [len]: !longEnabled[len] })}
    className={`w-7 h-7 rounded text-xs font-medium transition-colors ${longEnabled[len] ? "bg-primary-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
  >
                  {len}
                </button>)}
            </div>
          </div>
          {longPatterns.length > 0 ? <PatternTable patterns={longPatterns} colorMap={colorMap} /> : <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">{t("no_data")}</div>}
        </div>
      </div>
    </div>;
};
export {
  PatternsTab
};
