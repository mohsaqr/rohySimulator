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
// variables to fixed greys, and its palette to Okabe-Ito — with every op still
// told apart by SHAPE or a text label, never by colour alone. Honesty rules are
// kept: nothing is interpolated, long idle gaps are compressed with their real
// length printed, and a series that is partial or underivable says so.
//
// Per-episode by design: pooling a progression graph across messages is
// meaningless, so the Text tab picks one message to draw.

import React from 'react';
import { OKABE_ITO } from './signalStats.js';
import { linearScale, monotonePath } from '../charts/chartMath.js';
import {
    compressTimeAxis, axisTimeTicks, findPauses, computeFrontier, productionSeries,
    buildLogHistogram, reconstructBursts, formatDurationShort,
} from './typingChartMath.js';

const INK = '#1f2937';
const MUTED = '#6b7280';
const GRID = '#e5e7eb';
const AXIS = '#9ca3af';
const IDLE = '#f3f4f6';
const PAUSE_BAND = '#fdf1d6';

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

const Unavailable = ({ children }) => <p className="text-sm text-gray-500">{children}</p>;
const Legend = ({ children }) => (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">{children}</div>
);
const LegendItem = ({ glyph, children }) => (
    <span className="inline-flex items-center gap-1">{glyph}{children}</span>
);

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

function IdleBreaks({ axis, xOf, top, bottom, labelY }) {
    return axis.breaks.map((b, i) => {
        const x0 = xOf(b.realStart);
        const x1 = xOf(b.realEnd);
        return (
            <g key={`break-${i}`}>
                <rect x={x0} y={top} width={x1 - x0} height={bottom - top} fill={IDLE} />
                <line x1={x0} y1={top} x2={x0} y2={bottom} stroke={MUTED} strokeDasharray="2 3" />
                <line x1={x1} y1={top} x2={x1} y2={bottom} stroke={MUTED} strokeDasharray="2 3" />
                <text x={(x0 + x1) / 2} y={labelY} textAnchor="middle" fontSize={9} fill={MUTED}>
                    {formatDurationShort(b.gapMs)}
                </text>
            </g>
        );
    });
}

