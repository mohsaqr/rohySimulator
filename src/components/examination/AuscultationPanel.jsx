import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, AlertTriangle, CheckCircle, Heart, Wind, Activity } from 'lucide-react';
import EventLogger from '../../services/eventLogger';

// Default audio files for normal findings
const DEFAULT_SOUNDS = {
    heart:    './sounds/normal-heart.mp3',
    lung:     './sounds/normal-lung.mp3',
    vascular: null,
};

// --- Point set definitions per region mode ---

const CHEST_POINTS = {
    aortic:   { x: 54, y: 22, label: 'Aortic',       description: '2nd ICS, right sternal border',   type: 'heart' },
    pulmonic: { x: 46, y: 22, label: 'Pulmonic',      description: '2nd ICS, left sternal border',    type: 'heart' },
    erb:      { x: 46, y: 30, label: "Erb's Point",   description: '3rd ICS, left sternal border',    type: 'heart' },
    tricuspid:{ x: 50, y: 38, label: 'Tricuspid',     description: '4th ICS, left sternal border',    type: 'heart' },
    mitral:   { x: 42, y: 42, label: 'Mitral (Apex)', description: '5th ICS, midclavicular line',     type: 'heart' },
    lungLeft:      { x: 35, y: 28, label: 'L. Lung', description: 'Left anterior chest',  type: 'lung' },
    lungRight:     { x: 65, y: 28, label: 'R. Lung', description: 'Right anterior chest', type: 'lung' },
    lungBaseLeft:  { x: 38, y: 45, label: 'L. Base', description: 'Left lung base',       type: 'lung' },
    lungBaseRight: { x: 62, y: 45, label: 'R. Base', description: 'Right lung base',      type: 'lung' },
};

const ABDOMINAL_POINTS = {
    ruq: { x: 68, y: 32, label: 'RUQ', description: 'Right upper quadrant', type: 'bowel', defaultSound: './sounds/normal-RUQ.mp4' },
    luq: { x: 32, y: 32, label: 'LUQ', description: 'Left upper quadrant',  type: 'bowel', defaultSound: './sounds/normal-LUQ.wav' },
    rlq: { x: 68, y: 65, label: 'RLQ', description: 'Right lower quadrant', type: 'bowel', defaultSound: './sounds/normal-RLQ.wav' },
    llq: { x: 32, y: 65, label: 'LLQ', description: 'Left lower quadrant',  type: 'bowel', defaultSound: './sounds/normal-LLQ.mp4' },
};

const POSTERIOR_POINTS = {
    upperLeft:  { x: 32, y: 22, label: 'L. Upper', description: 'Left upper zone',  type: 'lung' },
    upperRight: { x: 68, y: 22, label: 'R. Upper', description: 'Right upper zone', type: 'lung' },
    midLeft:    { x: 32, y: 45, label: 'L. Mid',   description: 'Left mid zone',    type: 'lung' },
    midRight:   { x: 68, y: 45, label: 'R. Mid',   description: 'Right mid zone',   type: 'lung' },
    baseLeft:   { x: 35, y: 68, label: 'L. Base',  description: 'Left lung base',   type: 'lung' },
    baseRight:  { x: 65, y: 68, label: 'R. Base',  description: 'Right lung base',  type: 'lung' },
};

const NECK_POINTS = {
    carotidRight: { x: 63, y: 38, label: 'R. Carotid', description: 'Right carotid artery', type: 'vascular' },
    carotidLeft:  { x: 37, y: 38, label: 'L. Carotid', description: 'Left carotid artery',  type: 'vascular' },
    thyroid:      { x: 50, y: 55, label: 'Thyroid',    description: 'Thyroid bruit',         type: 'vascular' },
};

// Which regions map to which mode
const CHEST_REGION_IDS    = new Set(['chest', 'chestAnterior', 'heart']);
const ABDOMEN_REGION_IDS  = new Set(['abdomen']);
const POSTERIOR_REGION_IDS = new Set(['backUpper', 'scapulaLeft', 'scapulaRight']);
const NECK_REGION_IDS     = new Set(['headNeck', 'neck']);

function getRegionMode(regionId) {
    if (CHEST_REGION_IDS.has(regionId))    return 'chest';
    if (ABDOMEN_REGION_IDS.has(regionId))  return 'abdomen';
    if (POSTERIOR_REGION_IDS.has(regionId)) return 'posterior';
    if (NECK_REGION_IDS.has(regionId))     return 'neck';
    return 'chest'; // safe fallback
}

function getPointsForMode(mode) {
    if (mode === 'abdomen')  return ABDOMINAL_POINTS;
    if (mode === 'posterior') return POSTERIOR_POINTS;
    if (mode === 'neck')     return NECK_POINTS;
    return CHEST_POINTS;
}

