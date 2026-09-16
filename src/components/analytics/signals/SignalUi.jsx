// Shared building blocks for the Text and Voice analytics tabs.
//
// English-only by design: src/components/analytics/** is excluded from i18n
// extraction (i18next-parser.config.js), like the rest of this dashboard.
// Cards and panels are the dashboard's own (ui/DashboardCards.jsx), so these
// tabs read as part of Learning Analytics. Charts are plain SVG drawn at real
// pixel size — no chart library — in the Okabe-Ito palette, and every bar
// carries a text label so nothing is read by colour alone.

import React from 'react';
import { Info } from 'lucide-react';
import { OKABE_ITO } from './signalStats.js';
import { fmtPct } from './signalFormat.js';
import { Panel } from '../ui/DashboardCards.jsx';
import { ResponsiveSvg } from './ChartKit.jsx';
import { FONT, INK, TEXT } from './chartTheme.js';

// ── layout ─────────────────────────────────────────────────────────────────

/** A dashboard panel with a title and a one-line description. */
export function Section({ title, description, children, right = null, className = '' }) {
    return (
        <Panel title={title} description={description} actions={right} className={className}>
            {children}
        </Panel>
    );
}

/** A plain, honest note: what this tab measures and what it does not. */
export function Scope({ children }) {
    return (
        <div className="flex items-start gap-2.5 rounded-md border border-gray-200 bg-white px-4 py-3 text-xs leading-relaxed text-gray-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700" aria-hidden="true" />
            <p>{children}</p>
        </div>
    );
}

export function EmptyState({ icon: Icon, title, children }) {
    return (
        <div className="rohy-admin-light rounded-md border border-gray-200 bg-white p-10 text-center">
            {Icon && (
                <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-md bg-gradient-to-br from-cyan-50 to-white text-cyan-700 ring-1 ring-cyan-100">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
            )}
            <div className="text-sm font-semibold text-gray-900">{title}</div>
            <div className="mx-auto mt-2 max-w-xl text-sm text-gray-600">{children}</div>
        </div>
    );
}

/** Learner / message pickers above a per-item chart set. */
export function Pickers({ children }) {
    return <div className="mb-4 flex flex-wrap items-end gap-3">{children}</div>;
}

export function Picker({ label, value, onChange, grow = false, children }) {
    return (
        <label className={`flex min-w-0 flex-col gap-1 text-xs font-medium text-gray-600 ${grow ? 'w-full sm:w-auto sm:min-w-[18rem] sm:flex-1' : 'w-full sm:w-auto'}`}>
            {label}
            <select value={value} onChange={onChange}
                className="h-9 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 shadow-sm">
                {children}
            </select>
        </label>
    );
}

// ── charts ─────────────────────────────────────────────────────────────────

/**
 * Horizontal bars for a pooled pause histogram. Each bar is labelled with its
 * bucket and its count and share, so the chart reads without colour. Drawn at
 * the container's width, so it fills its panel at any size.
 */
export function PauseHistogram({ pauses, unit = 'pauses', caption = null, ariaLabel = null, labelWidth = 70 }) {
    if (!pauses || pauses.total === 0) {
        return <p className="py-6 text-center text-sm text-gray-500">No pauses recorded for this selection.</p>;
    }
    const rowH = 32;
    const barH = 18;
    const valueW = 78;
    const maxShare = Math.max(...pauses.buckets.map((b) => b.share), 0.0001);
    const height = pauses.buckets.length * rowH;
    return (
        <figure className="space-y-2">
            <ResponsiveSvg height={height} fallbackWidth={480}
                ariaLabel={ariaLabel || `Pause length distribution across ${pauses.total} ${unit}`}>
                {(width) => {
                    const barMax = Math.max(40, width - labelWidth - valueW);
                    return pauses.buckets.map((b, i) => {
                        const y = i * rowH;
                        const w = Math.max(b.count > 0 ? 2 : 0, (b.share / maxShare) * barMax);
                        return (
                            <g key={b.key}>
                                <text x={labelWidth - 10} y={y + rowH / 2} dy="0.35em" textAnchor="end" fontSize={FONT + 1} fill={TEXT}>
                                    {b.label}
                                </text>
                                <rect x={labelWidth} y={y + (rowH - barH) / 2} width={barMax} height={barH} rx="3" fill="#f3f4f6" />
                                {w > 0 && <rect x={labelWidth} y={y + (rowH - barH) / 2} width={w} height={barH} rx="3" fill={OKABE_ITO[4]} />}
                                <text x={labelWidth + w + 8} y={y + rowH / 2} dy="0.35em" fontSize={FONT + 1} fill={INK}>
                                    <tspan fontWeight={600}>{b.count}</tspan>
                                    <tspan fill={TEXT}>{` · ${fmtPct(b.share)}`}</tspan>
                                </text>
                            </g>
                        );
                    });
                }}
            </ResponsiveSvg>
            <figcaption className="text-xs text-gray-500">
                {caption ?? `${pauses.total} ${unit} pooled across the selection`}
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
    if (!rows || rows.length === 0) return <p className="py-6 text-center text-sm text-gray-500">{empty}</p>;
    const shown = limit ? rows.slice(0, limit) : rows;
    return (
        <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-max text-sm">
                <thead>
                    <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-500">
                        {columns.map((c, i) => (
                            <th key={c.key} scope="col"
                                className={`whitespace-nowrap py-2 font-semibold ${i === columns.length - 1 ? '' : 'pr-6'} ${c.align === 'right' ? 'text-right' : ''}`}>
                                {c.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {shown.map((row) => (
                        <tr key={row.key} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                            {columns.map((c, i) => (
                                <td key={c.key}
                                    className={`whitespace-nowrap py-2 ${i === columns.length - 1 ? '' : 'pr-6'} ${c.align === 'right' ? 'text-right tabular-nums text-gray-700' : 'text-gray-900'} ${i === 0 ? 'font-medium' : ''}`}>
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
