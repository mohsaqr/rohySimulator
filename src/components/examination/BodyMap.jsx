import React, { useState } from 'react';

/**
 * Body Map Component with Professional Silhouette and Floating Hotspots
 * Uses provided SVG silhouettes with CSS-positioned interactive hotspots
 * Hotspots appear only after clicking on the body
 */
export default function BodyMap({
    view = 'anterior',
    gender = 'male',
    selectedRegion,
    onRegionClick,
    examinedRegions = new Set(),
    abnormalRegions = new Set()
}) {
    const [hoveredRegion, setHoveredRegion] = useState(null);
    const [hotspotsVisible, setHotspotsVisible] = useState(false);

    // Hotspot positions (as percentages for responsive positioning)
    // Calibrated for both silhouettes
    const hotspots = {
        anterior: [
            { id: 'head', x: 50, y: 6, label: 'Head' },
            { id: 'neck', x: 50, y: 11, label: 'Neck' },
            { id: 'chestAnterior', x: 50, y: 20, label: 'Chest' },
            { id: 'heart', x: 56, y: 23, label: 'Heart', small: true },
            { id: 'abdomen', x: 50, y: 32, label: 'Abdomen' },
            { id: 'upperLimbLeft', x: 28, y: 28, label: 'L. Arm' },
            { id: 'upperLimbRight', x: 72, y: 28, label: 'R. Arm' },
            { id: 'lowerLimbLeft', x: 40, y: 65, label: 'L. Leg' },
            { id: 'lowerLimbRight', x: 60, y: 65, label: 'R. Leg' },
        ],
        posterior: [
            { id: 'head', x: 50, y: 6, label: 'Head' },
            { id: 'neck', x: 50, y: 11, label: 'Neck' },
            { id: 'backUpper', x: 50, y: 20, label: 'Upper Back' },
            { id: 'backLower', x: 50, y: 32, label: 'Lower Back' },
            { id: 'upperLimbLeft', x: 28, y: 28, label: 'L. Arm' },
            { id: 'upperLimbRight', x: 72, y: 28, label: 'R. Arm' },
            { id: 'lowerLimbLeft', x: 40, y: 65, label: 'L. Leg' },
            { id: 'lowerLimbRight', x: 60, y: 65, label: 'R. Leg' },
        ]
    };

    const currentHotspots = hotspots[view] || hotspots.anterior;

    // Get hotspot visual state
    const getHotspotState = (regionId) => {
        const isSelected = selectedRegion === regionId;
        const isHovered = hoveredRegion === regionId;
        const isExamined = examinedRegions.has(regionId);
        const isAbnormal = abnormalRegions.has(regionId);

        return { isSelected, isHovered, isExamined, isAbnormal };
    };

    // Get hotspot classes based on state
    const getHotspotClasses = (regionId, isSmall = false) => {
        const { isSelected, isHovered, isExamined, isAbnormal } = getHotspotState(regionId);

        const size = isSmall ? 'w-4 h-4' : 'w-5 h-5';
        let colorClasses = 'bg-slate-500/80 border-slate-400 shadow-slate-500/50';
        let animation = '';

        if (isAbnormal) {
            colorClasses = 'bg-red-500 border-red-300 shadow-red-500/50';
            animation = 'animate-pulse';
        } else if (isExamined) {
            colorClasses = 'bg-emerald-500 border-emerald-300 shadow-emerald-500/50';
        }

        if (isSelected) {
            colorClasses = 'bg-cyan-400 border-cyan-200 shadow-cyan-400/60';
        }

        const hoverScale = isHovered ? 'scale-125' : 'scale-100';

        return `${size} ${colorClasses} ${animation} ${hoverScale} rounded-full border-2 shadow-lg cursor-pointer transition-all duration-200 flex items-center justify-center`;
    };

    // Handle click on silhouette to show hotspots
    const handleSilhouetteClick = () => {
        if (!hotspotsVisible) {
            setHotspotsVisible(true);
        }
    };

    // Handle hotspot click
    const handleHotspotClick = (regionId) => {
        onRegionClick(regionId);
    };

    const silhouetteSrc = gender === 'female' ? '/woman-silhouette.svg' : '/man-silhouette.svg';

    return (
        <div className="relative w-full h-full flex flex-col">
            {/* Silhouette Container */}
            <div className="relative flex-1 flex items-center justify-center p-2">
                {/* SVG Silhouette with hotspots */}
                <div
                    className="relative w-full h-full flex items-center justify-center cursor-pointer"
                    onClick={handleSilhouetteClick}
                >
                    <img
                        src={silhouetteSrc}
                        alt={`${gender} body silhouette`}
                        className="max-h-full max-w-full object-contain select-none"
                        style={{
                            height: '100%',
                            width: 'auto',
                            filter: 'invert(0.6) sepia(0.1) saturate(0.5) hue-rotate(180deg)',
                            opacity: 0.85
                        }}
                        draggable={false}
                    />

                    {/* Click prompt */}
                    {!hotspotsVisible && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="bg-slate-800/90 text-slate-300 px-4 py-2 rounded-lg text-sm border border-slate-600 shadow-lg">
                                Click to reveal examination points
                            </div>
                        </div>
                    )}

                    {/* Hotspots Overlay - only visible after clicking */}
                    {hotspotsVisible && (
                        <div className="absolute inset-0 pointer-events-none">
                            {/* Wrapper to position hotspots relative to image */}
                            <div
                                className="absolute"
                                style={{
                                    // Center the hotspot container over the image
                                    left: '50%',
                                    top: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: gender === 'female' ? '35%' : '40%',
                                    height: '95%',
                                }}
                            >
                                {currentHotspots.map(hotspot => {
                                    const { isSelected, isAbnormal } = getHotspotState(hotspot.id);

                                    return (
                                        <div
                                            key={hotspot.id}
                                            className="absolute transform -translate-x-1/2 -translate-y-1/2 group pointer-events-auto"
                                            style={{
                                                left: `${hotspot.x}%`,
                                                top: `${hotspot.y}%`,
                                            }}
                                        >
                                            {/* Pulse ring for abnormal */}
                                            {isAbnormal && (
                                                <div className="absolute inset-0 w-8 h-8 -m-1.5 rounded-full bg-red-500/30 animate-ping" />
                                            )}

                                            {/* Selection ring */}
                                            {isSelected && (
                                                <div className="absolute inset-0 w-8 h-8 -m-1.5 rounded-full border-2 border-cyan-400/50 animate-pulse" />
                                            )}

                                            {/* Hotspot button */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleHotspotClick(hotspot.id);
                                                }}
                                                onMouseEnter={() => setHoveredRegion(hotspot.id)}
                                                onMouseLeave={() => setHoveredRegion(null)}
                                                className={getHotspotClasses(hotspot.id, hotspot.small)}
                                                title={hotspot.label}
                                            >
                                                <div className="w-1.5 h-1.5 bg-white rounded-full opacity-80" />
                                            </button>

                                            {/* Label tooltip */}
                                            <div className={`
                                                absolute left-1/2 -translate-x-1/2 -bottom-7
                                                px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap
                                                bg-slate-800 text-slate-200 border border-slate-600
                                                opacity-0 group-hover:opacity-100 transition-opacity duration-200
                                                pointer-events-none z-10
                                            `}>
                                                {hotspot.label}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Legend - only show when hotspots are visible */}
            {hotspotsVisible && (
                <div className="flex items-center justify-center gap-4 py-2 border-t border-slate-700/50 text-xs">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-slate-500 border border-slate-400" />
                        <span className="text-slate-500">Not examined</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-emerald-300" />
                        <span className="text-slate-500">Normal</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 border border-red-300" />
                        <span className="text-slate-500">Abnormal</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 border border-cyan-200" />
                        <span className="text-slate-500">Selected</span>
                    </div>
                </div>
            )}
        </div>
    );
}
