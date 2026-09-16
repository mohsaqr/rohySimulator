// The two across-turn voice charts, ported from Oyon's Analyze · Voice page
// (standalone/app/src/components/charts/VoiceTurnTrends.tsx and
// VoiceTurnComposition.tsx) to draw stored turns on rohy's Voice tab.
//
//   VoiceTurnTrends       — one small panel per metric across a session's turns:
//                           did the learner warm up, trail off, start hesitating.
//   VoiceTurnComposition  — one bar per turn: where that turn's time went.
//
// Derivations are Oyon's (voiceChartMath.js). The port swaps Oyon's theme
// variables for fixed greys and its palette for Okabe-Ito, keeps its honesty
// rules — an unmeasured turn is a gap the line never bridges, a turn Oyon
// flagged insufficient is drawn hollow, and a turn whose parts do not add up
// shows the residual rather than being normalised — and drops click-to-select,
// since this page has no per-turn detail to open.

import React, { useId } from 'react';
import { OKABE_ITO } from './signalStats.js';
import { linearScale } from '../charts/chartMath.js';
import { measuredRuns, turnMetricSeries, turnTimeComposition } from './voiceChartMath.js';
import { formatDurationShort } from './typingChartMath.js';

const MUTED = '#6b7280';
const GRID = '#e5e7eb';
const AXIS = '#9ca3af';
const WARN = OKABE_ITO[5];

// ── Trends ──────────────────────────────────────────────────────────────────

const PANELS = [
    {
        key: 'speech_ratio', label: 'Speaking share',
        pick: (v) => (v.speech_ratio == null ? null : v.speech_ratio * 100),
        format: (x) => `${x.toFixed(0)}%`, absent: 'zero-length turn',
    },
    {
        key: 'pitch_median_hz', label: 'Median pitch',
        pick: (v) => v.pitch_median_hz,
        format: (x) => `${x.toFixed(0)} Hz`, absent: 'too few voiced frames',
    },
    {
        key: 'pause_rate', label: 'Pauses per minute',
        pick: (v) => (v.turn_duration_ms > 0 && Number.isFinite(v.internal_pause_count)
            ? v.internal_pause_count / (v.turn_duration_ms / 60000) : null),
        format: (x) => `${x.toFixed(1)}/min`, absent: 'zero-length turn',
    },
    {
        key: 'segment_mean', label: 'Mean speech run',
        pick: (v) => (v.segment_duration_mean_ms == null ? null : v.segment_duration_mean_ms / 1000),
        format: (x) => `${x.toFixed(1)} s`, absent: 'no speech segments',
    },
];

