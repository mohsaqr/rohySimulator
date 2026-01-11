import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, AlertTriangle, CheckCircle, Heart, Wind } from 'lucide-react';
import EventLogger from '../../services/eventLogger';

/**
 * Auscultation Panel - Zoomed chest view with audio playback
 * Shows specific auscultation points on the chest where sounds can be heard
 * Uses default normal heart/lung sounds if no custom audio provided
 */

// Default audio files for normal findings
const DEFAULT_SOUNDS = {
    heart: '/sounds/normal-heart.mp3',
    lung: '/sounds/normal-lung.mp3'
};

// Auscultation points on the chest (percentage coordinates)
// type: 'heart' or 'lung' determines which default sound to use
const AUSCULTATION_POINTS = {
    aortic: { x: 54, y: 22, label: 'Aortic', description: '2nd ICS, right sternal border', type: 'heart' },
    pulmonic: { x: 46, y: 22, label: 'Pulmonic', description: '2nd ICS, left sternal border', type: 'heart' },
    erb: { x: 46, y: 30, label: "Erb's Point", description: '3rd ICS, left sternal border', type: 'heart' },
    tricuspid: { x: 50, y: 38, label: 'Tricuspid', description: '4th ICS, left sternal border', type: 'heart' },
    mitral: { x: 42, y: 42, label: 'Mitral (Apex)', description: '5th ICS, midclavicular line', type: 'heart' },
    lungLeft: { x: 35, y: 28, label: 'L. Lung', description: 'Left anterior chest', type: 'lung' },
    lungRight: { x: 65, y: 28, label: 'R. Lung', description: 'Right anterior chest', type: 'lung' },
    lungBaseLeft: { x: 38, y: 45, label: 'L. Base', description: 'Left lung base', type: 'lung' },
    lungBaseRight: { x: 62, y: 45, label: 'R. Base', description: 'Right lung base', type: 'lung' }
};

