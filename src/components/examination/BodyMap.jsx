import React, { useState, useEffect } from 'react';

// Storage key - must match BodyMapDebug
const STORAGE_KEY = 'rohy_bodymap_regions';

/**
 * Body Map Component with Invisible Polygon Regions
 * Regions are traced to match actual body silhouette areas
 * Only visible on hover/selection
 * Loads saved regions from localStorage/server if available
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
    const [savedRegions, setSavedRegions] = useState(null);

    // Load saved regions on mount
    useEffect(() => {
        // Try localStorage first (fastest)
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                setSavedRegions(parsed);
                return;
            }
        } catch (e) {
            console.warn('Failed to load regions from localStorage:', e);
        }

        // Try loading from server
        fetch('/api/bodymap-regions')
            .then(r => r.json())
            .then(data => {
                if (data.regions) {
                    setSavedRegions(data.regions);
                    // Cache in localStorage
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.regions));
                }
            })
            .catch(err => console.warn('Failed to load regions from server:', err));
    }, []);

    // Default regions - synced with BodyMapDebug.jsx
    // These are the corrected coordinates matching the body silhouettes
    const defaultRegions = {
        anterior: {
            male: {
                headNeck: { id: 'headNeck', label: 'Head & Neck', points: [[40, 4], [56, 4], [57, 9], [55, 19], [42, 19], [39, 8]] },
                chest: { id: 'chest', label: 'Chest', points: [[35, 19], [64, 20], [64, 25], [62, 32], [32, 32], [30, 22]] },
                upperArmLeft: { id: 'upperArmLeft', label: 'L. Upper Arm', points: [[28, 22], [33, 20], [31, 25], [33, 36], [24, 37], [25, 33]] },
                upperArmRight: { id: 'upperArmRight', label: 'R. Upper Arm', points: [[64, 21], [71, 21], [71, 32], [72, 36], [64, 37], [65, 27]] },
                forearmLeft: { id: 'forearmLeft', label: 'L. Forearm', points: [[24, 37], [33, 37], [32, 41], [27, 49], [20, 48]] },
                forearmRight: { id: 'forearmRight', label: 'R. Forearm', points: [[64, 37], [73, 37], [78, 49], [71, 50], [68, 44]] },
                handLeft: { id: 'handLeft', label: 'L. Hand', points: [[18, 49], [27, 50], [26, 58], [13, 58]] },
                handRight: { id: 'handRight', label: 'R. Hand', points: [[70, 50], [79, 50], [85, 57], [74, 59]] },
                abdomen: { id: 'abdomen', label: 'Abdomen', points: [[33, 33], [63, 33], [62, 46], [35, 46]] },
                pelvis: { id: 'pelvis', label: 'Pelvis', points: [[34, 47], [62, 46], [62, 54], [38, 54]] },
                thighLeft: { id: 'thighLeft', label: 'L. Thigh', points: [[36, 54], [50, 54], [48, 74], [38, 74]] },
                thighRight: { id: 'thighRight', label: 'R. Thigh', points: [[50, 54], [64, 54], [62, 74], [51, 74]] },
                lowerLegLeft: { id: 'lowerLegLeft', label: 'L. Lower Leg', points: [[38, 74], [48, 74], [46, 90], [40, 90]] },
                lowerLegRight: { id: 'lowerLegRight', label: 'R. Lower Leg', points: [[52, 74], [62, 74], [60, 90], [54, 90]] },
                footLeft: { id: 'footLeft', label: 'L. Foot', points: [[40, 91], [46, 91], [45, 97], [36, 97]] },
                footRight: { id: 'footRight', label: 'R. Foot', points: [[52, 91], [59, 91], [63, 96], [51, 96]] }
            },
            female: {
                head: {
                    id: 'head',
                    label: 'Head',
                    points: [[43, 0], [57, 0], [59, 4], [57, 8], [43, 8], [41, 4]]
                },
                neck: {
                    id: 'neck',
                    label: 'Neck',
                    points: [[45, 8], [55, 8], [55, 11], [45, 11]]
                },
                shoulderLeft: {
                    id: 'shoulderLeft',
                    label: 'L. Shoulder',
                    points: [[32, 11], [45, 11], [45, 14], [36, 15], [30, 13]]
                },
                shoulderRight: {
                    id: 'shoulderRight',
                    label: 'R. Shoulder',
                    points: [[55, 11], [68, 11], [70, 13], [64, 15], [55, 14]]
                },
                chestAnterior: {
                    id: 'chestAnterior',
                    label: 'Chest',
                    points: [[40, 14], [60, 14], [60, 22], [40, 22]]
                },
                heart: {
                    id: 'heart',
                    label: 'Heart',
                    points: [[49, 15], [58, 15], [58, 20], [49, 20]]
                },
                upperLimbLeft: {
                    id: 'upperLimbLeft',
                    label: 'L. Upper Arm',
                    points: [[24, 14], [32, 14], [28, 26], [20, 26]]
                },
                upperLimbRight: {
                    id: 'upperLimbRight',
                    label: 'R. Upper Arm',
                    points: [[68, 14], [76, 14], [80, 26], [72, 26]]
                },
                elbowLeft: {
                    id: 'elbowLeft',
                    label: 'L. Elbow',
                    points: [[18, 25], [28, 25], [26, 30], [16, 30]]
                },
                elbowRight: {
                    id: 'elbowRight',
                    label: 'R. Elbow',
                    points: [[72, 25], [82, 25], [84, 30], [74, 30]]
                },
                forearmLeft: {
                    id: 'forearmLeft',
                    label: 'L. Forearm',
                    points: [[14, 30], [26, 30], [22, 40], [10, 40]]
                },
                forearmRight: {
                    id: 'forearmRight',
                    label: 'R. Forearm',
                    points: [[74, 30], [86, 30], [90, 40], [78, 40]]
                },
                handLeft: {
                    id: 'handLeft',
                    label: 'L. Hand',
                    points: [[8, 40], [22, 40], [20, 48], [6, 48]]
                },
                handRight: {
                    id: 'handRight',
                    label: 'R. Hand',
                    points: [[78, 40], [92, 40], [94, 48], [80, 48]]
                },
                abdomen: {
                    id: 'abdomen',
                    label: 'Abdomen',
                    points: [[42, 22], [58, 22], [56, 35], [44, 35]]
                },
                groin: {
                    id: 'groin',
                    label: 'Groin',
                    points: [[44, 35], [56, 35], [54, 40], [46, 40]]
                },
                thighLeft: {
                    id: 'thighLeft',
                    label: 'L. Thigh',
                    points: [[38, 39], [49, 39], [47, 57], [40, 57]]
                },
                thighRight: {
                    id: 'thighRight',
                    label: 'R. Thigh',
                    points: [[51, 39], [62, 39], [60, 57], [53, 57]]
                },
                kneeLeft: {
                    id: 'kneeLeft',
                    label: 'L. Knee',
                    points: [[40, 57], [47, 57], [46, 63], [41, 63]]
                },
                kneeRight: {
                    id: 'kneeRight',
                    label: 'R. Knee',
                    points: [[53, 57], [60, 57], [59, 63], [54, 63]]
                },
                lowerLimbLeft: {
                    id: 'lowerLimbLeft',
                    label: 'L. Shin',
                    points: [[40, 63], [47, 63], [45, 86], [42, 86]]
                },
                lowerLimbRight: {
                    id: 'lowerLimbRight',
                    label: 'R. Shin',
                    points: [[53, 63], [60, 63], [58, 86], [55, 86]]
                },
                ankleLeft: {
                    id: 'ankleLeft',
                    label: 'L. Ankle',
                    points: [[42, 86], [46, 86], [46, 91], [42, 91]]
                },
                ankleRight: {
                    id: 'ankleRight',
                    label: 'R. Ankle',
                    points: [[54, 86], [58, 86], [58, 91], [54, 91]]
                },
                footLeft: {
                    id: 'footLeft',
                    label: 'L. Foot',
                    points: [[38, 91], [46, 91], [46, 99], [36, 99]]
                },
                footRight: {
                    id: 'footRight',
                    label: 'R. Foot',
                    points: [[54, 91], [62, 91], [64, 99], [54, 99]]
                }
            }
        },
        posterior: {
            male: {
                head: {
                    id: 'head',
                    label: 'Head',
                    points: [[42, 0], [58, 0], [60, 3], [58, 7], [42, 7], [40, 3]]
                },
                neck: {
                    id: 'neck',
                    label: 'Neck',
                    points: [[44, 7], [56, 7], [56, 10], [44, 10]]
                },
                shoulderLeft: {
                    id: 'shoulderLeft',
                    label: 'L. Shoulder',
                    points: [[28, 10], [44, 10], [44, 13], [32, 14], [26, 12]]
                },
                shoulderRight: {
                    id: 'shoulderRight',
                    label: 'R. Shoulder',
                    points: [[56, 10], [72, 10], [74, 12], [68, 14], [56, 13]]
                },
                scapulaLeft: {
                    id: 'scapulaLeft',
                    label: 'L. Scapula',
                    points: [[34, 13], [44, 13], [44, 20], [36, 20]]
                },
                scapulaRight: {
                    id: 'scapulaRight',
                    label: 'R. Scapula',
                    points: [[56, 13], [66, 13], [64, 20], [56, 20]]
                },
                backUpper: {
                    id: 'backUpper',
                    label: 'Upper Back',
                    points: [[44, 13], [56, 13], [56, 20], [44, 20]]
                },
                upperLimbLeft: {
                    id: 'upperLimbLeft',
                    label: 'L. Upper Arm',
                    points: [[20, 13], [28, 13], [24, 24], [16, 24]]
                },
                upperLimbRight: {
                    id: 'upperLimbRight',
                    label: 'R. Upper Arm',
                    points: [[72, 13], [80, 13], [84, 24], [76, 24]]
                },
                elbowLeft: {
                    id: 'elbowLeft',
                    label: 'L. Elbow',
                    points: [[14, 23], [24, 23], [22, 27], [12, 27]]
                },
                elbowRight: {
                    id: 'elbowRight',
                    label: 'R. Elbow',
                    points: [[76, 23], [86, 23], [88, 27], [78, 27]]
                },
                backLower: {
                    id: 'backLower',
                    label: 'Lower Back',
                    points: [[40, 20], [60, 20], [58, 30], [42, 30]]
                },
                sacrum: {
                    id: 'sacrum',
                    label: 'Sacrum',
                    points: [[44, 30], [56, 30], [54, 35], [46, 35]]
                },
                buttockLeft: {
                    id: 'buttockLeft',
                    label: 'L. Buttock',
                    points: [[36, 32], [48, 32], [46, 40], [38, 40]]
                },
                buttockRight: {
                    id: 'buttockRight',
                    label: 'R. Buttock',
                    points: [[52, 32], [64, 32], [62, 40], [54, 40]]
                },
                thighLeft: {
                    id: 'thighLeft',
                    label: 'L. Thigh',
                    points: [[38, 40], [46, 40], [45, 52], [39, 52]]
                },
                thighRight: {
                    id: 'thighRight',
                    label: 'R. Thigh',
                    points: [[54, 40], [62, 40], [61, 52], [55, 52]]
                },
                poplitealLeft: {
                    id: 'poplitealLeft',
                    label: 'L. Popliteal',
                    points: [[39, 52], [45, 52], [44, 58], [40, 58]]
                },
                poplitealRight: {
                    id: 'poplitealRight',
                    label: 'R. Popliteal',
                    points: [[55, 52], [61, 52], [60, 58], [56, 58]]
                },
                calfLeft: {
                    id: 'calfLeft',
                    label: 'L. Calf',
                    points: [[38, 58], [46, 58], [44, 80], [40, 80]]
                },
                calfRight: {
                    id: 'calfRight',
                    label: 'R. Calf',
                    points: [[54, 58], [62, 58], [60, 80], [56, 80]]
                },
                achillesLeft: {
                    id: 'achillesLeft',
                    label: 'L. Achilles',
                    points: [[40, 80], [44, 80], [44, 88], [40, 88]]
                },
                achillesRight: {
                    id: 'achillesRight',
                    label: 'R. Achilles',
                    points: [[56, 80], [60, 80], [60, 88], [56, 88]]
                },
                heelLeft: {
                    id: 'heelLeft',
                    label: 'L. Heel',
                    points: [[38, 88], [46, 88], [46, 96], [38, 96]]
                },
                heelRight: {
                    id: 'heelRight',
                    label: 'R. Heel',
                    points: [[54, 88], [62, 88], [62, 96], [54, 96]]
                }
            },
            female: {
                head: {
                    id: 'head',
                    label: 'Head',
                    points: [[43, 0], [57, 0], [59, 4], [57, 8], [43, 8], [41, 4]]
                },
                neck: {
                    id: 'neck',
                    label: 'Neck',
                    points: [[45, 8], [55, 8], [55, 11], [45, 11]]
                },
                shoulderLeft: {
                    id: 'shoulderLeft',
                    label: 'L. Shoulder',
                    points: [[32, 11], [45, 11], [45, 14], [36, 15], [30, 13]]
                },
                shoulderRight: {
                    id: 'shoulderRight',
                    label: 'R. Shoulder',
                    points: [[55, 11], [68, 11], [70, 13], [64, 15], [55, 14]]
                },
                scapulaLeft: {
                    id: 'scapulaLeft',
                    label: 'L. Scapula',
                    points: [[38, 14], [46, 14], [46, 22], [40, 22]]
                },
                scapulaRight: {
                    id: 'scapulaRight',
                    label: 'R. Scapula',
                    points: [[54, 14], [62, 14], [60, 22], [54, 22]]
                },
                backUpper: {
                    id: 'backUpper',
                    label: 'Upper Back',
                    points: [[46, 14], [54, 14], [54, 22], [46, 22]]
                },
                upperLimbLeft: {
                    id: 'upperLimbLeft',
                    label: 'L. Upper Arm',
                    points: [[24, 14], [32, 14], [28, 26], [20, 26]]
                },
                upperLimbRight: {
                    id: 'upperLimbRight',
                    label: 'R. Upper Arm',
                    points: [[68, 14], [76, 14], [80, 26], [72, 26]]
                },
                elbowLeft: {
                    id: 'elbowLeft',
                    label: 'L. Elbow',
                    points: [[18, 25], [28, 25], [26, 30], [16, 30]]
                },
                elbowRight: {
                    id: 'elbowRight',
                    label: 'R. Elbow',
                    points: [[72, 25], [82, 25], [84, 30], [74, 30]]
                },
                backLower: {
                    id: 'backLower',
                    label: 'Lower Back',
                    points: [[42, 22], [58, 22], [56, 33], [44, 33]]
                },
                sacrum: {
                    id: 'sacrum',
                    label: 'Sacrum',
                    points: [[46, 33], [54, 33], [52, 38], [48, 38]]
                },
                buttockLeft: {
                    id: 'buttockLeft',
                    label: 'L. Buttock',
                    points: [[38, 35], [50, 35], [48, 44], [40, 44]]
                },
                buttockRight: {
                    id: 'buttockRight',
                    label: 'R. Buttock',
                    points: [[50, 35], [62, 35], [60, 44], [52, 44]]
                },
                thighLeft: {
                    id: 'thighLeft',
                    label: 'L. Thigh',
                    points: [[40, 44], [48, 44], [46, 57], [42, 57]]
                },
                thighRight: {
                    id: 'thighRight',
                    label: 'R. Thigh',
                    points: [[52, 44], [60, 44], [58, 57], [54, 57]]
                },
                poplitealLeft: {
                    id: 'poplitealLeft',
                    label: 'L. Popliteal',
                    points: [[42, 57], [46, 57], [45, 63], [43, 63]]
                },
                poplitealRight: {
                    id: 'poplitealRight',
                    label: 'R. Popliteal',
                    points: [[54, 57], [58, 57], [57, 63], [55, 63]]
                },
                calfLeft: {
                    id: 'calfLeft',
                    label: 'L. Calf',
                    points: [[42, 63], [46, 63], [45, 84], [43, 84]]
                },
                calfRight: {
                    id: 'calfRight',
                    label: 'R. Calf',
                    points: [[54, 63], [58, 63], [57, 84], [55, 84]]
                },
                achillesLeft: {
                    id: 'achillesLeft',
                    label: 'L. Achilles',
                    points: [[43, 84], [45, 84], [45, 90], [43, 90]]
                },
                achillesRight: {
                    id: 'achillesRight',
                    label: 'R. Achilles',
                    points: [[55, 84], [57, 84], [57, 90], [55, 90]]
                },
                heelLeft: {
                    id: 'heelLeft',
                    label: 'L. Heel',
                    points: [[42, 90], [46, 90], [46, 97], [42, 97]]
                },
                heelRight: {
                    id: 'heelRight',
                    label: 'R. Heel',
                    points: [[54, 90], [58, 90], [58, 97], [54, 97]]
                }
            }
        }
    };

    // Use saved regions if available, otherwise fall back to defaults
    // The saved regions structure from debug editor is: { anterior: { male: {...}, female: {...} }, posterior: {...} }
    const getRegionsForView = () => {
        if (savedRegions?.[view]?.[gender]) {
            // Convert debug editor format (label-based) to expected format (includes id)
            const debugRegions = savedRegions[view][gender];
            const converted = {};
            Object.entries(debugRegions).forEach(([key, region]) => {
                converted[key] = {
                    id: region.id || key,
                    label: region.label,
                    points: region.points
                };
            });
            return converted;
        }
        return defaultRegions[view]?.[gender] || defaultRegions.anterior.male;
    };

    const currentRegions = getRegionsForView();
    const getImageSrc = () => { if (gender === 'female') return view === 'posterior' ? '/woman-back.png' : '/woman-front.png'; return view === 'posterior' ? '/man-back.png' : '/man-front.png'; }; const imageSrc = getImageSrc();
    // Convert points array to SVG polygon points string
    const pointsToString = (points) => {
        return points.map(([x, y]) => `${x},${y}`).join(' ');
    };
    // Get region visual state
    const getRegionState = (regionId) => {
        const isSelected = selectedRegion === regionId;
        const isHovered = hoveredRegion === regionId;
        const isExamined = examinedRegions.has(regionId);
        const isAbnormal = abnormalRegions.has(regionId);
        return { isSelected, isHovered, isExamined, isAbnormal };
    };
    // Get fill color based on state
    const getFillColor = (regionId) => {
        const { isSelected, isHovered, isExamined, isAbnormal } = getRegionState(regionId);
        if (isAbnormal) return 'rgba(239, 68, 68, 0.5)'; // red
        if (isExamined) return 'rgba(34, 197, 94, 0.4)'; // green
        if (isSelected) return 'rgba(6, 182, 212, 0.5)'; // cyan
        if (isHovered) return 'rgba(255, 255, 255, 0.3)'; // white
        return 'transparent';
    };
    // Get stroke color based on state
    const getStrokeColor = (regionId) => {
        const { isSelected, isHovered, isExamined, isAbnormal } = getRegionState(regionId);
        if (isAbnormal) return 'rgba(239, 68, 68, 0.8)';
        if (isExamined) return 'rgba(34, 197, 94, 0.6)';
        if (isSelected) return 'rgba(6, 182, 212, 0.8)';
        if (isHovered) return 'rgba(255, 255, 255, 0.6)';
        return 'transparent';
    };
    return (
        <div className="relative w-full h-full flex flex-col overflow-hidden">
            {/* Main container */}
            <div className="relative flex-1 flex items-center justify-center min-h-0 overflow-hidden">
                <div
                    className="relative"
                    style={{
                        aspectRatio: '5/9',
                        height: '100%',
                        maxHeight: '100%',
                        maxWidth: '100%'
                    }}
                >
                    {/* PNG Body Image as background */}
                    <img
                        src={imageSrc}
                        alt={`${gender} body ${view} view`}
                        className="absolute inset-0 w-full h-full select-none pointer-events-none"
                        style={{ objectFit: 'fill' }}
                        draggable={false}
                    />
                    {/* SVG Overlay for clickable regions */}
                    <svg
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="absolute inset-0 w-full h-full"
                        style={{ cursor: 'pointer' }}
                    >
                        {Object.values(currentRegions).map(region => {
                            const { isSelected, isHovered, isAbnormal } = getRegionState(region.id);
                            const showLabel = isSelected || isHovered;
                            // Calculate label position (center of polygon)
                            const centerX = region.points.reduce((sum, p) => sum + p[0], 0) / region.points.length;
                            const centerY = region.points.reduce((sum, p) => sum + p[1], 0) / region.points.length;
                            return (
                                <g key={region.id}>
                                    {/* Clickable polygon region */}
                                    <polygon
                                        points={pointsToString(region.points)}
                                        fill={getFillColor(region.id)}
                                        stroke={getStrokeColor(region.id)}
                                        strokeWidth="0.5"
                                        className="transition-all duration-150 cursor-pointer"
                                        onClick={() => onRegionClick(region.id)}
                                        onMouseEnter={() => setHoveredRegion(region.id)}
                                        onMouseLeave={() => setHoveredRegion(null)}
                                    />
                                    {/* Pulsing indicator for abnormal regions */}
                                    {isAbnormal && (
                                        <circle
                                            cx={centerX}
                                            cy={centerY}
                                            r="2"
                                            fill="rgba(239, 68, 68, 0.8)"
                                            className="animate-ping"
                                        />
                                    )}
                                    {/* Label on hover/select */}
                                    {showLabel && (
                                        <g>
                                            <rect
                                                x={centerX - 8}
                                                y={centerY - 2.5}
                                                width="16"
                                                height="4"
                                                rx="0.5"
                                                fill="rgba(0, 0, 0, 0.85)"
                                                stroke="rgba(255, 255, 255, 0.3)"
                                                strokeWidth="0.2"
                                            />
                                            <text
                                                x={centerX}
                                                y={centerY + 0.8}
                                                textAnchor="middle"
                                                fontSize="2.2"
                                                fill="white"
                                                fontWeight="500"
                                                style={{ pointerEvents: 'none' }}
                                            >
                                                {region.label}
                                            </text>
                                        </g>
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                </div>
            </div>
            {/* Legend */}
            <div className="flex-shrink-0 flex items-center justify-center gap-4 py-1.5 border-t border-slate-700/50 bg-slate-900/50">
                <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded border border-white/30 bg-transparent" />
                    <span className="text-[10px] text-slate-500">Hover to reveal</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-emerald-500/50 border border-emerald-400" />
                    <span className="text-[10px] text-slate-500">Normal</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-red-500/50 border border-red-400" />
                    <span className="text-[10px] text-slate-500">Abnormal</span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-cyan-500/50 border border-cyan-400" />
                    <span className="text-[10px] text-slate-500">Selected</span>
                </div>
            </div>
        </div>
    );
}
