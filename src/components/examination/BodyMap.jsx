import React from 'react';

/**
 * SVG Body Map Component
 * Displays an interactive human body silhouette with clickable regions
 */
export default function BodyMap({
    view = 'anterior',
    selectedRegion,
    onRegionClick,
    examinedRegions = new Set(),
    abnormalRegions = new Set()
}) {

    // Get region style based on state
    const getRegionStyle = (regionId) => {
        const isSelected = selectedRegion === regionId;
        const isExamined = examinedRegions.has(regionId);
        const isAbnormal = abnormalRegions.has(regionId);

        let fill = 'rgba(100, 116, 139, 0.3)'; // Default slate
        let stroke = 'rgb(100, 116, 139)';
        let strokeWidth = 1;

        if (isAbnormal) {
            fill = 'rgba(239, 68, 68, 0.3)'; // Red for abnormal
            stroke = 'rgb(239, 68, 68)';
        } else if (isExamined) {
            fill = 'rgba(34, 197, 94, 0.3)'; // Green for examined normal
            stroke = 'rgb(34, 197, 94)';
        }

        if (isSelected) {
            fill = 'rgba(6, 182, 212, 0.4)'; // Cyan for selected
            stroke = 'rgb(6, 182, 212)';
            strokeWidth = 2;
        }

        return { fill, stroke, strokeWidth };
    };

    // Common props for clickable regions
    const getRegionProps = (regionId) => ({
        onClick: () => onRegionClick(regionId),
        style: { cursor: 'pointer', transition: 'all 0.2s ease' },
        className: 'hover:opacity-80'
    });

    if (view === 'anterior') {
        return (
            <svg viewBox="0 0 200 400" className="w-full h-full max-h-[500px]">
                {/* Background */}
                <rect width="200" height="400" fill="transparent" />

                {/* Body outline - decorative */}
                <ellipse cx="100" cy="385" rx="30" ry="8" fill="rgba(50,50,50,0.3)" /> {/* Shadow */}

                {/* HEAD */}
                <g {...getRegionProps('head')}>
                    <ellipse
                        cx="100" cy="35" rx="25" ry="30"
                        {...getRegionStyle('head')}
                    />
                    <text x="100" y="38" textAnchor="middle" fontSize="10" fill="white" pointerEvents="none">
                        Head
                    </text>
                </g>

                {/* NECK */}
                <g {...getRegionProps('neck')}>
                    <rect
                        x="88" y="62" width="24" height="20" rx="4"
                        {...getRegionStyle('neck')}
                    />
                    <text x="100" y="75" textAnchor="middle" fontSize="8" fill="white" pointerEvents="none">
                        Neck
                    </text>
                </g>

                {/* CHEST (Anterior) */}
                <g {...getRegionProps('chestAnterior')}>
                    <path
                        d="M 60 82
                           Q 55 90 55 110
                           L 55 150
                           Q 55 155 60 158
                           L 140 158
                           Q 145 155 145 150
                           L 145 110
                           Q 145 90 140 82
                           L 115 82
                           Q 100 85 85 82
                           Z"
                        {...getRegionStyle('chestAnterior')}
                    />
                    <text x="100" y="125" textAnchor="middle" fontSize="10" fill="white" pointerEvents="none">
                        Chest
                    </text>
                </g>

                {/* HEART area overlay - clickable separately */}
                <g {...getRegionProps('heart')}>
                    <ellipse
                        cx="108" cy="130" rx="18" ry="20"
                        {...getRegionStyle('heart')}
                    />
                    <text x="108" y="133" textAnchor="middle" fontSize="8" fill="white" pointerEvents="none">
                        Heart
                    </text>
                </g>

                {/* ABDOMEN */}
                <g {...getRegionProps('abdomen')}>
                    <path
                        d="M 60 160
                           L 60 230
                           Q 65 245 100 248
                           Q 135 245 140 230
                           L 140 160
                           Z"
                        {...getRegionStyle('abdomen')}
                    />
                    <text x="100" y="205" textAnchor="middle" fontSize="10" fill="white" pointerEvents="none">
                        Abdomen
                    </text>
                </g>

                {/* LEFT UPPER LIMB */}
                <g {...getRegionProps('upperLimbLeft')}>
                    <path
                        d="M 55 85
                           Q 35 90 25 120
                           L 15 180
                           Q 12 190 18 192
                           L 28 192
                           Q 34 190 36 180
                           L 48 120
                           Q 52 100 55 95
                           Z"
                        {...getRegionStyle('upperLimbLeft')}
                    />
                    <text x="32" y="140" textAnchor="middle" fontSize="7" fill="white" pointerEvents="none" transform="rotate(-15, 32, 140)">
                        L.Arm
                    </text>
                </g>

                {/* RIGHT UPPER LIMB */}
                <g {...getRegionProps('upperLimbRight')}>
                    <path
                        d="M 145 85
                           Q 165 90 175 120
                           L 185 180
                           Q 188 190 182 192
                           L 172 192
                           Q 166 190 164 180
                           L 152 120
                           Q 148 100 145 95
                           Z"
                        {...getRegionStyle('upperLimbRight')}
                    />
                    <text x="168" y="140" textAnchor="middle" fontSize="7" fill="white" pointerEvents="none" transform="rotate(15, 168, 140)">
                        R.Arm
                    </text>
                </g>

                {/* LEFT LOWER LIMB */}
                <g {...getRegionProps('lowerLimbLeft')}>
                    <path
                        d="M 70 248
                           L 65 320
                           Q 63 350 60 370
                           L 58 380
                           Q 57 385 62 386
                           L 78 386
                           Q 83 385 82 380
                           L 85 350
                           Q 88 320 90 280
                           L 92 248
                           Z"
                        {...getRegionStyle('lowerLimbLeft')}
                    />
                    <text x="75" y="320" textAnchor="middle" fontSize="7" fill="white" pointerEvents="none">
                        L.Leg
                    </text>
                </g>

                {/* RIGHT LOWER LIMB */}
                <g {...getRegionProps('lowerLimbRight')}>
                    <path
                        d="M 130 248
                           L 135 320
                           Q 137 350 140 370
                           L 142 380
                           Q 143 385 138 386
                           L 122 386
                           Q 117 385 118 380
                           L 115 350
                           Q 112 320 110 280
                           L 108 248
                           Z"
                        {...getRegionStyle('lowerLimbRight')}
                    />
                    <text x="125" y="320" textAnchor="middle" fontSize="7" fill="white" pointerEvents="none">
                        R.Leg
                    </text>
                </g>

                {/* Legend */}
                <g transform="translate(5, 360)">
                    <rect x="0" y="0" width="8" height="8" fill="rgba(100, 116, 139, 0.3)" stroke="rgb(100, 116, 139)" />
                    <text x="12" y="7" fontSize="7" fill="rgb(156, 163, 175)">Not examined</text>

                    <rect x="0" y="12" width="8" height="8" fill="rgba(34, 197, 94, 0.3)" stroke="rgb(34, 197, 94)" />
                    <text x="12" y="19" fontSize="7" fill="rgb(156, 163, 175)">Normal</text>

                    <rect x="0" y="24" width="8" height="8" fill="rgba(239, 68, 68, 0.3)" stroke="rgb(239, 68, 68)" />
                    <text x="12" y="31" fontSize="7" fill="rgb(156, 163, 175)">Abnormal</text>
                </g>
            </svg>
        );
    }

    // Posterior view
    return (
        <svg viewBox="0 0 200 400" className="w-full h-full max-h-[500px]">
            {/* Background */}
            <rect width="200" height="400" fill="transparent" />

            {/* Shadow */}
            <ellipse cx="100" cy="385" rx="30" ry="8" fill="rgba(50,50,50,0.3)" />

            {/* HEAD (back) */}
            <g {...getRegionProps('head')}>
                <ellipse
                    cx="100" cy="35" rx="25" ry="30"
                    {...getRegionStyle('head')}
                />
                <text x="100" y="38" textAnchor="middle" fontSize="10" fill="white" pointerEvents="none">
                    Head
                </text>
            </g>

            {/* NECK (back) */}
            <g {...getRegionProps('neck')}>
                <rect
                    x="88" y="62" width="24" height="20" rx="4"
                    {...getRegionStyle('neck')}
                />
                <text x="100" y="75" textAnchor="middle" fontSize="8" fill="white" pointerEvents="none">
                    Neck
                </text>
            </g>

            {/* UPPER BACK */}
            <g {...getRegionProps('backUpper')}>
                <path
                    d="M 60 82
                       Q 55 90 55 110
                       L 55 155
                       L 145 155
                       L 145 110
                       Q 145 90 140 82
                       L 115 82
                       Q 100 85 85 82
                       Z"
                    {...getRegionStyle('backUpper')}
                />
                <text x="100" y="120" textAnchor="middle" fontSize="10" fill="white" pointerEvents="none">
                    Upper Back
                </text>
            </g>

            {/* LOWER BACK */}
            <g {...getRegionProps('backLower')}>
                <path
                    d="M 55 157
                       L 55 230
                       Q 60 245 100 248
                       Q 140 245 145 230
                       L 145 157
                       Z"
                    {...getRegionStyle('backLower')}
                />
                <text x="100" y="200" textAnchor="middle" fontSize="10" fill="white" pointerEvents="none">
                    Lower Back
                </text>
            </g>

            {/* LEFT UPPER LIMB (back view) */}
            <g {...getRegionProps('upperLimbLeft')}>
                <path
                    d="M 55 85
                       Q 35 90 25 120
                       L 15 180
                       Q 12 190 18 192
                       L 28 192
                       Q 34 190 36 180
                       L 48 120
                       Q 52 100 55 95
                       Z"
                    {...getRegionStyle('upperLimbLeft')}
                />
                <text x="32" y="140" textAnchor="middle" fontSize="7" fill="white" pointerEvents="none" transform="rotate(-15, 32, 140)">
                    L.Arm
                </text>
            </g>

            {/* RIGHT UPPER LIMB (back view) */}
            <g {...getRegionProps('upperLimbRight')}>
                <path
                    d="M 145 85
                       Q 165 90 175 120
                       L 185 180
                       Q 188 190 182 192
                       L 172 192
                       Q 166 190 164 180
                       L 152 120
                       Q 148 100 145 95
                       Z"
                    {...getRegionStyle('upperLimbRight')}
                />
                <text x="168" y="140" textAnchor="middle" fontSize="7" fill="white" pointerEvents="none" transform="rotate(15, 168, 140)">
                    R.Arm
                </text>
            </g>

            {/* LEFT LOWER LIMB (back view) */}
            <g {...getRegionProps('lowerLimbLeft')}>
                <path
                    d="M 70 248
                       L 65 320
                       Q 63 350 60 370
                       L 58 380
                       Q 57 385 62 386
                       L 78 386
                       Q 83 385 82 380
                       L 85 350
                       Q 88 320 90 280
                       L 92 248
                       Z"
                    {...getRegionStyle('lowerLimbLeft')}
                />
                <text x="75" y="320" textAnchor="middle" fontSize="7" fill="white" pointerEvents="none">
                    L.Leg
                </text>
            </g>

            {/* RIGHT LOWER LIMB (back view) */}
            <g {...getRegionProps('lowerLimbRight')}>
                <path
                    d="M 130 248
                       L 135 320
                       Q 137 350 140 370
                       L 142 380
                       Q 143 385 138 386
                       L 122 386
                       Q 117 385 118 380
                       L 115 350
                       Q 112 320 110 280
                       L 108 248
                       Z"
                    {...getRegionStyle('lowerLimbRight')}
                />
                <text x="125" y="320" textAnchor="middle" fontSize="7" fill="white" pointerEvents="none">
                    R.Leg
                </text>
            </g>

            {/* Legend */}
            <g transform="translate(5, 360)">
                <rect x="0" y="0" width="8" height="8" fill="rgba(100, 116, 139, 0.3)" stroke="rgb(100, 116, 139)" />
                <text x="12" y="7" fontSize="7" fill="rgb(156, 163, 175)">Not examined</text>

                <rect x="0" y="12" width="8" height="8" fill="rgba(34, 197, 94, 0.3)" stroke="rgb(34, 197, 94)" />
                <text x="12" y="19" fontSize="7" fill="rgb(156, 163, 175)">Normal</text>

                <rect x="0" y="24" width="8" height="8" fill="rgba(239, 68, 68, 0.3)" stroke="rgb(239, 68, 68)" />
                <text x="12" y="31" fontSize="7" fill="rgb(156, 163, 175)">Abnormal</text>
            </g>
        </svg>
    );
}
