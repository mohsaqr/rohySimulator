// Day×Hour activity matrix — React SVG port of carmdash's "Student
// Activity" card (moodle-tna activity-tab.ts), day_hour time mode:
// Heatmap | Bubbles toggle, 7-day paging windows snapped to Sunday
// (◀ label ▶ | Today | All), dominant-state cell colouring, deterministic
// Lehmer-jittered per-student bubbles, and a state-dot legend row.
//
// Deliberately skipped from the carmdash card: the Calendar (treemap) mode
// and the week_day / month_day time modes — only day_hour is ported for
// now; bucketDayHour keeps the extensible signature.

import { useMemo, useState } from 'react';
import { bucketDayHour, dominantState, hexLuminance, lehmerJitter } from './chartMath';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const W = 800;
const MARGIN = { top: 30, right: 10, bottom: 20, left: 40 };
const GAP = 2;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Window helpers (activity-tab.ts:359-449, day_hour branch) ───────────────

/** Sunday 00:00 of the week containing ts (local time). */
export function snapToWindowStart(ts) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
}

/** Shift a window start by ±1 week. */
export function shiftWindow(start, dir) {
    const d = new Date(start);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir * 7).getTime();
}

/** Exclusive end of the 7-day window starting at start. */
export function getWindowEnd(start) {
    const d = new Date(start);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
}