function TimeTicks({ ticks, spanMs, left, plotW, y }) {
    return ticks.map((tk) => {
        const x = left + (tk.comp / spanMs) * plotW;
        return (
            <g key={`x-${tk.realMs}`}>
                <line x1={x} y1={y} x2={x} y2={y + 4} stroke={MUTED} />
                <text x={x} y={y + 15} textAnchor="middle" fontSize={10} fill={MUTED}>{formatDurationShort(tk.realMs)}</text>
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
            return <path key={key} d={`M${x - 3.4},${y - 3}L${x + 3.4},${y - 3}L${x},${y + 3.4}Z`} fill={c} />;
        case 'replace':
            return <path key={key} d={`M${x},${y - 3.8}L${x + 3.8},${y}L${x},${y + 3.8}L${x - 3.8},${y}Z`} fill="none" stroke={c} strokeWidth={1.5} />;
        case 'paste':
            return <rect key={key} x={x - 2.7} y={y - 2.7} width={5.4} height={5.4} fill={c} />;
        case 'correct':
            return <path key={key} d={`M${x - 3.2},${y}H${x + 3.2}M${x},${y - 3.2}V${y + 3.2}`} stroke={c} strokeWidth={1.6} fill="none" />;
        case 'insert':
            return <circle key={key} cx={x} cy={y} r={2} fill={c} />;
        default:
            return <circle key={key} cx={x} cy={y} r={2} fill="none" stroke={MUTED} strokeWidth={1} />;
    }
}

export function TypingProgressionChart({ typing, quality }) {
    const W = 860, H = 280, L = 48, R = 14, T = 16, B = 30;
    const raw = Array.isArray(typing?.revision_locations) ? typing.revision_locations : [];
    if (raw.length === 0) return <Unavailable>Not drawable — no positioned edits were captured for this message.</Unavailable>;
    const positioned = raw.filter((e) => Number.isFinite(e.offset) && Number.isFinite(e.t));
    if (positioned.length === 0) return <Unavailable>Not drawable — no edit carried a caret position.</Unavailable>;
    const omitted = raw.length - positioned.length;

    const times = positioned.map((e) => e.t);
    const { start, end } = episodeBounds(typing, times);
    const axis = compressTimeAxis([start, ...times, end], { maxGapMs: GAP_COMPRESS_MS });
    const spanMs = Math.max(1, axis.spanMs);
    const plotW = W - L - R;
    const xOf = (t) => L + (axis.toCompressed(t) / spanMs) * plotW;

    const frontier = computeFrontier(positioned);
    const yMax = Math.max(1, ...positioned.map((e) => e.offset), ...frontier.map((p) => p.frontier));
    const y = linearScale([0, yMax], [H - B, T]);

    const frontierPath = frontier.map((p, i) => {
        const x = xOf(p.t);
        if (i === 0) return `M${x},${y(p.frontier)}`;
        return `L${x},${y(frontier[i - 1].frontier)}L${x},${y(p.frontier)}`;
    }).join('');
    const threadPath = positioned.map((e, i) => `${i === 0 ? 'M' : 'L'}${xOf(e.t)},${y(e.offset)}`).join('');

    const threshold = thresholdOf(quality);
    const isBreak = (a, b) => axis.breaks.some((br) => br.realStart === a && br.realEnd === b);
    const pauses = findPauses(times, threshold).filter((p) => !isBreak(p.startT, p.endT));
    const ops = [...new Set(positioned.map((e) => e.op))];

    return (
        <figure className="space-y-1.5">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
                aria-label="Caret position of every edit over time; drops below the leading-edge line are revisions into earlier text">
                {pauses.map((p, i) => (
                    <rect key={`pause-${i}`} x={xOf(p.startT)} y={T} width={Math.max(1, xOf(p.endT) - xOf(p.startT))} height={H - T - B} fill={PAUSE_BAND} />
                ))}
                <IdleBreaks axis={axis} xOf={xOf} top={T} bottom={H - B} labelY={T + 11} />
                {y.ticks(4).map((v) => (
                    <g key={`y-${v}`}>
                        <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={GRID} />
                        <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill={MUTED}>{v}</text>
                    </g>
                ))}
                <text x={L} y={10} fontSize={9} fill={MUTED}>position in message (characters)</text>
                <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke={AXIS} />
                <TimeTicks ticks={axisTimeTicks(axis, start, end, 6)} spanMs={spanMs} left={L} plotW={plotW} y={H - B} />
                <path d={frontierPath} fill="none" stroke={MUTED} strokeWidth={1} opacity={0.5} />
                <path d={threadPath} fill="none" stroke={MUTED} strokeWidth={0.75} opacity={0.35} />
                {positioned.map((e, i) => opMark(e.op, xOf(e.t), y(e.offset), `m-${i}`))}
            </svg>
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
                {axis.breaks.length > 0 && (
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
    const W = 860, H = 220, L = 48, R = 14, T = 16, B = 30;
    const series = productionSeries(Array.isArray(typing?.revision_locations) ? typing.revision_locations : []);
    if (series.missing !== null) return <Unavailable>{`Not drawable — ${MISSING[series.missing] || series.missing}`}</Unavailable>;

    const times = series.points.map((p) => p.t);
    const { start, end, elapsed } = episodeBounds(typing, times);
    const axis = compressTimeAxis([start, ...times, end], { maxGapMs: GAP_COMPRESS_MS });
    const spanMs = Math.max(1, axis.spanMs);
    const plotW = W - L - R;
    const xOf = (t) => L + (axis.toCompressed(t) / spanMs) * plotW;
    const committed = Number.isFinite(typing.committed_graphemes) ? typing.committed_graphemes : 0;
    const y = linearScale([0, Math.max(1, committed, ...series.points.map((p) => p.committed))], [H - B, T]);

    const curve = monotonePath(series.points.map((p) => ({ x: xOf(p.t), y: y(p.committed) })));
    const meanRate = elapsed > 0 ? committed / elapsed : 0;
    const refPath = [start, ...axis.breaks.flatMap((b) => [b.realStart, b.realEnd]), end]
        .map((t, i) => `${i === 0 ? 'M' : 'L'}${xOf(t)},${y(meanRate * (t - start))}`).join('');
    const line = OKABE_ITO[4];

    return (
        <figure className="space-y-1.5">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
                aria-label="Message length over time; flat stretches are pauses, downward steps are deletions, the dashed line is the mean rate">
                <IdleBreaks axis={axis} xOf={xOf} top={T} bottom={H - B} labelY={T + 11} />
                {y.ticks(4).map((v) => (
                    <g key={`y-${v}`}>
                        <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={GRID} />
                        <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill={MUTED}>{v}</text>
                    </g>
                ))}
                <text x={L} y={10} fontSize={9} fill={MUTED}>message length (characters)</text>
                <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke={AXIS} />
                <TimeTicks ticks={axisTimeTicks(axis, start, end, 6)} spanMs={spanMs} left={L} plotW={plotW} y={H - B} />
                <path d={refPath} fill="none" stroke={MUTED} strokeWidth={1} strokeDasharray="5 4" />
                <path d={curve} fill="none" stroke={line} strokeWidth={1.75} />
                {series.points.map((p, i) => <circle key={`pt-${i}`} cx={xOf(p.t)} cy={y(p.committed)} r={1.6} fill={line} />)}
            </svg>
            <Legend>
                <LegendItem glyph={<svg width={14} height={8} aria-hidden="true"><line x1={0} y1={4} x2={14} y2={4} stroke={line} strokeWidth={2} /></svg>}>length after each edit</LegendItem>
                <LegendItem glyph={<svg width={14} height={8} aria-hidden="true"><line x1={0} y1={4} x2={14} y2={4} stroke={MUTED} strokeDasharray="4 3" /></svg>}>
                    {`mean rate (${elapsed > 0 ? (meanRate * 60000).toFixed(1) : '—'} characters/min)`}
                </LegendItem>
            </Legend>
            {quality?.revision_locations_truncated && <p className="text-xs text-gray-500">This message hit the retention cap — the curve covers the retained edits only.</p>}
        </figure>
    );
}

// ── Keystroke-interval distribution ─────────────────────────────────────────

export function TypingIkiDistribution({ typing, quality }) {
    const W = 860, H = 210, L = 44, R = 14, T = 16, B = 30;
    const PER_DECADE = 4, MIN_MS = 10;
    const hist = buildLogHistogram(Array.isArray(typing?.inter_event_intervals_ms) ? typing.inter_event_intervals_ms : [], { binsPerDecade: PER_DECADE, minMs: MIN_MS });
    if (hist.bins.length === 0) return <Unavailable>Not drawable — a message needs at least two edits to have an interval.</Unavailable>;

    const uOf = (v) => Math.log10(v / MIN_MS) * PER_DECADE;
    const fixedMs = thresholdOf(quality);
    const adaptiveMs = Number.isFinite(quality?.thresholds?.adaptive_burst_threshold_ms) ? quality.thresholds.adaptive_burst_threshold_ms : null;
    const uMin = -1;
    const uMax = Math.max(hist.bins.length - 1, Math.ceil(uOf(fixedMs)) + 0.5,
        adaptiveMs !== null && adaptiveMs >= MIN_MS ? Math.ceil(uOf(adaptiveMs)) + 0.5 : 0);
    const plotW = W - L - R;
    const xOfU = (u) => L + ((u - uMin) / (uMax - uMin)) * plotW;
    const y = linearScale([0, Math.max(1, ...hist.bins.map((b) => b.count))], [H - B, T]);

    const decades = [];
    for (let d = 0; d * PER_DECADE <= uMax; d += 1) decades.push({ u: d * PER_DECADE, label: formatDurationShort(MIN_MS * 10 ** d) });

    return (
        <figure className="space-y-1.5">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
                aria-label="Histogram of intervals between keystrokes on a log axis, with the pause threshold marked">
                {y.ticks(4).map((v) => (
                    <g key={`y-${v}`}>
                        <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={GRID} />
                        <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill={MUTED}>{v}</text>
                    </g>
                ))}
                <text x={L} y={10} fontSize={9} fill={MUTED}>intervals</text>
                {hist.bins.map((b, k) => (b.count === 0 ? null : (
                    <rect key={`bin-${k}`} x={xOfU(k - 1) + 0.5} y={y(b.count)} width={Math.max(1, xOfU(k) - xOfU(k - 1) - 1)}
                        height={H - B - y(b.count)} fill={OKABE_ITO[1]} />
                )))}
                <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke={AXIS} />
                {decades.map((tk) => (
                    <g key={`x-${tk.u}`}>
                        <line x1={xOfU(tk.u)} y1={H - B} x2={xOfU(tk.u)} y2={H - B + 4} stroke={MUTED} />
                        <text x={xOfU(tk.u)} y={H - B + 15} textAnchor="middle" fontSize={10} fill={MUTED}>{tk.label}</text>
                    </g>
                ))}
                <line x1={xOfU(uOf(fixedMs))} y1={T} x2={xOfU(uOf(fixedMs))} y2={H - B} stroke={INK} strokeWidth={1.5} />
                <text x={xOfU(uOf(fixedMs)) + 4} y={T + 10} fontSize={10} fill={INK}>{`pause threshold ${formatDurationShort(fixedMs)}`}</text>
                {adaptiveMs !== null && adaptiveMs >= MIN_MS && (
                    <>
                        <line x1={xOfU(uOf(adaptiveMs))} y1={T} x2={xOfU(uOf(adaptiveMs))} y2={H - B} stroke={OKABE_ITO[2]} strokeWidth={1.5} strokeDasharray="5 4" />
                        <text x={xOfU(uOf(adaptiveMs)) + 4} y={T + 22} fontSize={10} fill={OKABE_ITO[2]}>{`adaptive ${formatDurationShort(adaptiveMs)} (3× this writer's median)`}</text>
                    </>
                )}
            </svg>
            <p className="text-xs text-gray-500">
                {`${hist.total.toLocaleString()} intervals`}
                {quality?.intervals_truncated ? ' — retention cap reached; later intervals are not counted' : ''}
            </p>
        </figure>
    );
}

// ── Burst strip ─────────────────────────────────────────────────────────────

export function TypingBurstStrip({ typing, quality }) {
    const W = 860, H = 130, L = 14, R = 14, TOP = 36, BOTTOM = 88;
    const raw = Array.isArray(typing?.revision_locations) ? typing.revision_locations : [];
    if (raw.length === 0) return <Unavailable>Not drawable — bursts are rebuilt from the per-edit series, and none was captured for this message.</Unavailable>;

    const threshold = thresholdOf(quality);
    const times = raw.map((e) => e.t);
    const rec = reconstructBursts(raw.map((e) => e.op), times, threshold);
    const reportedP = Number.isFinite(typing.p_burst_count) ? typing.p_burst_count : null;
    const reportedR = Number.isFinite(typing.r_burst_count) ? typing.r_burst_count : null;
    const matches = reportedP !== null && reportedR !== null ? rec.pCount === reportedP && rec.rCount === reportedR : null;

    const { start, end } = episodeBounds(typing, times);
    const axis = compressTimeAxis([start, ...times, end], { maxGapMs: GAP_COMPRESS_MS });
    const spanMs = Math.max(1, axis.spanMs);
    const plotW = W - L - R;
    const xOf = (t) => L + (axis.toCompressed(t) / spanMs) * plotW;
    const isBreak = (a, b) => axis.breaks.some((br) => br.realStart === a && br.realEnd === b);
    const pauses = findPauses(times, threshold).filter((p) => !isBreak(p.startT, p.endT));
    const trackH = BOTTOM - TOP;

    return (
        <figure className="space-y-1.5">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
                aria-label="Bursts of typing over time, labelled P when ended by a pause and R when ended by a revision">
                {pauses.map((p, i) => (
                    <rect key={`pause-${i}`} x={xOf(p.startT)} y={TOP} width={Math.max(1, xOf(p.endT) - xOf(p.startT))} height={trackH} fill={PAUSE_BAND} />
                ))}
                <IdleBreaks axis={axis} xOf={xOf} top={TOP} bottom={BOTTOM} labelY={TOP - 4} />
                <line x1={L} y1={BOTTOM + 0.5} x2={W - R} y2={BOTTOM + 0.5} stroke={AXIS} />
                {rec.segments.map((s, i) => {
                    const x = xOf(s.startT);
                    const width = Math.max(2, xOf(s.endT) - x);
                    const trailing = s.closedBy === 'end';
                    return (
                        <g key={`seg-${i}`}>
                            <rect x={x} y={TOP + 6} width={width} height={trackH - 12} fill={s.kind === 'r' ? R_COLOR : P_COLOR}
                                stroke={trailing ? INK : 'none'} strokeWidth={trailing ? 1 : 0} strokeDasharray={trailing ? '3 3' : undefined} />
                            {width >= 16 && (
                                <text x={x + width / 2} y={(TOP + BOTTOM) / 2 + 3.5} textAnchor="middle" fontSize={10} fontWeight={600} fill="#ffffff">
                                    {s.kind === 'r' ? 'R' : 'P'}
                                </text>
                            )}
                        </g>
                    );
                })}
                {raw.filter((e) => e.op === 'delete' || e.op === 'replace').map((e, i) => (
                    <path key={`rev-${i}`} d={`M${xOf(e.t) - 3},${TOP - 2}L${xOf(e.t) + 3},${TOP - 2}L${xOf(e.t)},${TOP + 4}Z`} fill={R_COLOR} />
                ))}
                <TimeTicks ticks={axisTimeTicks(axis, start, end, 6)} spanMs={spanMs} left={L} plotW={plotW} y={BOTTOM + 1} />
            </svg>
            <Legend>
                <LegendItem glyph={<svg width={14} height={10} aria-hidden="true"><rect x={0} y={1} width={14} height={8} fill={P_COLOR} /></svg>}>P — ended by a pause</LegendItem>
                <LegendItem glyph={<svg width={20} height={10} aria-hidden="true"><rect x={0} y={1} width={12} height={8} fill={R_COLOR} /><path d="M14,1L20,1L17,7Z" fill={R_COLOR} /></svg>}>R — ended by a revision ▾</LegendItem>
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
