import React, { useState, useRef, useEffect } from 'react';
import { AuthService } from '../../services/authService';
import DEFAULT_REGIONS from '../../utils/defaultRegions';
import { apiUrl } from '../../config/api';
 
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
            fetch(apiUrl('/bodymap-regions'))
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
            return baseUrl(view === 'posterior' ? '/woman-back.png' : '/woman-front.png');
        }
        return baseUrl(view === 'posterior' ? '/man-back.png' : '/man-front.png');
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
                await fetch(apiUrl('/bodymap-regions'), {
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
