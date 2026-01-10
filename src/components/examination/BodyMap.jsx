import React, { useState } from 'react';

/**
 * Body Map Component with Professional Silhouette and Floating Hotspots
 * Hotspots are always visible as subtle dots, become prominent on hover/selection
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

    // Comprehensive hotspot positions (percentages relative to body bounds)
    const hotspots = {
        anterior: {
            male: [
                { id: 'head', x: 50, y: 4, label: 'Head' },
                { id: 'eyes', x: 50, y: 3, label: 'Eyes', small: true },
                { id: 'neck', x: 50, y: 8, label: 'Neck' },
                { id: 'shoulderLeft', x: 30, y: 10, label: 'L. Shoulder', small: true },
                { id: 'shoulderRight', x: 70, y: 10, label: 'R. Shoulder', small: true },
                { id: 'chestAnterior', x: 50, y: 15, label: 'Chest' },
                { id: 'heart', x: 55, y: 17, label: 'Heart', small: true },
                { id: 'upperLimbLeft', x: 22, y: 20, label: 'L. Upper Arm' },
                { id: 'upperLimbRight', x: 78, y: 20, label: 'R. Upper Arm' },
                { id: 'abdomen', x: 50, y: 25, label: 'Abdomen' },
                { id: 'elbowLeft', x: 18, y: 28, label: 'L. Elbow', small: true },
                { id: 'elbowRight', x: 82, y: 28, label: 'R. Elbow', small: true },
                { id: 'forearmLeft', x: 14, y: 34, label: 'L. Forearm', small: true },
                { id: 'forearmRight', x: 86, y: 34, label: 'R. Forearm', small: true },
                { id: 'handLeft', x: 10, y: 42, label: 'L. Hand', small: true },
                { id: 'handRight', x: 90, y: 42, label: 'R. Hand', small: true },
                { id: 'groin', x: 50, y: 35, label: 'Groin', small: true },
                { id: 'thighLeft', x: 42, y: 45, label: 'L. Thigh' },
                { id: 'thighRight', x: 58, y: 45, label: 'R. Thigh' },
                { id: 'kneeLeft', x: 42, y: 55, label: 'L. Knee' },
                { id: 'kneeRight', x: 58, y: 55, label: 'R. Knee' },
                { id: 'lowerLimbLeft', x: 40, y: 68, label: 'L. Lower Leg' },
                { id: 'lowerLimbRight', x: 60, y: 68, label: 'R. Lower Leg' },
                { id: 'ankleLeft', x: 38, y: 82, label: 'L. Ankle', small: true },
                { id: 'ankleRight', x: 62, y: 82, label: 'R. Ankle', small: true },
                { id: 'footLeft', x: 36, y: 90, label: 'L. Foot', small: true },
                { id: 'footRight', x: 64, y: 90, label: 'R. Foot', small: true },
            ],
            female: [
                { id: 'head', x: 50, y: 4, label: 'Head' },
                { id: 'eyes', x: 50, y: 3, label: 'Eyes', small: true },
                { id: 'neck', x: 50, y: 8, label: 'Neck' },
                { id: 'shoulderLeft', x: 32, y: 11, label: 'L. Shoulder', small: true },
                { id: 'shoulderRight', x: 68, y: 11, label: 'R. Shoulder', small: true },
                { id: 'chestAnterior', x: 50, y: 16, label: 'Chest' },
                { id: 'heart', x: 55, y: 18, label: 'Heart', small: true },
                { id: 'upperLimbLeft', x: 25, y: 22, label: 'L. Upper Arm' },
                { id: 'upperLimbRight', x: 75, y: 22, label: 'R. Upper Arm' },
                { id: 'abdomen', x: 50, y: 26, label: 'Abdomen' },
                { id: 'elbowLeft', x: 20, y: 30, label: 'L. Elbow', small: true },
                { id: 'elbowRight', x: 80, y: 30, label: 'R. Elbow', small: true },
                { id: 'forearmLeft', x: 16, y: 36, label: 'L. Forearm', small: true },
                { id: 'forearmRight', x: 84, y: 36, label: 'R. Forearm', small: true },
                { id: 'handLeft', x: 12, y: 44, label: 'L. Hand', small: true },
                { id: 'handRight', x: 88, y: 44, label: 'R. Hand', small: true },
                { id: 'groin', x: 50, y: 36, label: 'Groin', small: true },
                { id: 'thighLeft', x: 42, y: 48, label: 'L. Thigh' },
                { id: 'thighRight', x: 58, y: 48, label: 'R. Thigh' },
                { id: 'kneeLeft', x: 42, y: 60, label: 'L. Knee' },
                { id: 'kneeRight', x: 58, y: 60, label: 'R. Knee' },
                { id: 'lowerLimbLeft', x: 40, y: 72, label: 'L. Lower Leg' },
                { id: 'lowerLimbRight', x: 60, y: 72, label: 'R. Lower Leg' },
                { id: 'ankleLeft', x: 38, y: 86, label: 'L. Ankle', small: true },
                { id: 'ankleRight', x: 62, y: 86, label: 'R. Ankle', small: true },
                { id: 'footLeft', x: 36, y: 94, label: 'L. Foot', small: true },
                { id: 'footRight', x: 64, y: 94, label: 'R. Foot', small: true },
            ]
        },
        posterior: {
            male: [
                { id: 'head', x: 50, y: 4, label: 'Head' },
                { id: 'neck', x: 50, y: 8, label: 'Neck' },
                { id: 'shoulderLeft', x: 30, y: 10, label: 'L. Shoulder', small: true },
                { id: 'shoulderRight', x: 70, y: 10, label: 'R. Shoulder', small: true },
                { id: 'backUpper', x: 50, y: 15, label: 'Upper Back' },
                { id: 'scapulaLeft', x: 38, y: 14, label: 'L. Scapula', small: true },
                { id: 'scapulaRight', x: 62, y: 14, label: 'R. Scapula', small: true },
                { id: 'upperLimbLeft', x: 22, y: 20, label: 'L. Upper Arm' },
                { id: 'upperLimbRight', x: 78, y: 20, label: 'R. Upper Arm' },
                { id: 'backLower', x: 50, y: 25, label: 'Lower Back' },
                { id: 'elbowLeft', x: 18, y: 28, label: 'L. Elbow', small: true },
                { id: 'elbowRight', x: 82, y: 28, label: 'R. Elbow', small: true },
                { id: 'sacrum', x: 50, y: 32, label: 'Sacrum', small: true },
                { id: 'buttockLeft', x: 42, y: 36, label: 'L. Buttock', small: true },
                { id: 'buttockRight', x: 58, y: 36, label: 'R. Buttock', small: true },
                { id: 'thighLeft', x: 42, y: 45, label: 'L. Thigh' },
                { id: 'thighRight', x: 58, y: 45, label: 'R. Thigh' },
                { id: 'poplitealLeft', x: 42, y: 55, label: 'L. Popliteal', small: true },
                { id: 'poplitealRight', x: 58, y: 55, label: 'R. Popliteal', small: true },
                { id: 'calfLeft', x: 40, y: 68, label: 'L. Calf' },
                { id: 'calfRight', x: 60, y: 68, label: 'R. Calf' },
                { id: 'achillesLeft', x: 38, y: 82, label: 'L. Achilles', small: true },
                { id: 'achillesRight', x: 62, y: 82, label: 'R. Achilles', small: true },
                { id: 'heelLeft', x: 36, y: 90, label: 'L. Heel', small: true },
                { id: 'heelRight', x: 64, y: 90, label: 'R. Heel', small: true },
            ],
            female: [
                { id: 'head', x: 50, y: 4, label: 'Head' },
                { id: 'neck', x: 50, y: 8, label: 'Neck' },
                { id: 'shoulderLeft', x: 32, y: 11, label: 'L. Shoulder', small: true },
                { id: 'shoulderRight', x: 68, y: 11, label: 'R. Shoulder', small: true },
                { id: 'backUpper', x: 50, y: 16, label: 'Upper Back' },
                { id: 'scapulaLeft', x: 40, y: 15, label: 'L. Scapula', small: true },
                { id: 'scapulaRight', x: 60, y: 15, label: 'R. Scapula', small: true },
                { id: 'upperLimbLeft', x: 25, y: 22, label: 'L. Upper Arm' },
                { id: 'upperLimbRight', x: 75, y: 22, label: 'R. Upper Arm' },
                { id: 'backLower', x: 50, y: 26, label: 'Lower Back' },
                { id: 'elbowLeft', x: 20, y: 30, label: 'L. Elbow', small: true },
                { id: 'elbowRight', x: 80, y: 30, label: 'R. Elbow', small: true },
                { id: 'sacrum', x: 50, y: 33, label: 'Sacrum', small: true },
                { id: 'buttockLeft', x: 42, y: 38, label: 'L. Buttock', small: true },
                { id: 'buttockRight', x: 58, y: 38, label: 'R. Buttock', small: true },
                { id: 'thighLeft', x: 42, y: 48, label: 'L. Thigh' },
                { id: 'thighRight', x: 58, y: 48, label: 'R. Thigh' },
                { id: 'poplitealLeft', x: 42, y: 60, label: 'L. Popliteal', small: true },
                { id: 'poplitealRight', x: 58, y: 60, label: 'R. Popliteal', small: true },
                { id: 'calfLeft', x: 40, y: 72, label: 'L. Calf' },
                { id: 'calfRight', x: 60, y: 72, label: 'R. Calf' },
                { id: 'achillesLeft', x: 38, y: 86, label: 'L. Achilles', small: true },
                { id: 'achillesRight', x: 62, y: 86, label: 'R. Achilles', small: true },
                { id: 'heelLeft', x: 36, y: 94, label: 'L. Heel', small: true },
                { id: 'heelRight', x: 64, y: 94, label: 'R. Heel', small: true },
            ]
        }
    };

    const currentHotspots = hotspots[view]?.[gender] || hotspots.anterior.male;

    // Get hotspot visual state
    const getHotspotState = (regionId) => {
        const isSelected = selectedRegion === regionId;
        const isHovered = hoveredRegion === regionId;
        const isExamined = examinedRegions.has(regionId);
        const isAbnormal = abnormalRegions.has(regionId);

        return { isSelected, isHovered, isExamined, isAbnormal };
    };

    const silhouetteSrc = gender === 'female' ? '/woman-silhouette.svg' : '/man-silhouette.svg';

    return (
        <div className="relative w-full h-full flex flex-col overflow-hidden">
            {/* Silhouette Container - Full height */}
            <div className="relative flex-1 flex items-center justify-center min-h-0">
                {/* Wrapper for proper aspect ratio */}
                <div
                    className="relative h-full"
                    style={{
                        aspectRatio: gender === 'female' ? '1/2' : '1/3',
                        maxHeight: '100%',
                        maxWidth: '100%'
                    }}
                >
                    {/* SVG Silhouette */}
                    <img
                        src={silhouetteSrc}
                        alt={`${gender} body silhouette`}
                        className="w-full h-full object-contain select-none"
                        style={{
                            filter: 'invert(0.7) sepia(0.05) saturate(0.3) brightness(1.2)',
                        }}
                        draggable={false}
                    />

                    {/* Hotspots Overlay */}
                    <div className="absolute inset-0">
                        {currentHotspots.map(hotspot => {
                            const { isSelected, isHovered, isExamined, isAbnormal } = getHotspotState(hotspot.id);
                            const isActive = isSelected || isHovered;

                            // Determine colors
                            let bgColor = 'bg-white/40';
                            let borderColor = 'border-white/60';
                            let ringColor = '';

                            if (isAbnormal) {
                                bgColor = 'bg-red-500';
                                borderColor = 'border-red-300';
                                ringColor = 'ring-2 ring-red-500/50';
                            } else if (isExamined) {
                                bgColor = 'bg-emerald-500';
                                borderColor = 'border-emerald-300';
                            } else if (isSelected) {
                                bgColor = 'bg-cyan-400';
                                borderColor = 'border-cyan-200';
                                ringColor = 'ring-2 ring-cyan-400/50';
                            } else if (isHovered) {
                                bgColor = 'bg-white/80';
                                borderColor = 'border-white';
                            }

                            const size = hotspot.small
                                ? (isActive ? 'w-4 h-4' : 'w-2 h-2')
                                : (isActive ? 'w-5 h-5' : 'w-3 h-3');

                            return (
                                <div
                                    key={hotspot.id}
                                    className="absolute transform -translate-x-1/2 -translate-y-1/2 group z-10"
                                    style={{
                                        left: `${hotspot.x}%`,
                                        top: `${hotspot.y}%`,
                                    }}
                                >
                                    {/* Pulse ring for abnormal */}
                                    {isAbnormal && (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div className="w-6 h-6 rounded-full bg-red-500/30 animate-ping" />
                                        </div>
                                    )}

                                    {/* Hotspot button */}
                                    <button
                                        onClick={() => onRegionClick(hotspot.id)}
                                        onMouseEnter={() => setHoveredRegion(hotspot.id)}
                                        onMouseLeave={() => setHoveredRegion(null)}
                                        className={`
                                            ${size} ${bgColor} ${borderColor} ${ringColor}
                                            rounded-full border shadow-sm
                                            cursor-pointer transition-all duration-150
                                            hover:scale-150 hover:bg-white/90 hover:border-white
                                            flex items-center justify-center
                                        `}
                                        title={hotspot.label}
                                    />

                                    {/* Label - shows on hover */}
                                    <div className={`
                                        absolute left-1/2 -translate-x-1/2 mt-1
                                        px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap
                                        bg-black/80 text-white border border-white/20
                                        transition-all duration-150 pointer-events-none
                                        ${isActive ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'}
                                    `}>
                                        {hotspot.label}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Compact Legend */}
            <div className="flex items-center justify-center gap-4 py-1.5 border-t border-slate-700/50 bg-slate-900/50">
                <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-white/40 border border-white/60" />
                    <span className="text-[10px] text-slate-500">Not examined</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 border border-emerald-300" />
                    <span className="text-[10px] text-slate-500">Normal</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-red-500 border border-red-300" />
                    <span className="text-[10px] text-slate-500">Abnormal</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-cyan-400 border border-cyan-200" />
                    <span className="text-[10px] text-slate-500">Selected</span>
                </div>
            </div>
        </div>
    );
}
