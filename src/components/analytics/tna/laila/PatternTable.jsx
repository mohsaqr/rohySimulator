// Redesigned pattern table (newest chatoyon-plus/LAILA version): ranked
// stacked rows instead of a numeric grid. Each row shows the state-chip
// sequence (horizontally scrollable so long patterns never push the numbers
// off-screen), the raw frequency, and a support bar scaled to the strongest
// displayed pattern. Full metrics (support / lift / proportion) live in the
// row tooltip; sorting is via the chip buttons above the list.

import { useState, useMemo } from 'react';
import { useTranslation } from './i18nShim';

// Soft tinted pill: translucent fill + raw-color text + faint inset border.
// Uses color-mix so it works with any colorMap value and adapts to light/dark.
function chipStyle(color) {
    const c = color || '#888';
    return {
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
        color: c,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 32%, transparent)`,
    };
}

const PatternTable = ({ patterns, colorMap }) => {
    const { t } = useTranslation(['admin']);
    const [sortBy, setSortBy] = useState('support');
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
    const maxSupport = Math.max(...displayed.map((p) => p.support), 1e-9);

    const sortKeys = [
        { key: 'support', label: t('pattern_support') },
        { key: 'frequency', label: t('pattern_frequency') },
        { key: 'lift', label: t('pattern_lift') },
    ];

    return (
        <div>
            {/* Sort control */}
            <div className="flex items-center gap-1 mb-3">
                {sortKeys.map((s) => (
                    <button
                        key={s.key}
                        onClick={() => handleSort(s.key)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${sortBy === s.key
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'
                            : 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        {s.label}{sortBy === s.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
                    </button>
                ))}
            </div>

            {/* Stacked rows — sequence on its own scrollable line so long patterns
                never push the bar/count off-screen in a narrow column. */}
            <div>
                {displayed.map((p, idx) => {
                    const states = p.pattern.split('->');
                    const firstColor = colorMap[states[0]] ?? '#888';
                    const barPct = Math.max(2, (p.support / maxSupport) * 100);
                    const tip = `${t('pattern_support')}: ${(p.support * 100).toFixed(1)}% · ${t('pattern_lift')}: ${p.lift.toFixed(2)}× · ${t('pattern_proportion')}: ${(p.proportion * 100).toFixed(1)}%`;
                    return (
                        <div
                            key={idx}
                            title={tip}
                            className="py-2.5 border-t first:border-t-0 border-gray-100 dark:border-gray-800"
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-gray-400 dark:text-gray-500">{idx + 1}</span>
                                <span className="flex-1 min-w-0 flex items-center justify-start gap-1.5 overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
                                    {states.map((state, si) => (
                                        <span key={si} className="flex items-center gap-1.5 shrink-0">
                                            {si > 0 && <span className="shrink-0 text-gray-300 dark:text-gray-600 text-[15px] font-semibold leading-none">→</span>}
                                            <span
                                                className="inline-block rounded-full px-3 py-1 text-[13px] font-semibold leading-tight"
                                                style={chipStyle(colorMap[state] ?? '#888')}
                                            >
                                                {state}
                                            </span>
                                        </span>
                                    ))}
                                </span>
                                <span className="shrink-0 tabular-nums font-semibold text-gray-800 dark:text-gray-100">{p.frequency.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-2 pl-7">
                                <div className="flex-1 h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700/60">
                                    <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: firstColor }} />
                                </div>
                                <span className="w-11 shrink-0 text-right tabular-nums text-[13px] font-medium text-gray-600 dark:text-gray-300">
                                    {(p.support * 100).toFixed(1)}%
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {sorted.length > maxRows && (
                <button
                    onClick={() => setMaxRows((prev) => prev + 20)}
                    className="mt-2 text-sm text-cyan-600 dark:text-cyan-400 hover:underline"
                >
                    {t('show_more')} ({sorted.length - maxRows} {t('remaining')})
                </button>
            )}
        </div>
    );
};

export {
    PatternTable
};
export default PatternTable;
