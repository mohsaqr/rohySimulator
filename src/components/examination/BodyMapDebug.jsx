import React, { useState, useRef, useEffect } from 'react';
import { AuthService } from '../../services/authService';

// Default regions - used as fallback
const DEFAULT_REGIONS = {
    anterior: {
        male: {
                headNeck: { id: 'headNeck', label: 'Head & Neck', color: '#ff6b6b', points: [[40, 4], [56, 4], [57, 9], [55, 19], [42, 19], [39, 8]] },
                chest: { id: 'chest', label: 'Chest', color: '#ffa94d', points: [[35, 19], [64, 20], [64, 25], [62, 32], [32, 32], [30, 22]] },
                upperArmLeft: { id: 'upperArmLeft', label: 'L. Upper Arm', color: '#ffd43b', points: [[28, 22], [33, 20], [31, 25], [33, 36], [24, 37], [25, 33]] },
                upperArmRight: { id: 'upperArmRight', label: 'R. Upper Arm', color: '#ffd43b', points: [[64, 21], [71, 21], [71, 32], [72, 36], [64, 37], [65, 27]] },
                forearmLeft: { id: 'forearmLeft', label: 'L. Forearm', color: '#69db7c', points: [[24, 37], [33, 37], [32, 41], [27, 49], [20, 48]] },
                forearmRight: { id: 'forearmRight', label: 'R. Forearm', color: '#69db7c', points: [[64, 37], [73, 37], [78, 49], [71, 50], [68, 44]] },
                handLeft: { id: 'handLeft', label: 'L. Hand', color: '#4dabf7', points: [[18, 49], [27, 50], [26, 58], [13, 58]] },
                handRight: { id: 'handRight', label: 'R. Hand', color: '#4dabf7', points: [[70, 50], [79, 50], [85, 57], [74, 59]] },
                abdomen: { id: 'abdomen', label: 'Abdomen', color: '#9775fa', points: [[33, 33], [63, 33], [62, 46], [35, 46]] },
                pelvis: { id: 'pelvis', label: 'Pelvis', color: '#f06595', points: [[34, 47], [62, 46], [62, 54], [38, 54]] },
                thighLeft: { id: 'thighLeft', label: 'L. Thigh', color: '#20c997', points: [[36, 54], [50, 54], [48, 74], [38, 74]] },
                thighRight: { id: 'thighRight', label: 'R. Thigh', color: '#20c997', points: [[50, 54], [64, 54], [62, 74], [51, 74]] },
                lowerLegLeft: { id: 'lowerLegLeft', label: 'L. Lower Leg', color: '#38d9a9', points: [[38, 74], [48, 74], [46, 90], [40, 90]] },
                lowerLegRight: { id: 'lowerLegRight', label: 'R. Lower Leg', color: '#38d9a9', points: [[52, 74], [62, 74], [60, 90], [54, 90]] },
                footLeft: { id: 'footLeft', label: 'L. Foot', color: '#3bc9db', points: [[40, 91], [46, 91], [45, 97], [36, 97]] },
                footRight: { id: 'footRight', label: 'R. Foot', color: '#3bc9db', points: [[52, 91], [59, 91], [63, 96], [51, 96]] }
            },
            female: {
                headNeck: { id: 'headNeck', label: 'Head & Neck', color: '#ff6b6b', points: [[40, 4], [60, 4], [62, 8], [58, 16], [42, 16], [38, 8]] },
                chest: { id: 'chest', label: 'Chest', color: '#ffa94d', points: [[28, 16], [72, 16], [70, 22], [68, 32], [32, 32], [30, 22]] },
                upperArmLeft: { id: 'upperArmLeft', label: 'L. Upper Arm', color: '#ffd43b', points: [[18, 16], [28, 16], [30, 22], [26, 32], [20, 38], [16, 32]] },
                upperArmRight: { id: 'upperArmRight', label: 'R. Upper Arm', color: '#ffd43b', points: [[72, 16], [82, 16], [84, 32], [80, 38], [74, 32], [70, 22]] },
                forearmLeft: { id: 'forearmLeft', label: 'L. Forearm', color: '#69db7c', points: [[14, 32], [24, 32], [20, 38], [22, 50], [16, 50]] },
                forearmRight: { id: 'forearmRight', label: 'R. Forearm', color: '#69db7c', points: [[76, 32], [86, 32], [84, 50], [78, 50], [80, 38]] },
                handLeft: { id: 'handLeft', label: 'L. Hand', color: '#4dabf7', points: [[14, 50], [24, 50], [26, 58], [16, 58]] },
                handRight: { id: 'handRight', label: 'R. Hand', color: '#4dabf7', points: [[76, 50], [86, 50], [88, 58], [78, 58]] },
                abdomen: { id: 'abdomen', label: 'Abdomen', color: '#9775fa', points: [[32, 32], [68, 32], [66, 44], [34, 44]] },
                pelvis: { id: 'pelvis', label: 'Pelvis', color: '#f06595', points: [[34, 44], [66, 44], [62, 54], [38, 54]] },
                thighLeft: { id: 'thighLeft', label: 'L. Thigh', color: '#20c997', points: [[36, 54], [50, 54], [48, 74], [38, 74]] },
                thighRight: { id: 'thighRight', label: 'R. Thigh', color: '#20c997', points: [[50, 54], [64, 54], [62, 74], [52, 74]] },
                lowerLegLeft: { id: 'lowerLegLeft', label: 'L. Lower Leg', color: '#38d9a9', points: [[38, 74], [48, 74], [46, 90], [40, 90]] },
                lowerLegRight: { id: 'lowerLegRight', label: 'R. Lower Leg', color: '#38d9a9', points: [[52, 74], [62, 74], [60, 90], [54, 90]] },
                footLeft: { id: 'footLeft', label: 'L. Foot', color: '#3bc9db', points: [[38, 90], [48, 90], [49, 96], [37, 96]] },
            footRight: { id: 'footRight', label: 'R. Foot', color: '#3bc9db', points: [[52, 90], [62, 90], [63, 96], [51, 96]] }
        }
    },
    posterior: {
            male: {
                headNeck: { id: 'headNeck', label: 'Head & Neck', color: '#ff6b6b', points: [[40, 4], [60, 4], [62, 8], [58, 16], [42, 16], [38, 8]] },
                upperBack: { id: 'upperBack', label: 'Upper Back', color: '#ffa94d', points: [[28, 16], [72, 16], [70, 22], [68, 32], [32, 32], [30, 22]] },
                upperArmLeft: { id: 'upperArmLeft', label: 'L. Upper Arm', color: '#ffd43b', points: [[18, 16], [28, 16], [30, 22], [26, 32], [20, 38], [16, 32]] },
                upperArmRight: { id: 'upperArmRight', label: 'R. Upper Arm', color: '#ffd43b', points: [[72, 16], [82, 16], [84, 32], [80, 38], [74, 32], [70, 22]] },
                forearmLeft: { id: 'forearmLeft', label: 'L. Forearm', color: '#69db7c', points: [[14, 32], [24, 32], [20, 38], [22, 50], [16, 50]] },
                forearmRight: { id: 'forearmRight', label: 'R. Forearm', color: '#69db7c', points: [[76, 32], [86, 32], [84, 50], [78, 50], [80, 38]] },
                handLeft: { id: 'handLeft', label: 'L. Hand', color: '#4dabf7', points: [[14, 50], [24, 50], [26, 58], [16, 58]] },
                handRight: { id: 'handRight', label: 'R. Hand', color: '#4dabf7', points: [[76, 50], [86, 50], [88, 58], [78, 58]] },
                lowerBack: { id: 'lowerBack', label: 'Lower Back', color: '#9775fa', points: [[32, 32], [68, 32], [66, 44], [34, 44]] },
                buttocks: { id: 'buttocks', label: 'Buttocks', color: '#f06595', points: [[34, 44], [66, 44], [62, 54], [38, 54]] },
                thighLeft: { id: 'thighLeft', label: 'L. Thigh', color: '#20c997', points: [[36, 54], [50, 54], [48, 74], [38, 74]] },
                thighRight: { id: 'thighRight', label: 'R. Thigh', color: '#20c997', points: [[50, 54], [64, 54], [62, 74], [52, 74]] },
                calfLeft: { id: 'calfLeft', label: 'L. Calf', color: '#38d9a9', points: [[38, 74], [48, 74], [46, 90], [40, 90]] },
                calfRight: { id: 'calfRight', label: 'R. Calf', color: '#38d9a9', points: [[52, 74], [62, 74], [60, 90], [54, 90]] },
                heelLeft: { id: 'heelLeft', label: 'L. Heel', color: '#3bc9db', points: [[38, 90], [48, 90], [49, 96], [37, 96]] },
                heelRight: { id: 'heelRight', label: 'R. Heel', color: '#3bc9db', points: [[52, 90], [62, 90], [63, 96], [51, 96]] }
            },
            female: {
                headNeck: { id: 'headNeck', label: 'Head & Neck', color: '#ff6b6b', points: [[40, 4], [60, 4], [62, 8], [58, 16], [42, 16], [38, 8]] },
                upperBack: { id: 'upperBack', label: 'Upper Back', color: '#ffa94d', points: [[28, 16], [72, 16], [70, 22], [68, 32], [32, 32], [30, 22]] },
                upperArmLeft: { id: 'upperArmLeft', label: 'L. Upper Arm', color: '#ffd43b', points: [[18, 16], [28, 16], [30, 22], [26, 32], [20, 38], [16, 32]] },
                upperArmRight: { id: 'upperArmRight', label: 'R. Upper Arm', color: '#ffd43b', points: [[72, 16], [82, 16], [84, 32], [80, 38], [74, 32], [70, 22]] },
                forearmLeft: { id: 'forearmLeft', label: 'L. Forearm', color: '#69db7c', points: [[14, 32], [24, 32], [20, 38], [22, 50], [16, 50]] },
                forearmRight: { id: 'forearmRight', label: 'R. Forearm', color: '#69db7c', points: [[76, 32], [86, 32], [84, 50], [78, 50], [80, 38]] },
                handLeft: { id: 'handLeft', label: 'L. Hand', color: '#4dabf7', points: [[14, 50], [24, 50], [26, 58], [16, 58]] },
                handRight: { id: 'handRight', label: 'R. Hand', color: '#4dabf7', points: [[76, 50], [86, 50], [88, 58], [78, 58]] },
                lowerBack: { id: 'lowerBack', label: 'Lower Back', color: '#9775fa', points: [[32, 32], [68, 32], [66, 44], [34, 44]] },
                buttocks: { id: 'buttocks', label: 'Buttocks', color: '#f06595', points: [[34, 44], [66, 44], [62, 54], [38, 54]] },
                thighLeft: { id: 'thighLeft', label: 'L. Thigh', color: '#20c997', points: [[36, 54], [50, 54], [48, 74], [38, 74]] },
                thighRight: { id: 'thighRight', label: 'R. Thigh', color: '#20c997', points: [[50, 54], [64, 54], [62, 74], [52, 74]] },
                calfLeft: { id: 'calfLeft', label: 'L. Calf', color: '#38d9a9', points: [[38, 74], [48, 74], [46, 90], [40, 90]] },
                calfRight: { id: 'calfRight', label: 'R. Calf', color: '#38d9a9', points: [[52, 74], [62, 74], [60, 90], [54, 90]] },
                heelLeft: { id: 'heelLeft', label: 'L. Heel', color: '#3bc9db', points: [[38, 90], [48, 90], [49, 96], [37, 96]] },
                heelRight: { id: 'heelRight', label: 'R. Heel', color: '#3bc9db', points: [[52, 90], [62, 90], [63, 96], [51, 96]] }
        }
    }
};

