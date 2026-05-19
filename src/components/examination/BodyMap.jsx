import React, { useState, useEffect } from 'react';
import defaultRegions from '../../utils/defaultRegions';
import { baseUrl } from '../../config/api';
import { apiFetch } from '../../services/apiClient';
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
    // Bug 13 (18.5.2026): the container was hardcoded to a 5:9 box for every
    // view, but the posterior PNGs are intrinsically far narrower than the
    // anterior ones (man-back ≈ 0.43 vs man-front ≈ 0.54), so the posterior
    // image + its SVG overlay were stretched ~30% horizontally. We now drive
    // the box (and the label counter-scale) from the image's real aspect
    // ratio. Seed a per-view default so there is no first-paint distortion
    // before onLoad fires; the exact ratio replaces it once the PNG loads.
    const [imgRatio, setImgRatio] = useState(null);

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

        // /bodymap-regions is a public endpoint by design.
        apiFetch('/bodymap-regions', { auth: false })
            .then(data => {
                if (data?.regions) {
                    setSavedRegions(data.regions);
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.regions));
                }
            })
            .catch(err => console.warn('Failed to load regions from server:', err));
    }, []);

 
  
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
    const getImageSrc = () => { if (gender === 'female') return baseUrl(view === 'posterior' ? '/woman-back.png' : '/woman-front.png'); return baseUrl(view === 'posterior' ? '/man-back.png' : '/man-front.png'); }; const imageSrc = getImageSrc();

    // Drop the measured ratio whenever the image changes so the previous
    // view's ratio can't briefly distort the new one before it loads.
    useEffect(() => { setImgRatio(null); }, [imageSrc]);

    // width / height. Posterior images are ~0.43, anterior ~0.54 — seed
    // those so the very first paint already uses a near-correct box.
    const DEFAULT_RATIO = view === 'posterior' ? 438 / 1022 : 429 / 791;
    const effectiveRatio = imgRatio || DEFAULT_RATIO;
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
            <div className="relative flex-1 flex items-center justify-center min-h-0 overflow-hidden bg-white">
                {/*
                    Container matches the active image's intrinsic aspect
                    ratio (not a fixed 5:9) so anterior and posterior PNGs
                    are both shown undistorted. width:auto + height
                    constraint keeps it from over-stretching on tall screens.
                */}
                <div
                    className="relative h-full"
                    style={{
                        aspectRatio: String(effectiveRatio),
                        maxHeight: '100%',
                        width: 'auto'
                    }}
                >
                    {/* PNG Body Image */}
                    <img
                        src={imageSrc}
                        alt={`${gender} body ${view} view`}
                        className="h-full w-full select-none pointer-events-none"
                        draggable={false}
                        onLoad={(e) => {
                            const { naturalWidth: w, naturalHeight: h } = e.target;
                            if (w > 0 && h > 0) setImgRatio(w / h);
                        }}
                    />
                    {/* SVG Overlay - positioned absolutely over the image */}
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
                                        <g transform={`translate(${centerX}, ${centerY})`} style={{ pointerEvents: 'none' }}>
                                            {/* Counter-scale to fix text stretching: viewBox is 100x100 with
                                                preserveAspectRatio="none", so a glyph is compressed horizontally
                                                by exactly the container's W/H ratio. Undo it with 1/ratio
                                                (Bug 13 — was hardcoded 1.8 for the old fixed 5:9 box). */}
                                            <g transform={`scale(${1 / effectiveRatio}, 1)`}>
                                                <rect
                                                    x="-8"
                                                    y="-2.5"
                                                    width="16"
                                                    height="5"
                                                    rx="0.5"
                                                    fill="rgba(0, 0, 0, 0.85)"
                                                    stroke="rgba(255, 255, 255, 0.3)"
                                                    strokeWidth="0.2"
                                                />
                                                <text
                                                    x="0"
                                                    y="0.8"
                                                    textAnchor="middle"
                                                    fontSize="2.2"
                                                    fill="white"
                                                    fontWeight="500"
                                                    style={{ pointerEvents: 'none', fontFamily: 'inherit' }}
                                                >
                                                    {region.label}
                                                </text>
                                            </g>
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
