// The four writing-process charts for ONE typing episode, ported from Oyon's
// Analyze · Typing page (standalone/app/src/components/charts/Typing*.tsx) to
// draw stored windows on rohy's Text tab.
//
//   TypingProgressionChart — caret position of every edit over time; drops
//                            below the leading edge are revisions.
//   TypingProductionCurve  — message length over time against the mean rate.
//   TypingIkiDistribution  — keystroke intervals on a log axis, with the
//                            pause threshold the counts were cut at.
//   TypingBurstStrip       — bursts ended by a pause (P) or a revision (R).
//
// The derivations are Oyon's (typingChartMath.js, tested against the real
// aggregator). What changed in the port: TypeScript to JSX, Oyon's theme
// variables to fixed greys, its palette to Okabe-Ito, and a fixed viewBox to
// drawing at the container's real pixel width (so labels never scale) — with every op still
// told apart by SHAPE or a text label, never by colour alone. Honesty rules are
// kept: nothing is interpolated, long idle gaps are compressed with their real
// length printed, and a series that is partial or underivable says so.
//
// Per-episode by design: pooling a progression graph across messages is
// meaningless, so the Text tab picks one message to draw.

import React from 'react';
import { OKABE_ITO } from './signalStats.js';
import { monotonePath } from '../charts/chartMath.js';
import {
    compressTimeAxis, axisTimeTicks, findPauses, computeFrontier, productionSeries,
    buildLogHistogram, reconstructBursts, formatDurationShort,
} from './typingChartMath.js';
import { niceAxis } from './chartAxis.js';
import {
    Baseline, Legend, LegendItem, ResponsiveSvg, Unavailable, ValueAxis, XTicks,
} from './ChartKit.jsx';
import { AXIS, FONT, FONT_SMALL, IDLE, INK, MUTED, PAUSE_BAND } from './chartTheme.js';

const OP_COLOR = {
    insert: OKABE_ITO[4],   // blue
    delete: OKABE_ITO[5],   // vermillion
    replace: OKABE_ITO[0],  // orange
    paste: OKABE_ITO[6],    // reddish purple
    correct: OKABE_ITO[2],  // bluish green
};
const P_COLOR = OKABE_ITO[4];
const R_COLOR = OKABE_ITO[5];
const GAP_COMPRESS_MS = 15000;

/** A linear map from `domain` to pixel `range`. */
const scale = ([d0, d1], [r0, r1]) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

/** About one time tick per 90 px of plot, between 2 and 8. */
const tickCount = (plotW) => Math.max(2, Math.min(8, Math.floor(plotW / 90)));
const timeLabel = (ms) => (ms === 0 ? '0s' : formatDurationShort(ms));

function thresholdOf(quality) {
    const ms = quality?.thresholds?.burst_threshold_ms;
    return Number.isFinite(ms) ? ms : 2000;
}

/** Episode start/end in the edits' monotonic time: first edit minus latency, through elapsed. */
function episodeBounds(typing, times) {
    const latency = Number.isFinite(typing.first_input_latency_ms) ? typing.first_input_latency_ms : 0;
    const start = times[0] - latency;
    const elapsed = Number.isFinite(typing.elapsed_ms) ? typing.elapsed_ms : 0;
    return { start, end: Math.max(times[times.length - 1], start + elapsed), elapsed };
}

/** The compressed time axis for a plot `plotW` wide starting at `left`. */
function timeAxis(typing, times, left, plotW) {
    const { start, end, elapsed } = episodeBounds(typing, times);
    const axis = compressTimeAxis([start, ...times, end], { maxGapMs: GAP_COMPRESS_MS });
    const spanMs = Math.max(1, axis.spanMs);
    const xOf = (t) => left + (axis.toCompressed(t) / spanMs) * plotW;
    const ticks = axisTimeTicks(axis, start, end, tickCount(plotW)).map((tk) => ({
        key: `x-${tk.realMs}`, x: left + (tk.comp / spanMs) * plotW, label: timeLabel(tk.realMs),
    }));
    return { axis, start, end, elapsed, xOf, ticks };
}

