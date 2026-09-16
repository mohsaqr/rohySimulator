// Small shared pieces for the Text and Voice charts: an SVG that draws at its
// container's real pixel width, a value axis with rounded, unit-carrying ticks,
// and the legend row under a chart.

import React from 'react';
import { useChartWidth } from './useChartWidth.js';
import { formatTick } from './chartAxis.js';
import { AXIS, FONT, GRID, MUTED, TEXT } from './chartTheme.js';

/**
 * An SVG sized to its container in real pixels. `children` is a function of the
 * measured width that returns the SVG's content, so text never scales.
 */
export function ResponsiveSvg({ height, ariaLabel, fallbackWidth = 640, className = '', children }) {
    const [ref, width] = useChartWidth(fallbackWidth);
    return (
        <div ref={ref} className={`w-full min-w-0 ${className}`}>
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}
                className="block max-w-full" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {children(width)}
            </svg>
        </div>
    );
}

/**
 * Horizontal gridlines with left-hand tick labels for a value axis from
 * `niceAxis`. `y` maps a value to a pixel row.
 */
export function ValueAxis({ axis, y, left, right, unit = '', title = null, titleY = 11 }) {
    return (
        <g>
            {axis.ticks.map((v) => (
                <g key={`y-${v}`}>
                    <line x1={left} y1={y(v)} x2={right} y2={y(v)} stroke={GRID} />
                    <text x={left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={FONT} fill={MUTED}>
                        {formatTick(v, axis.decimals, unit)}
                    </text>
                </g>
            ))}
            {title && <text x={left} y={titleY} fontSize={FONT} fill={TEXT}>{title}</text>}
        </g>
    );
}

/** The baseline under a plot. */
export function Baseline({ left, right, y }) {
    return <line x1={left} y1={y + 0.5} x2={right} y2={y + 0.5} stroke={AXIS} />;
}

/** Ticks along the x baseline: `[{ x, label, key }]`. */
export function XTicks({ ticks, y }) {
    return ticks.map((tk) => (
        <g key={tk.key ?? tk.label}>
            <line x1={tk.x} y1={y} x2={tk.x} y2={y + 4} stroke={AXIS} />
            <text x={tk.x} y={y + 16} textAnchor="middle" fontSize={FONT} fill={MUTED}>{tk.label}</text>
        </g>
    ));
}

export function Legend({ children }) {
    return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">{children}</div>;
}

export function LegendItem({ glyph, children }) {
    return <span className="inline-flex items-center gap-1.5">{glyph}{children}</span>;
}

export function Unavailable({ children }) {
    return <p className="rounded-md bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">{children}</p>;
}

/** A chart with a title and one line of guidance, inside a panel section. */
export function ChartCard({ title, hint, right = null, children }) {
    return (
        <div className="min-w-0 rounded-md border border-gray-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
                    {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
                </div>
                {right}
            </div>
            {children}
        </div>
    );
}