export default function AuscultationPanel({
    finding,
    isAbnormal,
    audioUrl,          // Single audio for the whole region (legacy support)
    audioUrls = {},    // Multiple audio files for different points { pointId: url }
    heartAudio,        // Custom heart sound (overrides default for all heart points)
    lungAudio,         // Custom lung sound (overrides default for all lung points)
    regionName = 'Chest'
}) {
    const [selectedPoint, setSelectedPoint] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [hasAutoPlayed, setHasAutoPlayed] = useState(false);
    const audioRef = useRef(null);

    // Get the appropriate audio URL for a point
    const getAudioForPoint = (pointId) => {
        // Priority: specific point audio > type-specific audio > general audio > default
        if (audioUrls[pointId]) return audioUrls[pointId];

        const point = AUSCULTATION_POINTS[pointId];
        if (point) {
            if (point.type === 'heart' && heartAudio) return heartAudio;
            if (point.type === 'lung' && lungAudio) return lungAudio;
            // Use defaults for normal findings
            if (!isAbnormal) {
                return DEFAULT_SOUNDS[point.type];
            }
        }

        return audioUrl || null;
    };

    const handlePointClick = (pointId) => {
        // Stop current audio
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setSelectedPoint(pointId);
        setIsPlaying(false);

        // Get point info for logging
        const point = AUSCULTATION_POINTS[pointId];
        const audioSrc = getAudioForPoint(pointId);
        const hasAudio = !!audioSrc;

        // Log auscultation event with audio URL
        EventLogger.auscultationPerformed(
            point?.label || pointId,
            point?.type || 'unknown',
            finding || 'No finding',
            hasAudio,
            audioSrc
        );

        // Auto-play the new point's audio
        if (audioSrc && audioRef.current) {
            audioRef.current.src = audioSrc;
            audioRef.current.load();
            audioRef.current.play().then(() => {
                setIsPlaying(true);
            }).catch(err => {
                console.log('Autoplay prevented:', err);
            });
        }
    };

    // Auto-select first point and play on mount
    useEffect(() => {
        if (!hasAutoPlayed && audioRef.current) {
            // Auto-select the first heart point (mitral/apex is clinically most important)
            const defaultPoint = 'mitral';
            setSelectedPoint(defaultPoint);
            setHasAutoPlayed(true);

            const audioSrc = getAudioForPoint(defaultPoint);
            if (audioSrc) {
                audioRef.current.src = audioSrc;
                audioRef.current.load();
                audioRef.current.play().then(() => {
                    setIsPlaying(true);
                }).catch(err => {
                    console.log('Autoplay prevented:', err);
                });
            }

            // Log the auto-played auscultation with audio URL
            const point = AUSCULTATION_POINTS[defaultPoint];
            EventLogger.auscultationPerformed(
                point?.label || defaultPoint,
                point?.type || 'heart',
                finding || 'No finding',
                !!audioSrc,
                audioSrc
            );
        }
    }, [hasAutoPlayed, finding]);

    // Update audio source when point changes (for prop changes)
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
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const toggleMute = () => {
        if (audioRef.current) {
            audioRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const currentAudioUrl = selectedPoint ? getAudioForPoint(selectedPoint) : null;
    const currentPoint = selectedPoint ? AUSCULTATION_POINTS[selectedPoint] : null;

    return (
        <div className={`rounded-lg border p-4 ${isAbnormal ? 'bg-red-950/30 border-red-800' : 'bg-slate-800/50 border-slate-700'}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Volume2 className="w-5 h-5 text-cyan-400" />
                    <span className="text-white font-medium">Auscultation - {regionName}</span>
                </div>
                {isAbnormal ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 bg-red-900/50 text-red-400 rounded">
                        <AlertTriangle className="w-3 h-3" />
                        Abnormal
                    </span>
                ) : (
                    <span className="flex items-center gap-1 text-xs px-2 py-1 bg-emerald-900/50 text-emerald-400 rounded">
                        <CheckCircle className="w-3 h-3" />
                        Normal
                    </span>
                )}
            </div>

            <div className="flex gap-4">
                {/* Zoomed Chest View */}
                <div className="relative bg-slate-900 rounded-lg overflow-hidden" style={{ width: '280px', height: '280px' }}>
                    {/* Chest silhouette background */}
                    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
                        {/* Simple chest outline */}
                        <ellipse cx="50" cy="35" rx="35" ry="30" fill="none" stroke="rgba(100,116,139,0.3)" strokeWidth="1" />
                        {/* Sternum line */}
                        <line x1="50" y1="15" x2="50" y2="55" stroke="rgba(100,116,139,0.2)" strokeWidth="0.5" />
                        {/* Rib lines */}
                        {[20, 28, 36, 44].map((y, i) => (
                            <g key={i}>
                                <path d={`M 50 ${y} Q 35 ${y + 3} 25 ${y + 8}`} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
                                <path d={`M 50 ${y} Q 65 ${y + 3} 75 ${y + 8}`} fill="none" stroke="rgba(100,116,139,0.15)" strokeWidth="0.5" />
                            </g>
                        ))}
                    </svg>

                    {/* Auscultation points */}
                    {Object.entries(AUSCULTATION_POINTS).map(([id, point]) => {
                        const pointHasAudio = !!getAudioForPoint(id);
                        const isSelected = selectedPoint === id;
                        const isHeartPoint = point.type === 'heart';
                        return (
                            <button
                                key={id}
                                onClick={() => handlePointClick(id)}
                                className={`absolute w-7 h-7 rounded-full transform -translate-x-1/2 -translate-y-1/2 transition-all flex items-center justify-center cursor-pointer ${
                                    isSelected
                                        ? isHeartPoint
                                            ? 'bg-red-500 ring-2 ring-red-400 ring-offset-1 ring-offset-slate-900 scale-125'
                                            : 'bg-cyan-500 ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-900 scale-125'
                                        : pointHasAudio
                                        ? isHeartPoint
                                            ? 'bg-red-600/80 hover:bg-red-500 hover:scale-110'
                                            : 'bg-cyan-600/80 hover:bg-cyan-500 hover:scale-110'
                                        : 'bg-slate-600 hover:bg-slate-500'
                                }`}
                                style={{ left: `${point.x}%`, top: `${point.y}%` }}
                                title={`${point.label}: ${point.description}`}
                            >
                                {isHeartPoint ? (
                                    <Heart className="w-3.5 h-3.5 text-white" />
                                ) : (
                                    <Wind className="w-3.5 h-3.5 text-white" />
                                )}
                                {isSelected && (
                                    <span className={`absolute inset-0 rounded-full animate-ping opacity-50 ${isHeartPoint ? 'bg-red-400' : 'bg-cyan-400'}`} />
                                )}
                            </button>
                        );
                    })}

                    {/* Point label */}
                    {currentPoint && (
                        <div className="absolute bottom-1 left-1 right-1 bg-black/70 rounded px-2 py-1 text-center">
                            <div className={`text-xs font-medium flex items-center justify-center gap-1 ${currentPoint.type === 'heart' ? 'text-red-300' : 'text-cyan-300'}`}>
                                {currentPoint.type === 'heart' ? <Heart className="w-3 h-3" /> : <Wind className="w-3 h-3" />}
                                {currentPoint.label}
                            </div>
                            <div className="text-[10px] text-slate-400">{currentPoint.description}</div>
                        </div>
                    )}
                </div>

                {/* Right side - Finding and Audio */}
                <div className="flex-1 flex flex-col">
                    {/* Finding text */}
                    <div className={`flex-1 text-sm leading-relaxed p-3 rounded bg-slate-900/50 mb-3 ${isAbnormal ? 'text-red-200' : 'text-slate-200'}`}>
                        {finding || 'Click on auscultation points to examine'}
                    </div>

                    {/* Hidden audio element - always rendered so ref is available */}
                    <audio
                        ref={audioRef}
                        onEnded={() => setIsPlaying(false)}
                        onError={() => console.error('Audio failed to load')}
                    />

                    {/* Audio Player */}
                    {currentAudioUrl ? (
                        <div className="bg-slate-900 rounded-lg p-3">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={togglePlay}
                                    className="w-10 h-10 rounded-full bg-cyan-600 hover:bg-cyan-500 flex items-center justify-center transition-colors"
                                >
                                    {isPlaying ? (
                                        <Pause className="w-5 h-5 text-white" />
                                    ) : (
                                        <Play className="w-5 h-5 text-white ml-0.5" />
                                    )}
                                </button>
                                <div className="flex-1">
                                    <div className="text-xs text-slate-400 mb-1">
                                        {currentPoint ? `${currentPoint.label} sounds` : 'Heart/Lung sounds'}
                                    </div>
                                    <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                                        <div className={`h-full bg-cyan-500 transition-all ${isPlaying ? 'animate-pulse' : ''}`} style={{ width: isPlaying ? '60%' : '0%' }} />
                                    </div>
                                </div>
                                <button
                                    onClick={toggleMute}
                                    className="p-2 text-slate-400 hover:text-white"
                                >
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

            {/* Auscultation point legend */}
            <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="text-xs text-slate-500 mb-2">Click points to examine:</div>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(AUSCULTATION_POINTS).map(([id, point]) => (
                        <button
                            key={id}
                            onClick={() => handlePointClick(id)}
                            className={`px-2 py-0.5 rounded text-xs transition-colors ${
                                selectedPoint === id
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
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