function IdleBreaks({ axis, xOf, top, bottom, labelY }) {
    return axis.breaks.map((b, i) => {
        const x0 = xOf(b.realStart);
        const x1 = xOf(b.realEnd);
        return (
            <g key={`break-${i}`}>
                <rect x={x0} y={top} width={x1 - x0} height={bottom - top} fill={IDLE} />
                <line x1={x0} y1={top} x2={x0} y2={bottom} stroke={MUTED} strokeDasharray="2 3" />
                <line x1={x1} y1={top} x2={x1} y2={bottom} stroke={MUTED} strokeDasharray="2 3" />
                <text x={(x0 + x1) / 2} y={labelY} textAnchor="middle" fontSize={FONT_SMALL} fill={MUTED}>
                    {formatDurationShort(b.gapMs)}
                </text>
            </g>
        );
    });
}

// ── Progression ─────────────────────────────────────────────────────────────

/** Shape per op — colour is never the only encoding. */
function opMark(op, x, y, key) {
    const c = OP_COLOR[op] || MUTED;
    switch (op) {
        case 'delete':
            return <path key={key} d={`M${x - 3.6},${y - 3.2}L${x + 3.6},${y - 3.2}L${x},${y + 3.6}Z`} fill={c} />;
        case 'replace':
            return <path key={key} d={`M${x},${y - 4}L${x + 4},${y}L${x},${y + 4}L${x - 4},${y}Z`} fill="none" stroke={c} strokeWidth={1.5} />;
        case 'paste':
            return <rect key={key} x={x - 3} y={y - 3} width={6} height={6} fill={c} />;
        case 'correct':
            return <path key={key} d={`M${x - 3.4},${y}H${x + 3.4}M${x},${y - 3.4}V${y + 3.4}`} stroke={c} strokeWidth={1.6} fill="none" />;
        case 'insert':
            return <circle key={key} cx={x} cy={y} r={2.4} fill={c} />;
        default:
            return <circle key={key} cx={x} cy={y} r={2.4} fill="none" stroke={MUTED} strokeWidth={1} />;
    }
}

const PLOT = { left: 40, right: 12, top: 26, bottom: 26 };