/** "5–11 Jan 2026" / "29 Jun – 5 Jul 2026" — carmdash formatWindowLabel. */
export function navLabel(start) {
    if (start === null) return 'All time';
    const d = new Date(start);
    const end = new Date(start + 6 * 86400000);
    if (d.getMonth() === end.getMonth()) {
        return `${d.getDate()}–${end.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
    }
    return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]} ${end.getFullYear()}`;
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {{ts:number,student:string,state:string}[]} props.events ts in ms
 * @param {Record<string,string>} props.colorMap state → hex colour
 * @param {number} [props.height=320]
 * @param {'heatmap'|'bubbles'} [props.initialMode='bubbles']
 * @param {(y:number,x:number,students:object[]) => void} [props.onCellClick]
 */
export default function DayHourMatrix({
    events,
    colorMap,
    height = 320,
    initialMode = 'bubbles',
    onCellClick,
}) {
    const [mode, setMode] = useState(initialMode);
    const [windowStart, setWindowStart] = useState(null); // null = All time

    const dataMaxTs = useMemo(
        () => events.reduce((m, e) => (e.ts > 0 ? Math.max(m, e.ts) : m), 0), [events]);

    const windowed = useMemo(() => {
        if (windowStart === null) return events;
        const end = getWindowEnd(windowStart);
        return events.filter((e) => e.ts >= windowStart && e.ts < end);
    }, [events, windowStart]);

    const { grid, maxTotalCell, maxStudent, xLabels, yLabels } = useMemo(
        () => bucketDayHour(windowed, { timeMode: 'day_hour' }), [windowed]);

    const legendStates = useMemo(
        () => [...new Set(events.filter((e) => e.ts > 0 && e.state).map((e) => e.state))].sort(),
        [events]);

    const xLen = xLabels.length;
    const yLen = yLabels.length;
    const innerW = W - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;
    const cellW = (innerW - GAP * (xLen - 1)) / xLen;
    const cellH = (innerH - GAP * (yLen - 1)) / yLen;

    const anchor = () => snapToWindowStart(dataMaxTs > 0 ? Math.min(dataMaxTs, Date.now()) : Date.now());
    const step = (dir) => setWindowStart((prev) => (prev === null ? anchor() : shiftWindow(prev, dir)));

    const pill = (active) => ({
        fontFamily: FONT,
        fontSize: 11,
        padding: '2px 10px',
        borderRadius: 999,
        border: '1px solid #c4cdd6',
        background: active ? '#1a1a2e' : '#ffffff',
        color: active ? '#ffffff' : '#1a1a2e',
        cursor: 'pointer',
    });
    const navBtn = {
        fontFamily: FONT,
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 4,
        border: '1px solid #c4cdd6',
        background: '#ffffff',
        color: '#1a1a2e',
        cursor: 'pointer',
    };

    return (
        <div data-testid="day-hour-matrix" style={{ fontFamily: FONT, color: '#1a1a2e' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 6 }}>
                <button type="button" style={pill(mode === 'heatmap')} onClick={() => setMode('heatmap')}>
                    Heatmap
                </button>
                <button type="button" style={pill(mode === 'bubbles')} onClick={() => setMode('bubbles')}>
                    Bubbles
                </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <button type="button" aria-label="Previous period" style={navBtn} onClick={() => step(-1)}>
                    {'◀'}
                </button>
                <span
                    data-testid="nav-label"
                    style={{ fontSize: 11, fontWeight: 600, minWidth: 140, textAlign: 'center', color: '#444' }}
                >
                    {navLabel(windowStart)}
                </span>
                <button type="button" aria-label="Next period" style={navBtn} onClick={() => step(1)}>
                    {'▶'}
                </button>
                <button type="button" style={navBtn} onClick={() => setWindowStart(snapToWindowStart(Date.now()))}>
                    Today
                </button>
                <button type="button" style={navBtn} onClick={() => setWindowStart(null)}>
                    All
                </button>
            </div>
            {/* maxWidth caps the viewBox scale — stretched across a wide
                container it inflates cell text and bubbles ~2x. */}
            <svg width="100%" style={{ maxWidth: W }} viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Day by hour activity matrix">
                <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                    {xLabels.map((label, h) => (
                        (cellW >= 14 || h % 2 === 0) && (
                            <text
                                key={`x-${label}`}
                                x={h * (cellW + GAP) + cellW / 2}
                                y={-8}
                                textAnchor="middle"
                                fontSize={9}
                                fill="#999"
                            >
                                {label}
                            </text>
                        )
                    ))}
                    {yLabels.map((label, i) => (
                        <text
                            key={`y-${label}`}
                            x={-8}
                            y={i * (cellH + GAP) + cellH / 2 + 3}
                            textAnchor="end"
                            fontSize={9}
                            fill="#666"
                        >
                            {label}
                        </text>
                    ))}
                    {grid.map((row, dy) => row.map((students, dx) => {
                        const x = dx * (cellW + GAP);
                        const y = dy * (cellH + GAP);
                        const total = students.reduce((s, e) => s + e.count, 0);
                        const cellTitle = `${yLabels[dy]} × ${xLabels[dx]}`;

                        if (total === 0) {
                            return (
                                <rect
                                    key={`${dy}-${dx}`}
                                    x={x}
                                    y={y}
                                    width={cellW}
                                    height={cellH}
                                    fill="#fafafa"
                                    rx={2}
                                />
                            );
                        }

                        const cellStates = {};
                        students.forEach((s) => Object.entries(s.states).forEach(([st, c]) => {
                            cellStates[st] = (cellStates[st] ?? 0) + c;
                        }));
                        const dom = dominantState(cellStates);
                        const color = colorMap[dom] ?? '#888888';
                        const click = onCellClick ? () => onCellClick(dy, dx, students) : undefined;

                        if (mode === 'heatmap') {
                            const intensity = 0.3 + 0.7 * (total / maxTotalCell);
                            return (
                                <g key={`${dy}-${dx}`}>
                                    <rect
                                        data-testid={`heat-cell-${dy}-${dx}`}
                                        x={x}
                                        y={y}
                                        width={cellW}
                                        height={cellH}
                                        fill={color}
                                        opacity={intensity}
                                        rx={2}
                                        cursor={click ? 'pointer' : 'default'}
                                        onClick={click}
                                    >
                                        <title>{`${cellTitle}\n${total} events\n${dom}`}</title>
                                    </rect>
                                    {cellW > 16 && cellH > 14 && (
                                        <text
                                            x={x + cellW / 2}
                                            y={y + cellH / 2 + 3}
                                            textAnchor="middle"
                                            fontSize={9}
                                            fontWeight={600}
                                            fill={intensity > 0.55 && hexLuminance(color) < 0.45 ? '#ffffff' : '#333333'}
                                            opacity={0.9}
                                            pointerEvents="none"
                                        >
                                            {total}
                                        </text>
                                    )}
                                </g>
                            );
                        }

                        // Bubbles: one translucent jittered circle per student,
                        // sorted desc by count, deterministic Lehmer jitter.
                        const rand = lehmerJitter(42 + dy * 100 + dx);
                        const sorted = [...students].sort((a, b) => b.count - a.count);
                        return (
                            <g key={`${dy}-${dx}`}>
                                <rect
                                    x={x}
                                    y={y}
                                    width={cellW}
                                    height={cellH}
                                    fill="transparent"
                                    cursor={click ? 'pointer' : 'default'}
                                    onClick={click}
                                />
                                {sorted.map((s) => {
                                    const sDom = dominantState(s.states);
                                    const jx = (rand() - 0.5) * cellW * 0.7;
                                    const jy = (rand() - 0.5) * cellH * 0.7;
                                    const r = 2 + (s.count / maxStudent) * Math.min(cellW, cellH) * 0.45;
                                    return (
                                        <circle
                                            key={s.student}
                                            data-testid="bubble"
                                            cx={x + cellW / 2 + jx}
                                            cy={y + cellH / 2 + jy}
                                            r={r}
                                            fill={colorMap[sDom] ?? '#888888'}
                                            opacity={0.35}
                                            stroke="#ffffff"
                                            strokeWidth={0.5}
                                            strokeOpacity={0.4}
                                            style={{ mixBlendMode: 'multiply' }}
                                        >
                                            <title>{`${s.student} · ${s.count} events · ${sDom}`}</title>
                                        </circle>
                                    );
                                })}
                            </g>
                        );
                    }))}
                </g>
            </svg>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                {legendStates.map((st) => (
                    <span
                        key={st}
                        style={{ fontSize: 9, color: '#666', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                    >
                        <span
                            aria-hidden="true"
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: colorMap[st] ?? '#888888',
                                display: 'inline-block',
                            }}
                        />
                        {st}
                    </span>
                ))}
            </div>
        </div>
    );
}
