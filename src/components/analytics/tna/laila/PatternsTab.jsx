// Sequence pattern mining tab (dynajs discoverPatterns). Upgraded to the
// newest chatoyon-plus/LAILA feature set: the two length panels are one
// shared PatternPanel component, and PatternTable renders the redesigned
// stacked rows (tinted pills + support bars) instead of the old numeric grid.
//
// Mining is debounced, capped at MAX_SEQS evenly-sampled sequences, and uses
// an adaptive minSupport so large datasets still surface patterns.

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from './i18nShim';
import { discoverPatterns } from 'dynajs';
import { Loading } from './Loading';
import { PatternTable } from './PatternTable';

const SHORT_LENGTHS = [2, 3];
const LONG_LENGTHS = [4, 5, 6, 7];

/** Cap sequences to avoid freezing the browser; sample evenly when too large. */
const MAX_SEQS = 1000;
function capSequences(seqs) {
    if (seqs.length <= MAX_SEQS) return seqs;
    const step = seqs.length / MAX_SEQS;
    const sampled = [];
    for (let i = 0; i < MAX_SEQS; i++) sampled.push(seqs[Math.floor(i * step)]);
    return sampled;
}

/** Scale minSupport so larger datasets still find patterns (at least 2 occurrences). */
function adaptiveSupport(n) {
    if (n <= 100) return 0.01;
    return Math.max(0.001, 2 / n);
}

const PatternsTab = ({ sequences, colorMap, shortEnabled, onShortEnabledChange: setShortEnabled, longEnabled, onLongEnabledChange: setLongEnabled }) => {
    const { t } = useTranslation(['admin']);
    const [result, setResult] = useState(null);
    const computeIdRef = useRef(0);

    useEffect(() => {
        // Debounced pattern mining: clears/sets result as an async side effect
        // of the sequence/length inputs changing (compute deferred via setTimeout).
        /* eslint-disable react-hooks/set-state-in-effect */
        if (!sequences?.length) {
            setResult({ short: [], long: [] });
            return;
        }
        const id = ++computeIdRef.current;
        setResult(null); // null = computing
        /* eslint-enable react-hooks/set-state-in-effect */
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
                } catch { /* ignore */ }
            }
            const longLens = LONG_LENGTHS.filter((l) => longEnabled[l]);
            if (longLens.length > 0) {
                try {
                    lp = discoverPatterns(capped, { len: longLens, minSupport, minFreq: 1 }).patterns;
                } catch { /* ignore */ }
            }
            if (id === computeIdRef.current) {
                setResult({ short: sp, long: lp });
            }
        }, 50);
        return () => clearTimeout(timer);
    }, [sequences, shortEnabled, longEnabled]);

    if (!result) {
        return <div className="py-16"><Loading text={t('computing_patterns')} /></div>;
    }

    const shortPatterns = result.short;
    const longPatterns = result.long;
    const total = shortPatterns.length + longPatterns.length;

    return (
        <div className="space-y-4">
            <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-700">Pattern Mining</h2>
                        <p className="mt-1 text-xs text-gray-500">Frequent short and long transition patterns for the current sequence source.</p>
                    </div>
                    <div className="rounded-md border border-cyan-100 bg-cyan-50 px-4 py-2 text-right">
                        <div className="text-2xl font-semibold leading-none tabular-nums text-gray-950">{total}</div>
                        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">{t('patterns_found')}</div>
                    </div>
                </div>
            </div>

            {/* Two cards side by side */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <PatternPanel
                    title={`${t('pattern_lengths')} 2–3`}
                    patterns={shortPatterns}
                    lengths={SHORT_LENGTHS}
                    enabled={shortEnabled}
                    onToggle={(len) => setShortEnabled({ ...shortEnabled, [len]: !shortEnabled[len] })}
                    colorMap={colorMap}
                    foundLabel={t('patterns_found')}
                    emptyLabel={t('no_data')}
                />
                <PatternPanel
                    title={`${t('pattern_lengths')} 4–7`}
                    patterns={longPatterns}
                    lengths={LONG_LENGTHS}
                    enabled={longEnabled}
                    onToggle={(len) => setLongEnabled({ ...longEnabled, [len]: !longEnabled[len] })}
                    colorMap={colorMap}
                    foundLabel={t('patterns_found')}
                    emptyLabel={t('no_data')}
                />
            </div>
        </div>
    );
};

// One pattern-length panel (short 2–3 / long 4–7): card, header with the
// per-length toggle chips, and the pattern table.
function PatternPanel({ title, patterns, lengths, enabled, onToggle, colorMap, foundLabel, emptyLabel }) {
    return (
        <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-gray-100 pb-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                    <p className="mt-0.5 text-xs font-medium text-gray-500">{patterns.length} {foundLabel}</p>
                </div>
                <div className="flex items-center gap-1">
                    {lengths.map((len) => (
                        <button
                            key={len}
                            onClick={() => onToggle(len)}
                            className={`h-8 w-8 rounded-md text-xs font-semibold transition-colors ${enabled[len]
                                ? 'bg-gray-900 text-white shadow-sm'
                                : 'bg-gray-50 text-gray-500 ring-1 ring-gray-200 hover:bg-gray-100'}`}
                        >
                            {len}
                        </button>
                    ))}
                </div>
            </div>
            {patterns.length > 0
                ? <PatternTable patterns={patterns} colorMap={colorMap} />
                : <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">{emptyLabel}</div>}
        </div>
    );
}

export {
    PatternsTab
};
export default PatternsTab;
