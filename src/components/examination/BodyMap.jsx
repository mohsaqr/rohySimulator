import React from 'react';

/**
 * Body Map Component with Clean Silhouette and Hotspots
 * Professional medical examination interface
 */
export default function BodyMap({
    view = 'anterior',
    selectedRegion,
    onRegionClick,
    examinedRegions = new Set(),
    abnormalRegions = new Set()
}) {

    // Hotspot configuration for anterior view
    const anteriorHotspots = [
        { id: 'head', x: 100, y: 40, label: 'Head' },
        { id: 'eyes', x: 100, y: 30, label: 'Eyes', small: true },
        { id: 'neck', x: 100, y: 72, label: 'Neck' },
        { id: 'chestAnterior', x: 100, y: 115, label: 'Chest' },
        { id: 'heart', x: 115, y: 125, label: 'Heart', small: true },
        { id: 'abdomen', x: 100, y: 175, label: 'Abdomen' },
        { id: 'upperLimbLeft', x: 45, y: 130, label: 'L. Arm' },
        { id: 'upperLimbRight', x: 155, y: 130, label: 'R. Arm' },
        { id: 'lowerLimbLeft', x: 80, y: 290, label: 'L. Leg' },
        { id: 'lowerLimbRight', x: 120, y: 290, label: 'R. Leg' },
    ];

    // Hotspot configuration for posterior view
    const posteriorHotspots = [
        { id: 'head', x: 100, y: 40, label: 'Head' },
        { id: 'neck', x: 100, y: 72, label: 'Neck' },
        { id: 'backUpper', x: 100, y: 115, label: 'Upper Back' },
        { id: 'backLower', x: 100, y: 175, label: 'Lower Back' },
        { id: 'upperLimbLeft', x: 45, y: 130, label: 'L. Arm' },
        { id: 'upperLimbRight', x: 155, y: 130, label: 'R. Arm' },
        { id: 'lowerLimbLeft', x: 80, y: 290, label: 'L. Leg' },
        { id: 'lowerLimbRight', x: 120, y: 290, label: 'R. Leg' },
    ];

    const hotspots = view === 'anterior' ? anteriorHotspots : posteriorHotspots;

    // Get hotspot status and styling
    const getHotspotStatus = (regionId) => {
        const isSelected = selectedRegion === regionId;
        const isExamined = examinedRegions.has(regionId);
        const isAbnormal = abnormalRegions.has(regionId);

        return { isSelected, isExamined, isAbnormal };
    };

    return (
        <svg viewBox="0 0 200 380" className="w-full h-full max-h-[500px]">
            <defs>
                {/* Glow filter for selected */}
                <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>

                {/* Pulse animation for abnormal */}
                <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>

                {/* Gradient for body */}
                <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#374151" stopOpacity="0.6"/>
                    <stop offset="100%" stopColor="#1f2937" stopOpacity="0.8"/>
                </linearGradient>
            </defs>

            {/* Clean Body Silhouette */}
            {view === 'anterior' ? (
                <g className="body-silhouette">
                    {/* Head */}
                    <ellipse cx="100" cy="38" rx="22" ry="26"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Neck */}
                    <rect x="90" y="62" width="20" height="18" rx="3"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Torso */}
                    <path d="M 60 80
                             Q 55 85 55 100
                             L 55 200
                             Q 55 210 70 215
                             L 70 220
                             L 85 220
                             L 85 215
                             Q 100 218 115 215
                             L 115 220
                             L 130 220
                             L 130 215
                             Q 145 210 145 200
                             L 145 100
                             Q 145 85 140 80
                             Q 120 78 100 80
                             Q 80 78 60 80 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Left Arm */}
                    <path d="M 55 85
                             Q 35 90 28 120
                             L 18 175
                             Q 15 185 20 188
                             L 30 188
                             Q 35 185 37 175
                             L 48 120
                             Q 52 95 55 90 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Right Arm */}
                    <path d="M 145 85
                             Q 165 90 172 120
                             L 182 175
                             Q 185 185 180 188
                             L 170 188
                             Q 165 185 163 175
                             L 152 120
                             Q 148 95 145 90 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Left Leg */}
                    <path d="M 70 220
                             L 68 300
                             Q 66 340 63 355
                             L 60 365
                             Q 58 370 65 372
                             L 80 372
                             Q 87 370 85 365
                             L 82 340
                             Q 85 300 88 250
                             L 88 220 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Right Leg */}
                    <path d="M 130 220
                             L 132 300
                             Q 134 340 137 355
                             L 140 365
                             Q 142 370 135 372
                             L 120 372
                             Q 113 370 115 365
                             L 118 340
                             Q 115 300 112 250
                             L 112 220 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>
                </g>
            ) : (
                <g className="body-silhouette">
                    {/* Head - Back View */}
                    <ellipse cx="100" cy="38" rx="22" ry="26"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Neck */}
                    <rect x="90" y="62" width="20" height="18" rx="3"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Back/Torso */}
                    <path d="M 60 80
                             Q 55 85 55 100
                             L 55 200
                             Q 55 210 70 215
                             L 70 220
                             L 85 220
                             L 85 215
                             Q 100 218 115 215
                             L 115 220
                             L 130 220
                             L 130 215
                             Q 145 210 145 200
                             L 145 100
                             Q 145 85 140 80
                             Q 120 78 100 80
                             Q 80 78 60 80 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Spine indication */}
                    <line x1="100" y1="85" x2="100" y2="210" stroke="#6b7280" strokeWidth="1" strokeDasharray="3,3"/>

                    {/* Left Arm */}
                    <path d="M 55 85
                             Q 35 90 28 120
                             L 18 175
                             Q 15 185 20 188
                             L 30 188
                             Q 35 185 37 175
                             L 48 120
                             Q 52 95 55 90 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Right Arm */}
                    <path d="M 145 85
                             Q 165 90 172 120
                             L 182 175
                             Q 185 185 180 188
                             L 170 188
                             Q 165 185 163 175
                             L 152 120
                             Q 148 95 145 90 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Left Leg */}
                    <path d="M 70 220
                             L 68 300
                             Q 66 340 63 355
                             L 60 365
                             Q 58 370 65 372
                             L 80 372
                             Q 87 370 85 365
                             L 82 340
                             Q 85 300 88 250
                             L 88 220 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>

                    {/* Right Leg */}
                    <path d="M 130 220
                             L 132 300
                             Q 134 340 137 355
                             L 140 365
                             Q 142 370 135 372
                             L 120 372
                             Q 113 370 115 365
                             L 118 340
                             Q 115 300 112 250
                             L 112 220 Z"
                        fill="url(#bodyGradient)" stroke="#4b5563" strokeWidth="1.5"/>
                </g>
            )}

            {/* Hotspots */}
            {hotspots.map(hotspot => {
                const { isSelected, isExamined, isAbnormal } = getHotspotStatus(hotspot.id);
                const size = hotspot.small ? 8 : 12;

                let fillColor = '#475569'; // Default gray
                let strokeColor = '#64748b';
                let filter = '';
                let pulseClass = '';

                if (isAbnormal) {
                    fillColor = '#ef4444';
                    strokeColor = '#f87171';
                    filter = 'url(#glow-red)';
                    pulseClass = 'animate-pulse';
                } else if (isExamined) {
                    fillColor = '#22c55e';
                    strokeColor = '#4ade80';
                } else if (isSelected) {
                    fillColor = '#06b6d4';
                    strokeColor = '#22d3ee';
                    filter = 'url(#glow-cyan)';
                }

                return (
                    <g
                        key={hotspot.id}
                        onClick={() => onRegionClick(hotspot.id)}
                        className={`cursor-pointer transition-all duration-200 hover:scale-110 ${pulseClass}`}
                        style={{ transformOrigin: `${hotspot.x}px ${hotspot.y}px` }}
                    >
                        {/* Outer ring for better visibility */}
                        <circle
                            cx={hotspot.x}
                            cy={hotspot.y}
                            r={size + 4}
                            fill="transparent"
                            stroke={strokeColor}
                            strokeWidth="1"
                            opacity="0.5"
                        />

                        {/* Main hotspot */}
                        <circle
                            cx={hotspot.x}
                            cy={hotspot.y}
                            r={size}
                            fill={fillColor}
                            stroke={strokeColor}
                            strokeWidth="2"
                            filter={filter}
                            className="transition-all duration-200"
                        />

                        {/* Inner dot */}
                        <circle
                            cx={hotspot.x}
                            cy={hotspot.y}
                            r={size * 0.3}
                            fill="white"
                            opacity="0.8"
                        />

                        {/* Label on hover - positioned to avoid overlap */}
                        <text
                            x={hotspot.x + (hotspot.x < 100 ? -size - 8 : size + 8)}
                            y={hotspot.y + 4}
                            textAnchor={hotspot.x < 100 ? 'end' : 'start'}
                            fontSize="9"
                            fill="#94a3b8"
                            className="pointer-events-none select-none"
                            fontWeight="500"
                        >
                            {hotspot.label}
                        </text>
                    </g>
                );
            })}

            {/* Legend */}
            <g transform="translate(10, 340)">
                <text x="0" y="0" fontSize="8" fill="#64748b" fontWeight="600">LEGEND</text>

                <circle cx="8" cy="12" r="5" fill="#475569" stroke="#64748b" strokeWidth="1"/>
                <text x="18" y="15" fontSize="7" fill="#94a3b8">Not examined</text>

                <circle cx="8" cy="26" r="5" fill="#22c55e" stroke="#4ade80" strokeWidth="1"/>
                <text x="18" y="29" fontSize="7" fill="#94a3b8">Normal</text>

                <circle cx="70" cy="12" r="5" fill="#ef4444" stroke="#f87171" strokeWidth="1"/>
                <text x="80" y="15" fontSize="7" fill="#94a3b8">Abnormal</text>

                <circle cx="70" cy="26" r="5" fill="#06b6d4" stroke="#22d3ee" strokeWidth="1"/>
                <text x="80" y="29" fontSize="7" fill="#94a3b8">Selected</text>
            </g>
        </svg>
    );
}