export function TypingProgressionChart({ typing, quality }) {
    const H = 250;
    const raw = Array.isArray(typing?.revision_locations) ? typing.revision_locations : [];
    if (raw.length === 0) return <Unavailable>Not drawable — no positioned edits were captured for this message.</Unavailable>;
    const positioned = raw.filter((e) => Number.isFinite(e.offset) && Number.isFinite(e.t));
    if (positioned.length === 0) return <Unavailable>Not drawable — no edit carried a caret position.</Unavailable>;
    const omitted = raw.length - positioned.length;

    const times = positioned.map((e) => e.t);
    const frontier = computeFrontier(positioned);
    const yMax = Math.max(1, ...positioned.map((e) => e.offset), ...frontier.map((p) => p.frontier));
    const valueAxis = niceAxis(0, yMax, { count: 4, floor: 0, minStep: 1 });
    const threshold = thresholdOf(quality);
    const ops = [...new Set(positioned.map((e) => e.op))];
    // Pauses and breaks do not depend on width; compute them once for the legend.
    const probe = timeAxis(typing, times, 0, 1);
    const isBreak = (a, b) => probe.axis.breaks.some((br) => br.realStart === a && br.realEnd === b);
    const pauses = findPauses(times, threshold).filter((p) => !isBreak(p.startT, p.endT));

    return (
        <figure className="space-y-2">
            <ResponsiveSvg height={H} ariaLabel="Caret position of every edit over time; drops below the leading-edge line are revisions into earlier text">
                {(W) => {
                    const { left: L, right: R, top: T, bottom: B } = PLOT;
                    const plotW = W - L - R;
                    const { axis, xOf, ticks } = timeAxis(typing, times, L, plotW);
                    const y = scale(valueAxis.domain, [H - B, T]);
                    const frontierPath = frontier.map((p, i) => {
                        const x = xOf(p.t);
                        if (i === 0) return `M${x},${y(p.frontier)}`;
                        return `L${x},${y(frontier[i - 1].frontier)}L${x},${y(p.frontier)}`;
                    }).join('');
                    const threadPath = positioned.map((e, i) => `${i === 0 ? 'M' : 'L'}${xOf(e.t)},${y(e.offset)}`).join('');
                    return (
                        <>
                            {pauses.map((p, i) => (
                                <rect key={`pause-${i}`} x={xOf(p.startT)} y={T} width={Math.max(1, xOf(p.endT) - xOf(p.startT))} height={H - T - B} fill={PAUSE_BAND} />
                            ))}
                            <IdleBreaks axis={axis} xOf={xOf} top={T} bottom={H - B} labelY={T + 12} />
                            <ValueAxis axis={valueAxis} y={y} left={L} right={W - R} title="Position in message (characters)" />
                            <Baseline left={L} right={W - R} y={H - B} />
                            <XTicks ticks={ticks} y={H - B} />
                            <path d={frontierPath} fill="none" stroke={MUTED} strokeWidth={1} opacity={0.6} />
                            <path d={threadPath} fill="none" stroke={MUTED} strokeWidth={0.75} opacity={0.35} />
                            {positioned.map((e, i) => opMark(e.op, xOf(e.t), y(e.offset), `m-${i}`))}
                        </>
                    );
                }}
            </ResponsiveSvg>
            <Legend>
                {ops.map((op) => (
                    <LegendItem key={op} glyph={<svg width={12} height={12} viewBox="-6 -6 12 12" aria-hidden="true">{opMark(op, 0, 0, op)}</svg>}>{op}</LegendItem>
                ))}
                <LegendItem glyph={<svg width={14} height={12} aria-hidden="true"><path d="M1,9H7V3H13" fill="none" stroke={MUTED} /></svg>}>leading edge</LegendItem>
                {pauses.length > 0 && (
                    <LegendItem glyph={<svg width={12} height={12} aria-hidden="true"><rect x={1} y={1} width={10} height={10} fill={PAUSE_BAND} stroke={AXIS} strokeWidth={0.5} /></svg>}>
                        {`pause ≥ ${formatDurationShort(threshold)}`}
                    </LegendItem>
                )}
                {probe.axis.breaks.length > 0 && (
                    <LegendItem glyph={<svg width={12} height={12} aria-hidden="true"><rect x={1} y={1} width={10} height={10} fill={IDLE} stroke={MUTED} strokeDasharray="2 2" /></svg>}>
                        idle, compressed (real length printed)
                    </LegendItem>
                )}
            </Legend>
            {omitted > 0 && <p className="text-xs text-gray-500">{`${omitted} of ${raw.length} edits carried no caret position and are not drawn.`}</p>}
            {quality?.revision_locations_truncated && <p className="text-xs text-gray-500">This message hit the retention cap — later edits are not drawn.</p>}
        </figure>
    );
}

// ── Production curve ────────────────────────────────────────────────────────

const MISSING = {
    revision_locations: 'no positioned edits were captured for this message.',
    offset: 'an edit lacks a caret position.',
    distance: 'this message was captured before typing-v3, so its length per edit cannot be recovered exactly.',
};

