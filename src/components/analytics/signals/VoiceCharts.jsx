// The two across-turn voice charts, ported from Oyon's Analyze · Voice page
// (standalone/app/src/components/charts/VoiceTurnTrends.tsx and
// VoiceTurnComposition.tsx) to draw stored turns on rohy's Voice tab.
//
//   VoiceTurnTrends       — one small panel per metric across a session's turns:
//                           did the learner warm up, trail off, start hesitating.
//   VoiceTurnComposition  — one bar per turn: where that turn's time went.
//
// Derivations are Oyon's (voiceChartMath.js). The port swaps Oyon's theme
// variables for fixed greys and its palette for Okabe-Ito, draws at the
// container's real pixel width so labels never scale, keeps its honesty
// rules — an unmeasured turn is a gap the line never bridges, a turn Oyon
// flagged insufficient is drawn hollow, and a turn whose parts do not add up
// shows the residual rather than being normalised — and drops click-to-select,
// since this page has no per-turn detail to open.

import React, { useId } from 'react';
import { OKABE_ITO } from './signalStats.js';
import { measuredRuns, turnMetricSeries, turnTimeComposition } from './voiceChartMath.js';
import { formatDurationShort } from './typingChartMath.js';
import { niceAxis } from './chartAxis.js';
import { Baseline, Legend, LegendItem, ResponsiveSvg, ValueAxis, XTicks } from './ChartKit.jsx';
import { AXIS, FONT, FONT_SMALL, IDLE, MUTED } from './chartTheme.js';

const WARN = OKABE_ITO[5];
const LINE = OKABE_ITO[4];

const scale = ([d0, d1], [r0, r1]) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

// ── Trends ──────────────────────────────────────────────────────────────────

const PANELS = [
    {
        key: 'speech_ratio', label: 'Speaking share', unit: '%', floor: 0, ceil: 100,
        pick: (v) => (v.speech_ratio == null ? null : v.speech_ratio * 100),
        format: (x) => `${x.toFixed(0)}%`, absent: 'zero-length turn',
    },
    {
        key: 'pitch_median_hz', label: 'Median pitch', unit: ' Hz', floor: 0,
        pick: (v) => v.pitch_median_hz,
        format: (x) => `${x.toFixed(0)} Hz`, absent: 'too few voiced frames',
    },
    {
        key: 'pause_rate', label: 'Pauses per minute', unit: '', floor: 0,
        pick: (v) => (v.turn_duration_ms > 0 && Number.isFinite(v.internal_pause_count)
            ? v.internal_pause_count / (v.turn_duration_ms / 60000) : null),
        format: (x) => `${x.toFixed(1)}/min`, absent: 'zero-length turn',
    },
    {
        key: 'segment_mean', label: 'Mean speech run', unit: ' s', floor: 0,
        pick: (v) => (v.segment_duration_mean_ms == null ? null : v.segment_duration_mean_ms / 1000),
        format: (x) => `${x.toFixed(1)} s`, absent: 'no speech segments',
    },
];