// Storage key for localStorage
const STORAGE_KEY = 'rohy_bodymap_regions';

/**
 * Body Map Debug Tool with Draggable Vertices
 * Click and drag polygon vertices to adjust regions
 * Changes are saved to localStorage and server
 */
export default function BodyMapDebug({ gender = 'male', view = 'anterior' }) {
    const [clickCoords, setClickCoords] = useState(null);
    const [showGrid, setShowGrid] = useState(true);
    const [showRegions, setShowRegions] = useState(true);
    const [selectedRegion, setSelectedRegion] = useState(null);
    const [draggingVertex, setDraggingVertex] = useState(null);
    const [saveStatus, setSaveStatus] = useState(null);
    const [hasChanges, setHasChanges] = useState(false);
    const svgRef = useRef(null);

    // Load saved regions from localStorage or use defaults
    const [regions, setRegions] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load saved regions:', e);
        }
        return JSON.parse(JSON.stringify(DEFAULT_REGIONS));
    });

    // Try loading from server on mount if no localStorage data
    useEffect(() => {
        const hasLocalData = localStorage.getItem(STORAGE_KEY);
        if (!hasLocalData) {
            fetch('/api/bodymap-regions')
                .then(r => r.json())
                .then(data => {
                    if (data.regions) {
                        setRegions(data.regions);
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.regions));
                    }
                })
                .catch(err => console.warn('Failed to load from server:', err));
        }
    }, []);

    const currentRegions = regions[view]?.[gender] || regions.anterior.male;

    const getImageSrc = () => {
        if (gender === 'female') {
            return view === 'posterior' ? '/woman-back.png' : '/woman-front.png';
        }
        return view === 'posterior' ? '/man-back.png' : '/man-front.png';
    };

    const getSvgCoords = (e) => {
        const svg = svgRef.current;
        if (!svg) return { x: 0, y: 0 };
        const rect = svg.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width * 100);
        const y = ((e.clientY - rect.top) / rect.height * 100);
        return { x, y };
    };

    const handleSvgClick = (e) => {
        if (draggingVertex) return;
        const { x, y } = getSvgCoords(e);
        setClickCoords({ x: x.toFixed(1), y: y.toFixed(1) });
    };

    const handleVertexMouseDown = (regionKey, vertexIndex, e) => {
        e.stopPropagation();
        setDraggingVertex({ regionKey, vertexIndex });
        setSelectedRegion(regionKey);
    };

    const handleMouseMove = (e) => {
        if (!draggingVertex) return;
        const { x, y } = getSvgCoords(e);
        const { regionKey, vertexIndex } = draggingVertex;

        setRegions(prev => {
            const newRegions = JSON.parse(JSON.stringify(prev));
            newRegions[view][gender][regionKey].points[vertexIndex] = [Math.round(x), Math.round(y)];
            return newRegions;
        });
        setHasChanges(true);
    };

    const handleMouseUp = () => {
        setDraggingVertex(null);
    };

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [draggingVertex, view, gender]);

    const pointsToString = (points) => points.map(([x, y]) => `${x},${y}`).join(' ');

    // Save to localStorage and server
    const saveChanges = async () => {
        setSaveStatus('saving');
        try {
            // Save to localStorage immediately
            localStorage.setItem(STORAGE_KEY, JSON.stringify(regions));

            // Also save to server for persistence
            const token = AuthService.getToken();
            if (token) {
                await fetch('/api/bodymap-regions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ regions })
                });
            }

            setSaveStatus('saved');
            setHasChanges(false);
            setTimeout(() => setSaveStatus(null), 2000);
        } catch (err) {
            console.error('Failed to save to server:', err);
            // Still saved to localStorage
            setSaveStatus('saved-local');
            setHasChanges(false);
            setTimeout(() => setSaveStatus(null), 3000);
        }
    };

    // Reset to defaults
    const resetToDefaults = () => {
        if (confirm('Reset all regions to defaults? This will discard all your changes.')) {
            setRegions(JSON.parse(JSON.stringify(DEFAULT_REGIONS)));
            localStorage.removeItem(STORAGE_KEY);
            setHasChanges(false);
            setSaveStatus(null);
        }
    };

    const copyToClipboard = () => {
        const data = JSON.stringify(regions[view][gender], null, 2);
        navigator.clipboard.writeText(data);
        alert('Copied current regions to clipboard!');
    };

    const exportAll = () => {
        const data = JSON.stringify(regions, null, 2);
        navigator.clipboard.writeText(data);
        alert('Copied ALL regions to clipboard!');
    };

    return (
        <div className="p-4 bg-slate-900 min-h-screen">
            {/* Save Bar - Fixed at top */}
            <div className="mb-4 p-3 bg-slate-800 rounded-lg border border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold text-white">Body Map Editor</h1>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-300">{gender} - {view}</span>
                    {hasChanges && (
                        <span className="px-2 py-1 bg-yellow-600/20 text-yellow-400 text-sm rounded">
                            Unsaved changes
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={resetToDefaults}
                        className="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600 transition-colors"
                    >
                        Reset to Defaults
                    </button>
                    <button
                        onClick={saveChanges}
                        disabled={saveStatus === 'saving'}
                        className={`px-6 py-2 font-bold rounded transition-colors ${
                            hasChanges
                                ? 'bg-green-600 hover:bg-green-500 text-white'
                                : 'bg-slate-600 text-slate-300'
                        } ${saveStatus === 'saving' ? 'opacity-50 cursor-wait' : ''}`}
                    >
                        {saveStatus === 'saving' ? 'Saving...' :
                         saveStatus === 'saved' ? 'Saved!' :
                         saveStatus === 'saved-local' ? 'Saved (local only)' :
                         'Save Changes'}
                    </button>
                </div>
            </div>

            <div className="mb-4 flex gap-4 flex-wrap items-center">
                <label className="flex items-center gap-2 text-white">
                    <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                    Show Grid
                </label>
                <label className="flex items-center gap-2 text-white">
                    <input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} />
                    Show Regions
                </label>
                <button
                    onClick={copyToClipboard}
                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-500"
                >
                    Copy Current View
                </button>
                <button
                    onClick={exportAll}
                    className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500"
                >
                    Export All Regions
                </button>
                {clickCoords && (
                    <span className="text-yellow-400 font-mono">
                        Click: [{clickCoords.x}, {clickCoords.y}]
                    </span>
                )}
                {selectedRegion && (
                    <span className="text-cyan-400 font-mono">
                        Selected: {selectedRegion}
                    </span>
                )}
            </div>

            <p className="text-gray-400 text-sm mb-4">
                Drag the circles to move vertices. Click a region to select it. Use Export to copy coordinates.
            </p>

            <div className="flex gap-8">
                {/* Image with overlay */}
                <div className="relative" style={{ width: '500px', height: '900px' }}>
                    <img
                        src={getImageSrc()}
                        alt={`${gender} body ${view}`}
                        className="absolute inset-0 w-full h-full object-contain"
                    />
                    <svg
                        ref={svgRef}
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="absolute inset-0 w-full h-full cursor-crosshair"
                        onClick={handleSvgClick}
                    >
                        {/* Grid */}
                        {showGrid && (
                            <g stroke="rgba(255,255,255,0.2)" strokeWidth="0.2">
                                {[10, 20, 30, 40, 50, 60, 70, 80, 90].map(v => (
                                    <g key={v}>
                                        <line x1={v} y1="0" x2={v} y2="100" />
                                        <line x1="0" y1={v} x2="100" y2={v} />
                                        <text x={v + 0.5} y="3" fill="rgba(255,255,255,0.5)" fontSize="2">{v}</text>
                                        <text x="1" y={v + 1} fill="rgba(255,255,255,0.5)" fontSize="2">{v}</text>
                                    </g>
                                ))}
                            </g>
                        )}

                        {/* Regions */}
                        {showRegions && Object.entries(currentRegions).map(([key, region]) => (
                            <g key={region.id}>
                                <polygon
                                    points={pointsToString(region.points)}
                                    fill={selectedRegion === key ? `${region.color}60` : `${region.color}30`}
                                    stroke={selectedRegion === key ? '#fff' : region.color}
                                    strokeWidth={selectedRegion === key ? '0.8' : '0.4'}
                                    onClick={(e) => { e.stopPropagation(); setSelectedRegion(key); }}
                                    style={{ cursor: 'pointer' }}
                                />
                                <text
                                    x={region.points.reduce((s, p) => s + p[0], 0) / region.points.length}
                                    y={region.points.reduce((s, p) => s + p[1], 0) / region.points.length}
                                    fill="white"
                                    fontSize="2"
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    style={{ pointerEvents: 'none' }}
                                >
                                    {region.label}
                                </text>
                                {/* Draggable vertices */}
                                {selectedRegion === key && region.points.map(([x, y], idx) => (
                                    <circle
                                        key={idx}
                                        cx={x}
                                        cy={y}
                                        r="1.5"
                                        fill="#fff"
                                        stroke={region.color}
                                        strokeWidth="0.5"
                                        style={{ cursor: 'grab' }}
                                        onMouseDown={(e) => handleVertexMouseDown(key, idx, e)}
                                    />
                                ))}
                            </g>
                        ))}
                    </svg>
                </div>

                {/* Region list */}
                <div className="text-white text-sm font-mono max-h-[900px] overflow-auto w-96">
                    <h3 className="font-bold mb-2">Regions ({view} - {gender}):</h3>
                    <p className="text-gray-400 text-xs mb-4">Click region name to select, drag vertices to adjust</p>
                    {Object.entries(currentRegions).map(([key, region]) => (
                        <div
                            key={key}
                            className={`mb-2 p-2 rounded cursor-pointer ${selectedRegion === key ? 'bg-slate-600 ring-2 ring-white' : 'bg-slate-800 hover:bg-slate-700'}`}
                            onClick={() => setSelectedRegion(key)}
                        >
                            <div style={{ color: region.color }} className="font-bold">{region.label}</div>
                            <div className="text-xs text-slate-400 break-all">
                                {JSON.stringify(region.points)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