export function TypingProductionCurve({ typing, quality }) {
    const H = 250;
    const series = productionSeries(Array.isArray(typing?.revision_locations) ? typing.revision_locations : []);
    if (series.missing !== null) return <Unavailable>{`Not drawable — ${MISSING[series.missing] || series.missing}`}</Unavailable>;

    const times = series.points.map((p) => p.t);
    const committed = Number.isFinite(typing.committed_graphemes) ? typing.committed_graphemes : 0;
    const valueAxis = niceAxis(0, Math.max(1, committed, ...series.points.map((p) => p.committed)), { count: 4, floor: 0, minStep: 1 });
    const { elapsed } = episodeBounds(typing, times);
    const meanRate = elapsed > 0 ? committed / elapsed : 0;
    const line = OKABE_ITO[4];

    return (
        <figure className="space-y-2">
            <ResponsiveSvg height={H} ariaLabel="Message length over time; flat stretches are pauses, downward steps are deletions, the dashed line is the mean rate">
                {(W) => {
                    const { left: L, right: R, top: T, bottom: B } = PLOT;
                    const plotW = W - L - R;
                    const { axis, start, end, xOf, ticks } = timeAxis(typing, times, L, plotW);
                    const y = scale(valueAxis.domain, [H - B, T]);
                    const curve = monotonePath(series.points.map((p) => ({ x: xOf(p.t), y: y(p.committed) })));
                    const refPath = [start, ...axis.breaks.flatMap((b) => [b.realStart, b.realEnd]), end]
                        .map((t, i) => `${i === 0 ? 'M' : 'L'}${xOf(t)},${y(meanRate * (t - start))}`).join('');
                    return (
                        <>
                            <IdleBreaks axis={axis} xOf={xOf} top={T} bottom={H - B} labelY={T + 12} />
                            <ValueAxis axis={valueAxis} y={y} left={L} right={W - R} title="Message length (characters)" />
                            <Baseline left={L} right={W - R} y={H - B} />
                            <XTicks ticks={ticks} y={H - B} />
                            <path d={refPath} fill="none" stroke={MUTED} strokeWidth={1} strokeDasharray="5 4" />
                            <path d={curve} fill="none" stroke={line} strokeWidth={2} />
                            {series.points.map((p, i) => <circle key={`pt-${i}`} cx={xOf(p.t)} cy={y(p.committed)} r={2} fill={line} />)}
                        </>
                    );
                }}
            </ResponsiveSvg>
            <Legend>
                <LegendItem glyph={<svg width={16} height={8} aria-hidden="true"><line x1={0} y1={4} x2={16} y2={4} stroke={line} strokeWidth={2} /></svg>}>length after each edit</LegendItem>
                <LegendItem glyph={<svg width={16} height={8} aria-hidden="true"><line x1={0} y1={4} x2={16} y2={4} stroke={MUTED} strokeDasharray="4 3" /></svg>}>
                    {`mean rate (${elapsed > 0 ? Math.round(meanRate * 60000) : '—'} characters/min)`}
                </LegendItem>
            </Legend>
            {quality?.revision_locations_truncated && <p className="text-xs text-gray-500">This message hit the retention cap — the curve covers the retained edits only.</p>}
        </figure>
    );
}

// ── Keystroke-interval distribution ─────────────────────────────────────────

