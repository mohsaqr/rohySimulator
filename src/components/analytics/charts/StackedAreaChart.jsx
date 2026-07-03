// Stacked area chart — React SVG port of carmdash's line-chart.ts
// stackedArea mode (moodle-tna): custom last→first baseline stacking,
// monotone-cubic area edges (top edge + reversed baseline), 0.85-opacity
// fills with a solid top line, ~5 horizontal gridlines, bottom legend, and
// a hover layer (vertical guide + floating per-series value box).

import { useEffect, useMemo, useRef, useState } from 'react';
import { getColor, linearScale, monotonePath, stackSeries } from './chartMath';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const DEFAULT_W = 760;
const MARGIN = { top: 16, right: 32, bottom: 48, left: 48 };

/**
 * @param {object} props
 * @param {{label:string,x:number[],y:number[]}[]} props.series first series
 *   renders as the top layer (carmdash stacking order)
 * @param {string[]} [props.xLabels] tick text per x value (indexed by x)
 * @param {number} [props.height=340]
 * @param {string[]} [props.colors] per-series colours (default CARM_PALETTE)
 * @param {string} [props.title]
 * @param {string} [props.xLabel]
 * @param {string} [props.yLabel]
 */
export default function StackedAreaChart({
    series,
    xLabels,
    height = 340,
    colors,
    title,
    xLabel,
    yLabel,
}) {
    const [hoverIdx, setHoverIdx] = useState(null);
    const [chartW, setChartW] = useState(DEFAULT_W);
    const wrapRef = useRef(null);

    useEffect(() => {
        const node = wrapRef.current;
        if (!node) return undefined;

        const updateWidth = () => {
            const next = Math.floor(node.getBoundingClientRect().width);
            if (next > 0) setChartW(next);
        };

        updateWidth();

        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(updateWidth);
            observer.observe(node);
            return () => observer.disconnect();
        }

        if (typeof window !== 'undefined') {
            window.addEventListener('resize', updateWidth);
            return () => window.removeEventListener('resize', updateWidth);
        }

        return undefined;
    }, []);

    const legendH = series.length > 1 ? 24 : 0;
    const innerW = chartW - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom - legendH;

    const { sortedXs, layers, xScale, yScale } = useMemo(() => {
        const allX = series.flatMap((s) => s.x);
        const xs = [...new Set(allX)].sort((a, b) => a - b);
        const stacked = stackSeries(series, xs);
        const yMax = stacked.reduce(
            (m, layer) => layer.reduce((mm, pt) => Math.max(mm, pt.y1), m), 0);
        const xMin = xs.length ? xs[0] : 0;
        const xMax = xs.length ? xs[xs.length - 1] : 1;
        const xPad = (xMax - xMin) * 0.05;
        return {
            sortedXs: xs,
            layers: stacked,
            xScale: linearScale([xMin - xPad, xMax + xPad], [0, innerW]),
            yScale: linearScale([0, yMax * 1.1 || 1], [innerH, 0]),
        };
    }, [series, innerW, innerH]);

    const seriesColor = (si) => colors?.[si] ?? getColor(si);
    const tickText = (x) => (xLabels && Number.isInteger(x) && xLabels[x] != null ? xLabels[x] : String(x));

    // Nearest sorted x for a mouse position in internal SVG coordinates.
    const handleMove = (e) => {
        if (!sortedXs.length) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * chartW - MARGIN.left;
        const nearest = sortedXs.reduce(
            (best, x, i) => {
                const d = Math.abs(xScale(x) - px);
                return d < best.d ? { d, i } : best;
            }, { d: Infinity, i: 0 });
        setHoverIdx(nearest.i);
    };

    // Area path: monotone top edge, then the baseline traced back with the
    // same curve (carmdash draws both edges with the curve factory).
    const areaPath = (layer) => {
        const top = layer.map((pt) => ({ x: xScale(pt.x), y: yScale(pt.y1) }));
        const bottom = [...layer].reverse().map((pt) => ({ x: xScale(pt.x), y: yScale(pt.y0) }));
        const bottomD = monotonePath(bottom).replace(/^M/, 'L');
        return `${monotonePath(top)}${bottomD}Z`;
    };

    const hoverX = hoverIdx !== null && sortedXs.length ? sortedXs[hoverIdx] : null;
    const hoverTotal = hoverX !== null
        ? layers.reduce((s, layer) => s + (layer[hoverIdx].y1 - layer[hoverIdx].y0), 0)
        : 0;

    return (
        <div
            ref={wrapRef}
            data-testid="stacked-area-chart"
            style={{ position: 'relative', fontFamily: FONT, color: '#1a1a2e' }}
        >
            {title && <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{title}</div>}
            <svg
                width="100%"
                height={height}
                style={{ display: 'block', width: '100%', height }}
                viewBox={`0 0 ${chartW} ${height}`}
                role="img"
                aria-label={title ?? 'Stacked area chart'}
                onMouseMove={handleMove}
                onMouseLeave={() => setHoverIdx(null)}
            >
                <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                    {yScale.ticks(5).map((t) => (
                        <g key={`gy-${t}`}>
                            <line x1={0} x2={innerW} y1={yScale(t)} y2={yScale(t)} stroke="#eaeef3" strokeWidth={1} />
                            <text x={-8} y={yScale(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#1a1a2e">
                                {t}
                            </text>
                        </g>
                    ))}
                    {/* Draw last series first so the first series renders on top (carmdash). */}
                    {layers.map((_, si) => si).reverse().map((si) => (
                        <g key={series[si].label} data-testid={`area-layer-${si}`}>
                            <path d={areaPath(layers[si])} fill={seriesColor(si)} opacity={0.85} />
                            <path
                                d={monotonePath(layers[si].map((pt) => ({ x: xScale(pt.x), y: yScale(pt.y1) })))}
                                fill="none"
                                stroke={seriesColor(si)}
                                strokeWidth={1}
                                pointerEvents="none"
                            />
                        </g>
                    ))}
                    {xScale.ticks(6).map((t) => (
                        <text
                            key={`gx-${t}`}
                            x={xScale(t)}
                            y={innerH + 16}
                            textAnchor="middle"
                            fontSize={11}
                            fill="#1a1a2e"
                        >
                            {tickText(t)}
                        </text>
                    ))}
                    <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="#c4cdd6" strokeWidth={1} />
                    {xLabel && (
                        <text x={innerW / 2} y={innerH + 38} textAnchor="middle" fontSize={11} fill="#1a1a2e">
                            {xLabel}
                        </text>
                    )}
                    {yLabel && (
                        <text
                            transform="rotate(-90)"
                            x={-innerH / 2}
                            y={-36}
                            textAnchor="middle"
                            fontSize={11}
                            fill="#1a1a2e"
                        >
                            {yLabel}
                        </text>
                    )}
                    {hoverX !== null && (
                        <line
                            data-testid="hover-guide"
                            x1={xScale(hoverX)}
                            x2={xScale(hoverX)}
                            y1={0}
                            y2={innerH}
                            stroke="#6c757d"
                            strokeWidth={1}
                            strokeDasharray="3,3"
                            pointerEvents="none"
                        />
                    )}
                </g>
            </svg>
            {series.length > 1 && (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingLeft: MARGIN.left, fontSize: 10 }}>
                    {series.map((s, si) => (
                        <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <span
                                aria-hidden="true"
                                style={{ width: 20, height: 2, background: seriesColor(si), display: 'inline-block' }}
                            />
                            {s.label}
                        </span>
                    ))}
                </div>
            )}
            {hoverX !== null && (
                <div
                    data-testid="hover-box"
                    style={{
                        position: 'absolute',
                        left: `${(((xScale(hoverX) + MARGIN.left) / chartW) * 100).toFixed(2)}%`,
                        top: MARGIN.top + 8,
                        transform: xScale(hoverX) > innerW / 2 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
                        background: '#ffffff',
                        border: '1px solid #c4cdd6',
                        borderRadius: 4,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                        padding: '6px 8px',
                        fontSize: 11,
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                    }}
                >
                    <div style={{ fontWeight: 600 }}>{`${tickText(hoverX)} — total ${Math.round(hoverTotal * 100) / 100}`}</div>
                    {series.map((s, si) => (
                        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span
                                aria-hidden="true"
                                style={{ width: 8, height: 8, borderRadius: '50%', background: seriesColor(si), display: 'inline-block' }}
                            />
                            {`${s.label}: ${Math.round((layers[si][hoverIdx].y1 - layers[si][hoverIdx].y0) * 100) / 100}`}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