function TrendPanel({ spec, series, turnCount }) {
    const W = 320, H = 132, L = 40, R = 10, T = 12, B = 22;
    const color = OKABE_ITO[4];
    const gaps = series.n - series.measured;

    if (series.measured === 0) {
        return (
            <div>
                <p className="text-xs font-medium text-gray-900">{spec.label}</p>
                <p className="text-xs text-gray-500">{`Not measured in any of the ${series.n} turns — ${spec.absent}.`}</p>
            </div>
        );
    }

    const lo = series.min;
    const hi = series.max;
    const pad = hi > lo ? (hi - lo) * 0.15 : Math.max(1, Math.abs(hi) * 0.1);
    const y = linearScale([lo - pad, hi + pad], [H - B, T]);
    const slot = (W - L - R) / Math.max(1, turnCount);
    const xOf = (i) => L + slot * (i + 0.5);
    // "Latest" skips turns Oyon flagged insufficient: they stay on the plot,
    // hollow, but the tab never quotes them as a figure (see voiceAnalytics).
    const last = [...series.points].reverse().find((p) => p.value !== null && !p.flagged);

    return (
        <div>
            <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium text-gray-900">{spec.label}</p>
                <p className="text-xs tabular-nums text-gray-700">
                    {last ? spec.format(last.value) : '—'}<span className="ml-1 text-gray-500">latest</span>
                </p>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
                aria-label={`${spec.label} across ${series.n} turns; ${series.measured} measured`}>
                {y.ticks(3).map((v) => (
                    <g key={`y-${v}`}>
                        <line x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke={GRID} />
                        <text x={L - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill={MUTED}>{Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)}</text>
                    </g>
                ))}
                <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke={AXIS} />
                <text x={W - R} y={H - 4} textAnchor="end" fontSize={9} fill={MUTED}>turn →</text>
                {measuredRuns(series.points).map((run, i) => (run.length >= 2 ? (
                    <path key={`run-${i}`} d={run.map((p, j) => `${j === 0 ? 'M' : 'L'}${xOf(p.index)},${y(p.value)}`).join('')}
                        fill="none" stroke={color} strokeWidth={1.5} />
                ) : null))}
                {series.points.map((p) => (p.value === null ? (
                    <line key={`gap-${p.index}`} x1={xOf(p.index)} y1={H - B - 3} x2={xOf(p.index)} y2={H - B + 3} stroke={MUTED} strokeDasharray="1 1" />
                ) : (
                    <circle key={`pt-${p.index}`} cx={xOf(p.index)} cy={y(p.value)} r={3}
                        fill={p.flagged ? '#ffffff' : color} stroke={p.flagged ? WARN : color} strokeWidth={p.flagged ? 1.5 : 1} />
                )))}
            </svg>
            {gaps > 0 && <p className="text-[11px] text-gray-500">{`${series.measured} of ${series.n} turns measured — the rest: ${spec.absent}.`}</p>}
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
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {PANELS.map((spec) => (
                    <TrendPanel key={spec.key} spec={spec} series={turnMetricSeries(turns, spec.pick)} turnCount={turns.length} />
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                <span className="inline-flex items-center gap-1">
                    <svg width={10} height={10} aria-hidden="true"><circle cx={5} cy={5} r={3} fill={OKABE_ITO[4]} /></svg>measured turn
                </span>
                {flagged > 0 && (
                    <span className="inline-flex items-center gap-1">
                        <svg width={10} height={10} aria-hidden="true"><circle cx={5} cy={5} r={3} fill="#ffffff" stroke={WARN} strokeWidth={1.5} /></svg>
                        {`hollow: Oyon could not measure the turn reliably (${flagged}) — shown, not comparable`}
                    </span>
                )}
                <span className="inline-flex items-center gap-1">
                    <svg width={10} height={10} aria-hidden="true"><line x1={5} y1={1} x2={5} y2={9} stroke={MUTED} strokeDasharray="1 1" /></svg>
                    turn with no value — the line breaks there
                </span>
            </div>
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

export function VoiceTurnComposition({ turns }) {
    const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const W = 860, ROW_H = 22, BAR_H = 13, L = 34, R = 60;
    const rows = (turns || []).map((t, index) => ({ index, composition: turnTimeComposition(t.voice) }));
    const drawable = rows.filter((r) => r.composition !== null);
    if (drawable.length === 0) return <p className="text-sm text-gray-500">Not drawable — no turn has a positive duration.</p>;

    const fill = {
        initial_silence: '#e5e7eb',
        speech: OKABE_ITO[4],
        pause: OKABE_ITO[0],
        trailing_silence: '#cbd5e1',
        playback: `url(#${id}-hatch)`,
        muted: `url(#${id}-dots)`,
        unaccounted: '#f3f4f6',
    };
    const maxMs = Math.max(...drawable.map((r) => Math.max(r.composition.totalMs, r.composition.accountedMs)));
    const wOf = (ms) => (ms / Math.max(1, maxMs)) * (W - L - R);
    const H = rows.length * ROW_H + 16;
    const kinds = new Set();
    for (const r of drawable) {
        for (const p of r.composition.parts) kinds.add(p.key);
        if (r.composition.unaccountedMs > 0) kinds.add('unaccounted');
    }

    return (
        <div className="space-y-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
                aria-label={`Where each turn's time went, across ${rows.length} turns`}>
                <defs>
                    <pattern id={`${id}-hatch`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width={6} height={6} fill="#f3f4f6" />
                        <line x1={0} y1={0} x2={0} y2={6} stroke={MUTED} strokeWidth={1.5} />
                    </pattern>
                    <pattern id={`${id}-dots`} width={4} height={4} patternUnits="userSpaceOnUse">
                        <rect width={4} height={4} fill="#f9fafb" />
                        <circle cx={1} cy={1} r={0.9} fill={MUTED} />
                    </pattern>
                </defs>
                {rows.map((row) => {
                    const y = row.index * ROW_H + 8;
                    const label = <text x={L - 5} y={y + BAR_H - 3} textAnchor="end" fontSize={9} fill={MUTED}>{row.index + 1}</text>;
                    if (!row.composition) {
                        return <g key={`row-${row.index}`}>{label}<text x={L} y={y + BAR_H - 3} fontSize={9} fill={MUTED}>zero-length turn</text></g>;
                    }
                    const { parts, unaccountedMs, totalMs, overrunMs } = row.composition;
                    let cursor = L;
                    return (
                        <g key={`row-${row.index}`}>
                            {label}
                            {parts.map((part) => {
                                const x = cursor;
                                const width = wOf(part.ms);
                                cursor += width;
                                return (
                                    <rect key={part.key} x={x} y={y} width={Math.max(0.5, width)} height={BAR_H} fill={fill[part.key]}>
                                        <title>{`${PART_LABEL[part.key]} — ${formatDurationShort(part.ms)} (${((part.ms / Math.max(1, totalMs)) * 100).toFixed(0)}% of the turn)`}</title>
                                    </rect>
                                );
                            })}
                            {unaccountedMs > 0 && (
                                <rect x={cursor} y={y} width={Math.max(0.5, wOf(unaccountedMs))} height={BAR_H} fill={fill.unaccounted} stroke={AXIS} strokeWidth={0.5}>
                                    <title>{`Unaccounted — ${formatDurationShort(unaccountedMs)} of wall-clock time the measured parts do not cover`}</title>
                                </rect>
                            )}
                            <text x={cursor + wOf(unaccountedMs) + 5} y={y + BAR_H - 3} fontSize={9} fill={overrunMs > 0 ? WARN : MUTED}>
                                {overrunMs > 0 ? `+${formatDurationShort(overrunMs)} over wall clock` : formatDurationShort(totalMs)}
                            </text>
                        </g>
                    );
                })}
            </svg>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                {[...kinds].map((key) => (
                    <span key={key} className="inline-flex items-center gap-1">
                        <svg width={12} height={12} aria-hidden="true"><rect x={1} y={1} width={10} height={10} fill={fill[key]} stroke={AXIS} strokeWidth={0.5} /></svg>
                        {PART_LABEL[key]}
                    </span>
                ))}
            </div>
            <p className="text-xs text-gray-500">
                Bar length is the turn&apos;s duration, so turns compare. A wide first band is a long think before
                answering; wide pause bands are hesitation inside the answer — two turns can have the same speaking
                share and mean different things.
            </p>
        </div>
    );
}