function TrendPanel({ spec, series, turnCount }) {
    const H = 150;
    const gaps = series.n - series.measured;

    if (series.measured === 0) {
        return (
            <div className="min-w-0 rounded-md bg-gray-50 p-3">
                <p className="text-xs font-semibold text-gray-900">{spec.label}</p>
                <p className="mt-2 text-xs text-gray-500">{`Not measured in any of the ${series.n} turns — ${spec.absent}.`}</p>
            </div>
        );
    }

    const valueAxis = niceAxis(series.min, series.max, { count: 3, floor: spec.floor, ceil: spec.ceil });
    // "Latest" skips turns Oyon flagged insufficient: they stay on the plot,
    // hollow, but the tab never quotes them as a figure (see voiceAnalytics).
    const last = [...series.points].reverse().find((p) => p.value !== null && !p.flagged);

    return (
        <div className="min-w-0 rounded-md bg-gray-50 p-3">
            <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold text-gray-900">{spec.label}</p>
                <p className="text-xs tabular-nums text-gray-900">
                    <span className="font-semibold">{last ? spec.format(last.value) : '—'}</span><span className="ml-1 text-gray-500">latest</span>
                </p>
            </div>
            <ResponsiveSvg height={H} fallbackWidth={300} className="mt-2"
                ariaLabel={`${spec.label} across ${series.n} turns; ${series.measured} measured`}>
                {(W) => {
                    const L = 50, R = 10, T = 8, B = 30;
                    const y = scale(valueAxis.domain, [H - B, T]);
                    const slot = (W - L - R) / Math.max(1, turnCount);
                    const xOf = (i) => L + slot * (i + 0.5);
                    // Label every turn when there is room, otherwise about one per 40 px.
                    const every = Math.max(1, Math.ceil(turnCount / Math.max(1, Math.floor((W - L - R) / 40))));
                    const ticks = series.points
                        .filter((p) => p.index % every === 0 || p.index === turnCount - 1)
                        .map((p) => ({ key: `t-${p.index}`, x: xOf(p.index), label: String(p.index + 1) }));
                    return (
                        <>
                            <ValueAxis axis={valueAxis} y={y} left={L} right={W - R} unit={spec.unit} />
                            <Baseline left={L} right={W - R} y={H - B} />
                            <XTicks ticks={ticks} y={H - B} />
                            {measuredRuns(series.points).map((run, i) => (run.length >= 2 ? (
                                <path key={`run-${i}`} d={run.map((p, j) => `${j === 0 ? 'M' : 'L'}${xOf(p.index)},${y(p.value)}`).join('')}
                                    fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
                            ) : null))}
                            {series.points.map((p) => (p.value === null ? (
                                <line key={`gap-${p.index}`} x1={xOf(p.index)} y1={T} x2={xOf(p.index)} y2={H - B} stroke={MUTED} strokeDasharray="2 3" />
                            ) : (
                                <circle key={`pt-${p.index}`} cx={xOf(p.index)} cy={y(p.value)} r={3.5}
                                    fill={p.flagged ? '#ffffff' : LINE} stroke={p.flagged ? WARN : '#ffffff'} strokeWidth={p.flagged ? 2 : 1.5} />
                            )))}
                        </>
                    );
                }}
            </ResponsiveSvg>
            {gaps > 0 && <p className="mt-1 text-[11px] text-gray-500">{`${series.measured} of ${series.n} turns measured — the rest: ${spec.absent}.`}</p>}
        </div>
    );
}

export function VoiceTurnTrends({ turns }) {
    if (!turns?.length) return <p className="text-sm text-gray-500">No turns in this session.</p>;
    if (turns.length === 1) {
        return <p className="text-sm text-gray-500">One turn only — a trend needs at least two.</p>;
    }
    const flagged = turns.filter((t) => t.voice?.insufficient_data).length;
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
                {PANELS.map((spec) => (
                    <TrendPanel key={spec.key} spec={spec} series={turnMetricSeries(turns, spec.pick)} turnCount={turns.length} />
                ))}
            </div>
            <Legend>
                <LegendItem glyph={<svg width={10} height={10} aria-hidden="true"><circle cx={5} cy={5} r={3.5} fill={LINE} /></svg>}>measured turn</LegendItem>
                {flagged > 0 && (
                    <LegendItem glyph={<svg width={10} height={10} aria-hidden="true"><circle cx={5} cy={5} r={3.5} fill="#ffffff" stroke={WARN} strokeWidth={1.5} /></svg>}>
                        {`hollow: Oyon could not measure the turn reliably (${flagged}) — shown, not comparable`}
                    </LegendItem>
                )}
                <LegendItem glyph={<svg width={10} height={12} aria-hidden="true"><line x1={5} y1={0} x2={5} y2={12} stroke={MUTED} strokeDasharray="2 3" /></svg>}>
                    turn with no value — the line breaks there
                </LegendItem>
                <span className="text-gray-500">x axis: turn number</span>
            </Legend>
        </div>
    );
}

// ── Composition ─────────────────────────────────────────────────────────────

