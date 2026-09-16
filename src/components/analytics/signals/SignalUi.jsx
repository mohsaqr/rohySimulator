// Shared building blocks for the Text and Voice analytics tabs.
//
// English-only by design: src/components/analytics/** is excluded from i18n
// extraction (i18next-parser.config.js), like the rest of this dashboard.
// Styling follows OyonGazeView (the light analytics theme). Charts are plain
// SVG — no chart library — in the Okabe-Ito palette, and every bar carries a
// text label so nothing is read by colour alone.

import React from 'react';
import { OKABE_ITO } from './signalStats.js';
import { fmtPct } from './signalFormat.js';

// ── layout ─────────────────────────────────────────────────────────────────

export function Stat({ label, value, hint, accent = false }) {
    return (
        <div className={`min-w-[9rem] rounded-lg border px-3 py-2 ${accent ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-white'}`}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</div>
            <div className="mt-0.5 text-lg font-semibold text-gray-900 tabular-nums">{value}</div>
            {hint && <div className="mt-0.5 text-[11px] text-gray-500">{hint}</div>}
        </div>
    );
}

export function Section({ title, description, children, right = null }) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                    {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
                </div>
                {right}
            </header>
            <div className="p-4">{children}</div>
        </section>
    );
}

/** A plain, honest note: what this tab measures and what it does not. */
export function Scope({ children }) {
    return (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">{children}</p>
    );
}

export function EmptyState({ icon: Icon, title, children }) {
    return (
        <div className="rohy-admin-light rounded-lg border border-gray-200 bg-white p-8 text-center">
            {Icon && <Icon className="mx-auto mb-2 h-6 w-6 text-gray-400" aria-hidden="true" />}
            <div className="text-sm font-medium text-gray-800">{title}</div>
            <div className="mx-auto mt-2 max-w-xl text-sm text-gray-600">{children}</div>
        </div>
    );
}

// ── charts ─────────────────────────────────────────────────────────────────

/**
 * Horizontal bars for a pooled pause histogram. Each bar is labelled with its
 * bucket and its count and share, so the chart reads without colour.
 */
export function PauseHistogram({ pauses, unit = 'pauses' }) {
    if (!pauses || pauses.total === 0) {
        return <p className="text-sm text-gray-500">No pauses recorded for this selection.</p>;
    }
    const rowH = 26;
    const labelW = 70;
    const valueW = 110;
    const width = 560;
    const barMax = width - labelW - valueW;
    const maxShare = Math.max(...pauses.buckets.map((b) => b.share), 0.0001);
    const height = pauses.buckets.length * rowH;
    return (
        <figure>
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full max-w-2xl"
                role="img"
                aria-label={`Pause length distribution across ${pauses.total} ${unit}`}
            >
                {pauses.buckets.map((b, i) => {
                    const y = i * rowH;
                    const w = Math.max(b.count > 0 ? 2 : 0, (b.share / maxShare) * barMax);
                    return (
                        <g key={b.key}>
                            <text x={labelW - 8} y={y + rowH / 2} textAnchor="end" dominantBaseline="middle" className="fill-gray-700" fontSize="12">
                                {b.label}
                            </text>
                            <rect x={labelW} y={y + 5} width={w} height={rowH - 10} rx="2" fill={OKABE_ITO[4]} />
                            <text x={labelW + w + 6} y={y + rowH / 2} dominantBaseline="middle" className="fill-gray-700" fontSize="12">
                                {`${b.count} · ${fmtPct(b.share)}`}
                            </text>
                        </g>
                    );
                })}
            </svg>
            <figcaption className="mt-1 text-xs text-gray-500">
                {`${pauses.total} ${unit} pooled across the selection`}
                {pauses.skipped > 0 ? ` · ${pauses.skipped} window(s) with custom pause thresholds not shown` : ''}
            </figcaption>
        </figure>
    );
}

// ── tables ─────────────────────────────────────────────────────────────────

/**
 * A breakdown table. `columns` is [{ key, label, render(row), align }]. Rows are
 * already sorted by the analytics module; the table does not reorder them.
 */
export function BreakdownTable({ columns, rows, empty = 'Nothing to show.', limit = null }) {
    if (!rows || rows.length === 0) return <p className="text-sm text-gray-500">{empty}</p>;
    const shown = limit ? rows.slice(0, limit) : rows;
    return (
        <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
                <thead>
                    <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                        {columns.map((c) => (
                            <th key={c.key} scope="col" className={`px-2 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {shown.map((row) => (
                        <tr key={row.key} className="border-b border-gray-100 last:border-0">
                            {columns.map((c) => (
                                <td key={c.key} className={`px-2 py-1.5 text-gray-800 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                                    {c.render(row)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {limit && rows.length > limit && (
                <p className="mt-2 text-xs text-gray-500">{`Showing the ${limit} most recent of ${rows.length}.`}</p>
            )}
        </div>
    );
}
