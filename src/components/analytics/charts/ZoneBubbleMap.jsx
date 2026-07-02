// Gaze-zone bubble map — a 16:10 "screen"-shaped SVG panel showing where
// on the screen attention landed. The 3×3 zone grid (top/middle/bottom ×
// left/center/right) is heat-filled with opacity proportional to each
// zone's overall share (plus a % label, text colour picked via
// hexLuminance), then one translucent bubble per student per zone they
// looked at: deterministic Lehmer-jittered position inside the cell,
// radius proportional to the student's share of that zone (capped at
// ~45% of the cell). Dark-background friendly: neutral gray strokes and
// labels, no opaque background fill.

import { hexLuminance, lehmerJitter } from './chartMath';

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const ROWS = ['top', 'middle', 'bottom'];
const COLS = ['left', 'center', 'right'];
const HEAT = '#f28e2b'; // CARM_PALETTE[1] — heat fill for zone shares
const GRID_STROKE = '#d1d5db';
const LABEL_MUTED = '#6b7280';

/**
 * @param {object} props
 * @param {string} [props.title]
 * @param {Record<string,number>} props.zoneWeights overall share per zone
 *   key (top_left … bottom_right), shares in [0,1]
 * @param {{student:string,color:string,zones:Record<string,number>}[]}
 *   props.studentZoneWeights one bubble per student per zone with share > 0
 * @param {number} [props.width=280] panel width; height = width × 10/16
 */
export default function ZoneBubbleMap({
    title,
    zoneWeights = {},
    studentZoneWeights = [],
    width = 280,
}) {
    const height = (width * 10) / 16;
    const cellW = width / 3;
    const cellH = height / 3;
    const maxR = Math.min(cellW, cellH) * 0.45;
    const maxShare = ROWS.reduce(
        (m, rk) => COLS.reduce((mm, ck) => Math.max(mm, zoneWeights[`${rk}_${ck}`] ?? 0), m), 0);
    const heatIsDark = hexLuminance(HEAT) < 0.45;

    return (
        <div data-testid="zone-bubble-map" style={{ fontFamily: FONT, width }}>
            {title && (
                <div style={{ fontSize: 12, fontWeight: 600, color: LABEL_MUTED, marginBottom: 4 }}>
                    {title}
                </div>
            )}
            <svg
                width="100%"
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label={title ?? 'Gaze zone map'}
            >
                {ROWS.map((rk, ri) => COLS.map((ck, ci) => {
                    const zone = `${rk}_${ck}`;
                    const share = zoneWeights[zone] ?? 0;
                    const heatOpacity = maxShare > 0 ? (share / maxShare) * 0.8 : 0;
                    const x = ci * cellW;
                    const y = ri * cellH;
                    // White text only over a strong dark heat fill; muted
                    // gray otherwise (dark-background friendly).
                    const labelFill = heatOpacity > 0.55 && heatIsDark ? '#ffffff' : LABEL_MUTED;
                    const rand = lehmerJitter(42 + ri * 100 + ci);
                    return (
                        <g key={zone} data-testid={`zone-cell-${zone}`}>
                            <rect
                                x={x}
                                y={y}
                                width={cellW}
                                height={cellH}
                                fill={HEAT}
                                fillOpacity={heatOpacity}
                                stroke={GRID_STROKE}
                                strokeWidth={0.75}
                            />
                            <text
                                x={x + cellW / 2}
                                y={y + cellH / 2}
                                dy="0.35em"
                                textAnchor="middle"
                                fontSize={10}
                                fontWeight={600}
                                fill={labelFill}
                                pointerEvents="none"
                            >
                                {`${Math.round(share * 100)}%`}
                            </text>
                            {studentZoneWeights.flatMap((s) => {
                                const sShare = s.zones?.[zone] ?? 0;
                                if (!(sShare > 0)) return [];
                                const jx = (rand() - 0.5) * cellW * 0.6;
                                const jy = (rand() - 0.5) * cellH * 0.6;
                                const r = Math.min(maxR, 2 + sShare * (maxR - 2));
                                return [(
                                    <circle
                                        key={`${zone}:${s.student}`}
                                        data-testid="zone-bubble"
                                        cx={x + cellW / 2 + jx}
                                        cy={y + cellH / 2 + jy}
                                        r={r}
                                        fill={s.color}
                                        fillOpacity={0.35}
                                        stroke="#ffffff"
                                        strokeWidth={0.5}
                                        strokeOpacity={0.5}
                                        style={{ mixBlendMode: 'multiply' }}
                                    >
                                        <title>{`${s.student} · ${zone} · ${Math.round(sShare * 100)}%`}</title>
                                    </circle>
                                )];
                            })}
                        </g>
                    );
                }))}
                {/* Screen bezel outline */}
                <rect
                    x={0.5}
                    y={0.5}
                    width={width - 1}
                    height={height - 1}
                    fill="none"
                    stroke={GRID_STROKE}
                    strokeWidth={1}
                    rx={4}
                />
            </svg>
        </div>
    );
}