const PART_LABEL = {
    initial_silence: 'Silence before speaking',
    speech: 'Speech',
    pause: 'Pauses',
    trailing_silence: 'Silence after speaking',
    playback: 'Patient speaking (excluded)',
    muted: 'Muted',
    unaccounted: 'Unaccounted',
};

/** Parts wide enough carry their own label, so the bar reads without the legend. */
const IN_BAR_LABEL = { speech: 'speech', pause: 'pauses' };

export function VoiceTurnComposition({ turns }) {
    const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const ROW_H = 30, BAR_H = 20, TOP = 4, AXIS_H = 26;
    const rows = (turns || []).map((t, index) => ({ index, flagged: t.voice?.insufficient_data === true, composition: turnTimeComposition(t.voice) }));
    const drawable = rows.filter((r) => r.composition !== null);
    if (drawable.length === 0) return <p className="text-sm text-gray-500">Not drawable — no turn has a positive duration.</p>;

    // Silences are grey, told apart by position (before / after) AND texture;
    // speech and pauses are labelled inside the bar when there is room.
    const fill = {
        initial_silence: '#e5e7eb',
        speech: LINE,
        pause: OKABE_ITO[0],
        trailing_silence: `url(#${id}-lines)`,
        playback: `url(#${id}-hatch)`,
        muted: `url(#${id}-dots)`,
        unaccounted: IDLE,
    };
    const maxMs = Math.max(...drawable.map((r) => Math.max(r.composition.totalMs, r.composition.accountedMs)));
    const valueAxis = niceAxis(0, maxMs / 1000, { count: 5, floor: 0 });
    const H = TOP + rows.length * ROW_H + AXIS_H;
    const kinds = new Set();
    for (const r of drawable) {
        for (const p of r.composition.parts) kinds.add(p.key);
        if (r.composition.unaccountedMs > 0) kinds.add('unaccounted');
    }

    const glyph = (key) => (
        <svg width={12} height={12} aria-hidden="true">
            <rect x={0.5} y={0.5} width={11} height={11} fill={fill[key]} stroke={AXIS} strokeWidth={0.5} />
        </svg>
    );

    return (
        <div className="space-y-3">
            <svg width={0} height={0} className="absolute" aria-hidden="true">
                <defs>
                    <pattern id={`${id}-hatch`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width={6} height={6} fill="#f3f4f6" />
                        <line x1={0} y1={0} x2={0} y2={6} stroke={MUTED} strokeWidth={1.5} />
                    </pattern>
                    <pattern id={`${id}-dots`} width={4} height={4} patternUnits="userSpaceOnUse">
                        <rect width={4} height={4} fill="#f9fafb" />
                        <circle cx={1} cy={1} r={0.9} fill={MUTED} />
                    </pattern>
                    <pattern id={`${id}-lines`} width={4} height={4} patternUnits="userSpaceOnUse">
                        <rect width={4} height={4} fill="#eef2f6" />
                        <line x1={0.5} y1={0} x2={0.5} y2={4} stroke="#cbd5e1" strokeWidth={1} />
                    </pattern>
                </defs>
            </svg>
            <ResponsiveSvg height={H} ariaLabel={`Where each turn's time went, across ${rows.length} turns`}>
                {(W) => {
                    const L = 56, R = 16;
                    const plotW = W - L - R;
                    const xOfS = scale(valueAxis.domain, [L, L + plotW]);
                    const wOf = (ms) => xOfS(ms / 1000) - L;
                    const plotBottom = TOP + rows.length * ROW_H;
                    return (
                        <>
                            {valueAxis.ticks.map((v) => (
                                <line key={`g-${v}`} x1={xOfS(v)} y1={TOP} x2={xOfS(v)} y2={plotBottom} stroke="#eceff3" />
                            ))}
                            {rows.map((row) => {
                                const y = TOP + row.index * ROW_H + (ROW_H - BAR_H) / 2;
                                const label = (
                                    <text x={L - 10} y={y + BAR_H / 2} dy="0.35em" textAnchor="end" fontSize={FONT} fill={MUTED}>
                                        {`Turn ${row.index + 1}`}
                                    </text>
                                );
                                if (!row.composition) {
                                    return <g key={`row-${row.index}`}>{label}<text x={L} y={y + BAR_H / 2} dy="0.35em" fontSize={FONT} fill={MUTED}>zero-length turn</text></g>;
                                }
                                const { parts, unaccountedMs, totalMs, overrunMs } = row.composition;
                                let cursor = L;
                                const segs = parts.map((part) => {
                                    const seg = { ...part, x: cursor, width: wOf(part.ms) };
                                    cursor += seg.width;
                                    return seg;
                                });
                                const end = cursor + (unaccountedMs > 0 ? wOf(unaccountedMs) : 0);
                                const overrunText = `+${formatDurationShort(overrunMs)} over wall clock`;
                                return (
                                    <g key={`row-${row.index}`}>
                                        {label}
                                        {segs.map((seg) => (
                                            <rect key={seg.key} x={seg.x} y={y} width={Math.max(0.5, seg.width)} height={BAR_H} fill={fill[seg.key]}>
                                                <title>{`${PART_LABEL[seg.key]} — ${formatDurationShort(seg.ms)} (${((seg.ms / Math.max(1, totalMs)) * 100).toFixed(0)}% of the turn)`}</title>
                                            </rect>
                                        ))}
                                        {segs.map((seg) => {
                                            const word = IN_BAR_LABEL[seg.key];
                                            const text = word ? `${formatDurationShort(seg.ms)} ${word}` : null;
                                            if (!text) return null;
                                            const fits = seg.width >= text.length * 6 + 10;
                                            const short = formatDurationShort(seg.ms);
                                            if (!fits && seg.width < short.length * 6 + 8) return null;
                                            return (
                                                <text key={`l-${seg.key}`} x={seg.x + seg.width / 2} y={y + BAR_H / 2} dy="0.35em" textAnchor="middle"
                                                    fontSize={FONT_SMALL} fontWeight={600} fill={seg.key === 'speech' ? '#ffffff' : '#1f2937'} pointerEvents="none">
                                                    {fits ? text : short}
                                                </text>
                                            );
                                        })}
                                        {unaccountedMs > 0 && (
                                            <rect x={cursor} y={y} width={Math.max(0.5, wOf(unaccountedMs))} height={BAR_H} fill={fill.unaccounted} stroke={AXIS} strokeWidth={0.5}>
                                                <title>{`Unaccounted — ${formatDurationShort(unaccountedMs)} of wall-clock time the measured parts do not cover`}</title>
                                            </rect>
                                        )}
                                        {row.flagged && (
                                            <text x={Math.min(end + 8, W - R)} y={y + BAR_H / 2} dy="0.35em" textAnchor={end + 8 + 150 > W - R ? 'end' : 'start'}
                                                fontSize={FONT_SMALL} fill={MUTED} fontStyle="italic">not measurable — left out of the figures</text>
                                        )}
                                        {overrunMs > 0 && !row.flagged && (
                                            <text x={Math.min(end + 6, W - R)} y={y + BAR_H / 2} dy="0.35em" textAnchor={end + 6 + overrunText.length * 6 > W ? 'end' : 'start'}
                                                fontSize={FONT_SMALL} fill={WARN}>{overrunText}</text>
                                        )}
                                    </g>
                                );
                            })}
                            <Baseline left={L} right={W - R} y={plotBottom} />
                            <XTicks ticks={valueAxis.ticks.map((v) => ({ key: `x-${v}`, x: xOfS(v), label: `${v.toFixed(valueAxis.decimals)} s` }))} y={plotBottom} />
                        </>
                    );
                }}
            </ResponsiveSvg>
            <Legend>
                {[...kinds].map((key) => <LegendItem key={key} glyph={glyph(key)}>{PART_LABEL[key]}</LegendItem>)}
            </Legend>
            <p className="text-xs text-gray-500">
                Bar length is the turn&apos;s duration, so turns compare. A wide first band is a long think before
                answering; wide pause bands are hesitation inside the answer — two turns can have the same speaking
                share and mean different things.
            </p>
        </div>
    );
}