export function TypingIkiDistribution({ typing, quality }) {
    const H = 230;
    const PER_DECADE = 4, MIN_MS = 10;
    const hist = buildLogHistogram(Array.isArray(typing?.inter_event_intervals_ms) ? typing.inter_event_intervals_ms : [], { binsPerDecade: PER_DECADE, minMs: MIN_MS });
    if (hist.bins.length === 0) return <Unavailable>Not drawable — a message needs at least two edits to have an interval.</Unavailable>;

    const uOf = (v) => Math.log10(v / MIN_MS) * PER_DECADE;
    const fixedMs = thresholdOf(quality);
    const adaptiveMs = Number.isFinite(quality?.thresholds?.adaptive_burst_threshold_ms) ? quality.thresholds.adaptive_burst_threshold_ms : null;
    const showAdaptive = adaptiveMs !== null && adaptiveMs >= MIN_MS;
    const uMin = -1;
    const uMax = Math.max(hist.bins.length - 1, Math.ceil(uOf(fixedMs)) + 1, showAdaptive ? Math.ceil(uOf(adaptiveMs)) + 1 : 0);
    const valueAxis = niceAxis(0, Math.max(1, ...hist.bins.map((b) => b.count)), { count: 4, floor: 0, minStep: 1 });
    const decades = [];
    for (let d = 0; d * PER_DECADE <= uMax; d += 1) decades.push({ u: d * PER_DECADE, label: formatDurationShort(MIN_MS * 10 ** d) });

    return (
        <figure className="space-y-2">
            <ResponsiveSvg height={H} ariaLabel="Histogram of intervals between keystrokes on a log axis, with the pause threshold marked">
                {(W) => {
                    const { left: L, right: R, top: T, bottom: B } = PLOT;
                    const plotW = W - L - R;
                    const xOfU = (u) => L + ((u - uMin) / (uMax - uMin)) * plotW;
                    const y = scale(valueAxis.domain, [H - B, T + 14]);
                    const marker = (ms, row, color, dash, text) => {
                        const x = xOfU(uOf(ms));
                        const flip = x > W - R - 170;
                        return (
                            <g>
                                <line x1={x} y1={T + 14} x2={x} y2={H - B} stroke={color} strokeWidth={1.5} strokeDasharray={dash} />
                                <text x={flip ? x - 5 : x + 5} y={T + 14 + row * 14} dy="0.7em" textAnchor={flip ? 'end' : 'start'} fontSize={FONT} fill={color}
                                    stroke="#ffffff" strokeWidth={3} paintOrder="stroke">{text}</text>
                            </g>
                        );
                    };
                    return (
                        <>
                            <ValueAxis axis={valueAxis} y={y} left={L} right={W - R} title="Intervals" />
                            {hist.bins.map((b, k) => {
                                if (b.count === 0) return null;
                                const x = xOfU(k - 1) + 1;
                                const width = Math.max(1, xOfU(k) - xOfU(k - 1) - 2);
                                return (
                                    <g key={`bin-${k}`}>
                                        <rect x={x} y={y(b.count)} width={width} height={H - B - y(b.count)} rx={1.5} fill={OKABE_ITO[1]} />
                                        {width >= 14 && (
                                            <text x={x + width / 2} y={y(b.count) - 4} textAnchor="middle" fontSize={FONT_SMALL} fill={INK}>{b.count}</text>
                                        )}
                                    </g>
                                );
                            })}
                            <Baseline left={L} right={W - R} y={H - B} />
                            <XTicks ticks={decades.map((tk) => ({ key: `u-${tk.u}`, x: xOfU(tk.u), label: tk.label }))} y={H - B} />
                            {marker(fixedMs, 0, INK, undefined, `pause threshold ${formatDurationShort(fixedMs)}`)}
                            {showAdaptive && marker(adaptiveMs, 1, OKABE_ITO[2], '5 4', `adaptive ${formatDurationShort(adaptiveMs)} (3× this writer's median)`)}
                        </>
                    );
                }}
            </ResponsiveSvg>
            <p className="text-xs text-gray-500">
                {`${hist.total.toLocaleString()} intervals, log scale`}
                {quality?.intervals_truncated ? ' — retention cap reached; later intervals are not counted' : ''}
            </p>
        </figure>
    );
}

// ── Burst strip ─────────────────────────────────────────────────────────────