function getDefaultPointForMode(mode) {
    if (mode === 'abdomen')  return 'ruq';
    if (mode === 'posterior') return 'midLeft';
    if (mode === 'neck')     return 'carotidRight';
    return 'mitral';
}

export default function AuscultationPanel({
    finding,
    isAbnormal,
    audioUrl,
    audioUrls = {},
    heartAudio,
    lungAudio,
    regionName = 'Chest',
    regionId = 'chest',
}) {
    const mode = getRegionMode(regionId);
    const POINTS = getPointsForMode(mode);
    const defaultPoint = getDefaultPointForMode(mode);

    const [selectedPoint, setSelectedPoint] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [hasAutoPlayed, setHasAutoPlayed] = useState(false);
    const audioRef = useRef(null);

    // Reset when region changes
    useEffect(() => {
        setSelectedPoint(null);
        setIsPlaying(false);
        setHasAutoPlayed(false);
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
        }
    }, [regionId]);

    const getAudioForPoint = (pointId) => {
        if (audioUrls[pointId]) return audioUrls[pointId];

        const point = POINTS[pointId];
        if (!point) return audioUrl || null;

        if (mode === 'chest') {
            if (point.type === 'heart' && heartAudio) return heartAudio;
            if (point.type === 'lung'  && lungAudio)  return lungAudio;
            if (!isAbnormal) return DEFAULT_SOUNDS[point.type] || null;
            return audioUrl || null;
        }

        if (mode === 'abdomen') {
            if (heartAudio) return heartAudio;
            if (!isAbnormal) return point.defaultSound || null;
            return audioUrl || null;
        }

        if (mode === 'posterior') {
            if (lungAudio)  return lungAudio;
            if (!isAbnormal) return DEFAULT_SOUNDS.lung;
            return audioUrl || null;
        }

        if (mode === 'neck') {
            return heartAudio || audioUrl || null;
        }

        return audioUrl || null;
    };

    const handlePointClick = (pointId) => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setSelectedPoint(pointId);
        setIsPlaying(false);

        const point = POINTS[pointId];
        const audioSrc = getAudioForPoint(pointId);

        EventLogger.auscultationPerformed(
            point?.label || pointId,
            point?.type || 'unknown',
            finding || 'No finding',
            !!audioSrc,
            audioSrc
        );

        if (audioSrc && audioRef.current) {
            audioRef.current.src = audioSrc;
            audioRef.current.load();
            audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
        }
    };

    // Auto-select default point on mount / region change
    useEffect(() => {
        if (!hasAutoPlayed && audioRef.current) {
            setSelectedPoint(defaultPoint);
            setHasAutoPlayed(true);

            const audioSrc = getAudioForPoint(defaultPoint);
            if (audioSrc) {
                audioRef.current.src = audioSrc;
                audioRef.current.load();
                audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
            }

            const point = POINTS[defaultPoint];
            EventLogger.auscultationPerformed(
                point?.label || defaultPoint,
                point?.type || mode,
                finding || 'No finding',
                !!audioSrc,
                audioSrc
            );
        }
    }, [hasAutoPlayed, finding]);

    // Refresh audio when props change
    useEffect(() => {
        if (audioRef.current && selectedPoint) {
            const newSrc = getAudioForPoint(selectedPoint);
            if (newSrc && !audioRef.current.src.endsWith(newSrc.split('/').pop())) {
                audioRef.current.src = newSrc;
                audioRef.current.load();
            }
        }
    }, [audioUrls, heartAudio, lungAudio]);

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) { audioRef.current.pause(); } else { audioRef.current.play(); }
        setIsPlaying(!isPlaying);
    };

    const toggleMute = () => {
        if (!audioRef.current) return;
        audioRef.current.muted = !isMuted;
        setIsMuted(!isMuted);
    };

    const currentAudioUrl = selectedPoint ? getAudioForPoint(selectedPoint) : null;
    const currentPoint    = selectedPoint ? POINTS[selectedPoint] : null;

    // --- Anatomy SVG backgrounds per mode ---
    const AnatomySVG = () => {
        if (mode === 'chest') return (
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
                <ellipse cx="50" cy="35" rx="35" ry="30" fill="none" stroke="rgba(100,116,139,0.3)" strokeWidth="1" />
                <line x1="50" y1="15" x2="50" y2="55" stroke="rgba(100,116,139,0.2)" strokeWidth="0.5" />
                {[20, 28, 36, 44].map((y, i) => (
                    <g key={i}>
                        <path d={`M 50 ${y} Q 35 ${y+3} 25 ${y+8}`} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
                        <path d={`M 50 ${y} Q 65 ${y+3} 75 ${y+8}`} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
                    </g>
                ))}
            </svg>
        );

        if (mode === 'abdomen') return (
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
                {/* Abdomen outline */}
                <ellipse cx="50" cy="50" rx="38" ry="42" fill="none" stroke="rgba(100,116,139,0.3)" strokeWidth="1" />
                {/* Quadrant dividers */}
                <line x1="50" y1="10" x2="50" y2="90" stroke="rgba(100,116,139,0.2)" strokeWidth="0.5" strokeDasharray="3,2" />
                <line x1="12" y1="50" x2="88" y2="50" stroke="rgba(100,116,139,0.2)" strokeWidth="0.5" strokeDasharray="3,2" />
                {/* Umbilicus marker */}
                <circle cx="50" cy="50" r="2" fill="none" stroke="rgba(100,116,139,0.3)" strokeWidth="0.5" />
                {/* Quadrant labels */}
                <text x="68" y="40" fontSize="5" fill="rgba(100,116,139,0.4)" textAnchor="middle">RUQ</text>
                <text x="32" y="40" fontSize="5" fill="rgba(100,116,139,0.4)" textAnchor="middle">LUQ</text>
                <text x="68" y="72" fontSize="5" fill="rgba(100,116,139,0.4)" textAnchor="middle">RLQ</text>
                <text x="32" y="72" fontSize="5" fill="rgba(100,116,139,0.4)" textAnchor="middle">LLQ</text>
            </svg>
        );

        if (mode === 'posterior') return (
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
                {/* Left lung */}
                <path d="M 20 15 Q 15 40 18 70 Q 25 80 38 75 Q 48 50 45 15 Z"
                    fill="none" stroke="rgba(100,116,139,0.25)" strokeWidth="1" />
                {/* Right lung */}
                <path d="M 80 15 Q 85 40 82 70 Q 75 80 62 75 Q 52 50 55 15 Z"
                    fill="none" stroke="rgba(100,116,139,0.25)" strokeWidth="1" />
                {/* Spine */}
                <line x1="50" y1="10" x2="50" y2="85" stroke="rgba(100,116,139,0.2)" strokeWidth="1" />
                {[15, 25, 35, 45, 55, 65, 75].map((y, i) => (
                    <rect key={i} x="46" y={y} width="8" height="7" rx="1"
                        fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
                ))}
            </svg>
        );

        if (mode === 'neck') return (
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
                {/* Neck silhouette */}
                <path d="M 35 10 Q 32 30 30 50 Q 28 70 35 85 Q 50 90 65 85 Q 72 70 70 50 Q 68 30 65 10 Z"
                    fill="none" stroke="rgba(100,116,139,0.3)" strokeWidth="1" />
                {/* Trachea */}
                <line x1="50" y1="15" x2="50" y2="80" stroke="rgba(100,116,139,0.2)" strokeWidth="1" strokeDasharray="2,2" />
                {/* Thyroid outline */}
                <ellipse cx="50" cy="58" rx="12" ry="7" fill="none" stroke="rgba(100,116,139,0.2)" strokeWidth="0.5" />
                {/* Carotid labels */}
                <text x="63" y="42" fontSize="4.5" fill="rgba(100,116,139,0.4)" textAnchor="middle">R. Carotid</text>
                <text x="37" y="42" fontSize="4.5" fill="rgba(100,116,139,0.4)" textAnchor="middle">L. Carotid</text>
            </svg>
        );

        return null;
    };

    // Point button colour by type
    const getPointColors = (point, isSelected, hasAudio) => {
        const colorMap = {
            heart:      { selected: 'bg-red-500 ring-2 ring-red-400',    active: 'bg-red-600/80 hover:bg-red-500',     ping: 'bg-red-400' },
            lung:       { selected: 'bg-cyan-500 ring-2 ring-cyan-400',  active: 'bg-cyan-600/80 hover:bg-cyan-500',   ping: 'bg-cyan-400' },
            bowel:      { selected: 'bg-amber-500 ring-2 ring-amber-400', active: 'bg-amber-600/80 hover:bg-amber-500', ping: 'bg-amber-400' },
            vascular:   { selected: 'bg-purple-500 ring-2 ring-purple-400', active: 'bg-purple-600/80 hover:bg-purple-500', ping: 'bg-purple-400' },
        };
        const c = colorMap[point.type] || colorMap.lung;
        if (isSelected) return { btn: `${c.selected} ring-offset-1 ring-offset-slate-900 scale-125`, ping: c.ping };
        if (hasAudio)   return { btn: c.active, ping: null };
        return { btn: 'bg-slate-600 hover:bg-slate-500', ping: null };
    };

    const PointIcon = ({ type }) => {
        if (type === 'heart')                           return <Heart className="w-3.5 h-3.5 text-white" />;
        if (type === 'bowel')    return <Activity className="w-3.5 h-3.5 text-white" />;
        if (type === 'vascular')                        return <Activity className="w-3.5 h-3.5 text-white" />;
        return <Wind className="w-3.5 h-3.5 text-white" />;
    };

    const pointLabelColor = (type) => {
        if (type === 'heart')                           return 'text-red-300';
        if (type === 'bowel')    return 'text-amber-300';
        if (type === 'vascular')                        return 'text-purple-300';
        return 'text-cyan-300';
    };

    return (
        <div className={`rounded-lg border p-4 ${isAbnormal ? 'bg-red-950/30 border-red-800' : 'bg-slate-800/50 border-slate-700'}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Volume2 className="w-5 h-5 text-cyan-400" />
                    <span className="text-white font-medium">Auscultation — {regionName}</span>
                </div>
                {isAbnormal ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 bg-red-900/50 text-red-400 rounded">
                        <AlertTriangle className="w-3 h-3" /> Abnormal
                    </span>
                ) : (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 bg-emerald-900/50 text-emerald-400 rounded">
                        <CheckCircle className="w-3 h-3" /> Normal
                    </span>
                )}
            </div>

            <div className="flex gap-4">
                {/* Anatomy map */}
                <div className="relative bg-slate-900 rounded-lg overflow-hidden flex-shrink-0" style={{ width: '280px', height: '280px' }}>
                    <AnatomySVG />

                    {/* Auscultation points */}
                    {Object.entries(POINTS).map(([id, point]) => {
                        const hasAudio  = !!getAudioForPoint(id);
                        const isSelected = selectedPoint === id;
                        const { btn, ping } = getPointColors(point, isSelected, hasAudio);
                        return (
                            <button
                                key={id}
                                onClick={() => handlePointClick(id)}
                                className={`absolute w-7 h-7 rounded-full transform -translate-x-1/2 -translate-y-1/2 transition-all flex items-center justify-center cursor-pointer ${btn}`}
                                style={{ left: `${point.x}%`, top: `${point.y}%` }}
                                title={`${point.label}: ${point.description}`}
                            >
                                <PointIcon type={point.type} />
                                {isSelected && ping && (
                                    <span className={`absolute inset-0 rounded-full animate-ping opacity-50 ${ping}`} />
                                )}
                            </button>
                        );
                    })}

                    {/* Selected point label */}
                    {currentPoint && (
                        <div className="absolute bottom-1 left-1 right-1 bg-black/70 rounded px-2 py-1 text-center">
                            <div className={`text-xs font-medium flex items-center justify-center gap-1 ${pointLabelColor(currentPoint.type)}`}>
                                <PointIcon type={currentPoint.type} />
                                {currentPoint.label}
                            </div>
                            <div className="text-[10px] text-slate-400">{currentPoint.description}</div>
                        </div>
                    )}
                </div>

                {/* Right side — finding + audio player */}
                <div className="flex-1 flex flex-col">
                    <div className={`flex-1 text-sm leading-relaxed p-3 rounded bg-slate-900/50 mb-3 ${isAbnormal ? 'text-red-200' : 'text-slate-200'}`}>
                        {finding || 'Click on auscultation points to examine'}
                    </div>

                    <audio
                        ref={audioRef}
                        onEnded={() => setIsPlaying(false)}
                        onError={() => console.error('Audio failed to load')}
                    />

                    {currentAudioUrl ? (
                        <div className="bg-slate-900 rounded-lg p-3">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={togglePlay}
                                    className="w-10 h-10 rounded-full bg-cyan-600 hover:bg-cyan-500 flex items-center justify-center transition-colors"
                                >
                                    {isPlaying ? <Pause className="w-5 h-5 text-white" /> : <Play className="w-5 h-5 text-white ml-0.5" />}
                                </button>
                                <div className="flex-1">
                                    <div className="text-xs text-slate-400 mb-1">
                                        {currentPoint ? `${currentPoint.label} sounds` : 'Auscultation sounds'}
                                    </div>
                                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                        <div className={`h-full bg-cyan-500 transition-all ${isPlaying ? 'animate-pulse' : ''}`} style={{ width: isPlaying ? '60%' : '0%' }} />
                                    </div>
                                </div>
                                <button onClick={toggleMute} className="p-2 text-slate-400 hover:text-white">
                                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-slate-900/50 rounded-lg p-3 text-center text-slate-500 text-xs">
                            No audio available for this examination
                        </div>
                    )}
                </div>
            </div>

            {/* Point legend */}
            <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="text-xs text-slate-500 mb-2">Click points to examine:</div>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(POINTS).map(([id, point]) => (
                        <button
                            key={id}
                            onClick={() => handlePointClick(id)}
                            className={`px-2 py-0.5 rounded text-xs transition-colors ${
                                selectedPoint === id ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }`}
                        >
                            {point.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