export function TypingBurstStrip({ typing, quality }) {
    const H = 150, TOP = 30, BOTTOM = 116;
    const raw = Array.isArray(typing?.revision_locations) ? typing.revision_locations : [];
    if (raw.length === 0) return <Unavailable>Not drawable — bursts are rebuilt from the per-edit series, and none was captured for this message.</Unavailable>;

    const threshold = thresholdOf(quality);
    const times = raw.map((e) => e.t);
    const rec = reconstructBursts(raw.map((e) => e.op), times, threshold);
    const reportedP = Number.isFinite(typing.p_burst_count) ? typing.p_burst_count : null;
    const reportedR = Number.isFinite(typing.r_burst_count) ? typing.r_burst_count : null;
    const matches = reportedP !== null && reportedR !== null ? rec.pCount === reportedP && rec.rCount === reportedR : null;
    const trackH = BOTTOM - TOP;

    return (
        <figure className="space-y-2">
            <ResponsiveSvg height={H} ariaLabel="Bursts of typing over time, labelled P when ended by a pause and R when ended by a revision">
                {(W) => {
                    const L = 12, R = 12;
                    const plotW = W - L - R;
                    const { axis, xOf, ticks } = timeAxis(typing, times, L, plotW);
                    const isBreak = (a, b) => axis.breaks.some((br) => br.realStart === a && br.realEnd === b);
                    const pauses = findPauses(times, threshold).filter((p) => !isBreak(p.startT, p.endT));
                    return (
                        <>
                            {pauses.map((p, i) => (
                                <rect key={`pause-${i}`} x={xOf(p.startT)} y={TOP} width={Math.max(1, xOf(p.endT) - xOf(p.startT))} height={trackH} fill={PAUSE_BAND} />
                            ))}
                            <IdleBreaks axis={axis} xOf={xOf} top={TOP} bottom={BOTTOM} labelY={TOP - 6} />
                            {rec.segments.map((s, i) => {
                                const x = xOf(s.startT);
                                const width = Math.max(2, xOf(s.endT) - x);
                                const trailing = s.closedBy === 'end';
                                return (
                                    <g key={`seg-${i}`}>
                                        <rect x={x} y={TOP + 8} width={width} height={trackH - 16} rx={2} fill={s.kind === 'r' ? R_COLOR : P_COLOR}
                                            stroke={trailing ? INK : 'none'} strokeWidth={trailing ? 1 : 0} strokeDasharray={trailing ? '3 3' : undefined} />
                                        {width >= 16 && (
                                            <text x={x + width / 2} y={(TOP + BOTTOM) / 2} dy="0.35em" textAnchor="middle" fontSize={FONT} fontWeight={600} fill="#ffffff">
                                                {s.kind === 'r' ? 'R' : 'P'}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}
                            {raw.filter((e) => e.op === 'delete' || e.op === 'replace').map((e, i) => (
                                <path key={`rev-${i}`} d={`M${xOf(e.t) - 3.5},${TOP}L${xOf(e.t) + 3.5},${TOP}L${xOf(e.t)},${TOP + 6}Z`} fill={R_COLOR} />
                            ))}
                            <Baseline left={L} right={W - R} y={BOTTOM} />
                            <XTicks ticks={ticks} y={BOTTOM} />
                        </>
                    );
                }}
            </ResponsiveSvg>
            <Legend>
                <LegendItem glyph={<svg width={14} height={10} aria-hidden="true"><rect x={0} y={1} width={14} height={8} rx={1} fill={P_COLOR} /></svg>}>P — ended by a pause</LegendItem>
                <LegendItem glyph={<svg width={14} height={10} aria-hidden="true"><rect x={0} y={1} width={14} height={8} rx={1} fill={R_COLOR} /></svg>}>R — ended by a revision</LegendItem>
                <LegendItem glyph={<svg width={10} height={10} aria-hidden="true"><path d="M1.5,2L8.5,2L5,8Z" fill={R_COLOR} /></svg>}>deletion or replacement</LegendItem>
                <LegendItem glyph={<svg width={14} height={10} aria-hidden="true"><rect x={0.5} y={1.5} width={13} height={7} fill={P_COLOR} stroke={INK} strokeDasharray="2 2" /></svg>}>last burst, closed by sending (counts as P)</LegendItem>
            </Legend>
            <p className="text-xs text-gray-500">
                {`Rebuilt ${rec.pCount} P / ${rec.rCount} R`}
                {matches === true ? ' — matches the counts Oyon reported.' : ''}
                {matches === null ? ' — this message has no reported counts to check against.' : ''}
            </p>
            {matches === false && (
                <p className="text-xs text-amber-700">
                    {`Differs from the reported ${reportedP} P / ${reportedR} R: some edits had no caret position`}
                    {quality?.revision_locations_truncated ? ' and the series hit its retention cap' : ''}
                    . Treat the strip as partial and the reported counts as authoritative.
                </p>
            )}
        </figure>
    );
}
